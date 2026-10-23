import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  UsageEndpointBreakdown,
  UsageReport,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
import { createTestAgentClient, createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { USAGE_TURN_ROW_SCHEMA, addTotals, emptyTotals } from "../usage/types.js";

/*
 * 中转站账本与 CLI 会话记录合并（任务 10-16-gateway-ledger-usage 工单 01）：真实 daemon + 本机假上游，
 * fetch 扮演 Claude Code 打中转站；临时目录里放假的 Claude Code 会话记录，回复编号与假上游一致，再读用量 RPC。
 * 同一次调用只算一次，与会话记录和账本哪边先到、中间是否重启无关。
 */

const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const KEY_A = "sk-real-key-alpha-SECRET";
const KEY_B = "sk-real-key-beta-SECRET";
const KEY_C = "sk-real-key-gamma-SECRET";
const KEY_D = "sk-real-key-delta-SECRET";
const CODEX_TOKEN = "gateway-token-codex-0123456789";
// ChatGPT 登录的 Codex 带的令牌（假的）：只转给假 ChatGPT 后端。
const CHATGPT_SIGN_IN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
// Codex 的线程编号：会话记录的文件名与会话头都用它。
const THREAD = "019a0000-1111-7222-8333-444455556666";
const SESSION_ID = "sess-gw";
const PROJECT_DIR = "-work-demo";
const SCAN_INTERVAL_MS = 50;
const PROMPT_TEXT = "SECRET-PROMPT-TEXT please list the files";
const REPLY_TEXT = "SECRET-REPLY-TEXT here are the files";

const UNPRICED = {
  autoUpdate: false,
  snapshot: {
    _meta: { source: "test", fetchedAt: "2026-09-18T00:00:00.000Z", etag: null, license: "MIT" },
    models: {},
  },
};

type UsagePricingOptions = NonNullable<
  NonNullable<NonNullable<Parameters<typeof createTestPaseoDaemon>[0]>["usage"]>["pricing"]
>;

// kimi-k2 每个 token 一美元：成本即计费的 token 数，乘了倍率一看便知。
const PRICED = {
  autoUpdate: false,
  snapshot: {
    ...UNPRICED.snapshot,
    models: { "kimi-k2": { input: 1, cachedInput: 1, cacheWrite: 1, output: 1 } },
  },
};

function totals(
  input: number,
  cachedInput: number,
  cacheWrite: number,
  output: number,
  reasoning = 0,
): UsageTokenTotals {
  return { input, cachedInput, cacheWrite, output, reasoning };
}

// 假上游 A 回的用量：账本记的就是它。
const LEDGER_TOTALS = totals(40, 300, 50, 25);
// 会话记录里同一个回复写成两行（先是开头的快照，再是最终的数），最终的数与账本不同：合并后取账本。
const CLI_TOTALS = totals(40, 300, 50, 20);
// 只在会话记录里的一次调用（升级前、或直连）：算「官方」。
const OLD_TOTALS = totals(7, 70, 0, 9);
// 假 Responses 上游回的用量（input_tokens 500 其中缓存 400）：Codex 的账本记的就是它。
const CODEX_LEDGER_TOTALS = totals(100, 400, 0, 60, 10);
// Codex 会话记录里同一个回复记的数，与账本不同：合并后取账本。
const CODEX_CLI_TOTALS = totals(100, 400, 0, 55, 10);
// 翻译路径：假 Chat 上游报 prompt 120（缓存 100）、completion 30。
const CHAT_TOTALS = totals(20, 100, 0, 30);

const servers: Server[] = [];
const tempRoots: string[] = [];
const daemons: TestPaseoDaemon[] = [];
const clients: DaemonClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 假 Anthropic 上游的流式回复：编号 messageId，一段文字，用量即 LEDGER_TOTALS。 */
function anthropicStream(messageId: string) {
  return (res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: "kimi-k2",
          content: [],
          usage: {
            input_tokens: 40,
            output_tokens: 0,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 50,
          },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: REPLY_TEXT } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 25 } },
      { type: "message_stop" },
    ]) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  };
}

/** 假 Responses 上游（与假 ChatGPT 后端）的流式回复：编号 responseId，一段文字，用量即 CODEX_LEDGER_TOTALS。 */
function responsesStream(responseId: string) {
  return (res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      {
        type: "response.created",
        response: { id: responseId, model: "gpt-5.5", status: "in_progress" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "msg_1", type: "message", role: "assistant", content: [] },
      },
      { type: "response.output_text.delta", item_id: "msg_1", delta: REPLY_TEXT },
      {
        type: "response.completed",
        response: {
          id: responseId,
          status: "completed",
          output: [],
          usage: {
            input_tokens: 500,
            output_tokens: 60,
            input_tokens_details: { cached_tokens: 400 },
            output_tokens_details: { reasoning_tokens: 10 },
          },
        },
      },
    ]) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  };
}

function chatStream(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of [
    {
      id: "chatcmpl-77",
      model: "deepseek-v3",
      choices: [{ index: 0, delta: { role: "assistant", content: REPLY_TEXT } }],
    },
    { id: "chatcmpl-77", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    {
      id: "chatcmpl-77",
      choices: [],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    },
  ]) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}

/** 假上游怎么回：每家接口与假 ChatGPT 后端各一个，测试里可以换。请求体也交给它（看是否拒收重问）。 */
type Respond = (res: ServerResponse, body: string) => void;
type UpstreamName = "a" | "b" | "c" | "d" | "chatgpt";

interface Harness {
  daemon: TestPaseoDaemon;
  client: DaemonClient;
  gateway: string;
  root: string;
  claudeRoot: string;
  codexRoot: string;
  usageDir: string;
  replies: Record<UpstreamName, Respond>;
  restart: () => Promise<void>;
}

async function startUpstreamOf(replies: Record<UpstreamName, Respond>, name: UpstreamName) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => replies[name](res, Buffer.concat(chunks).toString("utf8")));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * 四家接口：A 只有 Anthropic 地址（直通），C 只有 Chat 地址（翻译），B 与 D 都有 Responses 地址、都给 gpt-5.5
 * （Codex 先问 B，B 失败换 D）；Claude Code 与 Codex 都走中转站，ChatGPT 自带模型转给假 ChatGPT 后端。
 */
async function start(
  options: {
    messageId?: string;
    pricing?: UsagePricingOptions;
    /** 用量的时钟与逐条记录的大小上限（修剪的测试用）。 */
    now?: () => number;
    requestsMaxBytes?: number;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-ledger-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const claudeRoot = path.join(root, "claude-projects");
  await mkdir(path.join(claudeRoot, PROJECT_DIR), { recursive: true });
  const codexRoot = path.join(root, "codex-sessions");
  await mkdir(path.join(codexRoot, "2026", "10", "23"), { recursive: true });
  const replies: Record<UpstreamName, Respond> = {
    a: anthropicStream(options.messageId ?? "msg_gw_1"),
    b: responsesStream("resp_gw_1"),
    c: chatStream,
    d: responsesStream("resp_gw_d"),
    chatgpt: responsesStream("resp_native_1"),
  };
  const urlA = await startUpstreamOf(replies, "a");
  const urlB = await startUpstreamOf(replies, "b");
  const urlC = await startUpstreamOf(replies, "c");
  const urlD = await startUpstreamOf(replies, "d");
  const urlChatGpt = await startUpstreamOf(replies, "chatgpt");
  const endpoint = (input: {
    id: string;
    slug: string;
    name: string;
    baseUrls: { format: string; url: string }[];
    models: string[];
  }) => ({
    ...input,
    models: input.models.map((id) => ({ id })),
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  const files = {
    "endpoints.json": {
      endpoints: [
        endpoint({
          id: "ep_a",
          slug: "relay-a",
          name: "Relay A",
          baseUrls: [{ format: "anthropic_messages", url: urlA }],
          models: ["kimi-k2"],
        }),
        endpoint({
          id: "ep_c",
          slug: "relay-c",
          name: "Relay C",
          baseUrls: [{ format: "openai_chat", url: `${urlC}/v1` }],
          models: ["deepseek-v3"],
        }),
        endpoint({
          id: "ep_b",
          slug: "relay-b",
          name: "Relay B",
          baseUrls: [{ format: "openai_responses", url: `${urlB}/v1` }],
          models: ["gpt-5.5"],
        }),
        endpoint({
          id: "ep_d",
          slug: "relay-d",
          name: "Relay D",
          baseUrls: [{ format: "openai_responses", url: `${urlD}/v1` }],
          models: ["gpt-5.5"],
        }),
      ],
      agents: {
        claude: { enabled: true, defaultModelId: "kimi-k2" },
        codex: { enabled: true, defaultModelId: "gpt-5.5" },
      },
    },
    "keys.json": { keys: { ep_a: KEY_A, ep_b: KEY_B, ep_c: KEY_C, ep_d: KEY_D } },
    "gateway-tokens.json": { tokens: { claude: CLAUDE_TOKEN, codex: CODEX_TOKEN } },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
  }

  const launch = async () => {
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        gatewayChatGptBaseUrl: urlChatGpt,
        gatewayOpenAiApiBaseUrl: "http://127.0.0.1:9/v1",
        // 最后一家原地重试前不等。
        gatewayRetryPauseMs: 0,
      },
      // 假 Claude Code Agent：会话编号即会话记录里的那个，每轮花费按它读。
      agentClients: {
        ...createTestAgentClients(),
        claude: createTestAgentClient("claude", { nextSessionId: () => SESSION_ID }),
      },
      usage: {
        roots: { claude: [claudeRoot], codex: [codexRoot], pi: [], omp: [] },
        scanIntervalMs: SCAN_INTERVAL_MS,
        pricing: options.pricing ?? UNPRICED,
        ...(options.now ? { now: options.now } : {}),
        ...(options.requestsMaxBytes ? { requests: { maxBytes: options.requestsMaxBytes } } : {}),
      },
    });
    daemons.push(daemon);
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    clients.push(client);
    return {
      daemon,
      client,
      gateway: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`,
    };
  };
  const harness: Harness = {
    ...(await launch()),
    root,
    claudeRoot,
    codexRoot,
    usageDir: path.join(root, ".paseo", "usage"),
    replies,
    restart: async () => {
      await harness.client.close();
      await harness.daemon.close();
      Object.assign(harness, await launch());
    },
  };
  return harness;
}

/** Claude Code 打中转站的一轮：流式，读完整个回复；返回写给 CLI 的回复编号。 */
async function askClaude(harness: Harness, model = "kimi-k2"): Promise<string> {
  const response = await fetch(`${harness.gateway}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CLAUDE_TOKEN}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-claude-code-session-id": SESSION_ID,
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      stream: true,
      messages: [{ role: "user", content: PROMPT_TEXT }],
    }),
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain(REPLY_TEXT);
  const opening = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>)
    .find((event) => event.type === "message_start") as { message: { id: string } };
  return opening.message.id;
}

/** Codex 打中转站的一轮（API key 接法的 /v1/responses，或 ChatGPT 登录的后端路径）：流式，读完整个回复。 */
async function askCodex(
  harness: Harness,
  input: { via?: "api" | "chatgpt"; model?: string } = {},
): Promise<Response> {
  const isChatGpt = input.via === "chatgpt";
  const url = isChatGpt
    ? `${harness.gateway}/backend-api/codex/responses`
    : `${harness.gateway}/v1/responses`;
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${isChatGpt ? CHATGPT_SIGN_IN : CODEX_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "codex_cli_rs/0.130.0 (Mac OS 26.0; arm64)",
      session_id: THREAD,
    },
    body: JSON.stringify({
      model: input.model ?? "gpt-5.5",
      stream: true,
      input: [{ role: "user", content: [{ type: "input_text", text: PROMPT_TEXT }] }],
    }),
  });
}

/** Codex 回复里 response.completed 的编号。 */
async function codexReplyId(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain(REPLY_TEXT);
  const completed = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>)
    .find((event) => event.type === "response.completed") as { response: { id: string } };
  return completed.response.id;
}

/** 照 Codex 的样子追加一轮：第一次带 session_meta，再是这一轮的 token_usage_record。 */
async function appendCodexTurn(
  harness: Harness,
  input: {
    turnId: string;
    responses: { responseId: string; model: string; totals: UsageTokenTotals }[];
  },
): Promise<void> {
  const transcript = path.join(
    harness.codexRoot,
    "2026",
    "10",
    "23",
    `rollout-2026-10-23T10-00-00-${THREAD}.jsonl`,
  );
  const at = Date.now();
  const stamp = (offset: number) => new Date(at + offset).toISOString();
  const lines: unknown[] = [];
  const isNew = await stat(transcript).then(
    () => false,
    () => true,
  );
  if (isNew) {
    lines.push({
      timestamp: stamp(0),
      type: "session_meta",
      payload: { id: THREAD, timestamp: stamp(0), cwd: "/work/demo", originator: "codex_cli_rs" },
    });
  }
  lines.push(
    {
      timestamp: stamp(1),
      type: "event_msg",
      payload: { type: "task_started", turn_id: input.turnId },
    },
    {
      timestamp: stamp(2),
      type: "turn_context",
      payload: { turn_id: input.turnId, model: input.responses[0]?.model, cwd: "/work/demo" },
    },
  );
  let offset = 3;
  for (const response of input.responses) {
    const usage = {
      input_tokens: response.totals.input + response.totals.cachedInput,
      cached_input_tokens: response.totals.cachedInput,
      cache_write_input_tokens: response.totals.cacheWrite,
      output_tokens: response.totals.output,
      reasoning_output_tokens: response.totals.reasoning,
    };
    lines.push({
      timestamp: stamp(offset++),
      type: "token_usage_record",
      payload: {
        thread_id: THREAD,
        turn_id: input.turnId,
        session_id: THREAD,
        root_turn_id: input.turnId,
        response_id: response.responseId,
        usage,
      },
    });
  }
  lines.push({
    timestamp: stamp(offset),
    type: "event_msg",
    payload: { type: "task_complete", turn_id: input.turnId },
  });
  await writeFile(transcript, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, {
    flag: "a",
  });
}

/** Codex 走接口 B 的那次调用在会话记录里的样子。 */
function codexGatewayCall(responseId = "resp_gw_1") {
  return { responseId, model: "gpt-5.5", totals: CODEX_CLI_TOTALS };
}

interface TranscriptCall {
  messageId: string;
  model: string;
  // 同一个回复的每一行的用量（Claude Code 一个内容块写一行，每行重复用量）。
  lines: UsageTokenTotals[];
}

/** 照 Claude Code 的样子追加一轮：用户一行，再是每次调用的各行。 */
async function appendTurn(
  harness: Harness,
  input: { promptId: string; calls: TranscriptCall[] },
): Promise<void> {
  const at = Date.now();
  const stamp = (offset: number) => new Date(at + offset).toISOString();
  const lines: unknown[] = [
    {
      type: "user",
      promptId: input.promptId,
      uuid: `u-${input.promptId}`,
      timestamp: stamp(0),
      cwd: "/work/demo",
      sessionId: SESSION_ID,
      message: { role: "user", content: "<prompt text>" },
    },
  ];
  let offset = 1;
  for (const [callIndex, call] of input.calls.entries()) {
    for (const [lineIndex, usage] of call.lines.entries()) {
      const last = callIndex === input.calls.length - 1 && lineIndex === call.lines.length - 1;
      lines.push({
        type: "assistant",
        uuid: `a-${input.promptId}-${offset}`,
        timestamp: stamp(offset++),
        cwd: "/work/demo",
        sessionId: SESSION_ID,
        message: {
          id: call.messageId,
          model: call.model,
          role: "assistant",
          content: [{ type: "text", text: "<redacted>" }],
          stop_reason: last ? "end_turn" : "tool_use",
          usage: {
            input_tokens: usage.input,
            cache_read_input_tokens: usage.cachedInput,
            cache_creation_input_tokens: usage.cacheWrite,
            output_tokens: usage.output,
          },
        },
      });
    }
  }
  const transcript = path.join(harness.claudeRoot, PROJECT_DIR, `${SESSION_ID}.jsonl`);
  await writeFile(transcript, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, {
    flag: "a",
  });
}

/** 接口 A 那次调用在会话记录里：两行，开头的快照与最终的数。 */
function gatewayCall(messageId = "msg_gw_1"): TranscriptCall {
  return { messageId, model: "kimi-k2", lines: [totals(40, 300, 50, 5), CLI_TOTALS] };
}

const ALL_TIME = { from: null, to: null, timezone: "UTC" };
// 只在账本里的调用在按项目分时的那一行：没有目录。
const UNKNOWN_PROJECT = "";

async function waitForReport(
  harness: Harness,
  accept: (report: UsageReport) => boolean,
  request: Parameters<DaemonClient["usageReportGet"]>[0] = ALL_TIME,
): Promise<UsageReport> {
  const deadline = Date.now() + 15_000;
  let last: UsageReport | null = null;
  while (Date.now() < deadline) {
    const { requestId: _requestId, ...report } = await harness.client.usageReportGet(request);
    last = report;
    if (report.backfill.state === "done" && accept(report)) return report;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Usage report never matched: ${JSON.stringify(last)}`);
}

function endpointGroup(
  endpointId: string | null,
  name: string | null,
  groupTotals: UsageTokenTotals,
  share: number,
): UsageEndpointBreakdown {
  return { endpointId, name, deleted: false, totals: groupTotals, estimatedCost: 0, share };
}

function sameTotals(a: UsageTokenTotals, b: UsageTokenTotals): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sum(...all: UsageTokenTotals[]): UsageTokenTotals {
  const target = emptyTotals();
  for (const one of all) addTotals(target, one);
  return target;
}

/**
 * 每轮用量：盘上的轮次行照 daemon 读回的规则加起来，按轮次与接口分开，去掉加起来是零的。
 */
async function turnUsage(
  usageDir: string,
): Promise<{ turnKey: string; endpointId: string | null; totals: UsageTokenTotals }[]> {
  const byKey = new Map<
    string,
    { turnKey: string; endpointId: string | null; totals: UsageTokenTotals }
  >();
  for (const name of await readdir(usageDir)) {
    if (!name.startsWith("turns-")) continue;
    for (const line of (await readFile(path.join(usageDir, name), "utf8")).split("\n")) {
      if (line.length === 0) continue;
      const row = USAGE_TURN_ROW_SCHEMA.parse(JSON.parse(line));
      const endpointId = row.endpointId ?? null;
      const key = `${row.turnKey} ${endpointId ?? ""}`;
      const entry = byKey.get(key) ?? { turnKey: row.turnKey, endpointId, totals: emptyTotals() };
      addTotals(entry.totals, row);
      byKey.set(key, entry);
    }
  }
  return Array.from(byKey.values())
    .filter((entry) => !sameTotals(entry.totals, emptyTotals()))
    .sort((a, b) => `${a.turnKey}${a.endpointId}`.localeCompare(`${b.turnKey}${b.endpointId}`));
}

/** 一次调用只算一次、带上接口：汇总、按接口、按项目、按会话、每轮用量都一样。 */
async function expectCountedOnce(harness: Harness): Promise<void> {
  const report = await waitForReport(harness, (candidate) =>
    sameTotals(candidate.summary.totals, LEDGER_TOTALS),
  );
  expect(report.summary.totals).toEqual(LEDGER_TOTALS);
  expect(report.summary.sessionCount).toBe(1);
  expect(report.endpoints).toEqual([endpointGroup("ep_a", "Relay A", LEDGER_TOTALS, 1)]);
  expect(report.projects.map((project) => [project.rootPath, project.totals])).toEqual([
    ["/work/demo", LEDGER_TOTALS],
  ]);
  const { sessions } = await harness.client.usageSessionsList(ALL_TIME);
  expect(sessions.map((session) => [session.sessionId, session.totals])).toEqual([
    [SESSION_ID, LEDGER_TOTALS],
  ]);
  expect(await turnUsage(harness.usageDir)).toEqual([
    { turnKey: "p1", endpointId: "ep_a", totals: LEDGER_TOTALS },
  ]);
}

async function readLedger(usageDir: string): Promise<{ text: string; modes: number[] }> {
  const dir = path.join(usageDir, "requests");
  let text = "";
  const modes: number[] = [];
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    const bytes = await readFile(file);
    // 过完的一天压成了 .gz。
    text += (name.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
    modes.push((await stat(file)).mode & 0o777);
  }
  return { text, modes };
}

async function waitForLedgerRow(usageDir: string, replyId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ledger = await readLedger(usageDir).catch(() => ({ text: "" }));
    if (ledger.text.includes(`"replyId":"${replyId}"`)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The ledger never recorded ${replyId}`);
}

describe("the gateway ledger merged with Claude Code's logs", () => {
  test("advertises the gateway ledger", async () => {
    const harness = await start();
    expect(harness.client.getLastServerInfoMessage()?.features?.gatewayLedger).toBe(true);
  });

  test("a call the ledger records before the log is scanned counts once, with its endpoint", async () => {
    const harness = await start();
    expect(await askClaude(harness)).toBe("msg_gw_1");
    // 账本先到：会话记录还没写，这次调用算在未知项目，没有会话。
    const ledgerOnly = await waitForReport(harness, (report) =>
      sameTotals(report.summary.totals, LEDGER_TOTALS),
    );
    expect(ledgerOnly.endpoints).toEqual([endpointGroup("ep_a", "Relay A", LEDGER_TOTALS, 1)]);
    expect(ledgerOnly.projects.map((project) => [project.rootPath, project.totals])).toEqual([
      [UNKNOWN_PROJECT, LEDGER_TOTALS],
    ]);
    expect(ledgerOnly.summary.sessionCount).toBe(0);

    await appendTurn(harness, { promptId: "p1", calls: [gatewayCall()] });

    await waitForReport(harness, (report) => report.projects[0]?.rootPath === "/work/demo");
    await expectCountedOnce(harness);
  });

  test("a call the log shows before the ledger records it counts once, with its endpoint", async () => {
    const harness = await start();
    await appendTurn(harness, { promptId: "p1", calls: [gatewayCall()] });
    // 会话记录先被扫描：还没有账本行，先算「官方」。
    const official = await waitForReport(harness, (report) =>
      sameTotals(report.summary.totals, CLI_TOTALS),
    );
    expect(official.endpoints).toEqual([endpointGroup(null, null, CLI_TOTALS, 1)]);

    await askClaude(harness);

    await expectCountedOnce(harness);
  });

  test("the order still does not matter across a daemon restart", async () => {
    const ledgerFirst = await start();
    await askClaude(ledgerFirst);
    await waitForLedgerRow(ledgerFirst.usageDir, "msg_gw_1");
    await ledgerFirst.restart();
    await appendTurn(ledgerFirst, { promptId: "p1", calls: [gatewayCall()] });
    await waitForReport(ledgerFirst, (report) => report.projects[0]?.rootPath === "/work/demo");
    await expectCountedOnce(ledgerFirst);
    // 再起一次：读回的数一样。
    await ledgerFirst.restart();
    await expectCountedOnce(ledgerFirst);

    const logFirst = await start();
    await appendTurn(logFirst, { promptId: "p1", calls: [gatewayCall()] });
    await waitForReport(logFirst, (report) => sameTotals(report.summary.totals, CLI_TOTALS));
    await logFirst.restart();
    await waitForReport(logFirst, (report) => sameTotals(report.summary.totals, CLI_TOTALS));
    await askClaude(logFirst);
    await expectCountedOnce(logFirst);
  });

  test("a call only the log has is Official, beside the endpoint's calls, and the endpoint filter splits them", async () => {
    const harness = await start();
    await askClaude(harness);
    await appendTurn(harness, {
      promptId: "p1",
      calls: [gatewayCall(), { messageId: "msg_old", model: "claude-opus-5", lines: [OLD_TOTALS] }],
    });
    const all = sum(LEDGER_TOTALS, OLD_TOTALS);
    const report = await waitForReport(harness, (candidate) =>
      sameTotals(candidate.summary.totals, all),
    );
    expect(report.endpoints).toEqual([
      endpointGroup("ep_a", "Relay A", LEDGER_TOTALS, billable(LEDGER_TOTALS) / billable(all)),
      endpointGroup(null, null, OLD_TOTALS, billable(OLD_TOTALS) / billable(all)),
    ]);

    const onlyA = await harness.client.usageReportGet({
      ...ALL_TIME,
      filters: { endpoints: ["ep_a"] },
    });
    expect(onlyA.summary.totals).toEqual(LEDGER_TOTALS);
    expect(onlyA.models.map((model) => model.model)).toEqual(["kimi-k2"]);
    const onlyOfficial = await harness.client.usageReportGet({
      ...ALL_TIME,
      filters: { endpoints: [null] },
    });
    expect(onlyOfficial.summary.totals).toEqual(OLD_TOTALS);
    expect(onlyOfficial.models.map((model) => model.model)).toEqual(["claude-opus-5"]);
  });

  test("a translated reply is matched by the id the gateway wrote back to Claude Code", async () => {
    const harness = await start();
    const replyId = await askClaude(harness, "deepseek-v3");
    expect(replyId).toBe("msg_77");
    await appendTurn(harness, {
      promptId: "p1",
      calls: [{ messageId: replyId, model: "deepseek-v3", lines: [totals(20, 100, 0, 30)] }],
    });

    const report = await waitForReport(
      harness,
      (candidate) =>
        candidate.projects[0]?.rootPath === "/work/demo" &&
        sameTotals(candidate.summary.totals, CHAT_TOTALS),
    );
    expect(report.endpoints).toEqual([endpointGroup("ep_c", "Relay C", CHAT_TOTALS, 1)]);
  });

  test("the ledger keeps no conversation text, only the reply's id and timing, in owner-only files", async () => {
    const harness = await start();
    await askClaude(harness);
    await waitForLedgerRow(harness.usageDir, "msg_gw_1");

    const ledger = await readLedger(harness.usageDir);
    expect(ledger.text).not.toContain("SECRET-PROMPT-TEXT");
    expect(ledger.text).not.toContain("SECRET-REPLY-TEXT");
    expect(ledger.text).not.toContain(KEY_A);
    expect(ledger.modes.every((mode) => mode === 0o600)).toBe(true);
    const row = ledger.text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.replyId === "msg_gw_1");
    expect(row).toMatchObject({
      kind: "gateway",
      agent: "claude",
      sessionId: SESSION_ID,
      model: "kimi-k2",
      endpointId: "ep_a",
      endpointName: "Relay A",
      upstreamModel: "kimi-k2",
      input: 40,
      cachedInput: 300,
      cacheWrite: 50,
      output: 25,
      stop: "stop",
      status: "ok",
    });
    expect(row?.ttftMs).toEqual(expect.any(Number));
    expect(row?.attempts).toEqual([
      expect.objectContaining({ endpointId: "ep_a", model: "kimi-k2", result: "answered" }),
    ]);
  });
});

function hasDeletedEndpoint(report: UsageReport): boolean {
  return report.endpoints?.some((group) => group.deleted) === true;
}

/** 用当前存着的地址与模型改存接口 A（改名），或从它复制出一家。 */
async function saveFromA(
  harness: Harness,
  input: { name: string; copy: boolean },
): Promise<string> {
  const listed = await harness.client.apiEndpointList("claude");
  const a = listed.endpoints.find((endpoint) => endpoint.id === "ep_a");
  if (!a?.baseUrls) throw new Error("Expected endpoint A with its addresses");
  const saved = await harness.client.apiEndpointSave({
    provider: "claude",
    name: input.name,
    baseUrls: a.baseUrls,
    models: [{ id: "kimi-k2" }],
    ...(input.copy ? { copyOf: "ep_a" } : { endpointId: "ep_a" }),
  });
  expect(saved.error).toBeNull();
  if (!saved.endpoint) throw new Error("Expected a saved endpoint");
  return saved.endpoint.id;
}

describe("usage knows an endpoint by its id", () => {
  test("a rename shows the new name over all of its calls, a copy is its own group, and a deleted endpoint keeps its usage and last name across a restart", async () => {
    const harness = await start();
    await askClaude(harness);
    await waitForLedgerRow(harness.usageDir, "msg_gw_1");

    await saveFromA(harness, { name: "Relay A renamed", copy: false });
    harness.replies.a = anthropicStream("msg_gw_2");
    expect(await askClaude(harness)).toBe("msg_gw_2");
    const twice = sum(LEDGER_TOTALS, LEDGER_TOTALS);
    const renamed = await waitForReport(harness, (report) =>
      sameTotals(report.summary.totals, twice),
    );
    expect(renamed.endpoints).toEqual([endpointGroup("ep_a", "Relay A renamed", twice, 1)]);

    // 复制出来的那家用同一个上游；A 关掉后请求落到它身上。
    const copyId = await saveFromA(harness, { name: "Relay A copy", copy: true });
    expect(copyId).not.toBe("ep_a");
    await harness.client.apiEndpointSetEndpointState({ endpointId: "ep_a", enabled: false });
    harness.replies.a = anthropicStream("msg_copy_1");
    expect(await askClaude(harness)).toBe("msg_copy_1");
    const thrice = sum(twice, LEDGER_TOTALS);
    await waitForReport(harness, (report) => sameTotals(report.summary.totals, thrice));

    expect((await harness.client.apiEndpointDelete("claude", "ep_a")).error).toBeNull();
    const expected = [
      { ...endpointGroup("ep_a", "Relay A renamed", twice, 2 / 3), deleted: true },
      endpointGroup(copyId, "Relay A copy", LEDGER_TOTALS, 1 / 3),
    ];
    const afterDelete = await waitForReport(harness, hasDeletedEndpoint);
    expect(afterDelete.endpoints).toEqual(expected);
    expect(afterDelete.summary.totals).toEqual(thrice);

    await harness.restart();
    const restarted = await waitForReport(harness, (report) =>
      sameTotals(report.summary.totals, thrice),
    );
    expect(restarted.endpoints).toEqual(expected);
  });

  test("an endpoint only the ledger still names, gone from the endpoints and the snapshots, is deleted under the name the ledger recorded", async () => {
    const harness = await start();
    await askClaude(harness);
    await waitForLedgerRow(harness.usageDir, "msg_gw_1");
    // 升级前就删掉的接口、或快照文件丢了：接口文件里没有它，快照里也没有。
    const endpointsDir = path.join(harness.usageDir, "..", "api-endpoints");
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: { id: string }[];
    };
    file.endpoints = file.endpoints.filter((endpoint) => endpoint.id !== "ep_a");
    await writeFile(endpointsPath, JSON.stringify(file));
    await rm(path.join(endpointsDir, "endpoint-snapshots.json"), { force: true });

    await harness.restart();

    const report = await waitForReport(harness, (candidate) =>
      sameTotals(candidate.summary.totals, LEDGER_TOTALS),
    );
    expect(report.endpoints).toEqual([
      { ...endpointGroup("ep_a", "Relay A", LEDGER_TOTALS, 1), deleted: true },
    ]);
  });
});

/** 账本里的各行（不含会话记录的回复与合并标记）。 */
async function ledgerRows(usageDir: string): Promise<Record<string, unknown>[]> {
  const ledger = await readLedger(usageDir).catch(() => ({ text: "" }));
  return ledger.text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.kind === "gateway");
}

async function waitForLedgerRows(
  usageDir: string,
  accept: (rows: Record<string, unknown>[]) => boolean,
): Promise<Record<string, unknown>[]> {
  const deadline = Date.now() + 10_000;
  let rows: Record<string, unknown>[] = [];
  while (Date.now() < deadline) {
    rows = await ledgerRows(usageDir);
    if (accept(rows)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The ledger never matched: ${JSON.stringify(rows)}`);
}

/** Codex 的一次调用只算一次、带上接口 B：汇总、按接口、按项目、按会话、每轮用量。 */
async function expectCodexCountedOnce(harness: Harness): Promise<void> {
  const report = await waitForReport(
    harness,
    (candidate) =>
      sameTotals(candidate.summary.totals, CODEX_LEDGER_TOTALS) &&
      candidate.projects[0]?.rootPath === "/work/demo",
  );
  expect(report.endpoints).toEqual([endpointGroup("ep_b", "Relay B", CODEX_LEDGER_TOTALS, 1)]);
  expect(report.projects.map((project) => [project.rootPath, project.totals])).toEqual([
    ["/work/demo", CODEX_LEDGER_TOTALS],
  ]);
  const { sessions } = await harness.client.usageSessionsList(ALL_TIME);
  expect(sessions.map((session) => [session.sessionId, session.totals])).toEqual([
    [THREAD, CODEX_LEDGER_TOTALS],
  ]);
  expect(await turnUsage(harness.usageDir)).toEqual([
    { turnKey: "turn-1", endpointId: "ep_b", totals: CODEX_LEDGER_TOTALS },
  ]);
}

describe("the gateway ledger merged with Codex's logs", () => {
  test("a Codex call the ledger records first counts once, matched by response_id", async () => {
    const harness = await start();
    expect(await codexReplyId(await askCodex(harness))).toBe("resp_gw_1");
    const ledgerOnly = await waitForReport(harness, (report) =>
      sameTotals(report.summary.totals, CODEX_LEDGER_TOTALS),
    );
    expect(ledgerOnly.projects.map((project) => project.rootPath)).toEqual([UNKNOWN_PROJECT]);

    await appendCodexTurn(harness, { turnId: "turn-1", responses: [codexGatewayCall()] });

    await expectCodexCountedOnce(harness);
  });

  test("a Codex call the log shows first counts once, also across a restart", async () => {
    const harness = await start();
    await appendCodexTurn(harness, { turnId: "turn-1", responses: [codexGatewayCall()] });
    const official = await waitForReport(harness, (report) =>
      sameTotals(report.summary.totals, CODEX_CLI_TOTALS),
    );
    expect(official.endpoints).toEqual([endpointGroup(null, null, CODEX_CLI_TOTALS, 1)]);
    await harness.restart();
    await waitForReport(harness, (report) => sameTotals(report.summary.totals, CODEX_CLI_TOTALS));

    await codexReplyId(await askCodex(harness));

    await expectCodexCountedOnce(harness);
    await harness.restart();
    await expectCodexCountedOnce(harness);
  });

  test("a ledger row written before a restart still meets the Codex log after it", async () => {
    const harness = await start();
    await codexReplyId(await askCodex(harness));
    await waitForLedgerRow(harness.usageDir, "resp_gw_1");
    await harness.restart();
    await appendCodexTurn(harness, { turnId: "turn-1", responses: [codexGatewayCall()] });
    await expectCodexCountedOnce(harness);
  });

  test("a ChatGPT model's call is Official, counted once with the log, at the ledger's numbers and no multiplier", async () => {
    const harness = await start();
    expect(await codexReplyId(await askCodex(harness, { via: "chatgpt", model: "gpt-5.6" }))).toBe(
      "resp_native_1",
    );
    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({
      agent: "codex",
      sessionId: THREAD,
      model: "gpt-5.6",
      endpointId: null,
      replyId: "resp_native_1",
      status: "ok",
      input: 100,
      cachedInput: 400,
      output: 60,
    });
    // 照 magpie：官方那一次也是一次尝试，没有接口。
    expect(row?.attempts).toEqual([
      expect.objectContaining({ endpointId: null, model: "gpt-5.6", result: "answered" }),
    ]);
    expect(row?.ttftMs).toEqual(expect.any(Number));

    await appendCodexTurn(harness, {
      turnId: "turn-1",
      responses: [{ responseId: "resp_native_1", model: "gpt-5.6", totals: CODEX_CLI_TOTALS }],
    });

    const report = await waitForReport(
      harness,
      (candidate) =>
        sameTotals(candidate.summary.totals, CODEX_LEDGER_TOTALS) &&
        candidate.projects.length === 1 &&
        candidate.projects[0]?.rootPath === "/work/demo",
    );
    expect(report.endpoints).toEqual([endpointGroup(null, null, CODEX_LEDGER_TOTALS, 1)]);
  });

  test("ChatGPT's own error is a failed try with no endpoint, and the agent's words in error", async () => {
    const harness = await start();
    harness.replies.chatgpt = (res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "ChatGPT is having a moment" } }));
    };
    const response = await askCodex(harness, { via: "chatgpt", model: "gpt-5.6" });
    expect(response.status).toBe(500);
    await response.text();

    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({
      status: "failed",
      endpointId: null,
      output: 0,
      error: "ChatGPT is having a moment",
    });
    expect(row?.attempts).toEqual([
      expect.objectContaining({
        endpointId: null,
        model: "gpt-5.6",
        result: "failed",
        failure: "other",
        reason: "ChatGPT is having a moment",
        cooldownUntil: null,
      }),
    ]);
  });

  test("Codex leaving before ChatGPT answers is booked as ChatGPT unreached, as magpie does", async () => {
    const harness = await start();
    let asked: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      asked = resolve;
    });
    // 假 ChatGPT 收到请求后迟迟不回，Codex 这时走掉。
    harness.replies.chatgpt = () => asked();
    const controller = new AbortController();
    const pending = fetch(`${harness.gateway}/backend-api/codex/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${CHATGPT_SIGN_IN}`,
        "content-type": "application/json",
        session_id: THREAD,
      },
      body: JSON.stringify({ model: "gpt-5.6", stream: true, input: [] }),
    }).catch(() => null);
    await reached;
    controller.abort();
    await pending;

    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({ status: "failed", endpointId: null, output: 0 });
    expect(row?.error).toMatch(/^ChatGPT can't be reached \(context canceled\)/);
    expect(row?.attempts).toEqual([
      expect.objectContaining({ endpointId: null, model: "gpt-5.6", result: "failed" }),
    ]);
  });

  test("a ChatGPT reply that breaks off is booked as it came, like magpie, not as a failure", async () => {
    const harness = await start();
    harness.replies.chatgpt = (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const created = {
        type: "response.created",
        response: { id: "resp_native_2", model: "gpt-5.6", status: "in_progress" },
      };
      res.write(`event: response.created\ndata: ${JSON.stringify(created)}\n\n`);
      setTimeout(() => res.destroy(), 20);
    };
    const response = await askCodex(harness, { via: "chatgpt", model: "gpt-5.6" });
    await response.text().catch(() => "");

    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({ status: "ok", replyId: "resp_native_2", endpointId: null });
    expect(row?.attempts).toEqual([
      expect.objectContaining({ endpointId: null, result: "answered" }),
    ]);
  });

  test("a request every endpoint failed is one row of 0 tokens with each try's endpoint, class, masked reason and cooldown", async () => {
    const harness = await start();
    harness.replies.b = (res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: `upstream overloaded for ${KEY_B} ${"x".repeat(400)}` },
        }),
      );
    };
    harness.replies.d = (res) => {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "insufficient balance" } }));
    };
    const response = await askCodex(harness);
    expect(response.status).toBeGreaterThanOrEqual(400);
    await response.text();

    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({
      agent: "codex",
      status: "failed",
      endpointId: null,
      replyId: null,
      input: 0,
      cachedInput: 0,
      output: 0,
    });
    // 交给 Codex 的就是最后那家的说法，带上它的名字。
    expect(row?.error).toMatch(/^Relay D: insufficient balance/);
    const attempts = row?.attempts as Record<string, unknown>[];
    expect(attempts.map((attempt) => [attempt.endpointId, attempt.result])).toEqual([
      ["ep_b", "failed"],
      ["ep_d", "failed"],
    ]);
    expect(attempts[0]?.failure).toBe("other");
    expect(attempts[0]?.cooldownUntil).toEqual(expect.any(String));
    expect(attempts[0]?.reason).toContain("upstream overloaded");
    expect(attempts[0]?.reason).not.toContain(KEY_B);
    expect(String(attempts[0]?.reason).length).toBeLessThanOrEqual(200);
    expect(attempts[1]?.failure).toBe("credit");
    expect(attempts[1]?.reason).toContain("insufficient balance");

    // 0 token，汇总不变；按项目分照 magpie 把失败的请求算进去：只有失败的请求时也有「未知项目」一行。
    const report = await waitForReport(harness, (candidate) => candidate.projects.length === 1);
    expect(report.summary.totals).toEqual(emptyTotals());
    expect(
      report.projects.map((project) => [project.rootPath, project.unknown, project.totals]),
    ).toEqual([[UNKNOWN_PROJECT, true, emptyTotals()]]);
    expect(report.endpoints).toEqual([]);
  });

  test("a request turned away while every endpoint rests records the resting endpoint as its try, without asking", async () => {
    const harness = await start();
    const broke = (res: ServerResponse) => {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "insufficient balance" } }));
    };
    harness.replies.b = broke;
    harness.replies.d = broke;
    await (await askCodex(harness)).text();
    await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    harness.replies.b = () => {
      throw new Error("a resting endpoint was asked");
    };

    const response = await askCodex(harness);
    expect(response.status).toBe(402);
    await response.text();

    const rows = await waitForLedgerRows(harness.usageDir, (all) => all.length === 2);
    const held = rows[1];
    expect(held).toMatchObject({ status: "failed", endpointId: null, output: 0 });
    expect(held?.error).toMatch(/^Relay B: insufficient balance/);
    expect(held?.attempts).toEqual([
      expect.objectContaining({
        endpointId: "ep_b",
        result: "failed",
        failure: "credit",
        reason: "insufficient balance",
        cooldownUntil: expect.any(String),
        durationMs: 0,
      }),
    ]);
  });

  test("a request the agent cancels before the reply is one cancelled row of 0 tokens", async () => {
    const harness = await start();
    let asked: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      asked = resolve;
    });
    // B 收到请求后迟迟不回，Codex 这时走掉。
    harness.replies.b = () => asked();
    const controller = new AbortController();
    const pending = fetch(`${harness.gateway}/v1/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${CODEX_TOKEN}`,
        "content-type": "application/json",
        session_id: THREAD,
      },
      body: JSON.stringify({ model: "gpt-5.5", stream: true, input: [] }),
    }).catch(() => null);
    await reached;
    controller.abort();
    await pending;

    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({
      agent: "codex",
      status: "cancelled",
      endpointId: null,
      output: 0,
      error: "the agent canceled the request",
    });
    expect(row?.attempts).toEqual([
      expect.objectContaining({
        endpointId: "ep_b",
        result: "failed",
        failure: "canceled",
        reason: "the agent canceled the request",
      }),
    ]);
  });
});

describe("tries in the ledger tell failures, refusals and re-asks apart", () => {
  test("a refusal is a refused try, with the safety filter's reason and no cooldown", async () => {
    const harness = await start();
    harness.replies.a = (res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", code: "content_filter", message: "blocked" },
        }),
      );
    };
    const response = await fetch(`${harness.gateway}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CLAUDE_TOKEN}`,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "kimi-k2",
        max_tokens: 64,
        messages: [{ role: "user", content: PROMPT_TEXT }],
      }),
    });
    expect(response.status).toBe(400);
    await response.text();

    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({ status: "failed" });
    expect(row?.attempts).toEqual([
      expect.objectContaining({
        endpointId: "ep_a",
        result: "refused",
        failure: "refused",
        cooldownUntil: null,
        reasked: false,
      }),
    ]);
  });

  test("a field the endpoint refuses is asked again without it: one answered try marked re-asked", async () => {
    const harness = await start();
    const answer = anthropicStream("msg_gw_1");
    harness.replies.a = (res, body) => {
      if (body.includes('"temperature"')) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "`temperature` is deprecated for this model.",
            },
          }),
        );
        return;
      }
      answer(res, body);
    };
    const response = await fetch(`${harness.gateway}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CLAUDE_TOKEN}`,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "kimi-k2",
        max_tokens: 64,
        temperature: 0.2,
        stream: true,
        messages: [{ role: "user", content: PROMPT_TEXT }],
      }),
    });
    expect(response.status).toBe(200);
    await response.text();

    const [row] = await waitForLedgerRows(harness.usageDir, (rows) => rows.length === 1);
    expect(row).toMatchObject({ status: "ok", replyId: "msg_gw_1" });
    expect(row?.attempts).toEqual([
      expect.objectContaining({ endpointId: "ep_a", result: "answered", reasked: true }),
    ]);
  });
});

/** 计费的 token 数：kimi-k2 在 PRICED 里每个一美元，即按公开价的成本。 */
function billable(one: UsageTokenTotals): number {
  return one.input + one.cachedInput + one.cacheWrite + one.output;
}

/** 用当前存着的地址与模型改存接口 A，只改价格倍率（null 清掉）。 */
async function setMultiplier(harness: Harness, priceMultiplier: number | null) {
  const listed = await harness.client.apiEndpointList("claude");
  const a = listed.endpoints.find((endpoint) => endpoint.id === "ep_a");
  if (!a?.baseUrls) throw new Error("Expected endpoint A with its addresses");
  return harness.client.apiEndpointSave({
    provider: "claude",
    endpointId: "ep_a",
    name: a.name,
    baseUrls: a.baseUrls,
    models: [{ id: "kimi-k2" }],
    priceMultiplier,
  });
}

function costOf(report: UsageReport, endpointId: string | null): number | undefined {
  return report.endpoints?.find((group) => group.endpointId === endpointId)?.estimatedCost;
}

/** 接口 A 的一次调用，加一次只在会话记录里、算「官方」的同模型调用，同一轮。 */
async function askAndLogWithOfficial(harness: Harness): Promise<void> {
  await askClaude(harness);
  await appendTurn(harness, {
    promptId: "p1",
    calls: [gatewayCall(), { messageId: "msg_old", model: "kimi-k2", lines: [OLD_TOTALS] }],
  });
}

describe("an endpoint's price multiplier", () => {
  test("an endpoint's calls cost the list price times its multiplier, Official ones do not, and the sessions and the agent's turn agree", async () => {
    const harness = await start({ pricing: PRICED });
    expect((await setMultiplier(harness, 0.5)).error).toBeNull();
    const work = path.join(harness.root, "work");
    await mkdir(work, { recursive: true });
    const agent = await harness.client.createAgent({
      provider: "claude",
      cwd: work,
      title: "Usage",
    });

    await askAndLogWithOfficial(harness);

    const all = sum(LEDGER_TOTALS, OLD_TOTALS);
    const expected = billable(LEDGER_TOTALS) * 0.5 + billable(OLD_TOTALS);
    const report = await waitForReport(harness, (candidate) =>
      sameTotals(candidate.summary.totals, all),
    );
    expect(costOf(report, "ep_a")).toBe(billable(LEDGER_TOTALS) * 0.5);
    expect(costOf(report, null)).toBe(billable(OLD_TOTALS));
    expect(report.summary.estimatedCost).toBe(expected);
    expect(report.models.map((model) => [model.model, model.estimatedCost])).toEqual([
      ["kimi-k2", expected],
    ]);
    const { sessions } = await harness.client.usageSessionsList(ALL_TIME);
    expect(sessions.map((session) => session.estimatedCost)).toEqual([expected]);
    const { turns } = await harness.client.usageAgentTurnsList(agent.id);
    expect(turns.map((turn) => [turn.turnKey, turn.estimatedCost])).toEqual([["p1", expected]]);
    expect((await harness.client.usageAgentGet(agent.id)).estimatedCost).toBe(expected);
  });

  test("changing the multiplier reprices the endpoint's history and tells clients; none is the list price and 0 is free", async () => {
    const harness = await start({ pricing: PRICED });
    await askClaude(harness);
    await waitForReport(harness, (report) => costOf(report, "ep_a") === billable(LEDGER_TOTALS));

    await harness.client.observeEvents(["usage.pricing.updated"]);
    const repriced = new Promise<void>((resolve) => {
      harness.client.on("usage.pricing.updated", () => resolve());
    });
    expect((await setMultiplier(harness, 2)).error).toBeNull();
    await repriced;
    await waitForReport(
      harness,
      (report) => costOf(report, "ep_a") === billable(LEDGER_TOTALS) * 2,
    );

    expect((await setMultiplier(harness, 0)).error).toBeNull();
    const free = await waitForReport(harness, (report) => costOf(report, "ep_a") === 0);
    expect(free.summary.estimatedCost).toBe(0);

    expect((await setMultiplier(harness, null)).error).toBeNull();
    await waitForReport(harness, (report) => costOf(report, "ep_a") === billable(LEDGER_TOTALS));
    const listed = await harness.client.apiEndpointList("claude");
    expect(listed.endpoints.find((endpoint) => endpoint.id === "ep_a")?.priceMultiplier).toBe(
      undefined,
    );
  });

  test("a price the user set for the model stands as set, not multiplied", async () => {
    const harness = await start({
      pricing: {
        ...PRICED,
        overrides: [
          {
            model: "kimi-k2",
            pricePerMillion: { input: 2e6, cachedInput: 2e6, cacheWrite: 2e6, output: 2e6 },
          },
        ],
      },
    });
    expect((await setMultiplier(harness, 0.5)).error).toBeNull();
    await askClaude(harness);

    const report = await waitForReport(harness, (candidate) =>
      sameTotals(candidate.summary.totals, LEDGER_TOTALS),
    );
    expect(costOf(report, "ep_a")).toBe(billable(LEDGER_TOTALS) * 2);
  });

  test("a deleted endpoint is costed at the multiplier it had when it was deleted, across a restart", async () => {
    const harness = await start({ pricing: PRICED });
    expect((await setMultiplier(harness, 0.25)).error).toBeNull();
    await askClaude(harness);
    await waitForLedgerRow(harness.usageDir, "msg_gw_1");

    expect((await harness.client.apiEndpointDelete("claude", "ep_a")).error).toBeNull();
    const deleted = await waitForReport(harness, hasDeletedEndpoint);
    expect(costOf(deleted, "ep_a")).toBe(billable(LEDGER_TOTALS) * 0.25);

    await harness.restart();
    const restarted = await waitForReport(harness, hasDeletedEndpoint);
    expect(costOf(restarted, "ep_a")).toBe(billable(LEDGER_TOTALS) * 0.25);
  });

  test("a multiplier outside 0 to 1000 or with more than three decimals is refused and the stored one kept", async () => {
    const harness = await start();
    expect((await setMultiplier(harness, 0.125)).error).toBeNull();
    for (const refused of [-0.5, 1000.5, 0.1234]) {
      const saved = await setMultiplier(harness, refused);
      expect(saved.error).toMatchObject({
        code: "invalid_price_multiplier",
        params: { max: "1000" },
      });
    }
    expect((await setMultiplier(harness, 1000)).error).toBeNull();
    const listed = await harness.client.apiEndpointList("claude");
    expect(listed.endpoints.find((endpoint) => endpoint.id === "ep_a")?.priceMultiplier).toBe(1000);
  });
});

type RequestsListRequest = Parameters<DaemonClient["usageRequestsList"]>[0];
type RequestsListPage = Awaited<ReturnType<DaemonClient["usageRequestsList"]>>;

/** 请求列表：全部时段，每页 100 条，筛选另给。 */
function requestsOf(overrides: Partial<RequestsListRequest> = {}): RequestsListRequest {
  return { ...ALL_TIME, offset: 0, limit: 100, ...overrides };
}

async function waitForRequests(
  harness: Harness,
  accept: (page: RequestsListPage) => boolean,
  request: RequestsListRequest = requestsOf(),
): Promise<RequestsListPage> {
  const deadline = Date.now() + 15_000;
  let last: RequestsListPage | null = null;
  while (Date.now() < deadline) {
    last = await harness.client.usageRequestsList(request);
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The Requests list never matched: ${JSON.stringify(last)}`);
}

/** 各页的回复编号，没有编号的行写它的状态。 */
function replyIdsOf(page: RequestsListPage): string[] {
  return page.requests.map((row) => row.replyId ?? row.status);
}

/**
 * 四次请求，从旧到新：Claude Code 经接口 A（会话记录里也有，合成一条）、同一轮里一次只在会话记录里的直连、
 * Codex 先问 B 失败再由 D 回答（换过一家）、Codex 再问时先问刚答过的 D 也失败，再问 B 仍失败。
 */
async function fourRequests(harness: Harness, overloaded = "upstream overloaded"): Promise<void> {
  await askClaude(harness);
  await waitForLedgerRow(harness.usageDir, "msg_gw_1");
  await appendTurn(harness, {
    promptId: "p1",
    calls: [
      gatewayCall(),
      { messageId: "msg_direct_1", model: "claude-opus-4-1", lines: [OLD_TOTALS] },
    ],
  });
  await waitForRequests(harness, (page) => page.total === 2 && page.requests[1]?.project !== null);
  harness.replies.b = (res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: overloaded } }));
  };
  expect(await codexReplyId(await askCodex(harness))).toBe("resp_gw_d");
  await waitForRequests(harness, (page) => page.total === 3);
  harness.replies.d = (res) => {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "insufficient balance" } }));
  };
  await (await askCodex(harness)).text();
  await waitForRequests(harness, (page) => page.total === 4);
}

describe("the Requests list", () => {
  test("lists every request newest first: the merged call with the log's project, the direct call with no timing, and the failed ones", async () => {
    const harness = await start();
    await fourRequests(harness);

    const page = await harness.client.usageRequestsList(requestsOf());
    expect(page.total).toBe(4);
    expect(replyIdsOf(page)).toEqual(["failed", "resp_gw_d", "msg_direct_1", "msg_gw_1"]);
    const [failed, switched, direct, merged] = page.requests;
    expect(merged).toMatchObject({
      cli: "claude",
      model: "kimi-k2",
      through: "gateway",
      endpointId: "ep_a",
      endpointName: "Relay A",
      endpointDeleted: false,
      totals: LEDGER_TOTALS,
      status: "ok",
      error: null,
      sessionId: SESSION_ID,
      project: { rootPath: "/work/demo", displayName: "demo" },
    });
    expect(merged?.durationMs).toEqual(expect.any(Number));
    expect(merged?.ttftMs).toEqual(expect.any(Number));
    expect(merged?.attempts).toEqual([
      expect.objectContaining({ endpointId: "ep_a", endpointName: "Relay A", result: "answered" }),
    ]);
    expect(direct).toMatchObject({
      cli: "claude",
      model: "claude-opus-4-1",
      through: "direct",
      endpointId: null,
      endpointName: null,
      totals: OLD_TOTALS,
      durationMs: null,
      ttftMs: null,
      outputSpeed: null,
      status: "ok",
      attempts: [],
      sessionId: SESSION_ID,
      project: { rootPath: "/work/demo" },
    });
    expect(switched).toMatchObject({
      cli: "codex",
      through: "gateway",
      endpointId: "ep_d",
      endpointName: "Relay D",
      totals: CODEX_LEDGER_TOTALS,
      status: "ok",
      replyId: "resp_gw_d",
      project: null,
    });
    // 展开一行看每次尝试：哪家、结果、失败分类与原因、冷却到何时。
    expect(switched?.attempts).toEqual([
      expect.objectContaining({
        endpointId: "ep_b",
        endpointName: "Relay B",
        model: "gpt-5.5",
        result: "failed",
        failure: "other",
        reason: expect.stringContaining("upstream overloaded"),
        cooldownUntil: expect.any(String),
      }),
      expect.objectContaining({ endpointId: "ep_d", result: "answered", failure: null }),
    ]);
    // 没人回答的请求按它最后试的那家算接口，error 是交给 Agent 的说法。
    expect(failed).toMatchObject({
      cli: "codex",
      through: "gateway",
      endpointId: "ep_b",
      endpointName: "Relay B",
      status: "failed",
      error: "Relay B: upstream overloaded",
      totals: emptyTotals(),
      project: null,
      replyId: null,
    });
    expect(failed?.attempts.map((attempt) => [attempt.endpointId, attempt.failure])).toEqual([
      ["ep_d", "credit"],
      ["ep_b", "other"],
    ]);
    expect(page.facets).toEqual({
      clis: ["claude", "codex"],
      endpoints: [
        { endpointId: null, name: null, deleted: false },
        { endpointId: "ep_a", name: "Relay A", deleted: false },
        { endpointId: "ep_b", name: "Relay B", deleted: false },
        { endpointId: "ep_d", name: "Relay D", deleted: false },
      ],
      models: ["claude-opus-4-1", "gpt-5.5", "kimi-k2"],
    });
  });

  test("filters by status, through the gateway or direct, agent, endpoint, model and search, and the facets stay whole", async () => {
    const harness = await start();
    await fourRequests(harness);
    const list = async (filters: RequestsListRequest["filters"]) => {
      const page = await harness.client.usageRequestsList(requestsOf({ filters }));
      expect(page.total).toBe(page.requests.length);
      expect(page.facets.models).toEqual(["claude-opus-4-1", "gpt-5.5", "kimi-k2"]);
      return replyIdsOf(page);
    };

    expect(await list({ status: "failed" })).toEqual(["failed"]);
    expect(await list({ status: "switched" })).toEqual(["resp_gw_d"]);
    expect(await list({ status: "all" })).toHaveLength(4);
    expect(await list({ through: "direct" })).toEqual(["msg_direct_1"]);
    expect(await list({ through: "gateway" })).toEqual(["failed", "resp_gw_d", "msg_gw_1"]);
    expect(await list({ clis: ["claude"] })).toEqual(["msg_direct_1", "msg_gw_1"]);
    expect(await list({ endpoints: [null] })).toEqual(["msg_direct_1"]);
    expect(await list({ endpoints: ["ep_d"] })).toEqual(["resp_gw_d"]);
    expect(await list({ endpoints: ["ep_b"] })).toEqual(["failed"]);
    expect(await list({ endpoints: ["ep_a", null] })).toEqual(["msg_direct_1", "msg_gw_1"]);
    expect(await list({ models: ["kimi-k2"] })).toEqual(["msg_gw_1"]);
    // 搜索不分大小写，看模型、接口名、会话、项目与失败原因。
    expect(await list({ search: "relay d" })).toEqual(["failed", "resp_gw_d"]);
    expect(await list({ search: "OPUS" })).toEqual(["msg_direct_1"]);
    expect(await list({ search: SESSION_ID })).toEqual(["msg_direct_1", "msg_gw_1"]);
    expect(await list({ search: "/work/demo" })).toEqual(["msg_direct_1", "msg_gw_1"]);
    expect(await list({ search: "insufficient" })).toEqual(["failed"]);
    expect(await list({ clis: ["codex"], status: "failed", search: "nothing like it" })).toEqual(
      [],
    );
  });

  test("pages a hundred at a time by offset, with the total of every page together; a period with nothing lists nothing", async () => {
    const harness = await start();
    await fourRequests(harness);

    const first = await harness.client.usageRequestsList(requestsOf({ offset: 0, limit: 3 }));
    expect(first.total).toBe(4);
    expect(replyIdsOf(first)).toEqual(["failed", "resp_gw_d", "msg_direct_1"]);
    const second = await harness.client.usageRequestsList(requestsOf({ offset: 3, limit: 3 }));
    expect(second.total).toBe(4);
    expect(replyIdsOf(second)).toEqual(["msg_gw_1"]);
    const past = await harness.client.usageRequestsList(requestsOf({ offset: 8, limit: 3 }));
    expect(past).toMatchObject({ total: 4, requests: [] });

    const longAgo = await harness.client.usageRequestsList(
      requestsOf({ from: "2020-01-01", to: "2020-01-31" }),
    );
    expect(longAgo).toMatchObject({
      total: 0,
      requests: [],
      facets: { clis: [], endpoints: [], models: [] },
    });
  });

  test("the list is the same after a restart", async () => {
    const harness = await start();
    await fourRequests(harness);
    const before = await harness.client.usageRequestsList(requestsOf());
    await harness.restart();
    await waitForReport(harness, () => true);
    const after = await harness.client.usageRequestsList(requestsOf());
    expect(after.requests).toEqual(before.requests);
  });
});

/** 按 RFC 4180 读回 CSV：引号里的逗号、换行与成对的引号都是字段的一部分。 */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) throw new Error("CSV does not end with a newline");
  return records;
}

const CSV_HEADER = [
  "time",
  "agent",
  "model",
  "endpoint",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
  "cost_usd",
  "duration_ms",
  "ttft_ms",
  "output_tokens_per_second",
  "status",
  "error_type",
  "error_message",
  "tries",
  "response_id",
  "session",
];

/** 每行按列名取值。 */
function csvRows(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  expect(header).toEqual(CSV_HEADER);
  return rows.map((cells) => {
    expect(cells).toHaveLength(CSV_HEADER.length);
    return Object.fromEntries(CSV_HEADER.map((name, index) => [name, cells[index] ?? ""]));
  });
}

describe("the Requests CSV export", () => {
  test("exports every request the filters keep, all pages, with the list's columns, reasoning, the failure, tries, reply id and session; costs in USD and commas, quotes and newlines escaped", async () => {
    const harness = await start({ pricing: PRICED });
    await fourRequests(harness, 'upstream overloaded, "busy"');
    // 一次直连回复，编号里有逗号、引号和换行。
    const oddReplyId = 'msg_odd, "quoted"\nnext line';
    await appendTurn(harness, {
      promptId: "p2",
      calls: [{ messageId: oddReplyId, model: "claude-opus-4-1", lines: [OLD_TOTALS] }],
    });
    await waitForRequests(harness, (page) => page.total === 5);

    const all = await harness.client.usageRequestsExport(ALL_TIME);
    const rows = csvRows(all.csv);
    const listed = await harness.client.usageRequestsList(requestsOf({ limit: 1 }));
    expect(rows).toHaveLength(listed.total);
    expect(rows.map((row) => row.response_id || row.status)).toEqual([
      oddReplyId,
      "failed",
      "resp_gw_d",
      "msg_direct_1",
      "msg_gw_1",
    ]);
    expect(all.csv).toContain('"msg_odd, ""quoted""\nnext line"');
    const [, failed, switched, direct, merged] = rows;
    // kimi-k2 每个 token 一美元：按美元写成本，没有价的模型留空。
    expect(merged).toMatchObject({
      agent: "claude",
      model: "kimi-k2",
      endpoint: "Relay A",
      input_tokens: "40",
      output_tokens: "25",
      cache_read_tokens: "300",
      cache_write_tokens: "50",
      reasoning_tokens: "0",
      cost_usd: "415.000000",
      status: "ok",
      error_type: "",
      error_message: "",
      tries: "1",
      response_id: "msg_gw_1",
      session: SESSION_ID,
    });
    expect(merged?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Number(merged?.duration_ms)).toBeGreaterThanOrEqual(0);
    expect(merged?.ttft_ms).toMatch(/^\d+$/);
    expect(direct).toMatchObject({
      model: "claude-opus-4-1",
      endpoint: "Official",
      cost_usd: "",
      duration_ms: "",
      ttft_ms: "",
      output_tokens_per_second: "",
      tries: "",
      session: SESSION_ID,
    });
    expect(switched).toMatchObject({
      agent: "codex",
      endpoint: "Relay D",
      reasoning_tokens: "10",
      cost_usd: "",
      status: "ok",
      tries: "2",
      response_id: "resp_gw_d",
    });
    expect(failed).toMatchObject({
      agent: "codex",
      endpoint: "Relay B",
      status: "failed",
      error_type: "other",
      error_message: 'Relay B: upstream overloaded, "busy"',
      tries: "2",
      response_id: "",
    });
    expect(all.csv).toContain(',"Relay B: upstream overloaded, ""busy""",');

    const codex = await harness.client.usageRequestsExport({
      ...ALL_TIME,
      filters: { clis: ["codex"] },
    });
    expect(csvRows(codex.csv).map((row) => row.response_id || row.status)).toEqual([
      "failed",
      "resp_gw_d",
    ]);
    const nothing = await harness.client.usageRequestsExport({
      from: "2020-01-01",
      to: "2020-01-31",
      timezone: "Asia/Shanghai",
    });
    expect(nothing.csv).toBe(`${CSV_HEADER.join(",")}\n`);
    // 时间按请求的时区写，带它的偏移。
    const shanghai = csvRows(
      (await harness.client.usageRequestsExport({ ...ALL_TIME, timezone: "Asia/Shanghai" })).csv,
    );
    expect(shanghai[4]?.time).toMatch(/\+08:00$/);
    expect(Date.parse(shanghai[4]?.time ?? "")).toBe(Date.parse(merged?.time ?? ""));
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一个可以拨动的用量时钟：从真实的此刻起，加上测试拨过的时间。 */
function movableClock(): { now: () => number; advance: (ms: number) => void } {
  const base = Date.now();
  let offset = 0;
  return {
    now: () => base + offset,
    advance: (ms) => {
      offset += ms;
    },
  };
}

/**
 * 一行没人回答的请求。error 后面补 padding：`random` 压不小（随机十六进制），`plain` 一压就小。
 */
function failedRequestLine(
  at: number,
  padding: { length: number; kind: "random" | "plain" } = { length: 0, kind: "plain" },
  label = "seeded",
): string {
  const iso = new Date(at).toISOString();
  const fill =
    padding.kind === "random"
      ? randomBytes(Math.ceil(padding.length / 2))
          .toString("hex")
          .slice(0, padding.length)
      : "x".repeat(padding.length);
  const row = {
    kind: "gateway",
    at: iso,
    agent: "codex",
    sessionId: null,
    model: "gpt-5.5",
    endpointId: null,
    endpointName: null,
    upstreamModel: null,
    input: 0,
    cachedInput: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    output: 0,
    reasoning: 0,
    durationMs: 5,
    ttftMs: null,
    firstTextMs: null,
    replyId: null,
    stop: null,
    status: "failed",
    error: `${label} ${fill}`,
    attempts: [],
  };
  return `${JSON.stringify(row)}\n`;
}

/** 盘上某天的逐条记录文件追加一行没人回答的请求，回这个文件。 */
async function seedFailedRequest(
  usageDir: string,
  at: number,
  padding?: { length: number; kind: "random" | "plain" },
): Promise<string> {
  const dir = path.join(usageDir, "requests");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${new Date(at).toISOString().slice(0, 10)}.jsonl`);
  await writeFile(file, failedRequestLine(at, padding), { flag: "a" });
  return file;
}

/** 某天的逐条记录文件：明文的与压过的。 */
function dayFiles(usageDir: string, at: number): { plain: string; gz: string } {
  const plain = path.join(usageDir, "requests", `${new Date(at).toISOString().slice(0, 10)}.jsonl`);
  return { plain, gz: `${plain}.gz` };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

async function waitForGone(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await exists(file))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${file} was never pruned`);
}

describe("the Requests list keeps 30 days and 200 MB", () => {
  test("a day past 30 days goes whole, the summary keeps its calls, and a restart neither brings it back nor counts it twice", async () => {
    const clock = movableClock();
    const harness = await start({ now: clock.now });
    await askClaude(harness);
    await appendTurn(harness, { promptId: "p1", calls: [gatewayCall()] });
    await waitForRequests(
      harness,
      (page) => page.total === 1 && page.requests[0]?.project !== null,
    );
    await waitForReport(harness, (report) => report.projects[0]?.rootPath === "/work/demo");
    await expectCountedOnce(harness);

    // 31 天后，下一次写入时修剪：今天这一天整天删掉（连刚记下的那行）。
    clock.advance(31 * DAY_MS);
    await codexReplyId(await askCodex(harness));
    await waitForRequests(harness, (page) => page.total === 0);
    const all = sum(LEDGER_TOTALS, CODEX_LEDGER_TOTALS);
    const report = await waitForReport(harness, (candidate) =>
      sameTotals(candidate.summary.totals, all),
    );
    expect(report.endpoints).toEqual([
      endpointGroup("ep_b", "Relay B", CODEX_LEDGER_TOTALS, expect.any(Number) as number),
      endpointGroup("ep_a", "Relay A", LEDGER_TOTALS, expect.any(Number) as number),
    ]);
    expect(await readdir(path.join(harness.usageDir, "requests"))).toEqual([]);

    await harness.restart();
    const restarted = await waitForReport(harness, (candidate) =>
      sameTotals(candidate.summary.totals, all),
    );
    expect(restarted.endpoints).toEqual(report.endpoints);
    expect(restarted.projects.map((project) => [project.rootPath, project.totals])).toEqual(
      report.projects.map((project) => [project.rootPath, project.totals]),
    );
    expect(await turnUsage(harness.usageDir)).toEqual([
      { turnKey: "p1", endpointId: "ep_a", totals: LEDGER_TOTALS },
    ]);
    expect(await harness.client.usageRequestsList(requestsOf())).toMatchObject({ total: 0 });
  });

  test("over the size cap, counted compressed, the oldest day goes first, at most once an hour, and today stays", async () => {
    const clock = movableClock();
    const harness = await start({ now: clock.now, requestsMaxBytes: 10_000 });
    // 压不小的一天（约 20 KB 压过）与一行的一天，种好后重启让 daemon 读到。
    const oldestAt = clock.now() - 3 * DAY_MS;
    const olderAt = clock.now() - 2 * DAY_MS;
    await seedFailedRequest(harness.usageDir, oldestAt, { length: 40_000, kind: "random" });
    await seedFailedRequest(harness.usageDir, olderAt);
    await harness.restart();
    await waitForRequests(harness, (page) => page.total === 2);

    await codexReplyId(await askCodex(harness));
    const oldest = dayFiles(harness.usageDir, oldestAt);
    const older = dayFiles(harness.usageDir, olderAt);
    await waitForGone(oldest.plain);
    expect(await exists(oldest.gz)).toBe(false);
    // 过完的一天压成 .gz，明文的那份不在了。
    expect(await exists(older.gz)).toBe(true);
    expect(await exists(older.plain)).toBe(false);
    const page = await waitForRequests(harness, (candidate) => candidate.total === 2);
    expect(page.requests.map((row) => row.replyId ?? row.error)).toEqual(["resp_gw_1", "seeded "]);

    // 一小时内不再修剪：又塞进一个更旧、压不小的一天，下一次写入后它还在；过了一小时才删。
    const staleAt = clock.now() - 5 * DAY_MS;
    const stale = await seedFailedRequest(harness.usageDir, staleAt, {
      length: 40_000,
      kind: "random",
    });
    await codexReplyId(await askCodex(harness));
    await waitForLedgerRows(harness.usageDir, (rows) => rows.length >= 4);
    expect(await exists(stale)).toBe(true);
    clock.advance(61 * 60 * 1000);
    await codexReplyId(await askCodex(harness));
    await waitForGone(stale);
    expect(await exists(dayFiles(harness.usageDir, staleAt).gz)).toBe(false);
    expect(await exists(older.gz)).toBe(true);
  });

  test("a finished day is gzipped and still read: its .gz and a line written after it read as one day, before and after a restart", async () => {
    const clock = movableClock();
    const harness = await start({ now: clock.now, requestsMaxBytes: 10_000 });
    // 前天：压过的一份里一行（明文 40 KB，压过只有几百字节），旁边明文的文件里后来又追加的一行。
    const dayAt = clock.now() - 2 * DAY_MS;
    const day = dayFiles(harness.usageDir, dayAt);
    await mkdir(path.dirname(day.plain), { recursive: true });
    const early = failedRequestLine(dayAt, { length: 40_000, kind: "plain" }, "early");
    await writeFile(day.gz, gzipSync(early));
    await writeFile(day.plain, failedRequestLine(dayAt + 1000, undefined, "late"));
    await harness.restart();
    const errorsOf = (candidate: RequestsListPage) =>
      candidate.requests.map((row) => (row.error ?? "").slice(0, 5));
    const before = await waitForRequests(harness, (candidate) => candidate.total === 2);
    expect(errorsOf(before)).toEqual(["late ", "early"]);

    // 下一次写入时修剪：明文那份并进 .gz；按压过的大小算没超，这一天留着。
    await codexReplyId(await askCodex(harness));
    await waitForGone(day.plain);
    expect(await exists(day.gz)).toBe(true);
    const after = await waitForRequests(harness, (candidate) => candidate.total === 3);
    expect(errorsOf(after).slice(1)).toEqual(["late ", "early"]);
    expect(
      gunzipSync(await readFile(day.gz))
        .toString("utf8")
        .split("\n")
        .filter(Boolean),
    ).toHaveLength(2);

    await harness.restart();
    const restarted = await waitForRequests(harness, (candidate) => candidate.total === 3);
    expect(restarted.requests).toEqual(after.requests);
  });
});
