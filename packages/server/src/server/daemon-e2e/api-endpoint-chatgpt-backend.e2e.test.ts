// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend_test.go 的
// TestCodexOwnModelPassesThrough、TestCodexWebSocketUpgradeRequired、TestCodexNativeModelStaysNative；
// codexModels、codexModelsWait、codexClientHeader、alphaSearchHere 与 codexCompact 的做法）
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
import {
  CODEX_COMPACT_PROMPT,
  CODEX_SUMMARY_PREFIX,
} from "../api-endpoints/gateway/codex-compaction.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

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
    agents: { codex: { enabled: true, defaultModelId: fixtures[0]!.models[0]!.id } },
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
