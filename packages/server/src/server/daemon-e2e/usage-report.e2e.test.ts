import { mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type { UsageReport, UsageTokenTotals } from "@osuna/protocol/usage/types";
import { mergeTurnRow, turnRowKey, type UsageTurnRow } from "../usage/types.js";

const FIXTURE_DIR = new URL("../usage/fixtures/claude/", import.meta.url);
const CODEX_FIXTURE_DIR = new URL("../usage/fixtures/codex/", import.meta.url);
const PI_FIXTURE_DIR = new URL("../usage/fixtures/pi/", import.meta.url);
const OMP_FIXTURE_DIR = new URL("../usage/fixtures/omp/", import.meta.url);
const PI_SESSION = "01a0b317-1111-7000-8000-000000000001";
const PI_SUBAGENT = "01a0b317-1112-7000-8000-000000000011";
const OMP_SESSION = "01a0953b-2222-7000-8000-000000000002";
const OMP_CHILD = "01a0953b-3333-7000-8000-000000000003";
const CODEX_THREAD = "01a0a8e9-9f4c-7bd2-8a11-0d3c6f2b5e70";
const CODEX_ROLLOUT = `rollout-2026-09-18T17-30-00-${CODEX_THREAD}.jsonl`;
const PROJECT_DIR = "-work-demo";
const SESSION_ID = "sess-1";
const SCAN_INTERVAL_MS = 50;
// The daemon's clock is pinned to the fixtures' own day, so "today", the
// trailing windows, the heatmap and the backfill stamp are all fixed values.
const NOW = Date.parse("2026-09-18T23:00:00.000Z");
const DAY = "2026-09-18";

const tempRoots: string[] = [];

/**
 * This suite is about aggregation, so nothing is priced: the built-in snapshot
 * would otherwise move these numbers every time it is refreshed.
 */
const UNPRICED: NonNullable<
  NonNullable<Parameters<typeof createTestPaseoDaemon>[0]>["usage"]
>["pricing"] = {
  autoUpdate: false,
  snapshot: {
    _meta: { source: "test", fetchedAt: "2026-09-18T00:00:00.000Z", etag: null, license: "MIT" },
    models: {},
  },
};

function totals(
  input: number,
  cachedInput: number,
  cacheWrite: number,
  output: number,
  reasoning: number,
): UsageTokenTotals {
  return { input, cachedInput, cacheWrite, output, reasoning };
}

const FABLE_TOTALS = totals(7, 74_560, 26_884, 1010, 186);
const OPUS_TOTALS = totals(11, 600, 300, 950, 300);
const ALL_TOTALS = totals(18, 75_160, 27_184, 1960, 486);

function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date! + offset)).toISOString().slice(0, 10);
}

/** Lay the fixtures out the way Claude Code does, under a throwaway projects root. */
async function seedClaudeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-claude-"));
  tempRoots.push(root);
  const projectDir = path.join(root, PROJECT_DIR);
  await mkdir(path.join(projectDir, SESSION_ID, "subagents"), { recursive: true });
  await writeFile(
    path.join(projectDir, `${SESSION_ID}.jsonl`),
    await readFile(new URL("claude-session.jsonl", FIXTURE_DIR), "utf8"),
  );
  await writeFile(
    path.join(projectDir, SESSION_ID, "subagents", "agent-7.jsonl"),
    await readFile(new URL("claude-subagent.jsonl", FIXTURE_DIR), "utf8"),
  );
  return root;
}

function usageConfig(
  root: string,
): NonNullable<Parameters<typeof createTestPaseoDaemon>[0]>["usage"] {
  return {
    roots: { claude: [root], codex: [], pi: [], omp: [] },
    scanIntervalMs: SCAN_INTERVAL_MS,
    now: () => NOW,
    pricing: UNPRICED,
  };
}

async function connect(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return client;
}

async function waitForReport(
  client: DaemonClient,
  request: { from: string | null; to: string | null; timezone: string },
  accept: (report: UsageReport) => boolean,
): Promise<UsageReport> {
  const deadline = Date.now() + 15_000;
  let last: UsageReport | null = null;
  while (Date.now() < deadline) {
    const { requestId: _requestId, ...report } = await client.usageReportGet(request);
    last = report;
    if (accept(report)) return report;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Usage report never matched: ${JSON.stringify(last)}`);
}

function backfilled(report: UsageReport): boolean {
  return report.backfill.state === "done";
}

describe("usage report over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let claudeRoot: string;
  let homeRoot: string;

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  beforeEach(async () => {
    claudeRoot = await seedClaudeRoot();
    homeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-static-"));
    tempRoots.push(homeRoot, staticDir);
    // The restart case reuses this home, so the harness must not delete it.
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: homeRoot,
      staticDir,
      cleanup: false,
      usage: usageConfig(claudeRoot),
    });
    client = await connect(daemon);
  });

  test("backfills both transcripts into one report", async () => {
    const report = await waitForReport(client, { from: DAY, to: DAY, timezone: "UTC" }, backfilled);

    expect(report.backfill).toEqual({
      state: "done",
      filesTotal: 2,
      filesDone: 2,
      startedAt: "2026-09-18T23:00:00.000Z",
    });
    expect(report.error).toBe(null);
    expect(report.summary).toEqual({
      totals: ALL_TOTALS,
      estimatedCost: 0,
      sessionCount: 1,
      last7Days: { totals: ALL_TOTALS, estimatedCost: 0 },
      last30Days: { totals: ALL_TOTALS, estimatedCost: 0 },
    });
    expect(report.sources).toEqual([
      {
        cli: "claude",
        backend: null,
        totals: ALL_TOTALS,
        estimatedCost: 0,
        modelCount: 2,
        share: 1,
      },
    ]);
    expect(report.models).toEqual([
      {
        model: "claude-fable-5-1",
        cli: "claude",
        backend: null,
        totals: FABLE_TOTALS,
        estimatedCost: 0,
        priced: false,
      },
      {
        model: "claude-opus-5",
        cli: "claude",
        backend: null,
        totals: OPUS_TOTALS,
        estimatedCost: 0,
        priced: false,
      },
    ]);
    expect(report.days).toEqual([
      { day: DAY, totals: ALL_TOTALS, estimatedCost: 0, sessionCount: 1, turns: 2 },
    ]);
    expect(report.months).toEqual([
      { month: DAY.slice(0, 7), totals: ALL_TOTALS, estimatedCost: 0, sessionCount: 1, turns: 2 },
    ]);
    expect(report.projects).toEqual([
      {
        rootPath: "/work/demo",
        displayName: "demo",
        kind: "directory",
        totals: ALL_TOTALS,
        estimatedCost: 0,
        sources: [{ cli: "claude", backend: null }],
        cwds: [{ cwd: "/work/demo", totals: ALL_TOTALS, estimatedCost: 0 }],
      },
    ]);
    expect(report.trend).toEqual({
      granularity: "hour",
      stackBy: "source",
      points: [
        {
          key: `${DAY}T09`,
          groups: { claude: { totals: totals(8, 75_060, 26_984, 1910, 486), estimatedCost: 0 } },
        },
        {
          key: `${DAY}T10`,
          groups: { claude: { totals: totals(10, 100, 200, 50, 0), estimatedCost: 0 } },
        },
      ],
    });
    expect(report.heatmapDays).toHaveLength(182);
    expect(report.heatmapDays[0]).toEqual({
      day: shiftDay(DAY, -181),
      totals: totals(0, 0, 0, 0, 0),
    });
    expect(report.heatmapDays[181]).toEqual({ day: DAY, totals: ALL_TOTALS });
  });

  test("splits the same buckets across local days in a far-ahead timezone", async () => {
    await waitForReport(client, { from: DAY, to: DAY, timezone: "UTC" }, backfilled);

    // Kiritimati is UTC+14, so the 10:00 UTC bucket lands on the next local day.
    const report = await waitForReport(
      client,
      { from: DAY, to: shiftDay(DAY, 1), timezone: "Pacific/Kiritimati" },
      backfilled,
    );

    expect(report.days).toEqual([
      {
        day: DAY,
        totals: totals(8, 75_060, 26_984, 1910, 486),
        estimatedCost: 0,
        sessionCount: 1,
        turns: 1,
      },
      {
        day: shiftDay(DAY, 1),
        totals: totals(10, 100, 200, 50, 0),
        estimatedCost: 0,
        sessionCount: 1,
        turns: 1,
      },
    ]);
  });

  test("keeps the same buckets on one local day at +05:30", async () => {
    const report = await waitForReport(
      client,
      { from: DAY, to: shiftDay(DAY, 1), timezone: "Asia/Kolkata" },
      backfilled,
    );

    expect(report.days).toEqual([
      { day: DAY, totals: ALL_TOTALS, estimatedCost: 0, sessionCount: 1, turns: 2 },
    ]);
  });

  test("counts only the appended lines when a transcript grows", async () => {
    const before = await waitForReport(client, { from: DAY, to: DAY, timezone: "UTC" }, backfilled);
    expect(before.summary.totals).toEqual(ALL_TOTALS);

    const transcript = path.join(claudeRoot, PROJECT_DIR, `${SESSION_ID}.jsonl`);
    await writeFile(transcript, `${appendedTurn()}\n`, { flag: "a" });

    const after = await waitForReport(
      client,
      { from: DAY, to: DAY, timezone: "UTC" },
      (report) => report.summary.totals.input === ALL_TOTALS.input + 3,
    );
    expect(after.summary.totals).toEqual(totals(21, 75_167, 27_189, 1971, 486));
    expect(after.days).toEqual([
      {
        day: DAY,
        totals: totals(21, 75_167, 27_189, 1971, 486),
        estimatedCost: 0,
        sessionCount: 1,
        turns: 3,
      },
    ]);
  });

  test("recounts from the top when a transcript is truncated", async () => {
    await waitForReport(client, { from: DAY, to: DAY, timezone: "UTC" }, backfilled);

    const transcript = path.join(claudeRoot, PROJECT_DIR, `${SESSION_ID}.jsonl`);
    const firstTwoLines = (await readFile(transcript, "utf8")).split("\n").slice(0, 2).join("\n");
    await truncate(transcript, Buffer.byteLength(`${firstTwoLines}\n`, "utf8"));

    // The rewritten file replays its first response, so the report holds the
    // truncated transcript's usage twice plus the untouched subagent file.
    const report = await waitForReport(
      client,
      { from: DAY, to: DAY, timezone: "UTC" },
      (candidate) => candidate.summary.totals.output === 1960 + 408,
    );
    expect(report.summary.totals).toEqual(totals(20, 109_720, 54_068, 2368, 570));
  });

  test("keeps the same totals after a restart and writes no new rows", async () => {
    await waitForReport(client, { from: DAY, to: DAY, timezone: "UTC" }, backfilled);
    const usageDir = path.join(daemon.paseoHome, "usage");
    const bucketLinesBefore = await countRowLines(usageDir, "buckets-");
    const turnLinesBefore = await countRowLines(usageDir, "turns-");
    expect(turnLinesBefore).toBeGreaterThan(0);

    await client.close();
    await daemon.close();

    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: homeRoot,
      cleanup: false,
      usage: usageConfig(claudeRoot),
    });
    client = await connect(daemon);

    const report = await waitForReport(client, { from: DAY, to: DAY, timezone: "UTC" }, backfilled);
    expect(report.summary.totals).toEqual(ALL_TOTALS);
    expect(report.backfill.filesTotal).toBe(0);
    expect(await countRowLines(usageDir, "buckets-")).toBe(bucketLinesBefore);
    expect(await countRowLines(usageDir, "turns-")).toBe(turnLinesBefore);
  });

  test("writes a turn row per model and folds the subagent into its parent turn", async () => {
    await waitForReport(client, { from: DAY, to: DAY, timezone: "UTC" }, backfilled);

    const rows = await readTurnRows(path.join(daemon.paseoHome, "usage"));
    expect(rows).toEqual([
      {
        cli: "claude",
        backend: null,
        sessionId: SESSION_ID,
        turnKey: "p1",
        model: "claude-fable-5-1",
        ...totals(7, 74_560, 26_884, 1010, 186),
        startedAt: "2026-09-18T09:44:42.587Z",
        lastAt: "2026-09-18T09:46:00.000Z",
        userMessageIds: ["u1"],
      },
      {
        cli: "claude",
        backend: null,
        sessionId: SESSION_ID,
        turnKey: "p1",
        // The subagent ran a model of its own inside the turn that spawned it.
        model: "claude-opus-5",
        ...totals(1, 500, 100, 900, 300),
        startedAt: "2026-09-18T09:45:20.000Z",
        lastAt: "2026-09-18T09:45:25.000Z",
        userMessageIds: [],
      },
      {
        cli: "claude",
        backend: null,
        sessionId: SESSION_ID,
        turnKey: "p2",
        model: "claude-opus-5",
        ...totals(10, 100, 200, 50, 0),
        startedAt: "2026-09-18T10:01:00.000Z",
        lastAt: "2026-09-18T10:01:30.000Z",
        userMessageIds: ["u9"],
      },
    ]);
  });
});

describe("usage row files", () => {
  const homes: string[] = [];

  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  });

  test("rewrites a month whose rows outgrew its keys", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-static-"));
    homes.push(paseoHomeRoot, staticDir);
    const usageDir = path.join(paseoHomeRoot, ".osuna", "usage");
    await mkdir(usageDir, { recursive: true });
    const bucket = "2026-03-04T09:30:00.000Z";
    const row = (model: string, output: number) => ({
      cli: "claude",
      backend: null,
      model,
      sessionId: "sess-9",
      cwd: "/work/demo",
      bucket,
      input: 1,
      cachedInput: 0,
      cacheWrite: 0,
      output,
      reasoning: 0,
      turns: 0,
      durationMs: 0,
    });
    const lines = [
      row("claude-opus-5", 10),
      row("claude-opus-5", 10),
      row("claude-opus-5", 10),
      row("claude-sonnet-5", 4),
      row("claude-sonnet-5", 4),
    ];
    await writeFile(
      path.join(usageDir, "buckets-2026-03.jsonl"),
      `${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );

    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot,
      staticDir,
      cleanup: false,
      usage: { roots: { claude: [], codex: [], pi: [], omp: [] }, pricing: UNPRICED },
    });
    const client = await connect(daemon);
    try {
      const { requestId: _requestId, ...report } = await client.usageReportGet({
        from: null,
        to: null,
        timezone: "UTC",
      });
      expect(report.models).toEqual([
        {
          model: "claude-opus-5",
          cli: "claude",
          backend: null,
          totals: { input: 3, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0 },
          estimatedCost: 0,
          priced: false,
        },
        {
          model: "claude-sonnet-5",
          cli: "claude",
          backend: null,
          totals: { input: 2, cachedInput: 0, cacheWrite: 0, output: 8, reasoning: 0 },
          estimatedCost: 0,
          priced: false,
        },
      ]);
      expect(await countRowLines(usageDir, "buckets-")).toBe(2);
    } finally {
      await client.close();
      await daemon.close();
    }
  });

  test("rewrites a month of turn rows whose increments outgrew their keys", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-static-"));
    homes.push(paseoHomeRoot, staticDir);
    const usageDir = path.join(paseoHomeRoot, ".osuna", "usage");
    await mkdir(usageDir, { recursive: true });
    const increment = (turnKey: string, output: number, lastAt: string) => ({
      cli: "claude",
      backend: null,
      sessionId: "sess-9",
      turnKey,
      model: "claude-opus-5",
      input: 1,
      cachedInput: 0,
      cacheWrite: 0,
      output,
      reasoning: 0,
      startedAt: "2026-03-04T09:30:00.000Z",
      lastAt,
      userMessageIds: [turnKey === "p1" ? "u1" : "u2"],
    });
    const lines = [
      increment("p1", 10, "2026-03-04T09:30:10.000Z"),
      increment("p1", 10, "2026-03-04T09:30:20.000Z"),
      increment("p1", 10, "2026-03-04T09:30:30.000Z"),
      increment("p2", 4, "2026-03-04T09:31:00.000Z"),
      increment("p2", 4, "2026-03-04T09:31:10.000Z"),
    ];
    await writeFile(
      path.join(usageDir, "turns-2026-03.jsonl"),
      `${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );

    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot,
      staticDir,
      cleanup: false,
      usage: { roots: { claude: [], codex: [], pi: [], omp: [] }, pricing: UNPRICED },
    });
    const client = await connect(daemon);
    try {
      expect(await readTurnRows(usageDir)).toEqual([
        { ...increment("p1", 30, "2026-03-04T09:30:30.000Z"), input: 3 },
        { ...increment("p2", 8, "2026-03-04T09:31:10.000Z"), input: 2 },
      ]);
      expect(await countRowLines(usageDir, "turns-")).toBe(2);
    } finally {
      await client.close();
      await daemon.close();
    }
  });
});

describe("usage report with two sources", () => {
  const temps: string[] = [];
  const codexTotals = totals(800, 2400, 300, 390, 80);
  const bothTotals = totals(818, 77_560, 27_484, 2350, 566);
  // Reasoning is a subset of output, so a share counts the other four columns.
  const claudeBillable = 18 + 75_160 + 27_184 + 1960;
  const codexBillable = 800 + 2400 + 300 + 390;
  const billable = claudeBillable + codexBillable;

  afterEach(async () => {
    await Promise.all(temps.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  /**
   * Codex keeps a thread under `sessions/YYYY/MM/DD/` and moves it to
   * `archived_sessions/` later; a copy in both places is still one thread. The
   * compressed rollout next to it is one the scanner cannot read.
   */
  async function seedCodexRoot(): Promise<{ sessions: string; archived: string }> {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-codex-"));
    temps.push(root);
    const sessions = path.join(root, "sessions");
    const archived = path.join(root, "archived_sessions");
    const day = path.join(sessions, "2026", "09", "18");
    await mkdir(day, { recursive: true });
    await mkdir(archived, { recursive: true });
    const rollout = await readFile(new URL("codex-session.jsonl", CODEX_FIXTURE_DIR), "utf8");
    await writeFile(path.join(day, CODEX_ROLLOUT), rollout);
    await writeFile(path.join(archived, CODEX_ROLLOUT), rollout);
    await writeFile(path.join(day, `${CODEX_ROLLOUT}.zst`), "<compressed>");
    return { sessions, archived };
  }

  test("counts an archived Codex thread once and leaves the compressed one alone", async () => {
    const claudeRoot = await seedClaudeRoot();
    temps.push(claudeRoot);
    const codexRoot = await seedCodexRoot();
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-static-"));
    temps.push(paseoHomeRoot, staticDir);
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot,
      staticDir,
      cleanup: false,
      usage: {
        roots: {
          claude: [claudeRoot],
          codex: [codexRoot.sessions, codexRoot.archived],
          pi: [],
          omp: [],
        },
        scanIntervalMs: SCAN_INTERVAL_MS,
        now: () => NOW,
        pricing: UNPRICED,
      },
    });
    const client = await connect(daemon);

    try {
      const report = await waitForReport(
        client,
        { from: DAY, to: DAY, timezone: "UTC" },
        backfilled,
      );

      // Two Claude transcripts and one Codex thread: not its archived copy, not
      // the compressed rollout.
      expect(report.backfill.filesTotal).toBe(3);
      expect(report.summary.totals).toEqual(bothTotals);
      expect(report.summary.sessionCount).toBe(2);
      expect(report.sources).toEqual([
        {
          cli: "claude",
          backend: null,
          totals: ALL_TOTALS,
          estimatedCost: 0,
          modelCount: 2,
          share: claudeBillable / billable,
        },
        {
          cli: "codex",
          backend: null,
          totals: codexTotals,
          estimatedCost: 0,
          modelCount: 2,
          share: codexBillable / billable,
        },
      ]);
      expect(report.days).toEqual([
        { day: DAY, totals: bothTotals, estimatedCost: 0, sessionCount: 2, turns: 4 },
      ]);
    } finally {
      await client.close();
      await daemon.close();
    }
  });
});

describe("usage report across Pi and OMP backends", () => {
  const temps: string[] = [];

  afterEach(async () => {
    await Promise.all(temps.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  /**
   * Pi encodes the cwd as `--<path>--` and keeps a session's subagents in a
   * directory named after the session file.
   */
  async function seedPiRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-pi-"));
    temps.push(root);
    const sessionName = `2026-09-18T09-30-00-000Z_${PI_SESSION}`;
    const projectDir = path.join(root, "--work-demo--");
    await mkdir(path.join(projectDir, sessionName, "tasks"), { recursive: true });
    await writeFile(
      path.join(projectDir, `${sessionName}.jsonl`),
      await readFile(new URL("pi-session.jsonl", PI_FIXTURE_DIR), "utf8"),
    );
    await writeFile(
      path.join(projectDir, sessionName, "tasks", `2026-09-18T09-31-00-000Z_${PI_SUBAGENT}.jsonl`),
      await readFile(new URL("pi-subagent.jsonl", PI_FIXTURE_DIR), "utf8"),
    );
    // A workflow run nests one level deeper again and names nobody its parent,
    // so only the directory says whose session it belongs to.
    await mkdir(path.join(projectDir, sessionName, "a9832612", "run-0"), { recursive: true });
    await writeFile(
      path.join(projectDir, sessionName, "a9832612", "run-0", "session.jsonl"),
      await readFile(new URL("pi-workflow-run.jsonl", PI_FIXTURE_DIR), "utf8"),
    );
    return root;
  }

  /**
   * OMP encodes the cwd differently, names a subagent after the agent rather
   * than a stamp, and drops tool output as `.log` next to the transcripts.
   */
  async function seedOmpRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-omp-"));
    temps.push(root);
    const sessionName = `2026-09-18T10-00-00-000Z_${OMP_SESSION}`;
    const projectDir = path.join(root, "-work-omp-demo");
    await mkdir(path.join(projectDir, sessionName), { recursive: true });
    await writeFile(
      path.join(projectDir, `${sessionName}.jsonl`),
      await readFile(new URL("omp-session.jsonl", OMP_FIXTURE_DIR), "utf8"),
    );
    await writeFile(
      path.join(projectDir, `2026-09-18T10-20-00-000Z_${OMP_CHILD}.jsonl`),
      await readFile(new URL("omp-child-copies-parent-entries.jsonl", OMP_FIXTURE_DIR), "utf8"),
    );
    await writeFile(
      path.join(projectDir, sessionName, "ResearchAgent.jsonl"),
      await readFile(new URL("omp-subagent.jsonl", OMP_FIXTURE_DIR), "utf8"),
    );
    await writeFile(path.join(projectDir, sessionName, "shell.bash.log"), "<tool output>\n");
    return root;
  }

  test("splits both CLIs by backend and folds subagents into their session", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-usage-static-"));
    temps.push(paseoHomeRoot, staticDir);
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot,
      staticDir,
      cleanup: false,
      usage: {
        roots: { claude: [], codex: [], pi: [await seedPiRoot()], omp: [await seedOmpRoot()] },
        scanIntervalMs: SCAN_INTERVAL_MS,
        now: () => NOW,
        pricing: UNPRICED,
      },
    });
    const client = await connect(daemon);

    try {
      const report = await waitForReport(
        client,
        { from: DAY, to: DAY, timezone: "UTC" },
        backfilled,
      );

      // Three Pi transcripts and three OMP ones: the `.log` beside them is not
      // a transcript, and the branch copied its parent's entries rather than
      // producing new ones.
      expect(report.backfill.filesTotal).toBe(6);
      expect(report.summary.totals).toEqual(totals(1687, 2350, 120, 633, 208));
      expect(report.summary.sessionCount).toBe(3);
      expect(report.sources).toEqual([
        {
          cli: "pi",
          backend: "anthropic",
          totals: totals(20, 1150, 50, 350, 115),
          estimatedCost: 0,
          modelCount: 2,
          share: 1570 / 4790,
        },
        {
          cli: "omp",
          backend: "3oxy-openai",
          totals: totals(907, 200, 0, 133, 48),
          estimatedCost: 0,
          modelCount: 1,
          share: 1240 / 4790,
        },
        {
          cli: "omp",
          backend: "anthropic",
          totals: totals(60, 1000, 70, 90, 5),
          estimatedCost: 0,
          modelCount: 1,
          share: 1220 / 4790,
        },
        {
          cli: "pi",
          backend: "openai-codex",
          totals: totals(700, 0, 0, 60, 40),
          estimatedCost: 0,
          modelCount: 1,
          share: 760 / 4790,
        },
      ]);
      expect(report.models).toEqual([
        {
          model: "claude-opus-5",
          cli: "pi",
          backend: "anthropic",
          totals: totals(15, 1000, 50, 300, 100),
          estimatedCost: 0,
          priced: false,
        },
        {
          model: "gpt-5.6-sol",
          cli: "omp",
          backend: "3oxy-openai",
          totals: totals(907, 200, 0, 133, 48),
          estimatedCost: 0,
          priced: false,
        },
        {
          model: "claude-opus-5",
          cli: "omp",
          backend: "anthropic",
          totals: totals(60, 1000, 70, 90, 5),
          estimatedCost: 0,
          priced: false,
        },
        {
          model: "gpt-6-astra",
          cli: "pi",
          backend: "openai-codex",
          totals: totals(700, 0, 0, 60, 40),
          estimatedCost: 0,
          priced: false,
        },
        {
          model: "claude-fable-5-1",
          cli: "pi",
          backend: "anthropic",
          totals: totals(5, 150, 0, 50, 15),
          estimatedCost: 0,
          priced: false,
        },
      ]);
      expect(report.days).toEqual([
        {
          day: DAY,
          totals: totals(1687, 2350, 120, 633, 208),
          estimatedCost: 0,
          sessionCount: 3,
          turns: 5,
        },
      ]);
      expect(report.projects).toEqual([
        {
          rootPath: "/work/omp-demo",
          displayName: "omp-demo",
          kind: "directory",
          totals: totals(967, 1200, 70, 223, 53),
          estimatedCost: 0,
          sources: [
            { cli: "omp", backend: "3oxy-openai" },
            { cli: "omp", backend: "anthropic" },
          ],
          cwds: [
            { cwd: "/work/omp-demo", totals: totals(967, 1200, 70, 223, 53), estimatedCost: 0 },
          ],
        },
        {
          rootPath: "/work/demo",
          displayName: "demo",
          kind: "directory",
          totals: totals(720, 1150, 50, 410, 155),
          estimatedCost: 0,
          sources: [
            { cli: "pi", backend: "anthropic" },
            { cli: "pi", backend: "openai-codex" },
          ],
          cwds: [{ cwd: "/work/demo", totals: totals(720, 1150, 50, 410, 155), estimatedCost: 0 }],
        },
      ]);
    } finally {
      await client.close();
      await daemon.close();
    }
  });
});

async function countRowLines(usageDir: string, prefix: string): Promise<number> {
  const names = await readdir(usageDir);
  let count = 0;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const raw = await readFile(path.join(usageDir, name), "utf8");
    count += raw.split("\n").filter((line) => line.length > 0).length;
  }
  return count;
}

/**
 * The turn rows on disk, folded exactly the way the daemon loads them back and
 * ordered by when each turn ran, so the assertions do not depend on the order
 * the scanner happened to reach the files in.
 */
async function readTurnRows(usageDir: string): Promise<UsageTurnRow[]> {
  const merged = new Map<string, UsageTurnRow>();
  for (const name of await readdir(usageDir)) {
    if (!name.startsWith("turns-")) continue;
    const raw = await readFile(path.join(usageDir, name), "utf8");
    for (const line of raw.split("\n")) {
      if (line.length > 0) mergeTurnRow(merged, JSON.parse(line) as UsageTurnRow);
    }
  }
  return Array.from(merged.values()).sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || turnRowKey(a).localeCompare(turnRowKey(b)),
  );
}

/** One more turn on the fable model, in the same UTC 15-minute bucket as the first. */
function appendedTurn(): string {
  const user = {
    type: "user",
    promptId: "p3",
    uuid: "u11",
    timestamp: `${DAY}T09:40:00.000Z`,
    cwd: "/work/demo",
    sessionId: SESSION_ID,
    message: { role: "user", content: "<prompt text>" },
  };
  const assistant = {
    type: "assistant",
    uuid: "u12",
    timestamp: `${DAY}T09:40:10.000Z`,
    cwd: "/work/demo",
    sessionId: SESSION_ID,
    requestId: "req_04",
    message: {
      id: "msg_d",
      model: "claude-fable-5-1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "<redacted>" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 3,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 7,
        output_tokens: 11,
      },
    },
  };
  return `${JSON.stringify(user)}\n${JSON.stringify(assistant)}`;
}
