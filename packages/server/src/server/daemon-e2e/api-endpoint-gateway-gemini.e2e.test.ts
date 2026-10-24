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
