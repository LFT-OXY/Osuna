import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type {
  ApiEndpointBaseUrl,
  ApiEndpointListResponse,
  ApiEndpointModel,
  ApiEndpointSaveResponse,
  ApiEndpointSetAgentSettingsResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { connectDaemonClient } from "./daemon-client-loader";
import { getE2EDaemonPort } from "./daemon-port";

/*
 * 第三方接口页的 e2e 夹具：本机假中转站、带接口方法的 daemon 客户端、经真实中转站让某家进入冷却。
 * 绝不访问真实的中转站。spec 必须把 CLAUDE_CONFIG_DIR / CODEX_HOME 指到临时目录（e2eDaemonEnvironment），
 * 否则打开总开关会改写开发者自己的 CLI 配置。
 */

export const RELAY_KEY = "sk-e2e-relay";

export interface FakeRelay {
  origin: string;
  // 收到的请求，按到达顺序；只记路径与认证头。
  requests: { method: string; url: string; authorization: string | undefined }[];
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * 路径前缀决定这家的行为：
 * - /good：列出模型；Anthropic 与 Chat 能对话，Responses 没有（404）。
 * - /broke：Anthropic 对话回 402 欠费（中转站让它冷却 30 分钟）。
 * - /reject：Anthropic 对话回 401（中转站把它标成需要检查）。
 * 任何路径上 key 不对都回 401。
 */
export async function startFakeRelay(): Promise<FakeRelay> {
  const relay: Omit<FakeRelay, "close"> = { origin: "", requests: [] };
  const server: Server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const url = request.url ?? "";
      const headers: IncomingHttpHeaders = request.headers;
      relay.requests.push({
        method: request.method ?? "",
        url,
        authorization: headers.authorization,
      });
      if (headers.authorization !== `Bearer ${RELAY_KEY}`) {
        send(response, 401, { error: { message: "Invalid API key" } });
        return;
      }
      if (request.method === "GET" && url === "/good/v1/models") {
        send(response, 200, { data: [{ id: "claude-sonnet-4-5" }, { id: "gpt-5" }] });
        return;
      }
      if (url === "/good/v1/messages") {
        send(response, 200, { type: "message", content: [{ type: "text", text: "hi" }] });
        return;
      }
      if (url === "/good/v1/chat/completions") {
        send(response, 200, { choices: [{ message: { role: "assistant", content: "hi" } }] });
        return;
      }
      if (url === "/broke/v1/messages") {
        send(response, 402, { error: { message: "insufficient balance" } });
        return;
      }
      if (url === "/reject/v1/messages") {
        send(response, 401, { error: { message: "This key has been revoked" } });
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  relay.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin: relay.origin,
    requests: relay.requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

interface ApiEndpointSeedClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  apiEndpointList(provider: string): Promise<ApiEndpointListResponse["payload"]>;
  apiEndpointSave(options: {
    provider: string;
    endpointId?: string;
    name: string;
    baseUrls: ApiEndpointBaseUrl[];
    apiKey?: string;
    models: ApiEndpointModel[];
  }): Promise<ApiEndpointSaveResponse["payload"]>;
  apiEndpointDelete(provider: string, endpointId: string): Promise<unknown>;
  apiEndpointSetAgentSettings(options: {
    provider: string;
    enabled: boolean;
  }): Promise<ApiEndpointSetAgentSettingsResponse["payload"]>;
  apiEndpointDetectFormats(options: {
    endpointId?: string;
    baseUrl: string;
    apiKey?: string;
  }): Promise<{ results: { format: string; status: string }[]; error: unknown }>;
}

export async function connectApiEndpointClient(): Promise<ApiEndpointSeedClient> {
  return connectDaemonClient<ApiEndpointSeedClient>({ clientIdPrefix: "api-endpoints" });
}

/** 存一家主机级接口（新客户端写法，存好即开着），返回它的 id。 */
export async function seedApiEndpoint(
  client: ApiEndpointSeedClient,
  input: { name: string; baseUrls: ApiEndpointBaseUrl[]; models: string[] },
): Promise<string> {
  const saved = await client.apiEndpointSave({
    provider: "claude",
    name: input.name,
    baseUrls: input.baseUrls,
    apiKey: RELAY_KEY,
    models: input.models.map((id) => ({ id })),
  });
  if (!saved.endpoint) throw new Error(`Saving ${input.name} failed: ${saved.error?.message}`);
  return saved.endpoint.id;
}

/** 关掉两个 Agent 的总开关、删掉所有接口，让同一 worker 里的下一个用例从空开始。 */
export async function resetApiEndpoints(client: ApiEndpointSeedClient): Promise<void> {
  for (const provider of ["claude", "codex"]) {
    await client.apiEndpointSetAgentSettings({ provider, enabled: false });
  }
  const list = await client.apiEndpointList("claude");
  for (const endpoint of list.endpoints) {
    await client.apiEndpointDelete("claude", endpoint.id);
  }
}

/**
 * 像 Claude Code 那样经 daemon 中转站发一条对话，让选中这个模型的接口按上游的回复进入冷却或需要检查。
 * 调用前 Claude Code 的总开关要开着（口令从 gateway-tokens.json 读）。
 */
export async function sendThroughGateway(model: string): Promise<number> {
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("E2E_PASEO_HOME is not set (expected from the Playwright worker).");
  const tokens = JSON.parse(
    await readFile(path.join(home, "api-endpoints", "gateway-tokens.json"), "utf8"),
  ) as { tokens: Record<string, string> };
  const token = tokens.tokens.claude;
  if (!token) throw new Error("Claude Code has no gateway token; turn its switch on first.");
  const response = await fetch(
    `http://127.0.0.1:${getE2EDaemonPort()}/api-endpoint-gateway/v1/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    },
  );
  await response.text();
  return response.status;
}
