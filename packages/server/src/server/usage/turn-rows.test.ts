import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createClaudeParserState, parseClaudeChunk } from "./claude-parser.js";
import { createCodexParserState, parseCodexChunk } from "./codex-parser.js";
import { createPiLikeParserState, parsePiLikeChunk } from "./pi-like-parser.js";
import { UsageTurnIndex, resolveTurnRows, spanOf } from "./turn-rows.js";
import { turnKeyOf, type UsageParseResult, type UsageTurnRow } from "./types.js";

const PI_SESSION = "01a0b317-1111-7000-8000-000000000001";
const OMP_SESSION = "01a0953b-2222-7000-8000-000000000002";
const CODEX_THREAD = "01a0a8e9-9f4c-7bd2-8a11-0d3c6f2b5e70";

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

/** Everything a parse produced, once every draft has found its turn. */
function indexOf(...results: UsageParseResult[]): UsageTurnIndex {
  const index = new UsageTurnIndex();
  for (const result of results) index.addAll(resolveTurnRows(result.turnRows, index).rows);
  return index;
}

function turnsOf(index: UsageTurnIndex, cli: "claude" | "pi", sessionId: string): UsageTurnRow[] {
  return Array.from(index.listSession(cli, sessionId).values()).flat();
}

function parsePiSession(): UsageParseResult {
  return parsePiLikeChunk(
    fixture("pi/pi-session.jsonl"),
    createPiLikeParserState({ cli: "pi", sessionId: PI_SESSION, subagent: false }),
  );
}

function parsePiSubagent(name: string): UsageParseResult {
  return parsePiLikeChunk(
    fixture(`pi/${name}`),
    createPiLikeParserState({ cli: "pi", sessionId: PI_SESSION, subagent: true }),
  );
}

describe("turn rows across two parses", () => {
  test("two increments of one turn load back as a single row", () => {
    const bytes = fixture("claude/claude-session.jsonl");
    // Cut after the third line, which leaves the first turn open mid-response.
    const cut = newlineOffset(bytes, 3) + 1;
    const first = parseClaudeChunk(
      bytes.subarray(0, cut),
      createClaudeParserState({ subagent: false }),
    );
    const second = parseClaudeChunk(bytes.subarray(cut), first.state);

    expect(first.turnRows).toHaveLength(1);
    expect(second.turnRows).toHaveLength(2);

    const turns = indexOf(first, second).listSession("claude", "sess-1");
    expect(turns.get("p1")).toEqual([
      {
        cli: "claude",
        backend: null,
        sessionId: "sess-1",
        turnKey: "p1",
        model: "claude-fable-5-1",
        input: 7,
        cachedInput: 74_560,
        cacheWrite: 26_884,
        output: 1010,
        reasoning: 186,
        startedAt: "2026-09-18T09:44:42.587Z",
        lastAt: "2026-09-18T09:46:00.000Z",
        userMessageIds: ["u1"],
      },
    ]);
  });
});

describe("merging two increments of one turn row", () => {
  const increment = (overrides: Partial<UsageTurnRow>): UsageTurnRow => ({
    cli: "claude",
    backend: null,
    sessionId: "sess-1",
    turnKey: "p1",
    model: "claude-opus-5",
    input: 1,
    cachedInput: 0,
    cacheWrite: 0,
    output: 2,
    reasoning: 0,
    startedAt: "2026-09-18T09:00:00.000Z",
    lastAt: "2026-09-18T09:00:10.000Z",
    userMessageIds: ["u1"],
    ...overrides,
  });

  test("unions the user message ids and keeps the first Paseo turn id", () => {
    const index = new UsageTurnIndex();
    index.add(increment({}));
    index.add(
      increment({
        userMessageIds: ["u1", "u2"],
        lastAt: "2026-09-18T09:00:30.000Z",
        turnId: "paseo-turn-7",
      }),
    );
    index.add(increment({ turnId: "paseo-turn-9" }));

    expect(index.listSession("claude", "sess-1").get("p1")).toEqual([
      increment({
        input: 3,
        output: 6,
        lastAt: "2026-09-18T09:00:30.000Z",
        userMessageIds: ["u1", "u2"],
        turnId: "paseo-turn-7",
      }),
    ]);
  });
});

describe("attaching a subagent to a parent turn", () => {
  test("a subagent that started inside a turn counts against it", () => {
    const parent = parsePiSession();
    const index = indexOf(parent);

    const subagent = parsePiSubagent("pi-subagent-in-turn.jsonl");
    index.addAll(resolveTurnRows(subagent.turnRows, index).rows);

    const turn = index.listSession("pi", PI_SESSION).get("aa000001") ?? [];
    expect(turn.map((row) => [row.model, row.output])).toEqual([
      ["claude-opus-5", 300],
      // The subagent ran on its own model, so it is a row of its own.
      ["claude-fable-5-1", 40],
    ]);
    // Its own clock widens nothing: it ran and ended inside the parent's turn.
    expect(spanOf(turn)).toEqual({
      startedAt: "2026-09-18T09:30:05.000Z",
      lastAt: "2026-09-18T09:30:35.000Z",
    });
  });

  test("a subagent that started between two turns reaches no turn row", () => {
    const parent = parsePiSession();
    const index = indexOf(parent);

    // The header stands at 09:31:00, after the first turn ended and before the
    // second began, so its tokens stay in the bucket rows alone.
    const subagent = parsePiSubagent("pi-subagent.jsonl");
    const resolved = resolveTurnRows(subagent.turnRows, index);
    expect(resolved.rows).toEqual([]);
    // The second turn began after the header, so nothing can still cover it.
    expect(index.hasTurnAfter("pi", PI_SESSION, resolved.pending[0]?.attachAt ?? "")).toBe(true);
    expect(turnsOf(index, "pi", PI_SESSION)).toHaveLength(2);
  });

  test("a subagent read before its parent turn grew resolves on a later try", () => {
    const bytes = fixture("pi/pi-session.jsonl");
    // Stop after the prompt that opened the turn: it has no model yet, so the
    // session has no turn rows at all and the subagent can match nothing.
    const opened = parsePiLikeChunk(
      bytes.subarray(0, newlineOffset(bytes, 3) + 1),
      createPiLikeParserState({ cli: "pi", sessionId: PI_SESSION, subagent: false }),
    );
    const index = indexOf(opened);
    const subagent = parsePiSubagent("pi-subagent-in-turn.jsonl");
    const first = resolveTurnRows(subagent.turnRows, index);
    expect(first.rows).toEqual([]);
    expect(first.pending).toHaveLength(1);
    expect(index.hasTurnAfter("pi", PI_SESSION, first.pending[0]?.attachAt ?? "")).toBe(false);

    // The parent turn runs on and now covers the header it was read before.
    index.addAll(
      resolveTurnRows(
        parsePiLikeChunk(bytes.subarray(opened.consumedBytes), opened.state).turnRows,
        index,
      ).rows,
    );
    const retried = resolveTurnRows(first.pending, index);
    expect(retried.pending).toEqual([]);
    expect(retried.rows.map((row) => [row.turnKey, row.output])).toEqual([["aa000001", 40]]);
  });
});

describe("a turn's wall clock", () => {
  const cases = [
    {
      cli: "claude",
      parse: () =>
        parseClaudeChunk(
          fixture("claude/claude-session.jsonl"),
          createClaudeParserState({ subagent: false }),
        ),
    },
    {
      cli: "codex",
      parse: () =>
        parseCodexChunk(
          fixture("codex/codex-session.jsonl"),
          createCodexParserState({ threadId: CODEX_THREAD }),
        ),
    },
    { cli: "pi", parse: parsePiSession },
    {
      cli: "omp",
      parse: () =>
        parsePiLikeChunk(
          fixture("omp/omp-session.jsonl"),
          createPiLikeParserState({ cli: "omp", sessionId: OMP_SESSION, subagent: false }),
        ),
    },
  ];

  // A turn row stores no duration: `lastAt - startedAt` is it. The bucket rows
  // reach the same total by settling a segment at a time, and a report that
  // shows both has to agree with itself.
  test.each(cases)("adds up to what the $cli bucket rows settled", ({ parse }) => {
    const result = parse();
    const settled = result.rows.reduce((total, row) => total + row.durationMs, 0);

    const byTurn = new Map<string, UsageTurnRow[]>();
    for (const row of resolveTurnRows(result.turnRows, new UsageTurnIndex()).rows) {
      byTurn.set(turnKeyOf(row), [...(byTurn.get(turnKeyOf(row)) ?? []), row]);
    }
    const derived = Array.from(byTurn.values()).reduce((total, rows) => {
      const span = spanOf(rows);
      return total + (Date.parse(span.lastAt) - Date.parse(span.startedAt));
    }, 0);

    expect(byTurn.size).toBeGreaterThan(0);
    expect(derived).toBe(settled);
  });
});

/** Offset of the `count`-th `\n`, so a test can cut a chunk at a known line. */
function newlineOffset(bytes: Buffer, count: number): number {
  let offset = -1;
  for (let seen = 0; seen < count; seen += 1) offset = bytes.indexOf(0x0a, offset + 1);
  return offset;
}
