import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pino } from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type { UsageCli } from "@osuna/protocol/usage/types";
import {
  createUsageAgentBridge,
  type UsageAgentBacking,
  type UsageAgentBridge,
  type UsageAgentManagerLike,
  type UsageAgentRegistryLike,
} from "./agent-sessions.js";
import { claudeAssistantLine, claudeTurn } from "./fixtures/claude-transcript.js";
import { UsageService } from "./service.js";

const NOW = Date.parse("2026-09-18T23:00:00.000Z");
const CWD = "/work/demo";
const PROJECT_DIR = "-work-demo";
const logger = pino({ level: "silent" });
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function turn(input: { sessionId: string; promptId: string; at: string; output: number }): string {
  return claudeTurn({ ...input, cwd: CWD });
}

function bridge(backing: UsageAgentBacking | null): UsageAgentBridge {
  return {
    getBacking: async () => backing,
    findAgentIdForSession: async () => null,
    listTurnTimestamps: async () => [],
    subscribeTurnEnd: () => () => undefined,
  };
}

interface StartedService {
  service: UsageService;
  /** Answers taken from inside the backfill round, while it was still running. */
  duringBackfill: Promise<{ complete: boolean }> | null;
}

async function startService(options: {
  claudeRoot: string;
  agents: UsageAgentBridge;
  /** Reads the agent's usage from inside the first progress tick. */
  probeAgentId?: string;
}): Promise<StartedService> {
  const osunaHome = await tempDir("osuna-usage-agent-home-");
  let duringBackfill: Promise<{ complete: boolean }> | null = null;
  const service = new UsageService({
    osunaHome,
    config: {
      roots: { claude: [options.claudeRoot], codex: [], pi: [], omp: [] },
      // Long enough that the backfill is the only round this suite sees.
      scanIntervalMs: 60_000,
      now: () => NOW,
      pricing: {
        autoUpdate: false,
        snapshot: {
          _meta: { source: "test", fetchedAt: "2026-09-18T00:00:00.000Z", etag: null, license: "" },
          models: {},
        },
      },
    },
    logger,
    listProjects: async () => [],
    onBackfillProgress: (backfill) => {
      // Progress only fires from inside the round, so this is the one moment
      // the state is observably `running`.
      if (backfill.state !== "running" || !options.probeAgentId || duringBackfill) return;
      duringBackfill = service.getAgentUsage(options.probeAgentId);
    },
    getPricingConfig: () => ({ autoUpdate: false, overrides: [] }),
    onPricingUpdated: () => undefined,
    agents: options.agents,
    onUsageUpdated: () => undefined,
  });
  await service.start();
  await waitForBackfill(service);
  return { service, duringBackfill };
}

async function waitForBackfill(service: UsageService): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const report = await service.getReport({ from: null, to: null, timezone: "UTC" });
    if (report.backfill.state === "done") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The backfill never finished");
}

async function seedSession(root: string, sessionId: string, contents: string): Promise<void> {
  const dir = path.join(root, PROJECT_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${sessionId}.jsonl`), contents);
}

function backingOf(sessionIds: string[], cli: UsageCli = "claude"): UsageAgentBacking {
  return { cli, sessionIds, cwd: CWD, logPath: null };
}

describe("agent usage over its backing sessions", () => {
  test("adds up every session the agent ran in", async () => {
    const root = await tempDir("osuna-usage-agent-claude-");
    await seedSession(
      root,
      "sess-a",
      turn({ sessionId: "sess-a", promptId: "p1", at: "2026-09-18T09:00:00.000Z", output: 10 }),
    );
    await seedSession(
      root,
      "sess-b",
      turn({ sessionId: "sess-b", promptId: "p2", at: "2026-09-18T10:00:00.000Z", output: 30 }),
    );
    const { service } = await startService({
      claudeRoot: root,
      agents: bridge(backingOf(["sess-a", "sess-b"])),
    });

    const summary = await service.getAgentUsage("agent-1");
    const { turns } = await service.listAgentTurns("agent-1");
    await service.dispose();

    expect(summary.totals.output).toBe(40);
    expect(summary.turns).toBe(2);
    expect(summary.complete).toBe(true);
    expect(summary.firstAt).toBe("2026-09-18T09:00:00.000Z");
    expect(summary.lastAt).toBe("2026-09-18T10:00:05.000Z");
    expect(turns.map((row) => row.sessionId)).toEqual(["sess-a", "sess-b"]);
    expect(turns.map((row) => row.turnKey)).toEqual(["p1", "p2"]);
  });

  test("an old record names one session and the fork link finds the rest", async () => {
    const root = await tempDir("osuna-usage-agent-fork-");
    await seedSession(
      root,
      "sess-old",
      turn({ sessionId: "sess-old", promptId: "p1", at: "2026-09-18T09:00:00.000Z", output: 10 }),
    );
    // The resumed file replays the parent's lines, stamped `forkedFrom`.
    await seedSession(
      root,
      "sess-new",
      `${claudeAssistantLine({
        sessionId: "sess-new",
        at: "2026-09-18T09:00:05.000Z",
        cwd: CWD,
        output: 999,
        messageId: "msg-replay",
        finished: true,
        forkedFrom: "sess-old",
      })}\n${turn({
        sessionId: "sess-new",
        promptId: "p2",
        at: "2026-09-18T10:00:00.000Z",
        output: 30,
      })}`,
    );
    // A record written before `providerSessionIds` existed: only the handle.
    const { service } = await startService({
      claudeRoot: root,
      agents: createUsageAgentBridge({
        agentManager: stubAgentManager(),
        agentStorage: stubRegistry({
          id: "agent-1",
          provider: "claude",
          cwd: CWD,
          persistence: { provider: "claude", sessionId: "sess-new" },
        }),
      }),
    });

    const summary = await service.getAgentUsage("agent-1");
    await service.dispose();

    expect(summary.totals.output).toBe(40);
    expect(summary.turns).toBe(2);
    expect(summary.complete).toBe(true);
  });

  test("a session with no cursor leaves the answer incomplete", async () => {
    const root = await tempDir("osuna-usage-agent-partial-");
    await seedSession(
      root,
      "sess-a",
      turn({ sessionId: "sess-a", promptId: "p1", at: "2026-09-18T09:00:00.000Z", output: 10 }),
    );
    const { service } = await startService({
      claudeRoot: root,
      agents: bridge(backingOf(["sess-a", "sess-never-scanned"])),
    });

    const summary = await service.getAgentUsage("agent-1");
    const turns = await service.listAgentTurns("agent-1");
    await service.dispose();

    expect(summary.totals.output).toBe(10);
    expect(summary.complete).toBe(false);
    expect(turns.complete).toBe(false);
  });

  test("a subagent cursor alone does not make the session scanned", async () => {
    const root = await tempDir("osuna-usage-agent-subagent-");
    const dir = path.join(root, PROJECT_DIR, "sess-a", "subagents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "agent-7.jsonl"),
      turn({ sessionId: "sess-a", promptId: "p1", at: "2026-09-18T09:00:00.000Z", output: 10 }),
    );
    const { service } = await startService({
      claudeRoot: root,
      agents: bridge(backingOf(["sess-a"])),
    });

    const summary = await service.getAgentUsage("agent-1");
    await service.dispose();

    expect(summary.complete).toBe(false);
  });

  test("a backfill still running is reported as incomplete", async () => {
    const root = await tempDir("osuna-usage-agent-backfill-");
    for (let index = 0; index < 20; index += 1) {
      await seedSession(
        root,
        `sess-${index}`,
        turn({
          sessionId: `sess-${index}`,
          promptId: `p${index}`,
          at: "2026-09-18T09:00:00.000Z",
          output: 10,
        }),
      );
    }
    const { service, duringBackfill } = await startService({
      claudeRoot: root,
      agents: bridge(backingOf(["sess-0"])),
      probeAgentId: "agent-1",
    });

    const summary = await service.getAgentUsage("agent-1");
    await service.dispose();

    expect(duringBackfill).not.toBe(null);
    expect((await duringBackfill!).complete).toBe(false);
    expect(summary.complete).toBe(true);
  });

  test("an agent nobody knows reports nothing, and says so", async () => {
    const root = await tempDir("osuna-usage-agent-unknown-");
    const { service } = await startService({ claudeRoot: root, agents: bridge(null) });

    const summary = await service.getAgentUsage("agent-gone");
    const turns = await service.listAgentTurns("agent-gone");
    await service.dispose();

    expect(summary.totals.output).toBe(0);
    expect(summary.turns).toBe(0);
    expect(summary.complete).toBe(false);
    expect(turns).toEqual({ turns: [], complete: false });
  });
});

function stubAgentManager(): UsageAgentManagerLike {
  return {
    getAgent: () => null,
    listAgents: () => [],
    getTimelineRows: async () => [],
    subscribe: () => () => undefined,
  };
}

function stubRegistry(record: {
  id: string;
  provider: string;
  cwd: string;
  persistence: { provider: string; sessionId: string };
}): UsageAgentRegistryLike {
  const stored = {
    ...record,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    labels: {},
    lastStatus: "closed" as const,
    config: null,
  };
  return {
    get: async (agentId) => (agentId === record.id ? stored : null),
    list: async () => [stored],
  };
}
