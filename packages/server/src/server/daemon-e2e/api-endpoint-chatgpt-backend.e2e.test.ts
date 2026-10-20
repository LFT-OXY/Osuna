// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend_test.go 的
// TestCodexOwnModelPassesThrough、TestCodexWebSocketUpgradeRequired、TestCodexNativeModelStaysNative；
// codexModels、codexModelsWait、codexClientHeader、alphaSearchHere、codexCompact、plainCompact、localSummary 与 compactFails 的做法；
// 工单 24 照 codex_spawn_models_test.go 的 TestSpawnAgentNamesEveryModel、codex_subagent_test.go 的 TestCodexSubagentPutOnTheModelSet
// 与 codexcat.go 的 CacheEntries）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  CODEX_COMPACT_PROMPT,
  CODEX_SUMMARY_PREFIX,
} from "../api-endpoints/gateway/codex-compaction.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 中转站的 ChatGPT 后端那组路径（工单 08，ADR 0010）：真实 daemon + 本机假 ChatGPT 后端与假 OpenAI API，
 * 从不连真的 chatgpt.com。「Codex」用 node:http 扮演，请求头逐个由测试定（fetch 会自己加、也不让带逐跳头）。
 */

const CHATGPT_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
const ACCOUNT_ID = "acct-0123456789";
const CODEX_UA = "codex_cli_rs/0.130.0 (Mac OS 26.0; arm64) iTerm.app/3.6.5";

// 逐跳头与 Host：不比较。Node 的客户端自己会写 Host 与 Connection。
const NOT_COMPARED = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface FakeBackend {
  url: string;
  requests: RecordedRequest[];
  respond: (request: RecordedRequest, res: ServerResponse) => void;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const servers: Server[] = [];
const tempRoots: string[] = [];
const daemons: TestPaseoDaemon[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function startBackend(): Promise<FakeBackend> {
  const backend: FakeBackend = {
    url: "",
    requests: [],
    respond: (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    },
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      backend.requests.push(request);
      backend.respond(request, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  backend.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return backend;
}

interface EndpointFixture {
  id: string;
  slug: string;
  url: string;
  models: Array<{ id: string; facts?: Record<string, unknown> }>;
}

const RELAY_A: EndpointFixture = {
  id: "ep_a",
  slug: "relay-a",
  url: "http://127.0.0.1:9/v1",
  models: [{ id: "gpt-5.5" }],
};

/** 起 daemon：Codex 开着；ChatGPT 后端与 OpenAI API 的地址换成本机的假后端。 */
async function start(input: {
  chatgptBaseUrl: string;
  openAiApiBaseUrl?: string;
  endpoints?: EndpointFixture[];
  modelsWaitMs?: number;
  // Codex 的默认模型；缺省第一家的第一个模型。
  defaultModelId?: string;
  // 强制 Subagent 模型与「Codex Subagent 可用任意模型」；缺省没设、关着。
  forcedSubagentModelId?: string;
  allowsAnySubagentModel?: boolean;
  // 已禁用的模型；缺省没有。
  disabledModels?: string[];
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-chatgpt-backend-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  const codexHome = path.join(root, "codex");
  await mkdir(endpointsDir, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  const fixtures = input.endpoints ?? [RELAY_A];
  const endpoints = {
    endpoints: fixtures.map((fixture) => ({
      id: fixture.id,
      slug: fixture.slug,
      name: fixture.slug.toUpperCase(),
      baseUrls: [{ format: "openai_responses", url: fixture.url }],
      models: fixture.models.map(({ id }) => ({ id })),
      catalog: {
        fetchedAt: "2026-10-01T00:00:00.000Z",
        models: fixture.models.map(({ id, facts }) => ({ id, ...(facts ? { facts } : {}) })),
      },
      enabled: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    })),
    agents: {
      codex: {
        enabled: true,
        defaultModelId: input.defaultModelId ?? fixtures[0]!.models[0]!.id,
        forcedSubagentModelId: input.forcedSubagentModelId ?? null,
        allowsAnySubagentModel: input.allowsAnySubagentModel === true,
      },
    },
    ...(input.disabledModels ? { disabledModels: input.disabledModels } : {}),
  };
  await writeFile(path.join(endpointsDir, "endpoints.json"), JSON.stringify(endpoints));
  await writeFile(
    path.join(endpointsDir, "keys.json"),
    JSON.stringify({
      keys: Object.fromEntries(fixtures.map((fixture) => [fixture.id, `sk-${fixture.slug}-key`])),
    }),
  );
  await writeFile(
    path.join(endpointsDir, "gateway-tokens.json"),
    JSON.stringify({ tokens: { codex: "gateway-token-codex-0123456789" } }),
  );
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: codexHome },
      homeDir: root,
      gatewayChatGptBaseUrl: input.chatgptBaseUrl,
      gatewayOpenAiApiBaseUrl: input.openAiApiBaseUrl ?? "http://127.0.0.1:9/v1",
      gatewayChatGptModelsWaitMs: input.modelsWaitMs,
    },
  });
  daemons.push(daemon);
  return {
    daemon,
    codexHome,
    endpointsDir,
    codexBase: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway/backend-api/codex`,
  };
}

/** 扮演 Codex 发一个请求，读完整份回复；onData 每收到一段就拿到目前收到的全部文字。 */
function send(input: {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: Buffer;
  onData?: (soFar: string) => void;
}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      input.url,
      { method: input.method ?? "POST", headers: input.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          input.onData?.(Buffer.concat(chunks).toString("utf8"));
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    sent.on("error", reject);
    sent.end(input.body);
  });
}

/** ChatGPT 登录的 Codex 发对话请求时带的那些头（research/codex-wiring.md 第 3 题）。 */
function codexHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${CHATGPT_TOKEN}`,
    "chatgpt-account-id": ACCOUNT_ID,
    "user-agent": CODEX_UA,
    originator: "codex_cli_rs",
    version: "0.130.0",
    "session-id": "019a-session",
    "thread-id": "019a-thread",
    "x-client-request-id": "019a-thread",
    "x-codex-turn-metadata": '{"turn_id":"t1"}',
    "x-codex-beta-features": "unified_exec",
    accept: "text/event-stream",
    "accept-encoding": "gzip, br",
    "content-type": "application/json",
    ...extra,
  };
}

function compared(headers: IncomingHttpHeaders): Record<string, unknown> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !NOT_COMPARED.has(name)));
}

function sse(...events: string[]): string {
  return events.map((event) => `data: ${event}\n\n`).join("");
}

describe("Codex's ChatGPT requests through the gateway", () => {
  test("a turn reaches ChatGPT with its path, query, headers and body as Codex sent them, and the stream comes back as it streams", async () => {
    const chatgpt = await startBackend();
    // 第二段等「Codex」收到第一段后才写：中转站要是攒着整份回复，这里就等不到。
    let releaseRest: () => void = () => {};
    const restReleased = new Promise<void>((resolve) => {
      releaseRest = resolve;
    });
    chatgpt.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "x-codex-turn-state": "ts-1" });
      res.write(sse('{"type":"response.created","response":{"id":"r1"}}'));
      void restReleased.then(() =>
        res.end(sse('{"type":"response.completed","response":{"id":"r1"}}')),
      );
    };
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });
    // zstd 压过的请求体：中转站不解也不改，所以这里用不是 zstd 的字节也照样到达。
    const body = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01, 0x02, 0xff, 0xfe]);
    const headers = codexHeaders({
      "content-encoding": "zstd",
      "content-length": String(body.length),
      connection: "keep-alive",
      "keep-alive": "timeout=5",
    });

    const turn = await send({
      url: `${codexBase}/responses?client_version=0.130.0&trace=1`,
      headers,
      body,
      onData: (soFar) => {
        if (soFar.includes("response.created")) releaseRest();
      },
    });

    expect(turn.status).toBe(200);
    expect(turn.headers["x-codex-turn-state"]).toBe("ts-1");
    expect(turn.body.toString("utf8")).toBe(
      sse(
        '{"type":"response.created","response":{"id":"r1"}}',
        '{"type":"response.completed","response":{"id":"r1"}}',
      ),
    );
    expect(chatgpt.requests).toHaveLength(1);
    const reached = chatgpt.requests[0]!;
    expect(reached.method).toBe("POST");
    expect(reached.url).toBe("/backend-api/codex/responses?client_version=0.130.0&trace=1");
    expect(reached.body.equals(body)).toBe(true);
    // 除逐跳头与 Host 外一个不少、一个不多：ChatGPT 令牌与账号 id 照带，Osuna 不加自己的头。
    expect(compared(reached.headers)).toEqual(compared(headers));
  });

  test("compaction, search and any other path go to ChatGPT as they came for ChatGPT's own models", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (request, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: '"list-1"' });
      res.end(JSON.stringify({ path: request.url }));
    };
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });

    const calls = [
      { method: "POST", path: "/responses/compact" },
      { method: "POST", path: "/alpha/search" },
      { method: "POST", path: "/memories/trace_summarize" },
    ];
    for (const call of calls) {
      const body =
        call.method === "POST" ? Buffer.from('{"model":"gpt-5.5","input":"hi"}') : undefined;
      const headers = codexHeaders(body ? { "content-length": String(body.length) } : {});
      const reply = await send({
        url: `${codexBase}${call.path}`,
        method: call.method,
        headers,
        body,
      });
      expect(reply.status, call.path).toBe(200);
      expect(reply.headers.etag, call.path).toBe('"list-1"');
      expect(JSON.parse(reply.body.toString("utf8")), call.path).toEqual({
        path: `/backend-api/codex${call.path}`,
      });
      const reached = chatgpt.requests.at(-1)!;
      expect(reached.method, call.path).toBe(call.method);
      expect(compared(reached.headers), call.path).toEqual(compared(headers));
      expect(reached.body.equals(body ?? Buffer.alloc(0)), call.path).toBe(true);
    }
    expect(chatgpt.requests).toHaveLength(calls.length);
  });

  test("ChatGPT's 401 and 403 come back to Codex as they are", async () => {
    const chatgpt = await startBackend();
    const refusals: Record<string, { status: number; body: string }> = {
      "/responses": {
        status: 401,
        body: '{"detail":"Could not parse your authentication token. Please try signing in again."}',
      },
      "/models": { status: 403, body: '{"detail":{"code":"deactivated_workspace"}}' },
    };
    chatgpt.respond = (request, res) => {
      const refusal = refusals[request.url.split("?")[0]!.slice("/backend-api/codex".length)]!;
      res.writeHead(refusal.status, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="chatgpt"',
      });
      res.end(refusal.body);
    };
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });

    const turn = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-length": "2" }),
      body: Buffer.from("{}"),
    });
    expect(turn.status).toBe(401);
    expect(turn.headers["www-authenticate"]).toBe('Bearer realm="chatgpt"');
    expect(turn.body.toString("utf8")).toBe(refusals["/responses"]!.body);

    const models = await send({
      url: `${codexBase}/models?client_version=0.130.0`,
      method: "GET",
      headers: codexHeaders(),
    });
    expect(models.status).toBe(403);
    expect(models.body.toString("utf8")).toBe(refusals["/models"]!.body);
  });

  test("a WebSocket handshake gets 426 and nothing reaches ChatGPT", async () => {
    const chatgpt = await startBackend();
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });

    // 直接读 socket 上收到的全部字节，直到连接关闭：只能有 426 这一个回复，后面不能再跟 /ws 服务的 400。
    const port = new URL(codexBase).port;
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), "127.0.0.1", () => {
        socket.write(
          [
            "GET /api-endpoint-gateway/backend-api/codex/responses HTTP/1.1",
            `Host: 127.0.0.1:${port}`,
            `Authorization: Bearer ${CHATGPT_TOKEN}`,
            `User-Agent: ${CODEX_UA}`,
            "Connection: Upgrade",
            "Upgrade: websocket",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version: 13",
            "",
            "",
          ].join("\r\n"),
        );
      });
      let received = "";
      socket.on("data", (chunk: Buffer) => {
        received += chunk.toString("utf8");
      });
      socket.on("close", () => resolve(received));
      socket.on("error", reject);
    });

    expect(raw.startsWith("HTTP/1.1 426 Upgrade Required\r\n")).toBe(true);
    expect(raw.match(/HTTP\/1\.1 \d{3}/g)).toEqual(["HTTP/1.1 426"]);
    expect(chatgpt.requests).toHaveLength(0);
  });

  test("a Codex signed in with an API key goes to the OpenAI API, its model list still to ChatGPT", async () => {
    const chatgpt = await startBackend();
    const openAi = await startBackend();
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      openAiApiBaseUrl: `${openAi.url}/v1`,
    });
    const headers = {
      authorization: "Bearer sk-proj-0123456789",
      "user-agent": CODEX_UA,
      "content-type": "application/json",
    };

    for (const suffix of ["/responses", "/responses/compact"]) {
      const body = Buffer.from('{"model":"gpt-5.5","input":"hi"}');
      const reply = await send({
        url: `${codexBase}${suffix}`,
        headers: { ...headers, "content-length": String(body.length) },
        body,
      });
      expect(reply.status, suffix).toBe(200);
      expect(openAi.requests.at(-1)?.url, suffix).toBe(`/v1${suffix}`);
    }
    const models = await send({
      url: `${codexBase}/models?client_version=0.130.0`,
      method: "GET",
      headers,
    });
    expect(models.status).toBe(200);
    expect(chatgpt.requests.map((request) => request.url)).toEqual([
      "/backend-api/codex/models?client_version=0.130.0",
    ]);
    expect(openAi.requests).toHaveLength(2);
  });

  test("the OpenAI API refusing Codex's API key comes back as a 401 saying what to do", async () => {
    const openAi = await startBackend();
    openAi.respond = (_request, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        '{"error":{"message":"Incorrect API key provided: sk-proj-***789.","type":"invalid_request_error","code":"invalid_api_key"}}',
      );
    };
    const { codexBase } = await start({
      chatgptBaseUrl: "http://127.0.0.1:9/backend-api/codex",
      openAiApiBaseUrl: `${openAi.url}/v1`,
    });

    const reply = await send({
      url: `${codexBase}/responses`,
      headers: {
        authorization: "Bearer sk-proj-0123456789",
        "user-agent": CODEX_UA,
        "content-type": "application/json",
        "content-length": "2",
      },
      body: Buffer.from("{}"),
    });

    expect(reply.status).toBe(401);
    const error = JSON.parse(reply.body.toString("utf8")) as { error: { message: string } };
    expect(error.error.message).toBe(
      "OpenAI refused the API key Codex is signed in with (Incorrect API key provided: sk-proj-***789.). " +
        "This is one of Codex's own models, which goes to OpenAI with Codex's own sign-in: " +
        "pick an endpoint model (<endpoint>/<model>) in Codex, or sign Codex in with ChatGPT, or with an OpenAI API key",
    );
  });

  test("ChatGPT out of reach is a 502 in OpenAI's shape", async () => {
    const { codexBase } = await start({ chatgptBaseUrl: "http://127.0.0.1:9/backend-api/codex" });

    const reply = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-length": "2" }),
      body: Buffer.from("{}"),
    });

    expect(reply.status).toBe(502);
    const error = JSON.parse(reply.body.toString("utf8")) as { error: { message: string } };
    expect(error.error.message).toContain("ChatGPT can't be reached");
  });
});

interface ListedModel {
  slug: string;
  priority: number;
  context_window?: number;
  supported_reasoning_levels?: Array<{ effort: string }>;
  visibility?: string;
}

const DisplayNamesSchema = z.object({
  models: z.array(z.object({ slug: z.string(), display_name: z.string().optional() })),
});

function modelsOf(reply: Reply): ListedModel[] {
  return (JSON.parse(reply.body.toString("utf8")) as { models: ListedModel[] }).models;
}

const CHATGPT_MODELS = [
  { slug: "gpt-5.5", display_name: "GPT-5.5", priority: 1, visibility: "list" },
  { slug: "codex-auto-review", priority: 30, visibility: "hide" },
];

const KIMI_ON_TWO: EndpointFixture[] = [
  {
    id: "ep_a",
    slug: "relay-a",
    url: "",
    models: [{ id: "kimi-k2", facts: { context: 262_144, efforts: ["low", "high"] } }],
  },
  { id: "ep_b", slug: "relay-b", url: "", models: [{ id: "kimi-k2" }] },
];

describe("endpoint models in the /model of a Codex signed in with ChatGPT", () => {
  test("the model list is ChatGPT's first, then the endpoint models as <endpoint>/<model> with what is known of them", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: 'W/"list-1"' });
      res.end(JSON.stringify({ models: CHATGPT_MODELS }));
    };
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: KIMI_ON_TWO.map((fixture) => ({ ...fixture, url: "http://127.0.0.1:9/v1" })),
    });

    const reply = await send({
      url: `${codexBase}/models?client_version=0.163.0`,
      method: "GET",
      headers: codexHeaders(),
    });

    expect(reply.status).toBe(200);
    const models = modelsOf(reply);
    expect(models.map((model) => [model.slug, model.priority])).toEqual([
      ["gpt-5.5", 1],
      ["codex-auto-review", 30],
      ["relay-a/kimi-k2", 103],
      ["relay-b/kimi-k2", 104],
    ]);
    expect(models[0]).toEqual(CHATGPT_MODELS[0]);
    expect(models[2]!.context_window).toBe(262_144);
    expect(models[2]!.supported_reasoning_levels!.map((level) => level.effort)).toEqual([
      "low",
      "high",
    ]);
    expect(models[2]!.visibility).toBe("list");
    expect(reply.headers.etag).toMatch(/^W\/"list-1\+osuna-[0-9a-f]+"$/);
    // 清单请求带着 Codex 的登录原样到 ChatGPT（只是不要压缩过的回复）。
    const reached = chatgpt.requests[0]!;
    expect(reached.url).toBe("/backend-api/codex/models?client_version=0.163.0");
    expect(reached.headers.authorization).toBe(`Bearer ${CHATGPT_TOKEN}`);
    expect(reached.headers["chatgpt-account-id"]).toBe(ACCOUNT_ID);
  });

  test("the endpoint's name after a model follows the host's setting: always, only when names clash, never; the slugs keep them apart", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: 'W/"list-1"' });
      res.end(JSON.stringify({ models: CHATGPT_MODELS }));
    };
    const { codexBase, daemon } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [
        {
          id: "ep_a",
          slug: "relay-a",
          url: "http://127.0.0.1:9/v1",
          models: [{ id: "kimi-k2", facts: { name: "Kimi K2" } }, { id: "glm-5" }],
        },
        {
          id: "ep_b",
          slug: "relay-b",
          url: "http://127.0.0.1:9/v1",
          models: [{ id: "kimi-k2", facts: { name: "kimi k2" } }],
        },
      ],
    });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.17.0",
    });
    await client.connect();
    const named = async () => {
      const reply = await send({
        url: `${codexBase}/models?client_version=0.163.0`,
        method: "GET",
        headers: codexHeaders(),
      });
      const list = DisplayNamesSchema.parse(JSON.parse(reply.body.toString("utf8")));
      return list.models
        .filter((model) => model.slug.includes("/"))
        .map((model) => [model.slug, model.display_name]);
    };

    expect((await client.apiEndpointList("codex")).endpointNameDisplay).toBe("always");
    expect(await named()).toEqual([
      ["relay-a/kimi-k2", "Kimi K2 (RELAY-A)"],
      ["relay-a/glm-5", "glm-5 (RELAY-A)"],
      ["relay-b/kimi-k2", "kimi k2 (RELAY-B)"],
    ]);

    // 只差大小写也算同名（照 magpie）。
    expect((await client.apiEndpointSetEndpointNameDisplay({ display: "clash" })).error).toBeNull();
    expect((await client.apiEndpointList("codex")).endpointNameDisplay).toBe("clash");
    expect(await named()).toEqual([
      ["relay-a/kimi-k2", "Kimi K2 (RELAY-A)"],
      ["relay-a/glm-5", "glm-5"],
      ["relay-b/kimi-k2", "kimi k2 (RELAY-B)"],
    ]);

    await client.apiEndpointSetEndpointNameDisplay({ display: "never" });
    expect(await named()).toEqual([
      ["relay-a/kimi-k2", "Kimi K2"],
      ["relay-a/glm-5", "glm-5"],
      ["relay-b/kimi-k2", "kimi k2"],
    ]);

    const refused = await client.apiEndpointSetEndpointNameDisplay({ display: "sometimes" });
    expect(refused.error?.code).toBe("invalid_input");
    expect((await client.apiEndpointList("codex")).endpointNameDisplay).toBe("never");
    await client.apiEndpointSetEndpointNameDisplay({ display: "always" });
    expect((await client.apiEndpointList("codex")).endpointNameDisplay).toBe("always");
    await client.close();
  });

  test("only when names clash counts ChatGPT's own models too: an endpoint's gpt-5.5 beside ChatGPT's GPT-5.5 keeps its endpoint name", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: 'W/"list-1"' });
      res.end(JSON.stringify({ models: CHATGPT_MODELS }));
    };
    const { codexBase, daemon } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [{ ...RELAY_A, models: [{ id: "gpt-5.5" }, { id: "glm-5" }] }],
    });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.17.0",
    });
    await client.connect();
    await client.apiEndpointSetEndpointNameDisplay({ display: "clash" });

    const reply = await send({
      url: `${codexBase}/models?client_version=0.163.0`,
      method: "GET",
      headers: codexHeaders(),
    });

    const list = DisplayNamesSchema.parse(JSON.parse(reply.body.toString("utf8")));
    expect(list.models.map((model) => [model.slug, model.display_name])).toEqual([
      ["gpt-5.5", "GPT-5.5"],
      ["codex-auto-review", undefined],
      ["relay-a/gpt-5.5", "gpt-5.5 (RELAY-A)"],
      ["relay-a/glm-5", "glm-5"],
    ]);
    await client.close();
  });

  test("a default model naming one endpoint is in the merged list, so Codex knows it", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: CHATGPT_MODELS }));
    };
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: KIMI_ON_TWO.map((fixture) => ({ ...fixture, url: "http://127.0.0.1:9/v1" })),
      defaultModelId: "relay-b/kimi-k2",
    });

    const reply = await send({
      url: `${codexBase}/models?client_version=0.163.0`,
      method: "GET",
      headers: codexHeaders(),
    });

    expect(modelsOf(reply).map((model) => model.slug)).toContain("relay-b/kimi-k2");
  });

  test("ChatGPT not answering in time: Codex's last list of ChatGPT's models stands in", async () => {
    const chatgpt = await startBackend();
    // 不应答：连接一直挂着。
    chatgpt.respond = () => {};
    const { codexBase, codexHome } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      modelsWaitMs: 300,
    });
    // Codex 上次存下的清单：带着 Osuna 当时加的接口模型（换过的接口），读回来时去掉。
    await writeFile(
      path.join(codexHome, "models_cache.json"),
      JSON.stringify({
        fetched_at: "2026-10-18T00:00:00Z",
        etag: 'W/"list-0+osuna-000000000000"',
        models: [CHATGPT_MODELS[0], { slug: "relay-old/glm-4.6", priority: 102 }],
      }),
    );
    const startedAt = Date.now();

    const reply = await send({
      url: `${codexBase}/models?client_version=0.163.0`,
      method: "GET",
      headers: codexHeaders(),
    });

    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(reply.status).toBe(200);
    expect(modelsOf(reply).map((model) => model.slug)).toEqual(["gpt-5.5", "relay-a/gpt-5.5"]);
    expect(reply.headers.etag).toMatch(/^\+osuna-[0-9a-f]+$/);
  });

  test("ChatGPT's 401 and 403 on the model list come back as they are", async () => {
    for (const status of [401, 403]) {
      const chatgpt = await startBackend();
      const body = `{"detail":"refused with ${status}"}`;
      chatgpt.respond = (_request, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body);
      };
      const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });

      const reply = await send({
        url: `${codexBase}/models?client_version=0.163.0`,
        method: "GET",
        headers: codexHeaders(),
      });

      expect(reply.status).toBe(status);
      expect(reply.body.toString("utf8")).toBe(body);
    }
  });

  test("a turn on an endpoint model reaches that endpoint without the ChatGPT sign-in, and moves to the next one serving the model when it fails", async () => {
    const chatgpt = await startBackend();
    const relayA = await startBackend();
    relayA.respond = (_request, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end('{"error":{"message":"overloaded"}}');
    };
    const relayB = await startBackend();
    relayB.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        sse(
          '{"type":"response.created","response":{"id":"r1"}}',
          '{"type":"response.output_text.delta","delta":"hi"}',
          '{"type":"response.completed","response":{"id":"r1","usage":{"input_tokens":1,"output_tokens":1}}}',
        ),
      );
    };
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [
        { ...KIMI_ON_TWO[0]!, url: `${relayA.url}/v1` },
        { ...KIMI_ON_TWO[1]!, url: `${relayB.url}/v1` },
      ],
    });
    // Codex 发给 ChatGPT 后端的请求体用 zstd 压过。
    const body = zlib.zstdCompressSync(
      Buffer.from('{"model":"relay-a/kimi-k2","input":"hi","stream":true}'),
    );

    const turn = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-encoding": "zstd", "content-length": String(body.length) }),
      body,
    });

    expect(turn.status).toBe(200);
    expect(turn.body.toString("utf8")).toContain("response.completed");
    expect(chatgpt.requests).toHaveLength(0);
    expect(relayA.requests).toHaveLength(1);
    expect(relayB.requests).toHaveLength(1);
    for (const [relay, key] of [
      [relayA, "sk-relay-a-key"],
      [relayB, "sk-relay-b-key"],
    ] as const) {
      const reached = relay.requests[0]!;
      expect(reached.url).toBe("/v1/responses");
      expect(JSON.parse(reached.body.toString("utf8")).model).toBe("kimi-k2");
      expect(reached.headers.authorization).toBe(`Bearer ${key}`);
      expect(reached.headers["chatgpt-account-id"]).toBeUndefined();
      expect(JSON.stringify(reached.headers)).not.toContain(CHATGPT_TOKEN);
      expect(reached.headers["user-agent"]).toBe(CODEX_UA);
      expect(reached.headers.originator).toBe("codex_cli_rs");
      expect(reached.headers["session-id"]).toBe("019a-session");
      expect(reached.headers["thread-id"]).toBe("019a-thread");
      expect(reached.headers["x-codex-turn-metadata"]).toBe('{"turn_id":"t1"}');
      expect(reached.headers["content-encoding"]).toBeUndefined();
    }
  });

  test("remote compaction on an endpoint model is refused; search on one is a 200 saying it cannot search", async () => {
    const chatgpt = await startBackend();
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });

    const compactBody = Buffer.from('{"model":"relay-a/gpt-5.5","input":[]}');
    const compact = await send({
      url: `${codexBase}/responses/compact`,
      headers: codexHeaders({ "content-length": String(compactBody.length) }),
      body: compactBody,
    });
    expect(compact.status).toBe(400);
    const refused = JSON.parse(compact.body.toString("utf8")) as { error: { message: string } };
    expect(refused.error.message).toBe(
      "/responses/compact is not supported for API endpoint models (relay-a/gpt-5.5); use a compaction_trigger on /responses",
    );

    const searchBody = Buffer.from(
      '{"model":"relay-a/gpt-5.5","commands":{"search_query":[{"q":"weather"}]}}',
    );
    const search = await send({
      url: `${codexBase}/alpha/search`,
      headers: codexHeaders({ "content-length": String(searchBody.length) }),
      body: searchBody,
    });
    expect(search.status).toBe(200);
    expect(JSON.parse(search.body.toString("utf8"))).toEqual({
      encrypted_output: null,
      output:
        "Web search is not available for relay-a/gpt-5.5: it is an API endpoint model, and Codex's web search (web.run) only works with ChatGPT's own models. Answer without searching the web.",
    });
    expect(chatgpt.requests).toHaveLength(0);
  });

  test("a ChatGPT reply's X-Models-Etag carries the endpoint models' mark, as the list's ETag does", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (request, res) => {
      const isList = request.url.startsWith("/backend-api/codex/models");
      res.writeHead(200, {
        "content-type": "application/json",
        ...(isList ? { etag: '"list-1"' } : { "x-models-etag": '"list-1"' }),
      });
      res.end(isList ? JSON.stringify({ models: CHATGPT_MODELS }) : "{}");
    };
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });

    const list = await send({
      url: `${codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });
    const body = Buffer.from('{"model":"gpt-5.5","input":"hi"}');
    const turn = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-length": String(body.length) }),
      body,
    });

    expect(turn.headers["x-models-etag"]).toBe(list.headers.etag);
  });
});

function userText(text: string) {
  return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

interface CompactionItem {
  type: string;
  encrypted_content: string;
}

/** 流里 response.completed 的压缩条目。 */
function compactionItemOf(reply: Reply): CompactionItem {
  const events = reply.body
    .toString("utf8")
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map(
      (line) =>
        JSON.parse(line.slice(6)) as { type: string; response?: { output: CompactionItem[] } },
    );
  const completed = events.find((event) => event.type === "response.completed");
  return completed!.response!.output[0]!;
}

// 已禁用的模型（工单 16）照 magpie codex_backend.go 的 codexNativeOff：Codex 自己的模型被禁了不转给 ChatGPT、不列。
describe("disabled models for a Codex signed in with ChatGPT", () => {
  test("a disabled ChatGPT model is refused with a 403 and never reaches ChatGPT, and is left out of the list with the disabled endpoint models", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: CHATGPT_MODELS }));
    };
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [
        {
          id: "ep_a",
          slug: "relay-a",
          url: "http://127.0.0.1:9/v1",
          models: [{ id: "kimi-k2" }, { id: "glm-5-preview" }],
        },
      ],
      disabledModels: ["GPT-5.?", "*-preview"],
    });

    const turn = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ accept: "application/json" }),
      body: Buffer.from(JSON.stringify({ model: "gpt-5.5", input: "hi", stream: false })),
    });
    expect(turn.status).toBe(403);
    expect(JSON.parse(turn.body.toString("utf8"))).toEqual({
      error: {
        message:
          'model gpt-5.5 is disabled in Osuna (it matches "GPT-5.?" in Settings › API endpoints › Disabled models); enable it there. Only requests through Osuna are refused',
        type: "permission_error",
        code: null,
        param: null,
      },
    });
    const endpointTurn = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ accept: "application/json" }),
      body: Buffer.from(
        JSON.stringify({ model: "relay-a/glm-5-preview", input: "hi", stream: false }),
      ),
    });
    expect(endpointTurn.status).toBe(403);
    expect(chatgpt.requests).toEqual([]);

    const listed = await send({
      url: `${codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });
    expect(modelsOf(listed).map((model) => model.slug)).toEqual([
      "codex-auto-review",
      "relay-a/kimi-k2",
    ]);
  });
});

describe("compaction of an endpoint model's conversation for a Codex signed in with ChatGPT", () => {
  test("the compaction_trigger is summarised by the endpoint model, and the summary is read back in the next turn", async () => {
    const chatgpt = await startBackend();
    const relay = await startBackend();
    relay.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        sse(
          '{"type":"response.created","response":{"id":"resp_42"}}',
          '{"type":"response.output_text.delta","delta":"We fixed the parser."}',
          '{"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"We fixed the parser."}]}}',
          '{"type":"response.completed","response":{"id":"resp_42","status":"completed","output":[]}}',
        ),
      );
    };
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [{ ...KIMI_ON_TWO[1]!, slug: "relay-a", url: `${relay.url}/v1` }],
    });
    const turnMeta = '{"turn_id":"t9","compaction":{"implementation":"responses_compaction_v2"}}';
    const trigger = zlib.zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          model: "relay-a/kimi-k2",
          input: [userText("fix the parser"), { type: "compaction_trigger" }],
          tools: [{ type: "function", name: "shell" }],
          stream: true,
        }),
      ),
    );

    const compacted = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({
        "content-encoding": "zstd",
        "content-length": String(trigger.length),
        "x-codex-turn-metadata": turnMeta,
      }),
      body: trigger,
    });

    expect(compacted.status).toBe(200);
    const item = compactionItemOf(compacted);
    expect(item.type).toBe("compaction");
    expect(item.encrypted_content).toBe(
      `osuna1:${Buffer.from("We fixed the parser.").toString("base64")}`,
    );
    const asked = relay.requests[0]!;
    const askedBody = JSON.parse(asked.body.toString("utf8")) as {
      input: unknown[];
      tools: unknown[];
      tool_choice: string;
    };
    expect(askedBody.input).toEqual([userText("fix the parser"), userText(CODEX_COMPACT_PROMPT)]);
    expect(askedBody.tools).toEqual([]);
    expect(askedBody.tool_choice).toBe("auto");
    expect(asked.headers["x-codex-turn-metadata"]).toBe(
      '{"turn_id":"t9","compaction":{"implementation":"responses"}}',
    );
    expect(asked.headers.authorization).toBe("Bearer sk-relay-a-key");
    expect(JSON.stringify(asked.headers)).not.toContain(CHATGPT_TOKEN);

    // 下一轮 Codex 原样带回这个条目：接口收到的是 Codex 读摘要时的那条用户消息。
    const next = Buffer.from(
      JSON.stringify({ model: "relay-a/kimi-k2", input: [item, userText("go on")], stream: true }),
    );
    const turn = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-length": String(next.length) }),
      body: next,
    });
    expect(turn.status).toBe(200);
    const resumed = JSON.parse(relay.requests[1]!.body.toString("utf8")) as { input: unknown[] };
    expect(resumed.input).toEqual([
      userText(`${CODEX_SUMMARY_PREFIX}\nWe fixed the parser.`),
      userText("go on"),
    ]);
    expect(chatgpt.requests).toHaveLength(0);
  });

  test("an endpoint failing the summary request gets its failure back to Codex as it came", async () => {
    const chatgpt = await startBackend();
    const relay = await startBackend();
    relay.respond = (_request, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":{"message":"bad key"}}');
    };
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [{ ...KIMI_ON_TWO[1]!, slug: "relay-a", url: `${relay.url}/v1` }],
    });
    const body = Buffer.from(
      JSON.stringify({ model: "relay-a/kimi-k2", input: [{ type: "compaction_trigger" }] }),
    );

    const reply = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-length": String(body.length) }),
      body,
    });

    expect(reply.status).toBe(401);
    expect(reply.body.toString("utf8")).toContain("bad key");
  });

  test("switched to a ChatGPT model, the summary Osuna made reaches ChatGPT as the message Codex would have made", async () => {
    const chatgpt = await startBackend();
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });
    const item = {
      type: "compaction",
      id: "cmp_42",
      encrypted_content: `osuna1:${Buffer.from("We fixed the parser.").toString("base64")}`,
    };
    const body = zlib.zstdCompressSync(
      Buffer.from(JSON.stringify({ model: "gpt-5.5", input: [item, userText("go on")] })),
    );

    const reply = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-encoding": "zstd", "content-length": String(body.length) }),
      body,
    });

    expect(reply.status).toBe(200);
    const reached = chatgpt.requests[0]!;
    expect(reached.headers["content-encoding"]).toBeUndefined();
    expect(reached.headers.authorization).toBe(`Bearer ${CHATGPT_TOKEN}`);
    expect(JSON.parse(reached.body.toString("utf8"))).toEqual({
      model: "gpt-5.5",
      input: [userText(`${CODEX_SUMMARY_PREFIX}\nWe fixed the parser.`), userText("go on")],
    });
  });
});

describe("compaction fallbacks for an endpoint model", () => {
  async function startRelay(respond: FakeBackend["respond"]) {
    const chatgpt = await startBackend();
    const relay = await startBackend();
    relay.respond = respond;
    const { codexBase } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [{ ...KIMI_ON_TWO[1]!, slug: "relay-a", url: `${relay.url}/v1` }],
    });
    return { chatgpt, relay, codexBase };
  }

  function compactBody(): Buffer {
    return Buffer.from(
      JSON.stringify({
        model: "relay-a/kimi-k2",
        prompt_cache_key: "thread-7",
        input: [
          userText("fix the parser"),
          { type: "reasoning", id: "rs_9", encrypted_content: "gAAAAAsealed" },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
          { type: "compaction_trigger" },
        ],
        stream: true,
      }),
    );
  }

  function compact(codexBase: string): Promise<Reply> {
    const body = compactBody();
    return send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-length": String(body.length) }),
      body,
    });
  }

  function summaryStream(text: string): string {
    return sse(
      '{"type":"response.created","response":{"id":"resp_7"}}',
      JSON.stringify({ type: "response.output_text.delta", delta: text }),
      JSON.stringify({
        type: "response.output_item.done",
        item: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
      }),
      '{"type":"response.completed","response":{"id":"resp_7","status":"completed","output":[]}}',
    );
  }

  function summaryOf(reply: Reply): string {
    const sealed = compactionItemOf(reply).encrypted_content;
    return Buffer.from(sealed.slice("osuna1:".length), "base64").toString("utf8");
  }

  test("an item the endpoint can't find: the summary is asked again with the conversation as text", async () => {
    const { relay, codexBase } = await startRelay((request, res) => {
      const isPlain = request.body.toString("utf8").includes("This is the conversation so far");
      if (!isPlain) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end('{"error":{"message":"Item with id \'rs_9\' not found."}}');
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(summaryStream("Parser fixed; tests next."));
    });

    const reply = await compact(codexBase);

    expect(reply.status).toBe(200);
    expect(summaryOf(reply)).toBe("Parser fixed; tests next.");
    expect(relay.requests).toHaveLength(2);
    const plain = JSON.parse(relay.requests[1]!.body.toString("utf8")) as { input: unknown[] };
    expect(plain.input).toEqual([
      userText(
        "This is the conversation so far:\n\n[user]\nfix the parser\n\n[assistant]\nDone.\n\n",
      ),
      userText(CODEX_COMPACT_PROMPT),
    ]);
  });

  test("refused again as text: the summary is assembled locally and the compaction still completes", async () => {
    const { relay, codexBase } = await startRelay((_request, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":{"message":"Upstream request failed"}}');
    });

    const reply = await compact(codexBase);

    expect(reply.status).toBe(200);
    expect(relay.requests).toHaveLength(2);
    expect(summaryOf(reply)).toBe(
      "Osuna compacted this conversation without a model (relay-a (relay-a/kimi-k2) answered 404 to the summary request: RELAY-A: Upstream request failed), so this is no summary: " +
        "it is what the user asked and the last reply. Look at the workspace for where the work stands before going on.\n\n" +
        "## The user's messages\n\nfix the parser\n\n## The last reply\n\nDone.\n",
    );
  });

  test("a conversation whose compaction keeps failing is not asked again for a while", async () => {
    const { relay, codexBase } = await startRelay((_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        sse(
          '{"type":"response.created","response":{"id":"resp_8"}}',
          '{"type":"response.output_text.delta","delta":"Half a sum"}',
          '{"type":"response.incomplete","response":{"id":"resp_8","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
        ),
      );
    });

    for (let i = 0; i < 3; i++) {
      const failed = await compact(codexBase);
      expect(failed.status).toBe(502);
    }
    const held = await compact(codexBase);

    expect(held.status).toBe(400);
    const error = JSON.parse(held.body.toString("utf8")) as { error: { message: string } };
    expect(error.error.message).toMatch(
      /^compaction: relay-a\/kimi-k2 failed to summarise this conversation 3 times in a row \(last: the reply ended incomplete \(max_output_tokens\)\); Osuna doesn't ask it again for /,
    );
    expect(relay.requests).toHaveLength(3);
  });
});

const VersionedListSchema = z.object({
  models: z.array(z.object({ slug: z.string(), multi_agent_version: z.string().optional() })),
});

function versionsOf(reply: Reply): Array<[string, string | undefined]> {
  const list = VersionedListSchema.parse(JSON.parse(reply.body.toString("utf8")));
  return list.models.map((model) => [model.slug, model.multi_agent_version]);
}

const ownAdded = "- `gpt-5.4-mini`: GPT-5.4 Mini";
const endpointAdded = "- `relay-a/kimi-k2`: kimi-k2 (RELAY-A)";

const SealedErrorSchema = z.object({ error: z.object({ message: z.string() }) });

const SpawnToolsSchema = z.object({
  model: z.string(),
  tools: z.array(z.object({ description: z.string() })).optional(),
});

const SPAWN_DESCRIPTION =
  "Available model overrides (optional; inherited parent model is preferred):\n- `gpt-5.5`: GPT-5.5\nSpawn a sub-agent for a well-scoped task.";

/** SPAWN_DESCRIPTION 在 Codex 那段清单后补上 lines。 */
function spawnAdded(lines: string[]): string {
  const more = `More models that may be set as \`model\`:\n${lines.join("\n")}`;
  return SPAWN_DESCRIPTION.replace("\nSpawn", `\n${more}\nSpawn`);
}

function spawnTurn(model: string): Buffer {
  const tool = {
    type: "function",
    name: "spawn_agent",
    description: SPAWN_DESCRIPTION,
    parameters: { type: "object", properties: { model: { type: "string" } } },
  };
  return Buffer.from(JSON.stringify({ model, input: "hi", stream: true, tools: [tool] }));
}

function sentOf(request: RecordedRequest | undefined) {
  return SpawnToolsSchema.parse(JSON.parse(request?.body.toString("utf8") ?? "{}"));
}

const COMPLETED_STREAM = sse(
  '{"type":"response.created","response":{"id":"r1"}}',
  '{"type":"response.completed","response":{"id":"r1","usage":{"input_tokens":1,"output_tokens":1}}}',
);

function answerStream(_request: RecordedRequest, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(COMPLETED_STREAM);
}

const OWN_CACHE = {
  fetched_at: "2026-10-18T00:00:00Z",
  etag: '"list-1"',
  models: [
    { slug: "gpt-5.5", display_name: "GPT-5.5", priority: 1, visibility: "list" },
    { slug: "gpt-5.4-mini", display_name: "GPT-5.4 Mini", priority: 2, visibility: "list" },
  ],
};

describe("Subagents of a Codex signed in with ChatGPT", () => {
  test("Subagents on any model mark ChatGPT's own and the endpoint models multi-agent V1, the list's mark saying so; off, they are as ChatGPT gave them", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: 'W/"list-1"' });
      res.end(JSON.stringify({ models: [{ ...CHATGPT_MODELS[0], multi_agent_version: "v2" }] }));
    };
    const on = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      allowsAnySubagentModel: true,
    });

    const marked = await send({
      url: `${on.codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });

    expect(versionsOf(marked)).toEqual([
      ["gpt-5.5", "v1"],
      ["relay-a/gpt-5.5", "v1"],
    ]);
    expect(marked.headers.etag).toMatch(/^W\/"list-1\+osuna-v1\.[0-9a-f]+"$/);

    const off = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });
    const plain = await send({
      url: `${off.codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });
    expect(versionsOf(plain)).toEqual([
      ["gpt-5.5", "v2"],
      ["relay-a/gpt-5.5", undefined],
    ]);
    expect(plain.headers.etag).toMatch(/^W\/"list-1\+osuna-[0-9a-f]+"$/);
  });

  test("ChatGPT out of reach after the switch went off: the V1 Codex kept from the list goes back to what ChatGPT gave", async () => {
    const chatgpt = await startBackend();
    let isAnswering = true;
    chatgpt.respond = (_request, res) => {
      if (!isAnswering) return;
      res.writeHead(200, { "content-type": "application/json", etag: 'W/"list-1"' });
      res.end(JSON.stringify({ models: [{ ...CHATGPT_MODELS[0], multi_agent_version: "v2" }] }));
    };
    const { codexBase, codexHome, daemon } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      allowsAnySubagentModel: true,
      modelsWaitMs: 300,
    });
    const marked = await send({
      url: `${codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });
    // Codex 把拿到的清单原样存下。
    await writeFile(
      path.join(codexHome, "models_cache.json"),
      JSON.stringify({
        fetched_at: "2026-10-18T00:00:00Z",
        etag: marked.headers.etag,
        models: [{ ...CHATGPT_MODELS[0], multi_agent_version: "v1" }],
      }),
    );
    isAnswering = false;
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.17.0",
    });
    await client.connect();
    expect(
      (
        await client.apiEndpointSetAgentSettings({
          provider: "codex",
          enabled: true,
          allowsAnySubagentModel: false,
        })
      ).error,
    ).toBeNull();
    await client.close();

    const fallback = await send({
      url: `${codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });

    expect(versionsOf(fallback)).toEqual([
      ["gpt-5.5", "v2"],
      ["relay-a/gpt-5.5", undefined],
    ]);
  });

  test("ChatGPT out of reach from the start: the versions in Codex's own last list are kept, so switching off still takes the V1 marks out", async () => {
    const chatgpt = await startBackend();
    // 从不应答。
    chatgpt.respond = () => {};
    const { codexBase, codexHome, daemon } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      allowsAnySubagentModel: true,
      modelsWaitMs: 300,
    });
    const cachePath = path.join(codexHome, "models_cache.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        fetched_at: "2026-10-18T00:00:00Z",
        etag: '"list-1"',
        models: [{ ...CHATGPT_MODELS[0], multi_agent_version: "v2" }],
      }),
    );
    const marked = await send({
      url: `${codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });
    expect(versionsOf(marked)).toEqual([
      ["gpt-5.5", "v1"],
      ["relay-a/gpt-5.5", "v1"],
    ]);
    // Codex 把拿到的清单原样存下。
    await writeFile(
      cachePath,
      JSON.stringify({
        fetched_at: "2026-10-18T00:00:00Z",
        etag: marked.headers.etag,
        models: [{ ...CHATGPT_MODELS[0], multi_agent_version: "v1" }],
      }),
    );
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.17.0",
    });
    await client.connect();
    const off = await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      allowsAnySubagentModel: false,
    });
    await client.close();
    expect(off.error).toBeNull();

    const fallback = await send({
      url: `${codexBase}/models`,
      method: "GET",
      headers: codexHeaders(),
    });

    expect(versionsOf(fallback)).toEqual([
      ["gpt-5.5", "v2"],
      ["relay-a/gpt-5.5", undefined],
    ]);
  });

  test.each([
    {
      allowsAnySubagentModel: false,
      wayOut:
        "For subagents on any model while the lead is on a ChatGPT model, turn on \"Codex Subagents can use any model\" on Codex's page in Osuna's settings and start a new thread",
    },
    {
      allowsAnySubagentModel: true,
      wayOut:
        "\"Codex Subagents can use any model\" is on in Osuna's settings, but this thread runs Codex's multi-agent V2",
    },
  ])(
    "a task ChatGPT sealed, sent to an endpoint model, is refused with the way out (any model: $allowsAnySubagentModel)",
    async ({ allowsAnySubagentModel, wayOut }) => {
      const chatgpt = await startBackend();
      const relay = await startBackend();
      relay.respond = answerStream;
      const { codexBase } = await start({
        chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
        endpoints: [{ ...KIMI_ON_TWO[0]!, url: `${relay.url}/v1` }],
        allowsAnySubagentModel,
      });
      const task = {
        type: "agent_message",
        content: [
          { type: "input_text", text: "Message Type: NEW_TASK\n" },
          { type: "encrypted_content", encrypted_content: "gAAAAABsealedtask_-0123" },
        ],
      };
      const body = Buffer.from(
        JSON.stringify({ model: "relay-a/kimi-k2", input: [task], stream: true }),
      );

      const refused = await send({
        url: `${codexBase}/responses`,
        headers: codexHeaders({
          "content-length": String(body.length),
          "x-openai-subagent": "thread_spawn",
        }),
        body,
      });

      expect(refused.status).toBe(400);
      const error = SealedErrorSchema.parse(JSON.parse(refused.body.toString("utf8")));
      expect(error.error.message).toContain(
        "This subagent's task was sealed by the ChatGPT backend that answered its lead",
      );
      expect(error.error.message).toContain(wayOut);
      expect(relay.requests).toEqual([]);
      expect(chatgpt.requests).toEqual([]);
    },
  );

  test("with endpoints.json unreadable, spawn_agent still names Codex's own models and the turn reaches ChatGPT", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = answerStream;
    const { codexBase, codexHome, endpointsDir } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
    });
    await writeFile(path.join(codexHome, "models_cache.json"), JSON.stringify(OWN_CACHE));
    await writeFile(path.join(endpointsDir, "endpoints.json"), "{ not json");
    const body = spawnTurn("gpt-5.5");

    const reply = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ "content-length": String(body.length) }),
      body,
    });

    expect(reply.status).toBe(200);
    expect(sentOf(chatgpt.requests[0]).tools?.[0]?.description).toBe(spawnAdded([ownAdded]));
  });

  test("a Subagent on ChatGPT's own model reaches the forced endpoint model without the ChatGPT sign-in; the lead stays on ChatGPT", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = answerStream;
    const relay = await startBackend();
    relay.respond = answerStream;
    const { codexBase, codexHome } = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [{ ...KIMI_ON_TWO[0]!, url: `${relay.url}/v1` }],
      forcedSubagentModelId: "relay-a/kimi-k2",
    });
    await writeFile(path.join(codexHome, "models_cache.json"), JSON.stringify(OWN_CACHE));
    const body = Buffer.from('{"model":"gpt-5.5","input":"hi","stream":true}');
    const length = { "content-length": String(body.length) };

    const subagent = await send({
      url: `${codexBase}/responses`,
      headers: codexHeaders({ ...length, "x-openai-subagent": "thread_spawn" }),
      body,
    });
    const lead = await send({ url: `${codexBase}/responses`, headers: codexHeaders(length), body });

    expect([subagent.status, lead.status]).toEqual([200, 200]);
    expect(relay.requests.map((request) => sentOf(request).model)).toEqual(["kimi-k2"]);
    expect(relay.requests[0]?.headers["chatgpt-account-id"]).toBeUndefined();
    expect(chatgpt.requests.map((request) => sentOf(request).model)).toEqual(["gpt-5.5"]);
  });

  test("forced onto one of ChatGPT's own models, a Subagent on an endpoint model goes to ChatGPT; a sealed task stays on ChatGPT whatever is forced", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = answerStream;
    const relay = await startBackend();
    relay.respond = answerStream;
    const own = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [{ ...KIMI_ON_TWO[0]!, url: `${relay.url}/v1` }],
      forcedSubagentModelId: "gpt-5.4-mini",
    });
    await writeFile(path.join(own.codexHome, "models_cache.json"), JSON.stringify(OWN_CACHE));
    const onEndpoint = Buffer.from('{"model":"relay-a/kimi-k2","input":"hi","stream":true}');
    const toChatGpt = await send({
      url: `${own.codexBase}/responses`,
      headers: codexHeaders({
        "content-length": String(onEndpoint.length),
        "x-openai-subagent": "thread_spawn",
      }),
      body: onEndpoint,
    });
    expect(toChatGpt.status).toBe(200);
    expect(chatgpt.requests.map((request) => sentOf(request).model)).toEqual(["gpt-5.4-mini"]);
    expect(relay.requests).toEqual([]);

    const forcedAway = await start({
      chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
      endpoints: [{ ...KIMI_ON_TWO[0]!, url: `${relay.url}/v1` }],
      forcedSubagentModelId: "relay-a/kimi-k2",
    });
    await writeFile(
      path.join(forcedAway.codexHome, "models_cache.json"),
      JSON.stringify(OWN_CACHE),
    );
    const task = {
      type: "agent_message",
      content: [
        { type: "input_text", text: "Message Type: NEW_TASK\n" },
        { type: "encrypted_content", encrypted_content: "gAAAAABsealedtask_-0123" },
      ],
    };
    const sealed = Buffer.from(JSON.stringify({ model: "gpt-5.5", input: [task], stream: true }));
    const kept = await send({
      url: `${forcedAway.codexBase}/responses`,
      headers: codexHeaders({
        "content-length": String(sealed.length),
        "x-openai-subagent": "thread_spawn",
      }),
      body: sealed,
    });
    expect(kept.status).toBe(200);
    expect(chatgpt.requests.map((request) => sentOf(request).model)).toEqual([
      "gpt-5.4-mini",
      "gpt-5.5",
    ]);
    expect(relay.requests).toEqual([]);
  });

  test.each([
    { allowsAnySubagentModel: false, leadOnOwn: [ownAdded] },
    { allowsAnySubagentModel: true, leadOnOwn: [ownAdded, endpointAdded] },
  ])(
    "spawn_agent names Codex's own models, and the endpoint models too unless a lead on ChatGPT's own model seals its Subagents' tasks (any model: $allowsAnySubagentModel)",
    async ({ allowsAnySubagentModel, leadOnOwn }) => {
      const chatgpt = await startBackend();
      chatgpt.respond = answerStream;
      const relay = await startBackend();
      relay.respond = answerStream;
      const { codexBase, codexHome } = await start({
        chatgptBaseUrl: `${chatgpt.url}/backend-api/codex`,
        endpoints: [{ ...KIMI_ON_TWO[0]!, url: `${relay.url}/v1` }],
        allowsAnySubagentModel,
      });
      await writeFile(path.join(codexHome, "models_cache.json"), JSON.stringify(OWN_CACHE));
      for (const model of ["gpt-5.5", "relay-a/kimi-k2"]) {
        const body = spawnTurn(model);
        const reply = await send({
          url: `${codexBase}/responses`,
          headers: codexHeaders({ "content-length": String(body.length) }),
          body,
        });
        expect(reply.status).toBe(200);
      }

      expect(sentOf(chatgpt.requests[0]).tools?.[0]?.description).toBe(spawnAdded(leadOnOwn));
      expect(sentOf(relay.requests[0]).tools?.[0]?.description).toBe(
        spawnAdded([ownAdded, endpointAdded]),
      );
    },
  );
});
