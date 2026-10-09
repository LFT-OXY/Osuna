import { describe, expect, test } from "vitest";
import type { UsageCli, UsageSessionRow } from "@osuna/protocol/usage/types";
import type { UsageProjectAttribution } from "./project-attribution.js";
import type { UsageReportPricing } from "./report.js";
import { buildUsageSessionChains, type UsageSessionChains } from "./session-chains.js";
import {
  buildUsageSessions,
  usageSessionOwnerKey,
  USAGE_SESSIONS_PER_DAY_LIMIT,
  type BuildUsageSessionsInput,
  type UsageSessionOwner,
} from "./sessions.js";
import { UsageTurnIndex } from "./turn-rows.js";
import {
  emptyBucketRow,
  emptyScanState,
  type UsageBucketRow,
  type UsageScanCursor,
  type UsageScanState,
  type UsageTurnRow,
} from "./types.js";

const CWD = "/work/demo";

const PROJECTS = new Map<string, UsageProjectAttribution>([
  [CWD, { rootPath: CWD, displayName: "demo", kind: "git" }],
]);

/** A cent per thousand tokens of anything, so a cost is a number the test can predict. */
const PRICING: UsageReportPricing = {
  estimateCost: (totals) =>
    (totals.input + totals.cachedInput + totals.cacheWrite + totals.output) / 100_000,
  isPriced: (model) => model !== "mystery-model",
};

const NO_CHAINS: UsageSessionChains = {
  canonical: (_cli, sessionId) => sessionId,
  members: (_cli, sessionId) => [sessionId],
};

function bucketRow(input: {
  cli?: UsageCli;
  backend?: string | null;
  sessionId: string;
  model?: string;
  cwd?: string;
  bucket: string;
  output: number;
  turns?: number;
  durationMs?: number;
}): UsageBucketRow {
  const row = emptyBucketRow({
    cli: input.cli ?? "claude",
    backend: input.backend ?? null,
    model: input.model ?? "claude-fable-5-1",
    sessionId: input.sessionId,
    cwd: input.cwd ?? CWD,
    bucket: input.bucket,
  });
  row.output = input.output;
  row.turns = input.turns ?? 1;
  row.durationMs = input.durationMs ?? 0;
  return row;
}

function turnRow(input: {
  cli?: UsageCli;
  sessionId: string;
  turnKey: string;
  startedAt: string;
  lastAt: string;
}): UsageTurnRow {
  return {
    cli: input.cli ?? "claude",
    backend: null,
    sessionId: input.sessionId,
    turnKey: input.turnKey,
    model: "claude-fable-5-1",
    input: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    startedAt: input.startedAt,
    lastAt: input.lastAt,
    userMessageIds: [],
  };
}

function build(input: {
  rows: UsageBucketRow[];
  turnRows?: UsageTurnRow[];
  from?: string | null;
  to?: string | null;
  timezone?: string;
  chains?: UsageSessionChains;
  owners?: Map<string, UsageSessionOwner>;
  handleOf?: BuildUsageSessionsInput["handleOf"];
}) {
  const turns = new UsageTurnIndex();
  turns.addAll(input.turnRows ?? []);
  return buildUsageSessions({
    rows: input.rows,
    turns,
    request: {
      from: input.from ?? null,
      to: input.to ?? null,
      timezone: input.timezone ?? "UTC",
    },
    projects: PROJECTS,
    pricing: PRICING,
    chains: input.chains ?? NO_CHAINS,
    handleOf:
      input.handleOf ?? ((cli, sessionId) => ({ providerId: cli, providerHandleId: sessionId })),
    owners: input.owners ?? new Map(),
  });
}

function claudeCursor(input: {
  sessionId: string;
  forkedFromSessionId?: string | null;
  lastAt?: string | null;
  path?: string;
}): UsageScanCursor {
  return {
    cli: "claude",
    path: input.path ?? `/logs/${input.sessionId}.jsonl`,
    inode: 1,
    size: 0,
    mtimeMs: 0,
    offset: 0,
    firstAt: null,
    lastAt: input.lastAt ?? null,
    parser: {
      kind: "claude",
      sessionId: input.sessionId,
      cwd: CWD,
      subagent: false,
      forkedFromSessionId: input.forkedFromSessionId ?? null,
      openTurn: null,
      lastMessage: null,
      parentTurnKey: null,
    },
  };
}

function scanState(cursors: Record<string, UsageScanCursor>): UsageScanState {
  return { ...emptyScanState(), cursors };
}

describe("one row per session and local day", () => {
  test("a session that ran past midnight is two rows, each holding that day's tokens", () => {
    const result = build({
      rows: [
        bucketRow({ sessionId: "sess-1", bucket: "2026-09-18T23:45:00.000Z", output: 300 }),
        bucketRow({ sessionId: "sess-1", bucket: "2026-09-19T00:15:00.000Z", output: 700 }),
      ],
      turnRows: [
        turnRow({
          sessionId: "sess-1",
          turnKey: "turn-1",
          startedAt: "2026-09-18T23:50:00.000Z",
          lastAt: "2026-09-19T00:20:00.000Z",
        }),
      ],
    });

    expect(result.truncated).toBe(false);
    expect(result.sessions.map((session) => [session.day, session.totals.output])).toEqual([
      ["2026-09-19", 700],
      ["2026-09-18", 300],
    ]);
    // The turn started on the 18th and ended on the 19th, so each day shows the
    // stamp that fell inside it and falls back to its own buckets for the other.
    expect(result.sessions.map((session) => [session.firstAt, session.lastAt])).toEqual([
      ["2026-09-19T00:15:00.000Z", "2026-09-19T00:20:00.000Z"],
      ["2026-09-18T23:50:00.000Z", "2026-09-18T23:45:00.000Z"],
    ]);
  });

  test("the timezone decides which day a bucket lands on", () => {
    const rows = [
      bucketRow({ sessionId: "sess-1", bucket: "2026-09-18T23:45:00.000Z", output: 5 }),
    ];

    expect(build({ rows }).sessions.map((session) => session.day)).toEqual(["2026-09-18"]);
    expect(
      build({ rows, timezone: "Asia/Shanghai" }).sessions.map((session) => session.day),
    ).toEqual(["2026-09-19"]);
  });

  test("a row carries its models, totals, turns, duration and project in full", () => {
    const [session] = build({
      rows: [
        bucketRow({
          sessionId: "sess-1",
          bucket: "2026-09-18T10:00:00.000Z",
          output: 400,
          turns: 2,
          durationMs: 30_000,
        }),
        bucketRow({
          sessionId: "sess-1",
          model: "mystery-model",
          bucket: "2026-09-18T10:15:00.000Z",
          output: 100,
          turns: 1,
          durationMs: 5_000,
        }),
      ],
    }).sessions;

    expect(session).toEqual({
      day: "2026-09-18",
      cli: "claude",
      backend: null,
      sessionId: "sess-1",
      cwd: CWD,
      project: { rootPath: CWD, displayName: "demo", kind: "git" },
      models: [
        {
          model: "claude-fable-5-1",
          totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 400, reasoning: 0 },
          estimatedCost: 0.004,
          priced: true,
        },
        {
          model: "mystery-model",
          totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 100, reasoning: 0 },
          estimatedCost: 0.001,
          priced: false,
        },
      ],
      totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 500, reasoning: 0 },
      estimatedCost: 0.005,
      turns: 3,
      durationMs: 35_000,
      firstAt: "2026-09-18T10:00:00.000Z",
      lastAt: "2026-09-18T10:15:00.000Z",
      handle: { providerId: "claude", providerHandleId: "sess-1" },
    } satisfies UsageSessionRow);
  });

  test("the range and the filters narrow the listing the way the report does", () => {
    const rows = [
      bucketRow({ sessionId: "sess-1", bucket: "2026-09-17T10:00:00.000Z", output: 1 }),
      bucketRow({ sessionId: "sess-2", bucket: "2026-09-18T10:00:00.000Z", output: 2 }),
      bucketRow({
        cli: "codex",
        sessionId: "sess-3",
        bucket: "2026-09-18T11:00:00.000Z",
        output: 3,
      }),
    ];

    expect(
      build({ rows, from: "2026-09-18", to: "2026-09-18" }).sessions.map(
        (session) => session.sessionId,
      ),
    ).toEqual(["sess-3", "sess-2"]);

    const result = buildUsageSessions({
      rows,
      turns: new UsageTurnIndex(),
      request: {
        from: null,
        to: null,
        timezone: "UTC",
        filters: { sources: [{ cli: "codex", backend: null }] },
      },
      projects: PROJECTS,
      pricing: PRICING,
      chains: NO_CHAINS,
      handleOf: (cli, sessionId) => ({ providerId: cli, providerHandleId: sessionId }),
      owners: new Map(),
    });
    expect(result.sessions.map((session) => session.sessionId)).toEqual(["sess-3"]);
  });

  test("a day past the cap answers with the newest sessions and says it truncated", () => {
    const rows = Array.from({ length: USAGE_SESSIONS_PER_DAY_LIMIT + 1 }, (_value, index) =>
      bucketRow({
        sessionId: `sess-${String(index).padStart(4, "0")}`,
        bucket: `2026-09-18T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
        output: 1,
      }),
    );

    const result = build({ rows });

    expect(result.truncated).toBe(true);
    expect(result.sessions).toHaveLength(USAGE_SESSIONS_PER_DAY_LIMIT);
    // Newest first, so the one session dropped is the oldest of the day.
    expect(result.sessions.at(0)?.sessionId).toBe("sess-0500");
    expect(result.sessions.at(-1)?.sessionId).toBe("sess-0001");
  });
});

describe("Claude resume chains", () => {
  test("a chain is one row under the newest id, summing every id's tokens", () => {
    const chains = buildUsageSessionChains(
      scanState({
        "claude sess-a": claudeCursor({ sessionId: "sess-a" }),
        "claude sess-b": claudeCursor({ sessionId: "sess-b", forkedFromSessionId: "sess-a" }),
      }),
    );

    const result = build({
      rows: [
        bucketRow({ sessionId: "sess-a", bucket: "2026-09-18T10:00:00.000Z", output: 10 }),
        bucketRow({ sessionId: "sess-b", bucket: "2026-09-18T11:00:00.000Z", output: 20 }),
      ],
      chains,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe("sess-b");
    expect(result.sessions[0]?.totals.output).toBe(30);
  });

  test("the whole chain answers for who imported it", () => {
    const chains = buildUsageSessionChains(
      scanState({
        "claude sess-a": claudeCursor({ sessionId: "sess-a" }),
        "claude sess-b": claudeCursor({ sessionId: "sess-b", forkedFromSessionId: "sess-a" }),
      }),
    );

    const result = build({
      rows: [bucketRow({ sessionId: "sess-b", bucket: "2026-09-18T11:00:00.000Z", output: 1 })],
      chains,
      owners: new Map([
        [
          usageSessionOwnerKey("claude", "sess-a"),
          { agentId: "agent-1", workspaceId: "workspace-1" },
        ],
      ]),
    });

    expect(result.sessions[0]?.importedAgentId).toBe("agent-1");
    expect(result.sessions[0]?.importedAgentWorkspaceId).toBe("workspace-1");
  });

  test("a session forked twice keeps the resume that wrote last", () => {
    const chains = buildUsageSessionChains(
      scanState({
        "claude sess-a": claudeCursor({ sessionId: "sess-a" }),
        "claude sess-b": claudeCursor({
          sessionId: "sess-b",
          forkedFromSessionId: "sess-a",
          lastAt: "2026-09-18T10:00:00.000Z",
        }),
        "claude sess-c": claudeCursor({
          sessionId: "sess-c",
          forkedFromSessionId: "sess-a",
          lastAt: "2026-09-18T12:00:00.000Z",
        }),
      }),
    );

    expect(chains.canonical("claude", "sess-a")).toBe("sess-c");
    expect(chains.members("claude", "sess-c")).toEqual(["sess-c", "sess-a"]);
    // The branch that lost the tie is its own session, and does not drag the
    // parent's rows into a second row.
    expect(chains.canonical("claude", "sess-b")).toBe("sess-b");
    expect(chains.members("claude", "sess-b")).toEqual(["sess-b"]);
  });

  test("only Claude chains; the other CLIs are their own session", () => {
    const chains = buildUsageSessionChains(
      scanState({
        "claude sess-b": claudeCursor({ sessionId: "sess-b", forkedFromSessionId: "sess-a" }),
      }),
    );

    expect(chains.canonical("codex", "sess-a")).toBe("sess-a");
    expect(chains.members("codex", "sess-b")).toEqual(["sess-b"]);
  });
});

describe("how a row is resumed", () => {
  test("a Pi session with no cursor has no handle", () => {
    const result = build({
      rows: [
        bucketRow({
          cli: "pi",
          backend: "anthropic",
          sessionId: "sess-1",
          bucket: "2026-09-18T10:00:00.000Z",
          output: 1,
        }),
      ],
      handleOf: () => null,
    });

    expect(result.sessions[0]?.handle).toBeNull();
    expect(result.sessions[0]?.backend).toBe("anthropic");
  });
});
