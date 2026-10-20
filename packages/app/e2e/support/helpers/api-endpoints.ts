import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { z } from "zod";
import type {
  ApiEndpointBaseUrl,
  ApiEndpointListResponse,
  ApiEndpointModel,
  ApiEndpointModelSettings,
  ApiEndpointSaveResponse,
  ApiEndpointSetAgentSettingsResponse,
  ApiEndpointListTemplatesResponse,
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
  // 收到的请求，按到达顺序；只记路径、认证头与请求体里的模型名。
  requests: {
    method: string;
    url: string;
    authorization: string | undefined;
    // Azure 的 key 头。
    apiKey: string | undefined;
    model: string | undefined;
    // 表明是哪个 CLI 的头（按 Claude Code / Codex 的样子测时带的）。
    userAgent: string | undefined;
    originator: string | undefined;
    stream: boolean;
  }[];
  // /good 列出的模型；用例可以改它模拟上游清单变化。
  goodModels: string[];
  // 问 slow-* 挂着的请求里被对方断开的个数（测试模型被取消时 daemon 断开它们）。
  abandoned: number;
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * 路径前缀决定这家的行为：
 * - /good：列出 goodModels；Anthropic 与 Chat 能对话，Responses 没有（404）。
 * - /many：列出 MANY_MODELS（两百多个、跨家族），给详情页截图用。
 * - /slow：什么都不回（列模型、对话），详情页停在加载中，添加窗口里的拉模型、测试、检测停在进行中。
 * - /nolist：列不出模型（404），其余同 /good。
 * - /broke：Anthropic 对话回 402 欠费（中转站让它冷却 30 分钟）。
 * - /reject：Anthropic 对话回 401（中转站把它标成需要检查）。
 * - /free：像不要 key 的本机服务，谁来都答，其余同 /good。
 * - /azure：像 Azure OpenAI 的资源，key 只认 api-key 头；/azure/openai/deployments 列出 AZURE_DEPLOYMENTS。
 * - 测试模型用：/good 上对话请求问 bad-* 回 404（模型不存在），问 slow-* 什么都不回；cc-only-* 只答 User-Agent 是
 *   Claude Code 的，codex-only-* 只答 originator 是 Codex 的（照只放行某 CLI 的分组），别的回 403。
 * 除 /free 外，任何路径上 key 不对都回 401。
 */
export async function startFakeRelay(): Promise<FakeRelay> {
  const relay: Omit<FakeRelay, "close"> = {
    origin: "",
    requests: [],
    goodModels: ["claude-sonnet-4-5", "gpt-5"],
    abandoned: 0,
  };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const headers: IncomingHttpHeaders = request.headers;
      const text = Buffer.concat(chunks).toString("utf8");
      const isFree = (request.url ?? "").startsWith("/free/");
      const isNoList = (request.url ?? "").startsWith("/nolist/");
      const url = (request.url ?? "").replace(/^\/(free|nolist)\//, "/good/");
      relay.requests.push(recordOf({ request, text }));
      if (url.startsWith("/azure/")) {
        answerAzure({ url, apiKey: headers["api-key"], response });
        return;
      }
      if (!isFree && headers.authorization !== `Bearer ${RELAY_KEY}`) {
        send(response, 401, { error: { message: "Invalid API key" } });
        return;
      }
      const model = relay.requests.at(-1)?.model;
      const onAbandoned = () => {
        relay.abandoned += 1;
      };
      if (turnsAwayOtherClients({ url, model, headers, response })) return;
      if (holdsOrLacksList({ url, isNoList, model, response, onAbandoned })) return;
      if (request.method === "GET" && url === "/good/v1/models") {
        send(response, 200, { data: relay.goodModels.map((id) => ({ id })) });
        return;
      }
      if (request.method === "GET" && url === "/many/v1/models") {
        send(response, 200, { data: MANY_MODELS.map((id) => ({ id })) });
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
  // 返回同一个对象：用例改 goodModels、清 requests 都直接作用到假中转站上。
  return Object.assign(relay, {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}

export const CLAUDE_CODE_ONLY = "This group only allows Claude Code clients";
export const CODEX_ONLY = "This account only allows Codex official clients";

/** 只放行某个 CLI 的分组：cc-only-* 不是 Claude Code、codex-only-* 不是 Codex 发的回 403。返回 true 即已回。 */
function turnsAwayOtherClients(input: {
  url: string;
  model: string | undefined;
  headers: IncomingHttpHeaders;
  response: ServerResponse;
}): boolean {
  const { model, headers } = input;
  const isChatRequest = input.url.startsWith("/good/") && !input.url.endsWith("/models");
  if (!isChatRequest || model === undefined) return false;
  const isClaudeCode = String(headers["user-agent"] ?? "").startsWith("claude-cli/");
  if (model.startsWith("cc-only-") && !isClaudeCode) {
    send(input.response, 403, { error: { message: CLAUDE_CODE_ONLY } });
    return true;
  }
  if (model.startsWith("codex-only-") && headers.originator !== "codex_cli_rs") {
    send(input.response, 403, { error: { message: CODEX_ONLY } });
    return true;
  }
  return false;
}

/** /good 上的对话请求：bad-* 回 404，slow-* 不回。返回 true 即已处理（或故意不回）。 */
function answersByModel(input: {
  url: string;
  model: string | undefined;
  response: ServerResponse;
  onAbandoned: () => void;
}): boolean {
  const { url, model } = input;
  const isChatRequest = url.startsWith("/good/") && !url.endsWith("/models");
  if (!isChatRequest || model === undefined) return false;
  if (model.startsWith("slow-")) {
    input.response.on("close", input.onAbandoned);
    return true;
  }
  if (!model.startsWith("bad-")) return false;
  send(input.response, 404, { error: { message: `The model ${model} does not exist` } });
  return true;
}

/** /slow 什么都不回；/nolist 列模型回 404；再按模型名答（answersByModel）。返回 true 即已处理（或故意不回）。 */
function holdsOrLacksList(input: {
  url: string;
  isNoList: boolean;
  model: string | undefined;
  response: ServerResponse;
  onAbandoned: () => void;
}): boolean {
  if (answersByModel(input)) return true;
  if (input.url.startsWith("/slow/")) return true;
  if (!input.isNoList || !input.url.endsWith("/models")) return false;
  input.response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
  return true;
}

export const AZURE_DEPLOYMENTS = ["my-gpt-deployment", "my-kimi-deployment"];

function answerAzure(input: {
  url: string;
  apiKey: string | string[] | undefined;
  response: ServerResponse;
}): void {
  if (input.apiKey !== RELAY_KEY) {
    send(input.response, 401, { error: { code: "401", message: "Access denied: invalid key" } });
    return;
  }
  if (input.url === "/azure/openai/deployments?api-version=2022-12-01") {
    send(input.response, 200, {
      object: "list",
      data: AZURE_DEPLOYMENTS.map((id) => ({ id, model: "gpt-5.5" })),
    });
    return;
  }
  send(input.response, 404, { error: { code: "404", message: "Resource not found" } });
}

/** 假中转站记下的一条请求。 */
function recordOf(input: {
  request: IncomingMessage;
  text: string;
}): FakeRelay["requests"][number] {
  const { request, text } = input;
  const { headers } = request;
  return {
    method: request.method ?? "",
    url: request.url ?? "",
    authorization: headers.authorization,
    apiKey: typeof headers["api-key"] === "string" ? headers["api-key"] : undefined,
    model: modelOf(text),
    userAgent: headers["user-agent"],
    originator: typeof headers.originator === "string" ? headers.originator : undefined,
    stream: streamOf(text),
  };
}

/** 请求体要不要流式回答（读不出的按不要）。 */
function streamOf(body: string): boolean {
  try {
    return (JSON.parse(body) as { stream?: unknown }).stream === true;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function modelOf(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    return typeof parsed.model === "string" ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

// 两百多个模型：常见家族各若干，外加一大批认不出的，详情页截图看左右两栏的滚动。
export const MANY_MODELS: string[] = [
  "claude-opus-4-1",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-3-7-sonnet",
  "claude-opus-4",
  "claude-3-5-haiku",
  ...Array.from({ length: 11 }, (_, index) => `gpt-5.${index}`),
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemma-3-27b",
  "gemini-exp",
  "gemini-2.5-flash-lite",
  "gemma-3-12b",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v3.1",
  "deepseek-v3.2-exp",
  "kimi-k2",
  "kimi-k2-turbo",
  "moonshot-v1-8k",
  "glm-4.6",
  "glm-4.5",
  "glm-4.5-air",
  "glm-4.5v",
  ...Array.from({ length: 12 }, (_, index) => `qwen3-coder-${index + 1}`),
  "grok-4",
  "grok-code-fast-1",
  "mistral-large",
  "codestral-latest",
  "MiniMax-M2",
  ...Array.from(
    { length: 170 },
    (_, index) => `vendor/model-${String(index + 1).padStart(3, "0")}`,
  ),
];

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
    templateId?: string;
    region?: string;
    icon?: string | null;
    modelScope?: string;
    autoPick?: string[];
    modelSettings?: ApiEndpointModelSettings;
  }): Promise<ApiEndpointSaveResponse["payload"]>;
  apiEndpointListTemplates(): Promise<ApiEndpointListTemplatesResponse["payload"]>;
  apiEndpointStoreIcon(options: {
    data: string;
  }): Promise<{ icon: string | null; error: { code: string; message: string } | null }>;
  apiEndpointReadIcon(options: { icon: string }): Promise<{
    icon: { data: string; mimeType: string } | null;
    error: { code: string; message: string } | null;
  }>;
  apiEndpointDelete(provider: string, endpointId: string): Promise<unknown>;
  apiEndpointSetAgentSettings(options: {
    provider: string;
    enabled: boolean;
    defaultModelId?: string;
    keepsClaudeAiLogin?: boolean;
    defaultThinkingOptionId?: string | null;
    usesUltraCode?: boolean;
    backgroundModelId?: string | null;
    subagentModelId?: string | null;
    subagentThinkingOptionId?: string | null;
    memoryModelId?: string | null;
    forcedSubagentModelId?: string | null;
    allowsAnySubagentModel?: boolean;
  }): Promise<ApiEndpointSetAgentSettingsResponse["payload"]>;
  apiEndpointSetEndpointState(options: {
    endpointId: string;
    enabled: boolean;
  }): Promise<{ error: { code: string; message: string } | null }>;
  apiEndpointSetLongConversations(options: {
    fullContext: boolean;
    compactAt?: number | null;
  }): Promise<{ error: { code: string; message: string } | null }>;
  apiEndpointSetDisabledModels(options: {
    models: string[];
  }): Promise<{ error: { code: string; message: string } | null }>;
  apiEndpointSetEndpointNameDisplay(options: {
    display: string;
  }): Promise<{ error: { code: string; message: string } | null }>;
  apiEndpointFetchModels(options: {
    provider: string;
    endpointId?: string;
    baseUrl: string;
    format?: string;
  }): Promise<{ models: ApiEndpointModel[]; error: { code: string; message: string } | null }>;
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
  input: {
    name: string;
    baseUrls: ApiEndpointBaseUrl[];
    models: string[];
    apiKey?: string;
    // 服务范围；省略即「只用挑选的」。
    modelScope?: string;
  },
): Promise<string> {
  const saved = await client.apiEndpointSave({
    provider: "claude",
    name: input.name,
    baseUrls: input.baseUrls,
    apiKey: input.apiKey ?? RELAY_KEY,
    models: input.models.map((id) => ({ id })),
    ...(input.modelScope !== undefined ? { modelScope: input.modelScope } : {}),
  });
  if (!saved.endpoint) throw new Error(`Saving ${input.name} failed: ${saved.error?.message}`);
  return saved.endpoint.id;
}

/** 关掉两个 Agent 的总开关、删掉所有接口，让同一 worker 里的下一个用例从空开始。 */
export async function resetApiEndpoints(client: ApiEndpointSeedClient): Promise<void> {
  for (const provider of ["claude", "codex"]) {
    await client.apiEndpointSetAgentSettings({ provider, enabled: false });
  }
  // 「保留 claude.ai 登录」与默认思考档位关着也记着，不清掉会带进下一个用例。
  // 后台小任务、Subagent 与记忆模型也一样。
  await client.apiEndpointSetAgentSettings({
    provider: "claude",
    enabled: false,
    keepsClaudeAiLogin: false,
    defaultThinkingOptionId: null,
    usesUltraCode: false,
    backgroundModelId: null,
    subagentModelId: null,
    subagentThinkingOptionId: null,
  });
  await client.apiEndpointSetAgentSettings({
    provider: "codex",
    enabled: false,
    defaultThinkingOptionId: null,
    subagentModelId: null,
    subagentThinkingOptionId: null,
    memoryModelId: null,
    forcedSubagentModelId: null,
    allowsAnySubagentModel: false,
  });
  // 长对话是整台主机的设置，同样会带进下一个用例。
  await client.apiEndpointSetLongConversations({ fullContext: false, compactAt: null });
  await client.apiEndpointSetDisabledModels({ models: [] });
  await client.apiEndpointSetEndpointNameDisplay({ display: "always" });
  const list = await client.apiEndpointList("claude");
  for (const endpoint of list.endpoints) {
    await client.apiEndpointDelete("claude", endpoint.id);
  }
  await forgetTakeovers();
}

/**
 * 开关关着时接管记录还留着上次关掉前的默认模型（reconnect），下次打开会挑它（ADR 0012 的 again）。
 * 开关都关着、没有接管时删掉这两份记录，下一个用例从没接过的样子开始。
 */
async function forgetTakeovers(): Promise<void> {
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("E2E_PASEO_HOME is not set (expected from the Playwright worker).");
  for (const name of ["takeover-claude.json", "takeover-codex.json"]) {
    const filePath = path.join(home, "api-endpoints", name);
    if (!existsSync(filePath)) continue;
    const text = await readFile(filePath, "utf8");
    // 还接管着（关掉没成）就留着，不替 daemon 丢掉原值。
    const { takeover } = TakeoverRecordSchema.parse(JSON.parse(text));
    if (takeover === null) await rm(filePath);
  }
}

const TakeoverRecordSchema = z.object({ takeover: z.unknown() });

export const CLAUDE_CODE_SAMPLE = {
  "user-agent": "claude-cli/2.1.302 (external, cli)",
  "x-app": "cli",
  "anthropic-version": "2023-06-01",
};

/**
 * 中转站记下的 CLI 请求头样本（按 Claude Code / Codex 的样子测用）：给了就写成 daemon 记下的样子，null 即删掉。
 * 记下样本本身由 daemon 的 e2e 经中转站测，这里只摆好状态。
 */
export async function setCliHeaderSamples(
  samples: { claude_code?: Record<string, string> } | null,
): Promise<void> {
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("E2E_PASEO_HOME is not set (expected from the Playwright worker).");
  const filePath = path.join(home, "api-endpoints", "cli-header-samples.json");
  if (samples === null) {
    await rm(filePath, { force: true });
    return;
  }
  await writeFile(filePath, JSON.stringify(samples, null, 2), { mode: 0o600 });
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
