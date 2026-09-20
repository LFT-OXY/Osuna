import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { UsageSessionRow } from "@osuna/protocol/usage/types";
import { claudeProjectDirNameSync } from "../agent/providers/claude/project-dir.js";
import {
  claudeAssistantLine,
  claudeTurn,
  claudeUserLine,
} from "../usage/fixtures/claude-transcript.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/** The session the fake Claude client hands the agent it creates. */
const AGENT_SESSION = "sess-imported";
const SCAN_INTERVAL_MS = 50;

const tempDirs: string[] = [];

/**
 * Nothing is priced: the bundled snapshot is refreshed before every release, so
 * a real price would move these numbers on a schedule of its own.
 */
const UNPRICED: NonNullable<
  NonNullable<Parameters<typeof createTestPaseoDaemon>[0]>["usage"]
>["pricing"] = {
  autoUpdate: false,
  snapshot: {
    _meta: { source: "test", fetchedAt: "2026-09-18T00:00:00.000Z", etag: null, license: "" },
    models: {},
  },
};

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("usage.sessions.list over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let claudeRoot: string;
  let cwd: string;
  let projectDir: string;

  beforeEach(async () => {
    claudeRoot = await tempDir("paseo-usage-sessions-root-");
    cwd = await tempDir("paseo-usage-sessions-cwd-");
    projectDir = path.join(claudeRoot, claudeProjectDirNameSync(cwd));
    await mkdir(projectDir, { recursive: true });
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: await tempDir("paseo-usage-sessions-home-"),
      staticDir: await tempDir("paseo-usage-sessions-static-"),
      cleanup: false,
      agentClients: {
        claude: createTestAgentClient("claude", { nextSessionId: () => AGENT_SESSION }),
      },
      usage: {
        roots: { claude: [claudeRoot], codex: [], pi: [], omp: [] },
        scanIntervalMs: SCAN_INTERVAL_MS,
        pricing: UNPRICED,
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeTranscript(sessionId: string, contents: string): Promise<void> {
    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), contents);
  }

  async function listSessions(
    options: { from?: string | null; to?: string | null; timezone?: string } = {},
    accept: (sessions: UsageSessionRow[]) => boolean = (sessions) => sessions.length > 0,
  ): Promise<UsageSessionRow[]> {
    const deadline = Date.now() + 20_000;
    let last: UsageSessionRow[] = [];
    while (Date.now() < deadline) {
      const payload = await client.usageSessionsList({
        from: options.from ?? null,
        to: options.to ?? null,
        timezone: options.timezone ?? "UTC",
      });
      last = payload.sessions;
      if (accept(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Session listing never matched: ${JSON.stringify(last)}`);
  }

  test("splits a session that ran past midnight into one row per local day", async () => {
    await writeTranscript(
      "sess-split",
      claudeTurn({
        sessionId: "sess-split",
        promptId: "p1",
        at: "2026-09-18T23:50:00.000Z",
        cwd,
        output: 300,
      }) +
        claudeTurn({
          sessionId: "sess-split",
          promptId: "p2",
          at: "2026-09-19T00:20:00.000Z",
          cwd,
          output: 700,
        }),
    );

    const sessions = await listSessions({}, (rows) => rows.length === 2);

    expect(sessions).toEqual([
      {
        day: "2026-09-19",
        cli: "claude",
        backend: null,
        sessionId: "sess-split",
        cwd,
        project: { rootPath: cwd, displayName: path.basename(cwd), kind: "directory" },
        models: [
          {
            model: "claude-opus-5",
            totals: { input: 1, cachedInput: 0, cacheWrite: 0, output: 700, reasoning: 0 },
            estimatedCost: 0,
            priced: false,
          },
        ],
        totals: { input: 1, cachedInput: 0, cacheWrite: 0, output: 700, reasoning: 0 },
        estimatedCost: 0,
        turns: 1,
        durationMs: 5_000,
        firstAt: "2026-09-19T00:20:00.000Z",
        lastAt: "2026-09-19T00:20:05.000Z",
        handle: { providerId: "claude", providerHandleId: "sess-split" },
      },
      {
        day: "2026-09-18",
        cli: "claude",
        backend: null,
        sessionId: "sess-split",
        cwd,
        project: { rootPath: cwd, displayName: path.basename(cwd), kind: "directory" },
        models: [
          {
            model: "claude-opus-5",
            totals: { input: 1, cachedInput: 0, cacheWrite: 0, output: 300, reasoning: 0 },
            estimatedCost: 0,
            priced: false,
          },
        ],
        totals: { input: 1, cachedInput: 0, cacheWrite: 0, output: 300, reasoning: 0 },
        estimatedCost: 0,
        turns: 1,
        durationMs: 5_000,
        firstAt: "2026-09-18T23:50:00.000Z",
        lastAt: "2026-09-18T23:50:05.000Z",
        handle: { providerId: "claude", providerHandleId: "sess-split" },
      },
    ]);

    // The same two turns are one local day east of UTC, where midnight has passed already.
    const shanghai = await listSessions({ timezone: "Asia/Shanghai" }, (rows) => rows.length === 1);
    expect(shanghai.map((session) => [session.day, session.totals.output])).toEqual([
      ["2026-09-19", 1000],
    ]);

    const inDay = await listSessions(
      { from: "2026-09-18", to: "2026-09-18" },
      (rows) => rows.length === 1,
    );
    expect(inDay.map((session) => session.day)).toEqual(["2026-09-18"]);
  });

  test("reports a Claude resume chain as one session under the id it last used", async () => {
    await writeTranscript(
      "sess-parent",
      claudeTurn({
        sessionId: "sess-parent",
        promptId: "p1",
        at: "2026-09-18T08:00:00.000Z",
        cwd,
        output: 100,
      }),
    );
    // A resume replays the parent's lines stamped with the session it forked
    // from, then writes its own turn.
    await writeTranscript(
      "sess-child",
      `${claudeUserLine({ sessionId: "sess-child", promptId: "p1", at: "2026-09-18T08:00:00.000Z", cwd })}\n${claudeAssistantLine(
        {
          sessionId: "sess-child",
          at: "2026-09-18T08:00:05.000Z",
          cwd,
          output: 100,
          messageId: "msg-p1",
          finished: true,
          forkedFrom: "sess-parent",
        },
      )}\n${claudeTurn({
        sessionId: "sess-child",
        promptId: "p2",
        at: "2026-09-18T09:00:00.000Z",
        cwd,
        output: 50,
      })}`,
    );

    const chained = (rows: UsageSessionRow[]): boolean => rows[0]?.totals.output === 150;
    const sessions = await listSessions({}, chained);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("sess-child");
    expect(sessions[0]?.turns).toBe(2);
    expect(sessions[0]?.firstAt).toBe("2026-09-18T08:00:00.000Z");
    expect(sessions[0]?.lastAt).toBe("2026-09-18T09:00:05.000Z");

    // The report counts the same chain once, so the daily table's session count
    // and the rows it expands to agree.
    const report = await client.usageReportGet({ from: null, to: null, timezone: "UTC" });
    expect(report.summary.sessionCount).toBe(1);
    expect(report.days.map((day) => [day.day, day.sessionCount])).toEqual([["2026-09-18", 1]]);
  });

  test("marks the session a Paseo agent owns with the agent to open", async () => {
    const agent = await client.createAgent({ provider: "claude", cwd, title: "Usage agent" });
    await writeTranscript(
      AGENT_SESSION,
      claudeTurn({
        sessionId: AGENT_SESSION,
        promptId: "p1",
        at: "2026-09-18T10:00:00.000Z",
        cwd,
        output: 42,
      }),
    );

    const sessions = await listSessions({}, (rows) => rows.length === 1);

    expect(sessions[0]?.importedAgentId).toBe(agent.id);
    expect(sessions[0]?.handle).toEqual({
      providerId: "claude",
      providerHandleId: AGENT_SESSION,
    });
  });
});
