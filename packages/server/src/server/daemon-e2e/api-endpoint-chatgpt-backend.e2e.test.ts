// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend_test.go 的
// TestCodexOwnModelPassesThrough、TestCodexWebSocketUpgradeRequired、TestCodexNativeModelStaysNative）
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
import { afterEach, describe, expect, test } from "vitest";
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

/** 起 daemon：Codex 开着；ChatGPT 后端与 OpenAI API 的地址换成本机的假后端。 */
async function start(input: { chatgptBaseUrl: string; openAiApiBaseUrl?: string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-chatgpt-backend-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const endpoints = {
    endpoints: [
      {
        id: "ep_a",
        slug: "relay-a",
        name: "Relay A",
        baseUrls: [{ format: "openai_responses", url: "http://127.0.0.1:9/v1" }],
        models: [{ id: "gpt-5.5" }],
        enabled: true,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    agents: { codex: { enabled: true, defaultModelId: "gpt-5.5" } },
  };
  await writeFile(path.join(endpointsDir, "endpoints.json"), JSON.stringify(endpoints));
  await writeFile(
    path.join(endpointsDir, "gateway-tokens.json"),
    JSON.stringify({ tokens: { codex: "gateway-token-codex-0123456789" } }),
  );
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
      homeDir: root,
      gatewayChatGptBaseUrl: input.chatgptBaseUrl,
      gatewayOpenAiApiBaseUrl: input.openAiApiBaseUrl ?? "http://127.0.0.1:9/v1",
    },
  });
  daemons.push(daemon);
  return {
    daemon,
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

  test("the model list, compaction, search and any other path go to ChatGPT as they came", async () => {
    const chatgpt = await startBackend();
    chatgpt.respond = (request, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: '"list-1"' });
      res.end(JSON.stringify({ path: request.url }));
    };
    const { codexBase } = await start({ chatgptBaseUrl: `${chatgpt.url}/backend-api/codex` });

    const calls = [
      { method: "GET", path: "/models?client_version=0.130.0" },
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
