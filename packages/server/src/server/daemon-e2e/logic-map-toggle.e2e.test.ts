import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getLogicMapNameFromLabels, LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const WAIT_MS = 15_000;
const BLOCK_INTRO = "The logic map is on for this conversation.";

const tempDirs: string[] = [];
const daemons: TestPaseoDaemon[] = [];
const clients: DaemonClient[] = [];

interface Scenario {
  daemon: TestPaseoDaemon;
  client: DaemonClient;
  cwd: string;
  prompts: string[];
}

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function startDaemon(
  input: { cwd?: string; paseoHomeRoot?: string } = {},
): Promise<Scenario> {
  const cwd = input.cwd ?? (await makeTempDir("paseo-logic-map-ws-"));
  const prompts: string[] = [];
  const daemon = await createTestPaseoDaemon({
    agentClients: {
      codex: createTestAgentClient("codex", {
        onStartTurn: (prompt) => prompts.push(promptText(prompt)),
      }),
    },
    ...(input.paseoHomeRoot ? { paseoHomeRoot: input.paseoHomeRoot, cleanup: false } : {}),
  });
  daemons.push(daemon);
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  clients.push(client);
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return { daemon, client, cwd, prompts };
}

async function openWorkspace(scenario: Scenario): Promise<string> {
  const response = await scenario.client.openProject(scenario.cwd);
  if (!response.workspace) throw new Error(response.error ?? "Expected a workspace");
  return response.workspace.id;
}

async function sendAndFinish(scenario: Scenario, agentId: string, text: string): Promise<void> {
  await scenario.client.sendAgentMessage(agentId, text);
  await scenario.client.waitForFinish(agentId, WAIT_MS);
}

async function userMessages(scenario: Scenario, agentId: string): Promise<string[]> {
  const timeline = await scenario.client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 0,
    projection: "canonical",
  });
  return timeline.entries.flatMap((entry) =>
    entry.item.type === "user_message" ? [entry.item.text] : [],
  );
}

async function readSkeleton(cwd: string, mapName: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(cwd, "docs", "logic-maps", mapName, "map.json"), "utf8"),
  );
}

async function agentLogicMap(scenario: Scenario, agentId: string): Promise<string | null> {
  const { entries } = await scenario.client.fetchAgents({ filter: { includeArchived: true } });
  const agent = entries.find((entry) => entry.agent.id === agentId)?.agent;
  return getLogicMapNameFromLabels(agent?.labels);
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close().catch(() => undefined)));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Logic map toggle", () => {
  test("server_info advertises the logic map", async () => {
    const scenario = await startDaemon();

    expect(scenario.client.getLastServerInfoMessage()?.features?.logicMap).toBe(true);
  });

  test("turning it on creates an empty map and adds the instruction block to provider-bound messages only", async () => {
    const scenario = await startDaemon();
    const agent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });

    const { mapName } = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: true,
    });
    await sendAndFinish(scenario, agent.id, "add a login page");

    expect(mapName).toMatch(/^untitled-[0-9a-f]{8}$/);
    expect(await readSkeleton(scenario.cwd, mapName!)).toEqual({
      title: null,
      specFramework: null,
      nodes: [],
      edges: [],
    });
    expect(await agentLogicMap(scenario, agent.id)).toBe(mapName);
    expect(scenario.prompts).toHaveLength(1);
    expect(scenario.prompts[0]).toMatch(
      new RegExp(`^add a login page\\n\\n<paseo-system>\\n${BLOCK_INTRO}`),
    );
    expect(scenario.prompts[0]).toContain(`docs/logic-maps/${mapName}/`);
    expect(await userMessages(scenario, agent.id)).toEqual(["add a login page"]);
  });

  test("turning it off stops the block and keeps the map on disk", async () => {
    const scenario = await startDaemon();
    const agent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const { mapName } = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: true,
    });

    const off = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: false,
    });
    await sendAndFinish(scenario, agent.id, "fix the typo");

    expect(off.mapName).toBeNull();
    expect(await agentLogicMap(scenario, agent.id)).toBeNull();
    expect(scenario.prompts).toEqual(["fix the typo"]);
    expect(await readdir(path.join(scenario.cwd, "docs", "logic-maps"))).toEqual([mapName]);
  });

  test("turning it on twice keeps the same map", async () => {
    const scenario = await startDaemon();
    const agent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });

    const first = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: true,
    });
    const second = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: true,
    });

    expect(second.mapName).toBe(first.mapName);
    expect(await readdir(path.join(scenario.cwd, "docs", "logic-maps"))).toEqual([first.mapName]);
  });

  test("a draft gets a new map first, and the agent created from it carries the map into its first message", async () => {
    const scenario = await startDaemon();

    const workspaceId = await openWorkspace(scenario);
    const { mapName } = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "draft", workspaceId },
      enabled: true,
    });
    const agent = await scenario.client.createAgent({
      provider: "codex",
      cwd: scenario.cwd,
      initialPrompt: "sketch the checkout flow",
      clientMessageId: "first-message",
      labels: { [LOGIC_MAP_LABEL]: mapName! },
    });
    await scenario.client.waitForFinish(agent.id, WAIT_MS);

    expect(await readSkeleton(scenario.cwd, mapName!)).toMatchObject({ nodes: [] });
    expect(await agentLogicMap(scenario, agent.id)).toBe(mapName);
    expect(scenario.prompts[0]).toMatch(
      new RegExp(`^sketch the checkout flow\\n\\n<paseo-system>\\n${BLOCK_INTRO}`),
    );
    expect(await userMessages(scenario, agent.id)).toEqual(["sketch the checkout flow"]);
  });

  test("a new conversation continues a map an earlier one left, without creating another", async () => {
    const scenario = await startDaemon();
    const workspaceId = await openWorkspace(scenario);
    const earlier = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const { mapName } = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: earlier.id },
      enabled: true,
    });
    const later = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });

    const forAgent = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: later.id },
      enabled: true,
      mapName: mapName!,
    });
    const forDraft = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "draft", workspaceId },
      enabled: true,
      mapName: mapName!,
    });
    await sendAndFinish(scenario, later.id, "add the lockout rule");

    expect(forAgent.mapName).toBe(mapName);
    expect(forDraft.mapName).toBe(mapName);
    expect(await agentLogicMap(scenario, later.id)).toBe(mapName);
    expect(await readdir(path.join(scenario.cwd, "docs", "logic-maps"))).toEqual([mapName]);
    expect(scenario.prompts[0]).toContain(`docs/logic-maps/${mapName}/`);
  });

  test("an agent already on switches to the map it is told to continue", async () => {
    const scenario = await startDaemon();
    const agent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const other = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const { mapName: otherMap } = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: other.id },
      enabled: true,
    });
    await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: true,
    });

    const result = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: true,
      mapName: otherMap!,
    });

    expect(result.mapName).toBe(otherMap);
    expect(await agentLogicMap(scenario, agent.id)).toBe(otherMap);
  });

  test("continuing a map that is not in the workspace is a readable error and changes nothing", async () => {
    const scenario = await startDaemon();
    const workspaceId = await openWorkspace(scenario);
    const agent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });

    await expect(
      scenario.client.setAgentLogicMapEnabled({
        target: { kind: "agent", agentId: agent.id },
        enabled: true,
        mapName: "deleted-map",
      }),
    ).rejects.toThrow('Logic map "deleted-map" is not in this workspace any more');
    await expect(
      scenario.client.setAgentLogicMapEnabled({
        target: { kind: "draft", workspaceId },
        enabled: true,
        mapName: "../outside",
      }),
    ).rejects.toThrow('Logic map "../outside" is not in this workspace any more');

    expect(await agentLogicMap(scenario, agent.id)).toBeNull();
    await expect(readdir(path.join(scenario.cwd, "docs"))).rejects.toThrow(/ENOENT/);
  });

  test("a draft turned off creates nothing", async () => {
    const scenario = await startDaemon();

    const workspaceId = await openWorkspace(scenario);
    const result = await scenario.client.setAgentLogicMapEnabled({
      target: { kind: "draft", workspaceId },
      enabled: false,
    });

    expect(result.mapName).toBeNull();
    await expect(readdir(path.join(scenario.cwd, "docs"))).rejects.toThrow(/ENOENT/);
  });

  test("an unknown agent is a readable error", async () => {
    const scenario = await startDaemon();

    await expect(
      scenario.client.setAgentLogicMapEnabled({
        target: { kind: "agent", agentId: "00000000-0000-4000-8000-000000000000" },
        enabled: true,
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("a draft in a workspace the daemon does not know is a readable error and creates nothing", async () => {
    const scenario = await startDaemon();

    await expect(
      scenario.client.setAgentLogicMapEnabled({
        target: { kind: "draft", workspaceId: "workspace-that-does-not-exist" },
        enabled: true,
      }),
    ).rejects.toThrow(/Workspace not found: workspace-that-does-not-exist/);
    await expect(readdir(path.join(scenario.cwd, "docs"))).rejects.toThrow(/ENOENT/);
  });

  test("the toggle survives a daemon restart", async () => {
    const paseoHomeRoot = await makeTempDir("paseo-logic-map-home-");
    const first = await startDaemon({ paseoHomeRoot });
    const agent = await first.client.createAgent({ provider: "codex", cwd: first.cwd });
    const { mapName } = await first.client.setAgentLogicMapEnabled({
      target: { kind: "agent", agentId: agent.id },
      enabled: true,
    });
    await first.client.close();
    await first.daemon.close();

    const second = await startDaemon({ cwd: first.cwd, paseoHomeRoot });
    await sendAndFinish(second, agent.id, "continue");

    expect(await agentLogicMap(second, agent.id)).toBe(mapName);
    expect(second.prompts[0]).toContain(`docs/logic-maps/${mapName}/`);
  });
});
