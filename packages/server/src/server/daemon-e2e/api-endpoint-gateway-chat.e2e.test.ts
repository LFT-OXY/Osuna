// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway 的 message_tools_test.go、
// opencode_client_test.go（developer 改 system）与 workbuddy_session_test.go（会话头））
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
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
 * 中转站的 OpenAI Chat 入口与 Pi、OMP（任务 10-16-pi-omp-endpoints 工单 01）：真实 daemon + 本机假上游。
 * Pi、OMP 由 fetch 扮演，带上 gateway-tokens.json 里各自的口令，像它们读自己的模型配置那样；
 * 从不运行真的 Pi / OMP，也不碰 ~/.pi、~/.omp。
 */

const PI_TOKEN = "gateway-token-pi-0123456789";
const OMP_TOKEN = "gateway-token-omp-0123456789";
const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const CODEX_TOKEN = "gateway-token-codex-0123456789";
const KEY = "sk-real-key-SECRET";

interface RecordedRequest {
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
  daemon: TestPaseoDaemon;
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

async function startUpstream(
  respond: FakeUpstream["respond"] = (_request, res) => chatReply(res),
): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { url: "", requests: [], respond };
  const server = createServer((req, res) => {
    const received: Buffer[] = [];
    req.on("data", (chunk: Buffer) => received.push(chunk));
    req.on("end", () => {
      const request = {
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

function sse(res: ServerResponse, events: { name?: string; data: unknown }[]): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) {
    const name = event.name === undefined ? "" : `event: ${event.name}\n`;
    const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
    res.write(`${name}data: ${data}\n\n`);
  }
  res.end();
}

/** 假 Chat 上游的流式回复：一段文字，用量 120 进、30 出，其中 100 读自缓存。 */
function chatReply(res: ServerResponse, id = "chatcmpl-upstream-1"): void {
  sse(res, [
    {
      data: {
        id,
        object: "chat.completion.chunk",
        model: "deepseek-v3",
        choices: [{ index: 0, delta: { role: "assistant", content: "hello from chat" } }],
      },
    },
    { data: { id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] } },
    {
      data: {
        id,
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 100 },
        },
      },
    },
    { data: "[DONE]" },
  ]);
}

/** 假 Anthropic 上游的流式回复：先思考，再一段文字，再调用一个工具。 */
function anthropicReply(res: ServerResponse): void {
  const events: Record<string, unknown>[] = [
    {
      type: "message_start",
      message: {
        id: "msg_upstream_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [],
        usage: { input_tokens: 40, output_tokens: 0, cache_read_input_tokens: 300 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "reading" } },
    { type: "content_block_stop", index: 1 },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "toolu_1", name: "read", input: {} },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"path":"a.txt"}' },
    },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 25 } },
    { type: "message_stop" },
  ];
  sse(
    res,
    events.map((event) => ({ name: String(event.type), data: event })),
  );
}

/** 假 Responses 上游的流式回复：一段文字，再调用一个工具。 */
function responsesReply(res: ServerResponse): void {
  const events: Record<string, unknown>[] = [
    {
      type: "response.created",
      response: { id: "resp_upstream_1", model: "gpt-5.5", status: "in_progress" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "msg_1", type: "message", role: "assistant", content: [] },
    },
    { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "done" },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "done" }],
      },
    },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: { id: "fc_1", type: "function_call", call_id: "call_9", name: "bash", arguments: "" },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      output_index: 1,
      delta: '{"cmd":"ls"}',
    },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: {
        id: "fc_1",
        type: "function_call",
        call_id: "call_9",
        name: "bash",
        arguments: '{"cmd":"ls"}',
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp_upstream_1",
        status: "completed",
        output: [],
        usage: { input_tokens: 500, output_tokens: 60, input_tokens_details: { cached_tokens: 0 } },
      },
    },
  ];
  sse(
    res,
    events.map((event) => ({ name: String(event.type), data: event })),
  );
}

function endpoint(input: {
  id: string;
  name: string;
  baseUrls: { format: string; url: string }[];
  models: string[];
}) {
  return {
    id: input.id,
    slug: input.id.replace("ep_", "relay-").replaceAll("_", "-"),
    name: input.name,
    baseUrls: input.baseUrls,
    models: input.models.map((id) => ({ id })),
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

/**
 * 接口按这个顺序：Anthropic 地址的（claude-sonnet-4-5）、两家 Chat 地址的（都有 deepseek-v3）、
 * Responses 地址的（gpt-5.5）。没给的上游指向没人听的端口。
 */
async function start(
  options: {
    anthropic?: FakeUpstream;
    chat?: FakeUpstream;
    chatTwo?: FakeUpstream;
    responses?: FakeUpstream;
    cooldownsNow?: () => number;
    // 第一家 Chat 地址的接口选的模型；缺省 deepseek-v3。
    chatModels?: string[];
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-gateway-chat-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const nobody = "http://127.0.0.1:9";
  const files = {
    "endpoints.json": {
      endpoints: [
        endpoint({
          id: "ep_anthropic",
          name: "Relay Anthropic",
          baseUrls: [{ format: "anthropic_messages", url: options.anthropic?.url ?? nobody }],
          models: ["claude-sonnet-4-5"],
        }),
        endpoint({
          id: "ep_chat",
          name: "Relay Chat",
          baseUrls: [{ format: "openai_chat", url: `${options.chat?.url ?? nobody}/v1` }],
          models: options.chatModels ?? ["deepseek-v3"],
        }),
        endpoint({
          id: "ep_chat_two",
          name: "Relay Chat Two",
          baseUrls: [{ format: "openai_chat", url: `${options.chatTwo?.url ?? nobody}/v1` }],
          models: ["deepseek-v3"],
        }),
        endpoint({
          id: "ep_responses",
          name: "Relay Responses",
          baseUrls: [{ format: "openai_responses", url: `${options.responses?.url ?? nobody}/v1` }],
          models: ["gpt-5.5"],
        }),
      ],
      agents: {
        claude: { enabled: false, defaultModelId: null },
        codex: { enabled: false, defaultModelId: null },
      },
    },
    "keys.json": {
      keys: { ep_anthropic: KEY, ep_chat: KEY, ep_chat_two: KEY, ep_responses: KEY },
    },
    "gateway-tokens.json": {
      tokens: { claude: CLAUDE_TOKEN, codex: CODEX_TOKEN, pi: PI_TOKEN, omp: OMP_TOKEN },
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
      ...(options.cooldownsNow ? { cooldownsNow: options.cooldownsNow } : {}),
    },
  });
  daemons.push(daemon);
  return {
    daemon,
    gateway: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`,
    usageDir: path.join(root, ".paseo", "usage"),
  };
}

function chat(
  harness: Harness,
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: `Bearer ${PI_TOKEN}` },
): Promise<Response> {
  return fetch(`${harness.gateway}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ stream: true, ...body }),
  });
}

/** Chat 流里 data 行的 JSON（[DONE] 原样）；带 event: 行的流不是 Chat 的，测试里直接看原文。 */
function chatData(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .map((data) => (data === "[DONE]" ? data : (JSON.parse(data) as unknown)));
}

interface ChatChunk {
  id?: string;
  object?: string;
  choices?: { delta?: Record<string, unknown>; finish_reason?: string | null }[];
  usage?: Record<string, unknown> | null;
  error?: Record<string, unknown>;
}

function chunks(text: string): ChatChunk[] {
  return chatData(text).filter((data): data is ChatChunk => typeof data === "object");
}

function deltas(text: string, key: string): unknown[] {
  return chunks(text).flatMap((chunk) =>
    (chunk.choices ?? []).flatMap((choice) =>
      choice.delta?.[key] === undefined ? [] : [choice.delta[key]],
    ),
  );
}

async function ledgerRows(usageDir: string): Promise<Record<string, unknown>[]> {
  const dir = path.join(usageDir, "requests");
  let text = "";
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (name.endsWith(".gz")) continue;
    text += await readFile(path.join(dir, name), "utf8");
  }
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => row.kind === "gateway");
}

async function waitForLedger(usageDir: string, count: number): Promise<Record<string, unknown>[]> {
  const deadline = Date.now() + 10_000;
  let rows: Record<string, unknown>[] = [];
  while (Date.now() < deadline) {
    rows = await ledgerRows(usageDir);
    if (rows.length >= count) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The ledger has ${rows.length} rows, not ${count}`);
}

/** 不经 fetch 发请求：扮演网页时要带 Origin。 */
function rawPost(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(input.url, { method: "POST", headers: input.headers }, (response) => {
      const parts: Buffer[] = [];
      response.on("data", (chunk: Buffer) => parts.push(chunk));
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(parts).toString() }),
      );
    });
    sent.on("error", reject);
    sent.end(input.body);
  });
}

const HI = [{ role: "user", content: "hi" }];

function cutOff(res: ServerResponse): void {
  res.destroy();
}

describe("the gateway's OpenAI Chat entrance", () => {
  test("takes a local request, refuses a web page with 403, and other paths stay 404", async () => {
    const upstream = await startUpstream();
    const harness = await start({ chat: upstream });

    const local = await chat(harness, { model: "deepseek-v3", messages: HI });
    expect(local.status).toBe(200);
    expect(local.headers.get("x-osuna-api-endpoint")).toBe("relay-chat");

    const page = await rawPost({
      url: `${harness.gateway}/v1/chat/completions`,
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "user-agent": "Mozilla/5.0 Chrome/140",
      },
      body: JSON.stringify({ model: "deepseek-v3", messages: HI }),
    });
    expect(page.status).toBe(403);
    expect(JSON.parse(page.body)).toMatchObject({ error: { type: "permission_error" } });

    const other = await fetch(`${harness.gateway}/v1/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${PI_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v3", prompt: "hi" }),
    });
    expect(other.status).toBe(404);
    expect(upstream.requests).toHaveLength(1);
  });

  test("Pi and Oh My Pi are told apart by their tokens on every entrance, and the ledger says which", async () => {
    const anthropic = await startUpstream((_request, res) => anthropicReply(res));
    const chatUpstream = await startUpstream();
    const responses = await startUpstream((_request, res) => responsesReply(res));
    const harness = await start({ anthropic, chat: chatUpstream, responses });
    const asks: [string, string, Record<string, unknown>, Record<string, string>][] = [
      ["pi", "/v1/chat/completions", { model: "deepseek-v3", messages: HI }, {}],
      ["omp", "/v1/chat/completions", { model: "deepseek-v3", messages: HI }, {}],
      [
        "pi",
        "/v1/messages",
        { model: "claude-sonnet-4-5", max_tokens: 64, messages: HI },
        { "anthropic-version": "2023-06-01" },
      ],
      [
        "omp",
        "/v1/messages",
        { model: "claude-sonnet-4-5", max_tokens: 64, messages: HI },
        { "anthropic-version": "2023-06-01" },
      ],
      ["pi", "/v1/responses", { model: "gpt-5.5", input: "hi" }, {}],
      ["omp", "/v1/responses", { model: "gpt-5.5", input: "hi" }, {}],
    ];
    for (const [agent, entrance, body, headers] of asks) {
      const token = agent === "pi" ? PI_TOKEN : OMP_TOKEN;
      const response = await fetch(`${harness.gateway}${entrance}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Pi 的 User-Agent 不说明是谁：口令说了算。
          "user-agent": "claude-cli/2.1.302",
          authorization: `Bearer ${token}`,
          ...headers,
        },
        body: JSON.stringify({ stream: true, ...body }),
      });
      expect(response.status, `${agent} ${entrance}`).toBe(200);
      await response.text();
    }
    const rows = await waitForLedger(harness.usageDir, asks.length);
    expect(rows.map((row) => row.agent).sort()).toEqual(asks.map(([agent]) => agent).sort());
    for (const row of rows) expect(row.status).toBe("ok");
  });

  test("a level fixed in the model name is written the way the entrance asked, on all three", async () => {
    const anthropic = await startUpstream((_request, res) => anthropicReply(res));
    const chatUpstream = await startUpstream();
    const responses = await startUpstream((_request, res) => responsesReply(res));
    const harness = await start({ anthropic, chat: chatUpstream, responses });
    const ask = (entrance: string, body: Record<string, unknown>, headers = {}) =>
      fetch(`${harness.gateway}${entrance}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${PI_TOKEN}`,
          ...headers,
        },
        body: JSON.stringify({ stream: true, ...body }),
      }).then((response) => response.text());
    await ask("/v1/chat/completions", { model: "deepseek-v3:high", messages: HI });
    await ask(
      "/v1/messages",
      { model: "claude-sonnet-4-5:high", max_tokens: 32000, messages: HI },
      { "anthropic-version": "2023-06-01" },
    );
    await ask("/v1/responses", { model: "gpt-5.5:high", input: "hi" });

    const chatSent = JSON.parse(chatUpstream.requests[0]!.body) as Record<string, unknown>;
    expect(chatSent).toMatchObject({ model: "deepseek-v3", reasoning_effort: "high" });
    const anthropicSent = JSON.parse(anthropic.requests[0]!.body) as Record<string, unknown>;
    expect(anthropicSent.model).toBe("claude-sonnet-4-5");
    expect(anthropicSent.thinking).toMatchObject({ type: "enabled" });
    expect(anthropicSent).not.toHaveProperty("reasoning_effort");
    const responsesSent = JSON.parse(responses.requests[0]!.body) as Record<string, unknown>;
    expect(responsesSent).toMatchObject({ model: "gpt-5.5", reasoning: { effort: "high" } });
    expect(responsesSent).not.toHaveProperty("reasoning_effort");
  });

  test("without a token of ours: told by User-Agent, and an unknown caller on Chat counts as Pi", async () => {
    const harness = await start({ chat: await startUpstream() });
    for (const userAgent of ["omp/18.12.6", "curl/8.4.0"]) {
      const response = await chat(
        harness,
        { model: "deepseek-v3", messages: HI },
        {
          "user-agent": userAgent,
        },
      );
      expect(response.status).toBe(200);
      await response.text();
    }
    const rows = await waitForLedger(harness.usageDir, 2);
    expect(rows.map((row) => row.agent).sort()).toEqual(["omp", "pi"]);
  });

  test("passed straight to a Chat endpoint: developer becomes system, tools a message carries join the request's", async () => {
    const upstream = await startUpstream();
    const harness = await start({ chat: upstream });
    const readTool = { type: "function", function: { name: "read", parameters: {} } };
    const grepTool = { type: "function", function: { name: "grep", parameters: {} } };
    const response = await chat(harness, {
      model: "deepseek-v3",
      tools: [readTool],
      messages: [
        { role: "developer", content: "be brief" },
        { role: "user", content: "hi" },
        // Pi 在对话中途加的工具：只有工具、没有内容的 system 消息（magpie #2322）。
        { role: "system", tools: [grepTool, { ...readTool, function: { name: "read" } }] },
        { role: "user", content: "and grep" },
      ],
    });
    expect(response.status).toBe(200);
    await response.text();

    const sent = JSON.parse(upstream.requests[0]!.body) as {
      messages: { role: string; content?: string; tools?: unknown }[];
      tools: unknown[];
    };
    expect(sent.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
      { role: "user", content: "and grep" },
    ]);
    expect(sent.tools).toEqual([readTool, grepTool]);
    expect(upstream.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  test("the ledger records the Chat id written back to the CLI as the reply's id", async () => {
    const harness = await start({ chat: await startUpstream() });
    const response = await chat(harness, { model: "deepseek-v3", messages: HI });
    const text = await response.text();
    const id = chunks(text)[0]?.id;
    expect(id).toBe("chatcmpl-upstream-1");
    const [row] = await waitForLedger(harness.usageDir, 1);
    expect(row).toMatchObject({
      agent: "pi",
      replyId: id,
      endpointId: "ep_chat",
      input: 20,
      cachedInput: 100,
      output: 30,
    });
  });

  test("translated to an Anthropic endpoint: the reply streams back as Chat with thinking, the tool call and usage", async () => {
    const anthropic = await startUpstream((_request, res) => anthropicReply(res));
    const harness = await start({ anthropic });
    const response = await chat(harness, {
      model: "claude-sonnet-4-5",
      reasoning_effort: "high",
      messages: [{ role: "developer", content: "be brief" }, ...HI],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("event:");
    expect(deltas(text, "reasoning_content").join("")).toBe("hmm");
    expect(deltas(text, "content").join("")).toBe("reading");
    expect(deltas(text, "tool_calls")).toEqual([
      [
        {
          index: 0,
          id: "toolu_1",
          type: "function",
          function: { name: "read", arguments: "" },
        },
      ],
      [{ index: 0, function: { arguments: '{"path":"a.txt"}' } }],
    ]);
    const all = chunks(text);
    expect(all.flatMap((chunk) => chunk.choices ?? []).at(-1)?.finish_reason).toBe("tool_calls");
    expect(all.at(-1)?.usage).toMatchObject({ prompt_tokens: 340, completion_tokens: 25 });
    expect(chatData(text).at(-1)).toBe("[DONE]");

    const sent = JSON.parse(anthropic.requests[0]!.body) as {
      system: unknown;
      thinking?: unknown;
      tools: { name: string }[];
    };
    expect(JSON.stringify(sent.system)).toContain("be brief");
    expect(sent.tools.map((tool) => tool.name)).toEqual(["read"]);
    expect(anthropic.requests[0]!.url).toBe("/v1/messages");
    const [row] = await waitForLedger(harness.usageDir, 1);
    expect(row).toMatchObject({ agent: "pi", endpointId: "ep_anthropic" });
    expect(String(row!.replyId)).toMatch(/^chatcmpl-/);
    expect(chunks(text)[0]?.id).toBe(row!.replyId);
  });

  test("translated to a Responses endpoint: text and the tool call come back as Chat", async () => {
    const responses = await startUpstream((_request, res) => responsesReply(res));
    const harness = await start({ responses });
    const response = await chat(harness, { model: "gpt-5.5", messages: HI });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(deltas(text, "content").join("")).toBe("done");
    const calls = deltas(text, "tool_calls") as {
      function: { name?: string; arguments: string };
    }[][];
    expect(calls[0]?.[0]?.function.name).toBe("bash");
    expect(calls.map((call) => call[0]?.function.arguments).join("")).toBe('{"cmd":"ls"}');
    expect(chunks(text).at(-1)?.usage).toMatchObject({ prompt_tokens: 500, completion_tokens: 60 });
    expect(responses.requests[0]!.url).toBe("/v1/responses");
  });

  test("an endpoint that fails before answering is passed over for the next with the model", async () => {
    const failing = await startUpstream((_request, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream exploded" } }));
    });
    const next = await startUpstream();
    const harness = await start({ chat: failing, chatTwo: next });
    const response = await chat(harness, { model: "deepseek-v3", messages: HI });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-chat-two");
    expect(deltas(await response.text(), "content").join("")).toBe("hello from chat");
    expect(failing.requests.length).toBeGreaterThan(0);
  });

  test("every endpoint failing: the error comes back in Chat's shape", async () => {
    const failing = await startUpstream((_request, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad things" } }));
    });
    const harness = await start({ chat: failing });
    const response = await chat(harness, { model: "deepseek-v3", stream: false, messages: HI });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("bad things");
  });

  test("a stream cut mid-reply ends with an error in Chat's shape", async () => {
    const cut = await startUpstream((_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-cut",
          choices: [{ index: 0, delta: { role: "assistant", content: "par" } }],
        })}\n\n`,
      );
      setTimeout(cutOff, 20, res);
    });
    const harness = await start({ chat: cut });
    const response = await chat(harness, { model: "deepseek-v3", messages: HI });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("event:");
    const failure = chunks(text).at(-1);
    expect(failure?.error).toMatchObject({ type: "api_error" });
    expect(String(failure?.error?.message)).toContain("Relay Chat");
  });

  test("a refusal from every endpoint is told in Chat's shape", async () => {
    const refusing = await startUpstream((_request, res) =>
      sse(res, [
        { data: { id: "chatcmpl-r", choices: [{ index: 0, delta: { role: "assistant" } }] } },
        {
          data: {
            id: "chatcmpl-r",
            choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
          },
        },
        { data: "[DONE]" },
      ]),
    );
    const harness = await start({ chat: refusing, chatTwo: refusing });
    const response = await chat(harness, { model: "deepseek-v3", messages: HI });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({ type: "invalid_request_error", code: null, param: null });
    expect(String(body.error.message)).toContain(
      "deepseek-v3 refused this request (safety filter: content_filter)",
    );
    expect(refusing.requests).toHaveLength(2);
  });

  test("x-session-affinity keeps a conversation with the endpoint that took over", async () => {
    let now = Date.parse("2026-10-24T10:00:00.000Z");
    let failsFirst = true;
    const first = await startUpstream((_request, res) => {
      if (failsFirst) {
        failsFirst = false;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "busy" } }));
        return;
      }
      chatReply(res, "chatcmpl-first");
    });
    const second = await startUpstream((_request, res) => chatReply(res, "chatcmpl-second"));
    const harness = await start({ chat: first, chatTwo: second, cooldownsNow: () => now });
    const toolTurn = (session: string) =>
      chat(
        harness,
        {
          model: "deepseek-v3",
          messages: [
            { role: "user", content: "list files" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "ls", arguments: "{}" } },
              ],
            },
            { role: "tool", tool_call_id: "c1", content: "a b" },
          ],
        },
        { authorization: `Bearer ${PI_TOKEN}`, "x-session-affinity": session },
      );

    const opening = await toolTurn("pi-session-1");
    expect(opening.headers.get("x-osuna-api-endpoint")).toBe("relay-chat-two");
    await opening.text();
    // 第一家的冷却过去了：同一会话、同一轮仍留在接手的那家，别的会话回到第一家。
    now += 10 * 60_000;
    const same = await toolTurn("pi-session-1");
    expect(same.headers.get("x-osuna-api-endpoint")).toBe("relay-chat-two");
    await same.text();
    const other = await toolTurn("pi-session-2");
    expect(other.headers.get("x-osuna-api-endpoint")).toBe("relay-chat");
    await other.text();
  });

  test("passed straight from a Chat endpoint: empty fields are tidied and a call written into the text becomes a call", async () => {
    const written = '<tool_call>{"name": "read", "arguments": {"path": "a.txt"}}</tool_call>';
    const upstream = await startUpstream((_request, res) =>
      sse(res, [
        {
          data: {
            id: "chatcmpl-w",
            choices: [
              {
                index: 0,
                delta: { content: `let me look ${written}`, reasoning_content: "" },
                finish_reason: "",
              },
            ],
          },
        },
        { data: { id: "chatcmpl-w", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] } },
        { data: "[DONE]" },
      ]),
    );
    const harness = await start({ chat: upstream });
    const response = await chat(harness, {
      model: "deepseek-v3",
      messages: HI,
      tools: [{ type: "function", function: { name: "read", parameters: {} } }],
    });
    const text = await response.text();
    expect(text).not.toContain('"reasoning_content":""');
    expect(text).not.toContain('"finish_reason":""');
    expect(deltas(text, "content").join("")).toBe("let me look ");
    expect(deltas(text, "tool_calls")).toMatchObject([
      [{ index: 0, type: "function", function: { name: "read", arguments: '{"path":"a.txt"}' } }],
    ]);
    const finishes = chunks(text)
      .flatMap((chunk) => chunk.choices ?? [])
      .map((choice) => choice.finish_reason);
    expect(finishes.filter((finish) => finish != null)).toEqual(["tool_calls"]);
  });

  test("a Gemini call's thought signature rides in the id Pi is given and goes back to Gemini, not to others", async () => {
    const signature = Buffer.alloc(2000, 9).toString("base64");
    const gemini = await startUpstream((request, res) => {
      const asked = JSON.parse(request.body) as { messages: unknown[] };
      if (asked.messages.length > 1) return chatReply(res);
      sse(res, [
        {
          data: {
            id: "chatcmpl-g",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_g1",
                      type: "function",
                      function: { name: "read", arguments: "{}" },
                      extra_content: { google: { thought_signature: signature } },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          data: {
            id: "chatcmpl-g",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          },
        },
        { data: "[DONE]" },
      ]);
    });
    const harness = await start({ chat: gemini, chatModels: ["gemini-3-pro"] });
    const first = await chat(harness, { model: "gemini-3-pro", messages: HI });
    const calls = deltas(await first.text(), "tool_calls") as { id: string }[][];
    const id = calls[0]![0]!.id;
    expect(id).toMatch(/^call_g1__tsk16__/);
    expect(id.length).toBeLessThan(60);

    const again = await chat(harness, {
      model: "gemini-3-pro",
      messages: [
        ...HI,
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name: "read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: id, content: "a b" },
      ],
    });
    await again.text();
    const sent = JSON.parse(gemini.requests[1]!.body) as {
      messages: { tool_calls?: Record<string, unknown>[]; tool_call_id?: string }[];
    };
    expect(sent.messages[1]!.tool_calls![0]).toMatchObject({
      id: "call_g1",
      extra_content: { google: { thought_signature: signature } },
    });
    expect(sent.messages[2]!.tool_call_id).toBe("call_g1");
  });
});
