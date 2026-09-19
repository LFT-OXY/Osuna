import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  createClaudeParserState,
  parseClaudeChunk,
  settleClaudeOpenTurn,
} from "./claude-parser.js";
import {
  addBucketRow,
  bucketRowKey,
  type UsageBucketRow,
  type UsageTurnRowDraft,
} from "./types.js";

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/claude/${name}`, import.meta.url));
}

function aggregate(rows: UsageBucketRow[]): UsageBucketRow[] {
  const merged = new Map<string, UsageBucketRow>();
  for (const row of rows) {
    const key = bucketRowKey(row);
    const existing = merged.get(key);
    if (existing) {
      addBucketRow(existing, row);
      continue;
    }
    merged.set(key, { ...row });
  }
  return Array.from(merged.values());
}

const SESSION_ROWS: UsageBucketRow[] = [
  {
    cli: "claude",
    backend: null,
    model: "claude-fable-5-1",
    sessionId: "sess-1",
    cwd: "/work/demo",
    bucket: "2026-09-18T09:30:00.000Z",
    input: 2,
    cachedInput: 34560,
    cacheWrite: 26884,
    output: 410,
    reasoning: 86,
    turns: 1,
    durationMs: 77_413,
  },
  {
    cli: "claude",
    backend: null,
    model: "claude-fable-5-1",
    sessionId: "sess-1",
    cwd: "/work/demo",
    bucket: "2026-09-18T09:45:00.000Z",
    input: 5,
    cachedInput: 40_000,
    cacheWrite: 0,
    output: 600,
    reasoning: 100,
    turns: 0,
    durationMs: 0,
  },
  {
    cli: "claude",
    backend: null,
    model: "claude-opus-5",
    sessionId: "sess-1",
    cwd: "/work/demo",
    bucket: "2026-09-18T10:00:00.000Z",
    input: 10,
    cachedInput: 100,
    cacheWrite: 200,
    output: 50,
    reasoning: 0,
    turns: 1,
    durationMs: 30_000,
  },
];

/** One row per model of each turn; the subagent's tokens join its parent's. */
const SESSION_TURNS: UsageTurnRowDraft[] = [
  {
    cli: "claude",
    backend: null,
    sessionId: "sess-1",
    turnKey: "p1",
    attachAt: null,
    model: "claude-fable-5-1",
    input: 7,
    cachedInput: 74_560,
    cacheWrite: 26_884,
    output: 1010,
    reasoning: 186,
    startedAt: "2026-09-18T09:44:42.587Z",
    lastAt: "2026-09-18T09:46:00.000Z",
    // The tool_result line repeats the prompt id but is not a user message.
    userMessageIds: ["u1"],
  },
  {
    cli: "claude",
    backend: null,
    sessionId: "sess-1",
    turnKey: "p2",
    attachAt: null,
    model: "claude-opus-5",
    input: 10,
    cachedInput: 100,
    cacheWrite: 200,
    output: 50,
    reasoning: 0,
    startedAt: "2026-09-18T10:01:00.000Z",
    lastAt: "2026-09-18T10:01:30.000Z",
    userMessageIds: ["u9"],
  },
];

describe("parseClaudeChunk", () => {
  test("reads a whole session: multi-line message groups, skipped rows, turns and duration", () => {
    const bytes = fixture("claude-session.jsonl");
    const result = parseClaudeChunk(bytes, createClaudeParserState({ subagent: false }));

    expect(result.rows).toEqual(SESSION_ROWS);
    expect(result.turnRows).toEqual(SESSION_TURNS);
    expect(result.consumedBytes).toBe(bytes.length);
    expect(result.firstAt).toBe("2026-09-18T09:44:42.587Z");
    expect(result.lastAt).toBe("2026-09-18T10:01:30.000Z");
    expect(result.state).toEqual({
      kind: "claude",
      sessionId: "sess-1",
      cwd: "/work/demo",
      subagent: false,
      forkedFromSessionId: "sess-0",
      openTurn: {
        turnKey: "p2",
        startedAt: "2026-09-18T10:01:00.000Z",
        bucket: "2026-09-18T10:00:00.000Z",
        lastAt: "2026-09-18T10:01:30.000Z",
        settledMs: 30_000,
        model: "claude-opus-5",
        userMessageIds: ["u9"],
      },
      parentTurnKey: null,
      lastMessage: {
        id: "msg_c",
        model: "claude-opus-5",
        cwd: "/work/demo",
        bucket: "2026-09-18T10:00:00.000Z",
        input: 10,
        cachedInput: 100,
        cacheWrite: 200,
        output: 50,
        reasoning: 0,
      },
    });
  });

  test("a group split across two reads still lands on the final usage", () => {
    const bytes = fixture("claude-session.jsonl");
    // Cut inside the third line, the one that corrects the group's usage.
    const firstNewline = bytes.indexOf(0x0a);
    const secondNewline = bytes.indexOf(0x0a, firstNewline + 1);
    const thirdNewline = bytes.indexOf(0x0a, secondNewline + 1);
    const cut = Math.floor((secondNewline + thirdNewline) / 2);

    const first = parseClaudeChunk(
      bytes.subarray(0, cut),
      createClaudeParserState({ subagent: false }),
    );
    expect(first.consumedBytes).toBe(secondNewline + 1);

    const second = parseClaudeChunk(bytes.subarray(first.consumedBytes), first.state);

    expect(aggregate([...first.rows, ...second.rows])).toEqual(SESSION_ROWS);
  });

  test("a subagent transcript counts usage against the parent session and no turns", () => {
    const bytes = fixture("claude-subagent.jsonl");
    const result = parseClaudeChunk(bytes, createClaudeParserState({ subagent: true }));

    expect(result.rows).toEqual([
      {
        cli: "claude",
        backend: null,
        model: "claude-opus-5",
        sessionId: "sess-1",
        cwd: "/work/demo",
        bucket: "2026-09-18T09:45:00.000Z",
        input: 1,
        cachedInput: 500,
        cacheWrite: 100,
        output: 900,
        reasoning: 300,
        turns: 0,
        durationMs: 0,
      },
    ]);
    // The task prompt repeats the parent turn's prompt id, so the tokens land
    // on that turn without any matching by time.
    expect(result.turnRows).toEqual([
      {
        cli: "claude",
        backend: null,
        sessionId: "sess-1",
        turnKey: "p1",
        attachAt: null,
        model: "claude-opus-5",
        input: 1,
        cachedInput: 500,
        cacheWrite: 100,
        output: 900,
        reasoning: 300,
        startedAt: "2026-09-18T09:45:20.000Z",
        lastAt: "2026-09-18T09:45:25.000Z",
        userMessageIds: [],
      },
    ]);
    expect(result.state.openTurn).toBe(null);
  });
});

describe("one Claude pitfall per fixture", () => {
  function parse(name: string, subagent = false) {
    return parseClaudeChunk(fixture(name), createClaudeParserState({ subagent }));
  }

  test("a response split into blocks counts only the final usage", () => {
    expect(parse("claude-multiline-message-id.jsonl").rows).toEqual([
      {
        cli: "claude",
        backend: null,
        model: "claude-fable-5-1",
        sessionId: "sess-1",
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 2,
        cachedInput: 34_560,
        cacheWrite: 26_884,
        output: 410,
        reasoning: 86,
        turns: 1,
        durationMs: 0,
      },
    ]);
  });

  test("history copied in by a resume is skipped and its session id kept", () => {
    const result = parse("claude-forked-from.jsonl");

    expect(result.rows).toEqual([
      {
        cli: "claude",
        backend: null,
        model: "claude-fable-5-1",
        sessionId: "sess-1",
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 3,
        cachedInput: 5,
        cacheWrite: 4,
        output: 6,
        reasoning: 1,
        turns: 1,
        durationMs: 2413,
      },
    ]);
    expect(result.state.forkedFromSessionId).toBe("sess-0");
  });

  test("synthetic, tool_result, compact-summary and system rows carry nothing", () => {
    expect(parse("claude-skipped-rows.jsonl").rows).toEqual([
      {
        cli: "claude",
        backend: null,
        model: "claude-fable-5-1",
        sessionId: "sess-1",
        cwd: "/work/demo",
        bucket: "2026-09-18T09:45:00.000Z",
        input: 7,
        cachedInput: 9,
        cacheWrite: 8,
        output: 10,
        reasoning: 2,
        turns: 0,
        durationMs: 0,
      },
      {
        cli: "claude",
        backend: null,
        model: "claude-fable-5-1",
        sessionId: "sess-1",
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 0,
        cachedInput: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
        turns: 1,
        durationMs: 37_413,
      },
    ]);
  });

  test("U+2028 and U+2029 inside a prompt are not line breaks", () => {
    const bytes = fixture("claude-line-separator.jsonl");
    expect(bytes.includes(Buffer.from("\u2028", "utf8"))).toBe(true);
    expect(bytes.includes(Buffer.from("\u2029", "utf8"))).toBe(true);

    expect(parse("claude-line-separator.jsonl").rows).toEqual([
      {
        cli: "claude",
        backend: null,
        model: "claude-opus-5",
        sessionId: "sess-1",
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 1,
        cachedInput: 3,
        cacheWrite: 2,
        output: 4,
        reasoning: 1,
        turns: 1,
        durationMs: 2413,
      },
    ]);
  });
});

describe("settleClaudeOpenTurn", () => {
  test("appends the wall clock of a turn whose file went quiet", () => {
    const bytes = fixture("claude-session.jsonl");
    const secondNewline = bytes.indexOf(0x0a, bytes.indexOf(0x0a) + 1);
    const parsed = parseClaudeChunk(
      bytes.subarray(0, secondNewline + 1),
      createClaudeParserState({ subagent: false }),
    );

    const settled = settleClaudeOpenTurn(parsed.state);

    expect(settled.rows).toEqual([
      {
        cli: "claude",
        backend: null,
        model: "claude-fable-5-1",
        sessionId: "sess-1",
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 0,
        cachedInput: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
        turns: 0,
        durationMs: 2845,
      },
    ]);
    expect(settleClaudeOpenTurn(settled.state).rows).toEqual([]);
  });
});
