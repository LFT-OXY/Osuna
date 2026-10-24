import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

/*
 * 中转站发往 Gemini 地址（任务 10-16-gemini-upstream 工单 02）：真实 daemon + 本机假 Gemini 上游。
 * Claude Code（Anthropic 入口）、Codex（Responses 入口）、Pi（Chat 入口）由 fetch 扮演，带上 gateway-tokens.json 里各自的口令；
 * 假上游按路径里的模型与 `:streamGenerateContent?alt=sse` 回 SSE，从不连 Google 或真实的中转服务。
 */

const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const CODEX_TOKEN = "gateway-token-codex-0123456789";
const PI_TOKEN = "gateway-token-pi-0123456789";
const KEY = "sk-real-gemini-key-SECRET";

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface FakeUpstream {
  url: string;
  requests: RecordedRequest[];
  respond: (request: RecordedRequest, res: ServerResponse) => void;
}

interface Harness {
  gateway: string;
  usageDir: string;
  signaturesDir: string;
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

async function startUpstream(respond: FakeUpstream["respond"]): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { url: "", requests: [], respond };
  const server = createServer((req, res) => {
    const received: Buffer[] = [];
    req.on("data", (chunk: Buffer) => received.push(chunk));
    req.on("end", () => {
      const request = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(received).toString("utf8"),
      };
      upstream.requests.push(request);
      upstream.respond(request, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

const STREAM_PATH = /^\/v1beta\/models\/([^/:]+):streamGenerateContent\?alt=sse$/;

/** 假 Gemini 上游：路径对的回一段 SSE（两段文字，再说完与用量），别的路径回 404。 */
function geminiUpstream(finishReason = "STOP"): Promise<FakeUpstream> {
  return startUpstream((request, res) => {
    const matched = STREAM_PATH.exec(request.url);
    if (request.method !== "POST" || matched === null) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, message: "not found", status: "NOT_FOUND" } }));
      return;
    }
    const model = decodeURIComponent(matched[1] ?? "");
    const chunks = [
      {
        responseId: "gemini-resp-1",
        modelVersion: model,
        candidates: [{ content: { role: "model", parts: [{ text: "hello from " }] } }],
        usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 100 },
      },
      { candidates: [{ content: { role: "model", parts: [{ text: "gemini" }] } }] },
      {
        candidates: [{ content: { role: "model", parts: [] }, finishReason }],
        usageMetadata: {
          promptTokenCount: 120,
          cachedContentTokenCount: 100,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 5,
        },
      },
    ];
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
    res.end();
  });
}

/** 假 Chat 上游：一段文字的流。 */
function chatUpstream(): Promise<FakeUpstream> {
  return startUpstream((_request, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = {
      id: "chatcmpl-1",
      choices: [{ index: 0, delta: { content: "hello from chat" }, finish_reason: "stop" }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
}

interface EndpointSpec {
  id: string;
  baseUrls: { format: string; url: string }[];
  models: string[];
  modelSettings?: Record<string, unknown>;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  searchesWeb?: boolean;
}

async function start(endpoints: EndpointSpec[]): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-gateway-gemini-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const files = {
    "endpoints.json": {
      endpoints: endpoints.map((spec) => ({
        id: spec.id,
        slug: spec.id.replace("ep_", "relay-").replaceAll("_", "-"),
        name: `Relay ${spec.id}`,
        baseUrls: spec.baseUrls,
        models: spec.models.map((id) => ({ id })),
        enabled: true,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        ...(spec.modelSettings ? { modelSettings: spec.modelSettings } : {}),
        ...(spec.headers ? { headers: spec.headers } : {}),
        ...(spec.extraBody ? { extraBody: spec.extraBody } : {}),
        ...(spec.searchesWeb ? { searchesWeb: true } : {}),
      })),
      agents: {
        claude: { enabled: false, defaultModelId: null },
        codex: { enabled: false, defaultModelId: null },
      },
    },
    "keys.json": { keys: Object.fromEntries(endpoints.map((spec) => [spec.id, KEY])) },
    "gateway-tokens.json": {
      tokens: { claude: CLAUDE_TOKEN, codex: CODEX_TOKEN, pi: PI_TOKEN },
    },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
  }
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: {
        CLAUDE_CONFIG_DIR: path.join(root, "claude"),
        CODEX_HOME: path.join(root, "codex"),
        PI_CODING_AGENT_DIR: path.join(root, "pi"),
      },
      homeDir: root,
      gatewayRetryPauseMs: 0,
    },
  });
  daemons.push(daemon);
  return {
    gateway: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`,
    usageDir: path.join(root, ".paseo", "usage"),
    signaturesDir: path.join(endpointsDir, "gemini-signatures"),
  };
}

function geminiOnly(upstream: FakeUpstream, extra: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    id: "ep_gemini",
    baseUrls: [{ format: "gemini", url: `${upstream.url}/v1beta` }],
    models: ["gemini-2.5-pro"],
    ...extra,
  };
}

function askClaude(harness: Harness, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${harness.gateway}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CLAUDE_TOKEN}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
}

function askCodex(harness: Harness, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${harness.gateway}/v1/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${CODEX_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function askPi(harness: Harness, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${harness.gateway}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${PI_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 流里每个 data 行的 JSON（[DONE] 跳过）。 */
function sseData(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

function sentBody(request: RecordedRequest | undefined): Record<string, unknown> {
  expect(request).toBeDefined();
  return JSON.parse(request?.body ?? "{}") as Record<string, unknown>;
}

async function ledgerRows(usageDir: string, count: number): Promise<Record<string, unknown>[]> {
  const dir = path.join(usageDir, "requests");
  const deadline = Date.now() + 10_000;
  let rows: Record<string, unknown>[] = [];
  while (Date.now() < deadline) {
    let text = "";
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith(".gz")) text += await readFile(path.join(dir, name), "utf8");
    }
    rows = text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((row) => row.kind === "gateway");
    if (rows.length >= count) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The ledger has ${rows.length} rows, not ${count}`);
}

const HI = [{ role: "user", content: "hi" }];

describe("the gateway asking a Gemini base URL", () => {
  test("Claude Code's streamed turn goes out as streamGenerateContent with only x-goog-api-key, and comes back as Anthropic", async () => {
    const upstream = await geminiUpstream();
    const harness = await start([geminiOnly(upstream)]);

    const response = await askClaude(harness, {
      model: "gemini-2.5-pro",
      max_tokens: 1024,
      stream: true,
      system: "Be brief.",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-gemini");
    const [sent] = upstream.requests;
    expect(sent?.url).toBe("/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse");
    expect(sent?.headers["x-goog-api-key"]).toBe(KEY);
    expect(sent?.headers.authorization).toBeUndefined();
    expect(sent?.headers["x-api-key"]).toBeUndefined();
    expect(sentBody(sent)).toEqual({
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
        { role: "user", parts: [{ text: "again" }] },
      ],
      systemInstruction: { parts: [{ text: "Be brief." }] },
      generationConfig: { maxOutputTokens: 1024 },
    });

    const events = sseData(text);
    const said = events
      .filter((event) => event.type === "content_block_delta")
      .map((event) => (event.delta as Record<string, unknown>).text)
      .join("");
    expect(said).toBe("hello from gemini");
    const opening = events.find((event) => event.type === "message_start");
    expect(opening).toMatchObject({
      message: {
        usage: {
          input_tokens: 20,
          cache_read_input_tokens: 100,
        },
      },
    });
    const delta = events.find((event) => event.type === "message_delta");
    expect(delta).toMatchObject({
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 35 },
    });
    expect(events.at(-1)).toMatchObject({ type: "message_stop" });
  });

  test("Claude Code's whole (non-streamed) ask is read off the stream and given as one message", async () => {
    const upstream = await geminiUpstream();
    const harness = await start([geminiOnly(upstream)]);

    const response = await askClaude(harness, {
      model: "gemini-2.5-pro",
      max_tokens: 64,
      messages: HI,
    });

    expect(response.status).toBe(200);
    expect(upstream.requests[0]?.url).toBe(
      "/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
    );
    expect(sentBody(upstream.requests[0])).not.toHaveProperty("stream");
    expect(await response.json()).toMatchObject({
      type: "message",
      content: [{ type: "text", text: "hello from gemini" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 35 },
    });
  });

  test("a reply cut at MAX_TOKENS reaches each CLI as its own length stop", async () => {
    const upstream = await geminiUpstream("MAX_TOKENS");
    const harness = await start([geminiOnly(upstream)]);

    const claude = await askClaude(harness, {
      model: "gemini-2.5-pro",
      max_tokens: 8,
      messages: HI,
    });
    const codex = await askCodex(harness, { model: "gemini-2.5-pro", input: "hi" });
    const pi = await askPi(harness, { model: "gemini-2.5-pro", messages: HI });

    expect(await claude.json()).toMatchObject({ stop_reason: "max_tokens" });
    expect(await codex.json()).toMatchObject({ status: "incomplete" });
    expect(await pi.json()).toMatchObject({ choices: [{ finish_reason: "length" }] });
  });

  test("Codex's Responses turn, streamed and whole, is answered from the Gemini base URL", async () => {
    const upstream = await geminiUpstream();
    const harness = await start([geminiOnly(upstream)]);

    const streamed = await askCodex(harness, {
      model: "gemini-2.5-pro",
      instructions: "You are Codex.",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      stream: true,
    });
    const events = sseData(await streamed.text());
    const whole = await askCodex(harness, { model: "gemini-2.5-pro", input: "hi" });

    expect(streamed.status).toBe(200);
    expect(sentBody(upstream.requests[0])).toEqual({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { parts: [{ text: "You are Codex." }] },
    });
    const said = events
      .filter((event) => event.type === "response.output_text.delta")
      .map((event) => event.delta)
      .join("");
    expect(said).toBe("hello from gemini");
    const completed = events.find((event) => event.type === "response.completed");
    expect(completed).toMatchObject({
      response: {
        usage: {
          input_tokens: 120,
          output_tokens: 35,
          input_tokens_details: { cached_tokens: 100 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      },
    });
    expect(whole.status).toBe(200);
    expect(await whole.json()).toMatchObject({
      object: "response",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "hello from gemini" }] }],
    });
    expect(upstream.requests).toHaveLength(2);
  });

  test("Pi's Chat turn, streamed and whole, is answered from the Gemini base URL", async () => {
    const upstream = await geminiUpstream();
    const harness = await start([geminiOnly(upstream)]);

    const streamed = await askPi(harness, {
      model: "gemini-2.5-pro",
      messages: [{ role: "system", content: "You are Pi." }, ...HI],
      temperature: 0.2,
      stream: true,
    });
    const chunks = sseData(await streamed.text());
    const whole = await askPi(harness, { model: "gemini-2.5-pro", messages: HI });

    expect(sentBody(upstream.requests[0])).toEqual({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { parts: [{ text: "You are Pi." }] },
      generationConfig: { temperature: 0.2 },
    });
    const choices = chunks.flatMap(
      (chunk) =>
        (chunk.choices as { delta?: Record<string, unknown>; finish_reason?: string }[]) ?? [],
    );
    expect(choices.map((choice) => choice.delta?.content ?? "").join("")).toBe("hello from gemini");
    expect(choices.some((choice) => choice.finish_reason === "stop")).toBe(true);
    expect(await whole.json()).toMatchObject({
      choices: [{ message: { content: "hello from gemini" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 35 },
    });
  });

  test("the endpoint's request headers, extra body and upstream model name apply to the Gemini request", async () => {
    const upstream = await geminiUpstream();
    const harness = await start([
      geminiOnly(upstream, {
        models: ["gemini-pro-latest"],
        headers: { "x-relay-team": "blue" },
        extraBody: { labels: { team: "blue" } },
        modelSettings: {
          models: { "gemini-pro-latest": { upstreamName: "models/gemini-2.5 pro" } },
        },
      }),
    ]);

    const response = await askPi(harness, { model: "gemini-pro-latest", messages: HI });
    await response.text();

    const [sent] = upstream.requests;
    expect(sent?.url).toBe("/v1beta/models/gemini-2.5%20pro:streamGenerateContent?alt=sse");
    expect(sent?.headers["x-relay-team"]).toBe("blue");
    expect(sentBody(sent)).toMatchObject({ labels: { team: "blue" } });
    expect(sentBody(sent)).not.toHaveProperty("model");
  });

  test("an endpoint with Chat and Gemini base URLs translates to Chat; pinning Gemini sends it to Gemini", async () => {
    const gemini = await geminiUpstream();
    const chat = await chatUpstream();
    const both = (id: string, modelSettings?: Record<string, unknown>): EndpointSpec => ({
      id,
      baseUrls: [
        { format: "gemini", url: `${gemini.url}/v1beta` },
        { format: "openai_chat", url: `${chat.url}/v1` },
      ],
      models: [id === "ep_pinned" ? "gemini-2.5-flash" : "gemini-2.5-pro"],
      ...(modelSettings ? { modelSettings } : {}),
    });
    const harness = await start([
      both("ep_both"),
      both("ep_pinned", { models: { "gemini-2.5-flash": { format: "gemini" } } }),
    ]);

    const unpinned = await askClaude(harness, {
      model: "gemini-2.5-pro",
      max_tokens: 64,
      messages: HI,
    });
    const pinned = await askClaude(harness, {
      model: "gemini-2.5-flash",
      max_tokens: 64,
      messages: HI,
    });

    expect(await unpinned.json()).toMatchObject({ content: [{ text: "hello from chat" }] });
    expect(await pinned.json()).toMatchObject({ content: [{ text: "hello from gemini" }] });
    expect(chat.requests).toHaveLength(1);
    expect(gemini.requests.map((request) => request.url)).toEqual([
      "/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    ]);
  });

  test("calls through the Gemini base URL go in the gateway ledger under the endpoint", async () => {
    const upstream = await geminiUpstream();
    const harness = await start([geminiOnly(upstream)]);

    await (await askPi(harness, { model: "gemini-2.5-pro", messages: HI, stream: true })).text();
    await (
      await askClaude(harness, { model: "gemini-2.5-pro", max_tokens: 64, messages: HI })
    ).text();

    const rows = await ledgerRows(harness.usageDir, 2);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "ok",
        endpointId: "ep_gemini",
        upstreamModel: "gemini-2.5-pro",
        input: 20,
        cachedInput: 100,
        output: 35,
        reasoning: 5,
      });
    }
  });
});

/** 假 Gemini 上游：第 n 个请求回第 n 份脚本里的 chunk（多出的请求回最后一份）。 */
function scriptedGemini(replies: unknown[][]): Promise<FakeUpstream> {
  let asked = 0;
  return startUpstream((_request, res) => {
    const reply = replies[Math.min(asked, replies.length - 1)] ?? [];
    asked++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of reply) res.write(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
    res.end();
  });
}

const SIGNATURE = Buffer.alloc(2000, 9).toString("base64");

/** 想了一下、带签名调用 bash 的回复；id 为空时 Gemini 没给调用编号。 */
function signedCall(id: string): unknown[] {
  return [
    {
      responseId: "r1",
      candidates: [{ content: { role: "model", parts: [{ text: "Need ls.", thought: true }] } }],
      usageMetadata: { promptTokenCount: 10 },
    },
    {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  ...(id ? { id } : {}),
                  name: "default_api:bash",
                  args: { cmd: "ls" },
                },
                thoughtSignature: SIGNATURE,
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 4 },
    },
  ];
}

const DONE = [
  {
    candidates: [{ content: { role: "model", parts: [{ text: "a.txt" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 2 },
  },
];

const BASH = {
  name: "bash",
  description: "run",
  input_schema: { type: "object", properties: { cmd: { type: "string" } } },
};

describe("thinking, tools, images and search through a Gemini base URL", () => {
  test("Claude Code's thinking and a signed call come back; the next turn carries the signature back to Gemini off the kept store", async () => {
    const upstream = await scriptedGemini([signedCall(""), DONE]);
    const harness = await start([geminiOnly(upstream, { models: ["gemini-3-pro-preview"] })]);
    const first = {
      model: "gemini-3-pro-preview",
      max_tokens: 32_000,
      stream: true,
      thinking: { type: "enabled", budget_tokens: 24_000 },
      tools: [BASH],
      messages: [{ role: "user", content: "list files" }],
    };

    const events = sseData(await (await askClaude(harness, first)).text());

    expect(sentBody(upstream.requests[0]).generationConfig).toEqual({
      maxOutputTokens: 32_000,
      thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
    });
    const thought = events
      .filter(
        (event) => (event.delta as Record<string, unknown> | undefined)?.type === "thinking_delta",
      )
      .map((event) => (event.delta as Record<string, unknown>).thinking)
      .join("");
    expect(thought).toBe("Need ls.");
    const use = events.find(
      (event) => (event.content_block as Record<string, unknown> | undefined)?.type === "tool_use",
    )?.content_block as Record<string, unknown>;
    expect(use.name).toBe("bash");
    const id = String(use.id);
    // 签名几 KB，id 里只带 16 个字符的引用（存在 daemon 目录里）。
    expect(id.length).toBeLessThan(64);
    expect(await readdir(harness.signaturesDir)).toHaveLength(1);
    expect(events.find((event) => event.type === "message_delta")).toMatchObject({
      delta: { stop_reason: "tool_use" },
    });

    const second = await askClaude(harness, {
      ...first,
      messages: [
        { role: "user", content: "list files" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Need ls.", signature: "" },
            { type: "tool_use", id, name: "bash", input: { cmd: "ls" } },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "a.txt" }] },
      ],
    });
    await second.text();

    const contents = sentBody(upstream.requests[1]).contents as Record<string, unknown>[];
    const callId = id.slice(0, id.indexOf("__ts"));
    expect(callId).toMatch(/^call_/);
    expect(contents.slice(1)).toEqual([
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "bash", args: { cmd: "ls" }, id: callId },
            thoughtSignature: SIGNATURE,
          },
        ],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "bash", response: { output: "a.txt" }, id: callId } }],
      },
    ]);
  });

  test("Codex's parallel calls with no ids get ids of their own, and the answers go back under them", async () => {
    const parallel = [
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { functionCall: { name: "read", args: { path: "a" } } },
                { functionCall: { name: "read", args: { path: "b" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    ];
    const upstream = await scriptedGemini([parallel, DONE]);
    const harness = await start([geminiOnly(upstream)]);
    const tools = [
      {
        type: "function",
        name: "read",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ];

    const reply = (await (
      await askCodex(harness, { model: "gemini-2.5-pro", input: "read both", tools, stream: false })
    ).json()) as { output: Record<string, unknown>[] };

    const calls = reply.output.filter((item) => item.type === "function_call");
    expect(calls).toHaveLength(2);
    const [a, b] = calls.map((call) => String(call.call_id));
    expect(a).toMatch(/^call_/);
    expect(a).not.toBe(b);

    await askCodex(harness, {
      model: "gemini-2.5-pro",
      tools,
      stream: false,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "read both" }] },
        ...calls.map((call) => ({
          type: "function_call",
          call_id: call.call_id,
          name: "read",
          arguments: call.arguments,
        })),
        { type: "function_call_output", call_id: a, output: "A" },
        { type: "function_call_output", call_id: b, output: "B" },
      ],
    }).then((response) => response.text());

    const contents = sentBody(upstream.requests[1]).contents as Record<string, unknown>[];
    expect(contents.slice(1)).toEqual([
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "read", args: { path: "a" }, id: a },
            thoughtSignature: "skip_thought_signature_validator",
          },
          {
            functionCall: { name: "read", args: { path: "b" }, id: b },
            thoughtSignature: "skip_thought_signature_validator",
          },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "read", response: { output: "A" }, id: a } },
          { functionResponse: { name: "read", response: { output: "B" }, id: b } },
        ],
      },
    ]);
  });

  test("Pi's signed call comes back on the next Chat turn with its signature", async () => {
    const upstream = await scriptedGemini([signedCall("fc_9"), DONE]);
    const harness = await start([geminiOnly(upstream, { models: ["gemini-3-flash"] })]);
    const tools = [{ type: "function", function: { name: "bash", parameters: BASH.input_schema } }];

    const reply = (await (
      await askPi(harness, {
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "ls" }],
        tools,
      })
    ).json()) as { choices: { message: { tool_calls: { id: string }[] } }[] };
    const id = reply.choices[0]?.message.tool_calls[0]?.id ?? "";
    expect(id.startsWith("fc_9__ts")).toBe(true);

    await askPi(harness, {
      model: "gemini-3-flash",
      tools,
      messages: [
        { role: "user", content: "ls" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id, type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } },
          ],
        },
        { role: "tool", tool_call_id: id, content: "a.txt" },
      ],
    }).then((response) => response.text());

    const contents = sentBody(upstream.requests[1]).contents as Record<string, unknown>[];
    expect(contents[1]).toEqual({
      role: "model",
      parts: [
        {
          functionCall: { name: "bash", args: { cmd: "ls" }, id: "fc_9" },
          thoughtSignature: SIGNATURE,
        },
      ],
    });
    expect(contents[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "bash", response: { output: "a.txt" }, id: "fc_9" } }],
    });
  });

  test.each([
    {
      model: "gemini-2.5-pro",
      effort: "medium",
      thinking: { includeThoughts: true, thinkingBudget: 10_000 },
    },
    {
      model: "gemini-3-pro-preview",
      effort: "medium",
      thinking: { includeThoughts: true, thinkingLevel: "high" },
    },
    {
      model: "gemini-4-argon",
      effort: "medium",
      thinking: { includeThoughts: true, thinkingLevel: "medium" },
    },
    {
      model: "gemini-3-pro-preview",
      effort: "none",
      thinking: { includeThoughts: true, thinkingLevel: "low" },
    },
    {
      model: "gemini-2.5-pro",
      effort: "none",
      thinking: { includeThoughts: true, thinkingBudget: 4096 },
    },
  ])("Codex at $effort on $model asks $thinking", async ({ model, effort, thinking }) => {
    const upstream = await scriptedGemini([DONE]);
    const harness = await start([geminiOnly(upstream, { models: [model] })]);

    await (
      await askCodex(harness, { model, input: "hi", reasoning: { effort }, stream: false })
    ).text();

    expect(
      (sentBody(upstream.requests[0]).generationConfig as Record<string, unknown>).thinkingConfig,
    ).toEqual(thinking);
  });

  test("a call left unanswered, a second answer, a history opening with the model and images by bytes and by address are mended for Gemini", async () => {
    const upstream = await scriptedGemini([DONE]);
    const harness = await start([geminiOnly(upstream)]);

    await (
      await askClaude(harness, {
        model: "gemini-2.5-pro",
        max_tokens: 100,
        tools: [BASH],
        messages: [
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "t1", name: "bash", input: {} },
              { type: "tool_use", id: "t2", name: "bash", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "one" },
              { type: "tool_result", tool_use_id: "t1", content: "again" },
            ],
          },
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
              { type: "image", source: { type: "url", url: "https://example.com/a.png" } },
              { type: "text", text: "what is this?" },
            ],
          },
        ],
      })
    ).text();

    const contents = sentBody(upstream.requests[0]).contents as Record<string, unknown>[];
    expect(contents[0]).toEqual({
      role: "user",
      parts: [{ text: "[Continuing from previous AI thoughts...]" }],
    });
    expect(contents[2]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: "bash",
            response: {
              output: "[The result of this tool call is unavailable: the turn was interrupted.]",
            },
            id: "t2",
          },
        },
        { functionResponse: { name: "bash", response: { output: "one" }, id: "t1" } },
      ],
    });
    expect(contents[3]).toEqual({
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/png", data: "iVBOR" } },
        { fileData: { mimeType: "", fileUri: "https://example.com/a.png" } },
        { text: "what is this?" },
      ],
    });
  });

  test("with the endpoint searching the web itself, Claude Code's search goes as googleSearch and what it found comes back as Anthropic's search", async () => {
    const found = [
      {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Osuna shipped." }] },
            groundingMetadata: {
              webSearchQueries: ["osuna"],
              groundingChunks: [
                { web: { title: "osuna.dev", uri: "https://vertexaisearch.cloud.google.com/x" } },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    ];
    const upstream = await scriptedGemini([found]);
    const harness = await start([geminiOnly(upstream, { searchesWeb: true })]);

    const events = sseData(
      await (
        await askClaude(harness, {
          model: "gemini-2.5-pro",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "Perform a web search for the query: osuna" }],
          tool_choice: { type: "tool", name: "web_search" },
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
        })
      ).text(),
    );

    expect(sentBody(upstream.requests[0]).tools).toEqual([{ googleSearch: {} }]);
    const blocks = events
      .filter((event) => event.type === "content_block_start")
      .map((event) => (event.content_block as Record<string, unknown>).type);
    expect(blocks).toEqual(["text", "server_tool_use", "web_search_tool_result"]);
  });
});
