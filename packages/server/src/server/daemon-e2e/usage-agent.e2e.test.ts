import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage } from "@osuna/protocol/messages";
import { claudeProjectDirNameSync } from "../agent/providers/claude/project-dir.js";
import { claudeAssistantLine, claudeUserLine } from "../usage/fixtures/claude-transcript.js";
import {
  createTestAgentClient,
  type FakeAgentSessionControl,
} from "../test-utils/fake-agent-client.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

const FIRST_SESSION = "sess-live-1";
const SECOND_SESSION = "sess-live-2";
/** Long enough that only the targeted parse can explain what lands in the rows. */
const SCAN_INTERVAL_MS = 600_000;

const tempDirs: string[] = [];
/** Transcript writes the fake provider performs when a turn starts. */
let onTurnStart: (() => Promise<void>) | null = null;
let sessionIds: string[] = [];
let liveSession: FakeAgentSessionControl | null = null;

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("agent usage after a turn finishes", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let collector: MessageCollector;
  let eventSubscription: { release: () => Promise<void> } | null = null;
  let claudeRoot: string;
  let cwd: string;
  let projectDir: string;

  beforeEach(async () => {
    claudeRoot = await tempDir("paseo-usage-agent-root-");
    cwd = await tempDir("paseo-usage-agent-cwd-");
    projectDir = path.join(claudeRoot, claudeProjectDirNameSync(cwd));
    await mkdir(projectDir, { recursive: true });
    sessionIds = [FIRST_SESSION, SECOND_SESSION];
    onTurnStart = null;
    liveSession = null;
    const homeRoot = await tempDir("paseo-usage-agent-home-");
    const staticDir = await tempDir("paseo-usage-agent-static-");
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: homeRoot,
      staticDir,
      cleanup: false,
      agentClients: {
        claude: createTestAgentClient("claude", {
          nextSessionId: () => sessionIds.shift() ?? FIRST_SESSION,
          onSessionCreated: (session) => {
            liveSession = session;
          },
          onStartTurn: () => {
            void onTurnStart?.();
          },
        }),
      },
      usage: {
        roots: { claude: [claudeRoot], codex: [], pi: [], omp: [] },
        scanIntervalMs: SCAN_INTERVAL_MS,
        pricing: {
          autoUpdate: false,
          snapshot: {
            _meta: {
              source: "test",
              fetchedAt: "2026-09-18T00:00:00.000Z",
              etag: null,
              license: "",
            },
            models: {},
          },
        },
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    eventSubscription = client.observeEvents(["usage.updated", "usage.backfill.progress"]);
    await eventSubscription.ready;
    collector = createMessageCollector(client);
  });

  afterEach(async () => {
    collector?.unsubscribe();
    await eventSubscription?.release().catch(() => undefined);
    eventSubscription = null;
    await client?.close();
    await daemon?.close();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeTranscript(sessionId: string, contents: string): Promise<void> {
    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), contents);
  }

  async function createAgent(): Promise<string> {
    const agent = await client.createAgent({ provider: "claude", cwd, title: "Usage agent" });
    return agent.id;
  }

  /** What the agent record on disk says about the sessions it has run in. */
  async function storedProviderSessionIds(agentId: string): Promise<string[] | undefined> {
    const agentsDir = path.join(daemon.paseoHome, "agents");
    for (const entry of await readdir(agentsDir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || entry.name !== `${agentId}.json`) continue;
      const record = JSON.parse(await readFile(path.join(entry.parentPath, entry.name), "utf8"));
      return record.providerSessionIds;
    }
    throw new Error(`No stored record for agent ${agentId}`);
  }

  /** The turn id the daemon gave the newest turn, as its own timeline records it. */
  async function lastTurnId(agentId: string): Promise<string | null> {
    const timeline = await client.fetchAgentTimeline(agentId, { direction: "tail", limit: 200 });
    for (let index = timeline.entries.length - 1; index >= 0; index -= 1) {
      const turnId = timeline.entries[index]?.turnId;
      if (turnId) return turnId;
    }
    return null;
  }

  async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 20_000;
    let last: T | undefined;
    while (Date.now() < deadline) {
      last = await read();
      if (accept(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Condition never held; last value: ${JSON.stringify(last)}`);
  }

  test("stamps the finished turn and tells the client whose usage moved", async () => {
    const agentId = await createAgent();
    onTurnStart = async () => {
      await writeTranscript(
        FIRST_SESSION,
        `${claudeUserLine({ sessionId: FIRST_SESSION, promptId: "p1", at: "2026-09-18T09:00:00.000Z", cwd })}\n${claudeAssistantLine(
          {
            sessionId: FIRST_SESSION,
            at: "2026-09-18T09:00:10.000Z",
            cwd,
            output: 40,
            messageId: "msg-1",
            finished: true,
          },
        )}\n`,
      );
    };

    await client.sendAgentMessage(agentId, "count something");
    const { turns } = await waitFor(
      () => client.usageAgentTurnsList(agentId),
      (payload) => payload.turns.length === 1 && payload.turns[0]?.turnId !== null,
    );

    expect(turns[0]?.turnKey).toBe("p1");
    expect(turns[0]?.turnId).toBe(await lastTurnId(agentId));
    expect(turns[0]?.totals.output).toBe(40);
    expect(turns[0]?.durationMs).toBe(10_000);

    const summary = await client.usageAgentGet(agentId);
    expect(summary.totals.output).toBe(40);
    expect(summary.turns).toBe(1);
    expect(summary.complete).toBe(true);

    const updates = collector.messages
      .filter(
        (message): message is Extract<SessionOutboundMessage, { type: "usage.updated" }> =>
          message.type === "usage.updated",
      )
      .map((message) => message.payload);
    expect(updates).toContainEqual(
      expect.objectContaining({ cli: "claude", sessionId: FIRST_SESSION, agentId }),
    );
  });

  test("keeps counting across a resume that hands back a new session id", async () => {
    const agentId = await createAgent();
    onTurnStart = async () => {
      await writeTranscript(
        FIRST_SESSION,
        `${claudeUserLine({ sessionId: FIRST_SESSION, promptId: "p1", at: "2026-09-18T09:00:00.000Z", cwd })}\n${claudeAssistantLine(
          {
            sessionId: FIRST_SESSION,
            at: "2026-09-18T09:00:10.000Z",
            cwd,
            output: 40,
            messageId: "msg-1",
            finished: true,
          },
        )}\n`,
      );
    };
    await client.sendAgentMessage(agentId, "first");
    await waitFor(
      () => client.usageAgentTurnsList(agentId),
      (payload) => payload.turns.length === 1,
    );

    onTurnStart = async () => {
      // The resumed transcript replays the old session, stamped `forkedFrom`.
      await writeTranscript(
        SECOND_SESSION,
        `${claudeAssistantLine({
          sessionId: SECOND_SESSION,
          at: "2026-09-18T09:00:10.000Z",
          cwd,
          output: 999,
          messageId: "msg-1",
          finished: true,
          forkedFrom: FIRST_SESSION,
        })}\n${claudeUserLine({ sessionId: SECOND_SESSION, promptId: "p2", at: "2026-09-18T10:00:00.000Z", cwd })}\n${claudeAssistantLine(
          {
            sessionId: SECOND_SESSION,
            at: "2026-09-18T10:00:05.000Z",
            cwd,
            output: 60,
            messageId: "msg-2",
            finished: true,
          },
        )}\n`,
      );
    };
    // The provider resumes onto a new session id, the way Claude does.
    liveSession?.rotateSessionId(SECOND_SESSION);
    await client.sendAgentMessage(agentId, "second");

    const summary = await waitFor(
      () => client.usageAgentGet(agentId),
      (payload) => payload.turns === 2,
    );

    expect(summary.totals.output).toBe(100);
    expect(summary.complete).toBe(true);
    const { turns } = await client.usageAgentTurnsList(agentId);
    expect(turns.map((row) => row.sessionId)).toEqual([FIRST_SESSION, SECOND_SESSION]);
    // The record remembers both ids, so the sum does not depend on the fork link.
    expect(await storedProviderSessionIds(agentId)).toEqual([FIRST_SESSION, SECOND_SESSION]);
  });

  test("reads the file again when the turn was still being written", async () => {
    const agentId = await createAgent();
    onTurnStart = async () => {
      // Half a turn: no `stop_reason`, so the parse cannot close it yet.
      await writeTranscript(
        FIRST_SESSION,
        `${claudeUserLine({ sessionId: FIRST_SESSION, promptId: "p1", at: "2026-09-18T09:00:00.000Z", cwd })}\n${claudeAssistantLine(
          {
            sessionId: FIRST_SESSION,
            at: "2026-09-18T09:00:05.000Z",
            cwd,
            output: 20,
            messageId: "msg-1",
            finished: false,
          },
        )}\n`,
      );
    };

    await client.sendAgentMessage(agentId, "answer slowly");
    await waitFor(
      () => client.usageAgentGet(agentId),
      (payload) => payload.totals.output === 20,
    );
    expect((await client.usageAgentTurnsList(agentId)).turns[0]?.turnId).toBe(null);

    await writeTranscript(
      FIRST_SESSION,
      `${claudeUserLine({ sessionId: FIRST_SESSION, promptId: "p1", at: "2026-09-18T09:00:00.000Z", cwd })}\n${claudeAssistantLine(
        {
          sessionId: FIRST_SESSION,
          at: "2026-09-18T09:00:05.000Z",
          cwd,
          output: 20,
          messageId: "msg-1",
          finished: false,
        },
      )}\n${claudeAssistantLine({
        sessionId: FIRST_SESSION,
        at: "2026-09-18T09:00:10.000Z",
        cwd,
        output: 25,
        messageId: "msg-2",
        finished: true,
      })}\n`,
    );

    const { turns } = await waitFor(
      () => client.usageAgentTurnsList(agentId),
      (payload) => payload.turns[0]?.turnId !== null,
    );
    expect(turns[0]?.turnId).toBe(await lastTurnId(agentId));
    expect(turns[0]?.totals.output).toBe(45);
  });
});
