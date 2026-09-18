import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createCodexParserState, parseCodexChunk, settleCodexOpenTurn } from "./codex-parser.js";
import { addBucketRow, bucketRowKey, type UsageBucketRow } from "./types.js";

const THREAD = "01a0a8e9-9f4c-7bd2-8a11-0d3c6f2b5e70";

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/codex/${name}`, import.meta.url));
}

function parse(name: string, threadId: string | null = THREAD) {
  return parseCodexChunk(fixture(name), createCodexParserState({ threadId }));
}

/** Offset of the `count`-th `\n`, so a test can cut a chunk at a known line. */
function newlineOffset(bytes: Buffer, count: number): number {
  let offset = -1;
  for (let seen = 0; seen < count; seen += 1) offset = bytes.indexOf(0x0a, offset + 1);
  return offset;
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
    cli: "codex",
    backend: null,
    model: "gpt-5.6-luna",
    sessionId: THREAD,
    cwd: "/work/demo",
    bucket: "2026-09-18T09:30:00.000Z",
    input: 300,
    cachedInput: 2400,
    cacheWrite: 300,
    output: 350,
    reasoning: 80,
    turns: 1,
    durationMs: 40_000,
  },
  {
    cli: "codex",
    backend: null,
    model: "gpt-6-astra",
    sessionId: THREAD,
    cwd: "/work/demo/sub",
    bucket: "2026-09-18T09:45:00.000Z",
    input: 500,
    cachedInput: 0,
    cacheWrite: 0,
    output: 40,
    reasoning: 0,
    turns: 1,
    durationMs: 30_000,
  },
];

describe("parseCodexChunk", () => {
  test("reads a whole rollout: usage records, repeats, model and cwd per turn, turn wall clock", () => {
    const bytes = fixture("codex-session.jsonl");
    const result = parseCodexChunk(bytes, createCodexParserState({ threadId: THREAD }));

    expect(result.rows).toEqual(SESSION_ROWS);
    expect(result.consumedBytes).toBe(bytes.length);
    expect(result.firstAt).toBe("2026-09-18T09:30:00.000Z");
    expect(result.lastAt).toBe("2026-09-18T09:46:30.000Z");
    expect(result.state).toEqual({
      kind: "codex",
      sessionId: THREAD,
      cwd: "/work/demo/sub",
      subagent: false,
      metaSeen: true,
      model: "gpt-6-astra",
      usesUsageRecords: true,
      lastUsageKey: "resp_3",
      // `turn_aborted` settled and closed the turn, so nothing stays open.
      openTurn: null,
    });
  });

  test("a rollout split across two reads lands on the same rows", () => {
    const bytes = fixture("codex-session.jsonl");
    // Cut inside line 8, the verbatim repeat of the response on line 7: the
    // key that drops it has to survive the read boundary.
    const seventhNewline = newlineOffset(bytes, 7);
    const cut = Math.floor((seventhNewline + newlineOffset(bytes, 8)) / 2);

    const first = parseCodexChunk(
      bytes.subarray(0, cut),
      createCodexParserState({ threadId: THREAD }),
    );
    expect(first.consumedBytes).toBe(seventhNewline + 1);

    const second = parseCodexChunk(bytes.subarray(first.consumedBytes), first.state);

    expect(aggregate([...first.rows, ...second.rows])).toEqual(SESSION_ROWS);
  });

  test("an older rollout falls back to token_count and never diffs the running total", () => {
    expect(parse("codex-token-count.jsonl", "019fd6e0-2c31-7a04-9c65-12b7d8e4a5f3").rows).toEqual([
      {
        cli: "codex",
        backend: null,
        model: "gpt-5.5",
        sessionId: "019fd6e0-2c31-7a04-9c65-12b7d8e4a5f3",
        cwd: "/work/legacy",
        bucket: "2026-09-18T09:45:00.000Z",
        input: 300,
        cachedInput: 1400,
        cacheWrite: 0,
        output: 80,
        reasoning: 10,
        turns: 1,
        durationMs: 25_000,
      },
    ]);
  });

  test("usage before any turn_context is recorded against an unknown model", () => {
    expect(parse("codex-unknown-model.jsonl", "01a09612-77aa-7c19-b0d4-5e8f1a2c3b44").rows).toEqual(
      [
        {
          cli: "codex",
          backend: null,
          model: "unknown",
          sessionId: "01a09612-77aa-7c19-b0d4-5e8f1a2c3b44",
          cwd: "/work/quiet",
          bucket: "2026-09-18T10:00:00.000Z",
          input: 40,
          cachedInput: 0,
          cacheWrite: 0,
          output: 5,
          reasoning: 0,
          turns: 1,
          durationMs: 8000,
        },
      ],
    );
  });

  test("a resume restarts the running total, and every event still counts its own last", () => {
    expect(
      parse("codex-total-reset-after-resume.jsonl", "01a01814-6b52-7e08-9d31-4c7a0f6e2b95").rows,
    ).toEqual([
      {
        cli: "codex",
        backend: null,
        model: "gpt-5.5",
        sessionId: "01a01814-6b52-7e08-9d31-4c7a0f6e2b95",
        cwd: "/work/resume",
        bucket: "2026-09-18T10:00:00.000Z",
        input: 200,
        cachedInput: 1900,
        cacheWrite: 0,
        output: 80,
        reasoning: 0,
        turns: 1,
        durationMs: 29_500,
      },
      {
        cli: "codex",
        backend: null,
        model: "gpt-5.5",
        sessionId: "01a01814-6b52-7e08-9d31-4c7a0f6e2b95",
        cwd: "/work/resume",
        bucket: "2026-09-18T10:30:00.000Z",
        input: 100,
        cachedInput: 200,
        cacheWrite: 0,
        output: 20,
        reasoning: 0,
        turns: 1,
        durationMs: 20_000,
      },
    ]);
  });

  test("a subagent rollout counts against the parent thread and starts no turn", () => {
    const result = parse("codex-subagent.jsonl", "01a0a91d-4e88-7f30-bb27-9a6c0e5d1f82");

    expect(result.rows).toEqual([
      {
        cli: "codex",
        backend: null,
        model: "gpt-5.6-luna",
        sessionId: THREAD,
        cwd: "/work/demo",
        bucket: "2026-09-18T10:00:00.000Z",
        input: 100,
        cachedInput: 200,
        cacheWrite: 50,
        output: 80,
        reasoning: 20,
        turns: 0,
        durationMs: 0,
      },
    ]);
    expect(result.state.subagent).toBe(true);
    expect(result.state.openTurn).toBe(null);
  });
});

describe("settleCodexOpenTurn", () => {
  test("a turn the CLI never finished runs to its last line, not its last response", () => {
    const parsed = parse("codex-unterminated-turn.jsonl", "01a0adee-3f17-7b44-8e02-6d9c5a1b8e77");

    expect(parsed.rows).toEqual([
      {
        cli: "codex",
        backend: null,
        model: "gpt-6-astra",
        sessionId: "01a0adee-3f17-7b44-8e02-6d9c5a1b8e77",
        cwd: "/work/stop",
        bucket: "2026-09-18T11:00:00.000Z",
        input: 200,
        cachedInput: 0,
        cacheWrite: 0,
        output: 30,
        reasoning: 10,
        turns: 1,
        durationMs: 0,
      },
    ]);

    // 11:00:05 to the assistant message at 11:00:45, not to the response at 11:00:20.
    expect(settleCodexOpenTurn(parsed.state).rows).toEqual([
      {
        cli: "codex",
        backend: null,
        model: "gpt-6-astra",
        sessionId: "01a0adee-3f17-7b44-8e02-6d9c5a1b8e77",
        cwd: "/work/stop",
        bucket: "2026-09-18T11:00:00.000Z",
        input: 0,
        cachedInput: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
        turns: 0,
        durationMs: 40_000,
      },
    ]);
  });

  test("appends the wall clock of a turn whose file went quiet", () => {
    const bytes = fixture("codex-session.jsonl");
    // Stop right after the first turn's first response, before task_complete.
    const fifthNewline = [...Array(5)].reduce(
      (index: number) => bytes.indexOf(0x0a, index + 1),
      -1,
    );
    const parsed = parseCodexChunk(
      bytes.subarray(0, fifthNewline + 1),
      createCodexParserState({ threadId: THREAD }),
    );

    const settled = settleCodexOpenTurn(parsed.state);

    expect(settled.rows).toEqual([
      {
        cli: "codex",
        backend: null,
        model: "gpt-5.6-luna",
        sessionId: THREAD,
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 0,
        cachedInput: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
        turns: 0,
        durationMs: 10_000,
      },
    ]);
    expect(settleCodexOpenTurn(settled.state).rows).toEqual([]);
  });
});
