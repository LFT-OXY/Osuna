import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@osuna/protocol/agent-labels";
import type { AgentAttentionRequiredNotification } from "@osuna/client/internal/daemon-client";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOsunaDaemon, type TestOsunaDaemon } from "../test-utils/osuna-daemon.js";
import { getAskModeConfig, getFullAccessConfig } from "./agent-configs.js";

const WAIT_MS = 15_000;

const tempDirs: string[] = [];
let daemon: TestOsunaDaemon | null = null;
let client: DaemonClient | null = null;

interface SubagentScenario {
  client: DaemonClient;
  workspaceId: string;
  parentId: string;
  childId: string;
  attention: AgentAttentionRequiredNotification[];
}

async function startScenario(): Promise<SubagentScenario> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "osuna-subagent-permission-"));
  tempDirs.push(cwd);
  daemon = await createTestOsunaDaemon();
  client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });

  const created = await client.createWorkspace({
    source: { kind: "directory", path: cwd },
    title: "Subagent permission workspace",
  });
  const workspaceId = created.workspace?.id;
  if (!workspaceId) throw new Error(created.error ?? "Expected a workspace");

  const parent = await client.createAgent({
    ...getFullAccessConfig("codex"),
    cwd,
    workspaceId,
    title: "Parent",
  });
  const child = await client.createAgent({
    ...getAskModeConfig("codex"),
    cwd,
    workspaceId,
    title: "Child",
    labels: { [PARENT_AGENT_ID_LABEL]: parent.id },
  });

  const attention: AgentAttentionRequiredNotification[] = [];
  client.onAgentAttentionRequired((notification) => attention.push(notification));
  await client.observeEvents(["agent_attention_required"], { notifications: true }).ready;
  return { client, workspaceId, parentId: parent.id, childId: child.id, attention };
}

async function workspaceStatus(scenario: SubagentScenario): Promise<string | undefined> {
  const workspaces = await scenario.client.fetchWorkspaces();
  return workspaces.entries.find((entry) => entry.id === scenario.workspaceId)?.status;
}

async function parkChildOnPermission(scenario: SubagentScenario): Promise<string> {
  await scenario.client.sendMessage(
    scenario.childId,
    'Use your shell tool to run: `printf "ok" > child.txt`. Request permission and wait.',
  );
  const parked = await scenario.client.waitForFinish(scenario.childId, WAIT_MS);
  expect(parked.status).toBe("permission");
  const requestId = parked.final?.pendingPermissions[0]?.id;
  if (!requestId) throw new Error("Expected a pending permission on the child");
  return requestId;
}

// Attention is broadcast in event order, so once the parent's own finish arrives,
// anything the child was going to raise before it has arrived too.
async function flushAttentionThroughParent(scenario: SubagentScenario): Promise<void> {
  const before = scenario.attention.length;
  await scenario.client.sendMessage(scenario.parentId, "Say hello");
  await expect
    .poll(
      () =>
        scenario.attention
          .slice(before)
          .some((entry) => entry.agentId === scenario.parentId && entry.reason === "finished"),
      { timeout: WAIT_MS },
    )
    .toBe(true);
}

function childAttentionReasons(scenario: SubagentScenario): string[] {
  return scenario.attention
    .filter((entry) => entry.agentId === scenario.childId)
    .map((entry) => entry.reason);
}

afterEach(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.close().catch(() => undefined);
  client = null;
  daemon = null;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("subagent permission requests go to the user", () => {
  test("a child's permission request raises attention pointed at the child", async () => {
    const scenario = await startScenario();

    await parkChildOnPermission(scenario);

    await expect
      .poll(() => childAttentionReasons(scenario), { timeout: WAIT_MS })
      .toEqual(["permission"]);
    const childAttention = scenario.attention.find((entry) => entry.agentId === scenario.childId);
    expect(childAttention?.notification?.data).toMatchObject({
      agentId: scenario.childId,
      workspaceId: scenario.workspaceId,
      reason: "permission",
    });
  }, 60_000);

  test("a child that finishes or errors raises no attention", async () => {
    const scenario = await startScenario();

    const requestId = await parkChildOnPermission(scenario);
    await scenario.client.respondToPermission(scenario.childId, requestId, { behavior: "allow" });
    const finished = await scenario.client.waitForFinish(scenario.childId, WAIT_MS);
    expect(finished.status).toBe("idle");

    await scenario.client.sendMessage(scenario.childId, "Emit a turn failure");
    const failed = await scenario.client.waitForFinish(scenario.childId, WAIT_MS);
    expect(failed.status).toBe("error");

    await flushAttentionThroughParent(scenario);
    expect(childAttentionReasons(scenario)).toEqual(["permission"]);
  }, 60_000);

  test("a same-workspace child waiting for approval puts the workspace in needs input", async () => {
    const scenario = await startScenario();
    expect(await workspaceStatus(scenario)).toBe("done");

    const requestId = await parkChildOnPermission(scenario);
    expect(await workspaceStatus(scenario)).toBe("needs_input");

    await scenario.client.respondToPermission(scenario.childId, requestId, { behavior: "allow" });
    const finished = await scenario.client.waitForFinish(scenario.childId, WAIT_MS);
    expect(finished.status).toBe("idle");
    expect(await workspaceStatus(scenario)).toBe("done");
  }, 60_000);
});
