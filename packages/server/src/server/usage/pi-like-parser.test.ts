import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  createPiLikeParserState,
  parsePiLikeChunk,
  settlePiLikeOpenTurn,
} from "./pi-like-parser.js";
import type { PiLikeParserState } from "./types.js";

const PI_SESSION = "01a0b317-1111-7000-8000-000000000001";
const RETRY_SESSION = "01a0b317-1114-7000-8000-000000000033";
const OMP_SESSION = "01a0953b-2222-7000-8000-000000000002";
const OMP_CHILD = "01a0953b-3333-7000-8000-000000000003";

function fixture(cli: PiLikeParserState["kind"], name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${cli}/${name}`, import.meta.url));
}

/** Offset of the `count`-th `\n`, so a test can cut a chunk at a known line. */
function newlineOffset(bytes: Buffer, count: number): number {
  let offset = -1;
  for (let seen = 0; seen < count; seen += 1) offset = bytes.indexOf(0x0a, offset + 1);
  return offset;
}

function parse(
  cli: PiLikeParserState["kind"],
  name: string,
  input: { sessionId: string; subagent?: boolean },
) {
  return parsePiLikeChunk(
    fixture(cli, name),
    createPiLikeParserState({ cli, sessionId: input.sessionId, subagent: input.subagent ?? false }),
  );
}

describe("parsePiLikeChunk on a Pi transcript", () => {
  test("splits a session by the backend each turn routed to", () => {
    const bytes = fixture("pi", "pi-session.jsonl");
    const result = parsePiLikeChunk(
      bytes,
      createPiLikeParserState({ cli: "pi", sessionId: PI_SESSION, subagent: false }),
    );

    expect(result.rows).toEqual([
      {
        cli: "pi",
        backend: "anthropic",
        model: "claude-opus-5",
        sessionId: PI_SESSION,
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 15,
        cachedInput: 1000,
        cacheWrite: 50,
        output: 300,
        // Pi writes the reasoning column as `reasoning`.
        reasoning: 100,
        turns: 1,
        durationMs: 30_000,
      },
      {
        cli: "pi",
        backend: "openai-codex",
        model: "gpt-6-astra",
        sessionId: PI_SESSION,
        cwd: "/work/demo",
        bucket: "2026-09-18T09:45:00.000Z",
        input: 700,
        cachedInput: 0,
        cacheWrite: 0,
        output: 60,
        reasoning: 40,
        turns: 1,
        durationMs: 40_000,
      },
    ]);
    expect(result.consumedBytes).toBe(bytes.length);
    expect(result.firstAt).toBe("2026-09-18T09:30:00.000Z");
    expect(result.lastAt).toBe("2026-09-18T09:47:40.000Z");
    expect(result.state).toEqual({
      kind: "pi",
      sessionId: PI_SESSION,
      cwd: "/work/demo",
      subagent: false,
      headerSeen: true,
      copiedBefore: null,
      backend: "openai-codex",
      turnBackend: "openai-codex",
      // The last turn stays open: a session that runs on after a stop reason
      // appends to it, and only the next prompt starts a new one.
      openTurn: {
        turnKey: "aa000006",
        startedAt: "2026-09-18T09:47:00.000Z",
        bucket: "2026-09-18T09:45:00.000Z",
        lastAt: "2026-09-18T09:47:40.000Z",
        settledMs: 40_000,
        model: "gpt-6-astra",
      },
    });
  });

  test("counts a subagent against its parent session and against no turn", () => {
    const result = parse("pi", "pi-subagent.jsonl", { sessionId: PI_SESSION, subagent: true });

    expect(result.rows).toEqual([
      {
        cli: "pi",
        backend: "anthropic",
        model: "claude-fable-5-1",
        sessionId: PI_SESSION,
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 3,
        cachedInput: 100,
        cacheWrite: 0,
        output: 30,
        reasoning: 10,
        turns: 0,
        durationMs: 0,
      },
    ]);
  });

  test("keeps a turn that failed and ran on, and ignores what was written after it", () => {
    const result = parse("pi", "pi-retry-after-error.jsonl", { sessionId: RETRY_SESSION });

    expect(result.rows).toEqual([
      {
        cli: "pi",
        backend: "anthropic",
        model: "claude-opus-5",
        sessionId: RETRY_SESSION,
        cwd: "/work/demo",
        bucket: "2026-09-18T11:00:00.000Z",
        input: 9,
        cachedInput: 0,
        cacheWrite: 0,
        output: 90,
        reasoning: 0,
        turns: 1,
        // The failed response settled ten seconds, the retry the rest — not the
        // exit record fourteen minutes later.
        durationMs: 360_000,
      },
    ]);
    expect(settlePiLikeOpenTurn(result.state).rows).toEqual([]);
  });

  test("appends the wall clock of a turn whose file went quiet mid-tool", () => {
    const bytes = fixture("pi", "pi-session.jsonl");
    // Cut right after the first response, which stopped to run a tool.
    const parsed = parsePiLikeChunk(
      bytes.subarray(0, newlineOffset(bytes, 4) + 1),
      createPiLikeParserState({ cli: "pi", sessionId: PI_SESSION, subagent: false }),
    );

    const settled = settlePiLikeOpenTurn(parsed.state);

    expect(settled.rows).toEqual([
      {
        cli: "pi",
        backend: "anthropic",
        model: "claude-opus-5",
        sessionId: PI_SESSION,
        cwd: "/work/demo",
        bucket: "2026-09-18T09:30:00.000Z",
        input: 0,
        cachedInput: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
        turns: 0,
        durationMs: 15_000,
      },
    ]);
    expect(settlePiLikeOpenTurn(settled.state).rows).toEqual([]);
  });
});

describe("parsePiLikeChunk on an OMP transcript", () => {
  test("reads the header behind the title line and lowercases the backend", () => {
    const result = parse("omp", "omp-session.jsonl", { sessionId: OMP_SESSION });

    expect(result.rows).toEqual([
      {
        cli: "omp",
        backend: "3oxy-openai",
        model: "gpt-5.6-sol",
        sessionId: OMP_SESSION,
        cwd: "/work/omp-demo",
        bucket: "2026-09-18T10:00:00.000Z",
        input: 900,
        cachedInput: 200,
        cacheWrite: 0,
        output: 120,
        // OMP writes the reasoning column as `reasoningTokens`.
        reasoning: 45,
        turns: 1,
        durationMs: 20_000,
      },
      {
        cli: "omp",
        backend: "anthropic",
        model: "claude-opus-5",
        sessionId: OMP_SESSION,
        cwd: "/work/omp-demo",
        bucket: "2026-09-18T10:15:00.000Z",
        input: 20,
        cachedInput: 1000,
        cacheWrite: 70,
        output: 80,
        reasoning: 0,
        turns: 1,
        durationMs: 30_000,
      },
    ]);
    expect(result.firstAt).toBe("2026-09-18T10:00:00.000Z");
    expect(result.lastAt).toBe("2026-09-18T10:17:00.000Z");
  });

  test("skips the parent entries a branch copied in and counts only its own", () => {
    const result = parse("omp", "omp-child-copies-parent-entries.jsonl", {
      sessionId: OMP_CHILD,
    });

    expect(result.rows).toEqual([
      {
        cli: "omp",
        backend: "anthropic",
        model: "claude-opus-5",
        sessionId: OMP_CHILD,
        cwd: "/work/omp-demo",
        bucket: "2026-09-18T10:15:00.000Z",
        input: 40,
        cachedInput: 0,
        cacheWrite: 0,
        output: 10,
        reasoning: 5,
        turns: 1,
        durationMs: 30_000,
      },
    ]);
    // The copies are the parent's span too, so they stay out of this one.
    expect(result.firstAt).toBe("2026-09-18T10:20:00.000Z");
    expect(result.lastAt).toBe("2026-09-18T10:20:40.000Z");
    expect(result.state.copiedBefore).toBe("2026-09-18T10:20:00.000Z");
  });

  test("counts a subagent against its parent session and against no turn", () => {
    const result = parse("omp", "omp-subagent.jsonl", {
      sessionId: OMP_SESSION,
      subagent: true,
    });

    expect(result.rows).toEqual([
      {
        cli: "omp",
        backend: "3oxy-openai",
        model: "gpt-5.6-sol",
        sessionId: OMP_SESSION,
        cwd: "/work/omp-demo",
        bucket: "2026-09-18T10:00:00.000Z",
        input: 7,
        cachedInput: 0,
        cacheWrite: 0,
        output: 13,
        reasoning: 3,
        turns: 0,
        durationMs: 0,
      },
    ]);
  });
});
