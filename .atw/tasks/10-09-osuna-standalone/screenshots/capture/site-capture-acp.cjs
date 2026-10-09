// 临时文件（不提交）：给官网取图用的脚本化 ACP agent。
// 收到 prompt 后按固定剧本回放一轮会话，并把改动真实写进工作目录，Changes 面板里的 diff 来自 git。
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

let cwd = process.cwd();
const sessionId = "site-capture";

const session = {
  sessionId,
  models: {
    currentModelId: "default",
    availableModels: [{ modelId: "default", name: "Default" }],
  },
};

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
}

function update(payload) {
  send({ method: "session/update", params: { sessionId, update: payload } });
}

function say(text) {
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
}

function think(text) {
  update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });
}

let toolCounter = 0;
function tool({ kind, title, filePath, content, rawInput, rawOutput }) {
  toolCounter += 1;
  const toolCallId = `call_${toolCounter}`;
  const locations = filePath ? [{ path: path.join(cwd, filePath) }] : undefined;
  update({ sessionUpdate: "tool_call", toolCallId, title, kind, status: "in_progress", locations, rawInput });
  update({
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "completed",
    content,
    rawOutput,
  });
}

function read(filePath) {
  const text = fs.readFileSync(path.join(cwd, filePath), "utf8");
  tool({
    kind: "read",
    title: filePath,
    filePath,
    content: [{ type: "content", content: { type: "text", text } }],
  });
}

function edit(filePath, newText) {
  const absolute = path.join(cwd, filePath);
  const oldText = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, newText);
  tool({
    kind: "edit",
    title: filePath,
    filePath,
    content: [{ type: "diff", path: absolute, oldText, newText }],
  });
}

function shell(command, output) {
  tool({
    kind: "execute",
    title: command,
    rawInput: { command },
    content: [{ type: "content", content: { type: "text", text: output } }],
    rawOutput: { exitCode: 0 },
  });
}

const STORE_TS = `import { db } from "./db";

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface Page {
  limit: number;
  offset: number;
}

export async function listNotes({ limit, offset }: Page): Promise<Note[]> {
  return db
    .selectFrom("notes")
    .selectAll()
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .offset(offset)
    .execute();
}

export async function countNotes(): Promise<number> {
  const row = await db
    .selectFrom("notes")
    .select(({ fn }) => fn.countAll<number>().as("total"))
    .executeTakeFirstOrThrow();
  return row.total;
}
`;

const ROUTES_TS = `import { Hono } from "hono";
import { countNotes, listNotes } from "../store";

export const notes = new Hono();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePage(query: Record<string, string>) {
  const limit = Math.min(Number(query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
}

notes.get("/", async (c) => {
  const page = parsePage(c.req.query());
  const [items, total] = await Promise.all([listNotes(page), countNotes()]);
  return c.json({ notes: items, total, ...page });
});
`;

const TEST_TS = `import { describe, expect, it } from "vitest";
import { app } from "../src/server";
import { seedNotes } from "./helpers";

describe("GET /notes", () => {
  it("returns notes ordered by last update", async () => {
    await seedNotes(3);
    const res = await app.request("/notes");
    const body = await res.json();
    expect(body.notes.map((note: { title: string }) => note.title)).toEqual([
      "Note 3",
      "Note 2",
      "Note 1",
    ]);
  });

  it("pages with a default limit of 20", async () => {
    await seedNotes(45);
    const res = await app.request("/notes");
    const body = await res.json();
    expect(body.notes).toHaveLength(20);
    expect(body).toMatchObject({ total: 45, limit: 20, offset: 0 });
  });

  it("caps limit at 100", async () => {
    await seedNotes(120);
    const res = await app.request("/notes?limit=500&offset=10");
    const body = await res.json();
    expect(body.notes).toHaveLength(100);
    expect(body).toMatchObject({ total: 120, limit: 100, offset: 10 });
  });
});
`;

const TEST_OUTPUT = `> notes-api@0.4.0 test
> vitest run

 ✓ test/notes.test.ts (3 tests) 38ms
 ✓ test/health.test.ts (1 test) 4ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  412ms`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function paginationScript() {
  think("先看现有的列表接口和存储层，再决定分页参数怎么传。");
  await sleep(1800);
  read("src/routes/notes.ts");
  await sleep(900);
  read("src/store.ts");
  await sleep(1500);
  say(
    "列表接口现在一次返回全部笔记。我给它加上 `limit` 和 `offset` 两个查询参数，默认每页 20 条、上限 100 条，并在响应里带上 `total`。\n\n",
  );
  await sleep(2600);
  edit("src/store.ts", STORE_TS);
  await sleep(2400);
  edit("src/routes/notes.ts", ROUTES_TS);
  await sleep(3100);
  edit("test/notes.test.ts", TEST_TS);
  await sleep(4200);
  shell("npm test", TEST_OUTPUT);
  await sleep(1500);
  say(
    [
      "分页已经加好，测试全部通过。",
      "",
      "- `GET /notes` 支持 `limit` 与 `offset`，默认 20 条，上限 100 条",
      "- 响应新增 `total`，客户端可以据此计算页数",
      "- 补了两条测试：默认分页、超出上限时截断",
      "",
      "要我顺手把 README 里的接口说明也更新吗？",
    ].join("\n"),
  );
}

async function shortScript() {
  think("先确认失败是不是稳定复现。");
  await sleep(6000);
  shell(
    "npm test -- --retry=0",
    ` ✓ test/charts.test.ts (8 tests) 122ms\n ✓ test/filters.test.ts (5 tests) 31ms\n\n Test Files  2 passed (2)\n      Tests  13 passed (13)`,
  );
  say(
    "本地连跑三次都通过，失败只出现在 CI。日志显示是时区差异：CI 跑在 UTC，`formatDay` 用了本地时区。我来把它改成显式传入时区。",
  );
}

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return;
  let result = {};
  if (request.method === "initialize") {
    result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
  }
  if (request.method === "session/new") {
    if (request.params && typeof request.params.cwd === "string") cwd = request.params.cwd;
    result = session;
  }
  if (request.method === "session/prompt") {
    const text = JSON.stringify(request.params && request.params.prompt);
    if (text.includes("分页")) await paginationScript();
    else await shortScript();
    result = { stopReason: "end_turn" };
  }
  send({ id: request.id, result });
});
