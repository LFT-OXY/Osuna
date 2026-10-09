import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentSnapshotPayload } from "@osuna/protocol/messages";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOsunaDaemon, type TestOsunaDaemon } from "../test-utils/osuna-daemon.js";

const tempDirs: string[] = [];
let daemon: TestOsunaDaemon | null = null;
let client: DaemonClient | null = null;

async function startDaemon(
  options: Parameters<typeof createTestOsunaDaemon>[0] & {
    supportsMcpServers?: boolean;
    mcpServersDecidedPerSession?: boolean;
  },
): Promise<{ daemon: TestOsunaDaemon; client: DaemonClient; cwd: string }> {
  const { supportsMcpServers = true, mcpServersDecidedPerSession, ...daemonOptions } = options;
  const cwd = await mkdtemp(path.join(os.tmpdir(), "osuna-create-agents-cwd-"));
  tempDirs.push(cwd);
  daemon = await createTestOsunaDaemon({
    agentClients: {
      codex: createTestAgentClient("codex", { supportsMcpServers, mcpServersDecidedPerSession }),
    },
    ...daemonOptions,
  });
  client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return { daemon, client, cwd };
}

function createAgentsFields(agent: AgentSnapshotPayload) {
  return {
    canCreateAgents: agent.canCreateAgents,
    createAgentsUnavailableReason: agent.createAgentsUnavailableReason,
  };
}

/** provider 快照里 codex 条目的预测字段，新建界面据此置灰。 */
async function predictedCreateAgentsFields(daemonClient: DaemonClient, cwd: string) {
  const snapshot = await daemonClient.getProvidersSnapshot({ cwd });
  const entry = snapshot.entries.find((candidate) => candidate.provider === "codex");
  if (!entry) throw new Error("codex is missing from the provider snapshot");
  return {
    canCreateAgents: entry.canCreateAgents,
    createAgentsUnavailableReason: entry.createAgentsUnavailableReason,
  };
}

async function fetchCreateAgentsFields(daemonClient: DaemonClient, agentId: string) {
  const result = await daemonClient.fetchAgent(agentId);
  if (!result) throw new Error(`Agent ${agentId} not found`);
  return createAgentsFields(result.agent);
}

afterEach(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.close().catch(() => undefined);
  client = null;
  daemon = null;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent snapshot create-agents capability", () => {
  test("advertises agentMentions in server_info", async () => {
    const started = await startDaemon({});

    expect(started.client.getLastServerInfoMessage()?.features?.agentMentions).toBe(true);
  });

  test("a session with the internal osuna MCP server delivered can create agents", async () => {
    const started = await startDaemon({});

    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    expect(createAgentsFields(agent)).toEqual({
      canCreateAgents: true,
      createAgentsUnavailableReason: undefined,
    });
    expect(await fetchCreateAgentsFields(started.client, agent.id)).toEqual({
      canCreateAgents: true,
      createAgentsUnavailableReason: undefined,
    });
  });

  test("reports mcp_disabled when the daemon MCP endpoint is off", async () => {
    const started = await startDaemon({ mcpEnabled: false });

    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    expect(createAgentsFields(agent)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "mcp_disabled",
    });
  });

  test("reports tools_not_injected when injection into agents is off", async () => {
    const started = await startDaemon({ mcpInjectIntoAgents: false });

    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    expect(createAgentsFields(agent)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "tools_not_injected",
    });
  });

  test("reports create_agent_not_allowed when the provider policy disables create_agent", async () => {
    const started = await startDaemon({
      providerOverrides: { codex: { osunaTools: { disabledTools: ["create_agent"] } } },
    });

    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    expect(createAgentsFields(agent)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "create_agent_not_allowed",
    });
  });

  test("reports tools_not_delivered when the session cannot take MCP servers", async () => {
    const started = await startDaemon({ supportsMcpServers: false });

    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    expect(createAgentsFields(agent)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "tools_not_delivered",
    });
  });

  test("runtime config changes leave running sessions alone until they reload", async () => {
    const started = await startDaemon({});
    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    await started.client.patchDaemonConfig({ mcp: { injectIntoAgents: false } });

    expect(await fetchCreateAgentsFields(started.client, agent.id)).toEqual({
      canCreateAgents: true,
      createAgentsUnavailableReason: undefined,
    });

    await started.client.refreshAgent(agent.id);

    expect(await fetchCreateAgentsFields(started.client, agent.id)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "tools_not_injected",
    });
  });

  test("provider policy changes apply on reload", async () => {
    const started = await startDaemon({});
    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    await started.client.patchDaemonConfig({
      providers: { codex: { osunaTools: { disabledTools: ["create_agent"] } } },
    });

    expect(await fetchCreateAgentsFields(started.client, agent.id)).toEqual({
      canCreateAgents: true,
      createAgentsUnavailableReason: undefined,
    });

    await started.client.refreshAgent(agent.id);

    expect(await fetchCreateAgentsFields(started.client, agent.id)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "create_agent_not_allowed",
    });
  });
});

describe("provider snapshot create-agents prediction", () => {
  test.each([
    { name: "everything on", options: {}, expected: { canCreateAgents: true } },
    {
      name: "MCP endpoint off",
      options: { mcpEnabled: false },
      expected: { canCreateAgents: false, createAgentsUnavailableReason: "mcp_disabled" },
    },
    {
      name: "injection off",
      options: { mcpInjectIntoAgents: false },
      expected: { canCreateAgents: false, createAgentsUnavailableReason: "tools_not_injected" },
    },
    {
      name: "provider policy disables create_agent",
      options: {
        providerOverrides: { codex: { osunaTools: { disabledTools: ["create_agent"] } } },
      },
      expected: {
        canCreateAgents: false,
        createAgentsUnavailableReason: "create_agent_not_allowed",
      },
    },
    {
      name: "provider cannot take MCP servers",
      options: { supportsMcpServers: false },
      expected: { canCreateAgents: false, createAgentsUnavailableReason: "tools_not_delivered" },
    },
  ])("matches what a new session would get: $name", async ({ options, expected }) => {
    const started = await startDaemon(options);

    const predicted = await predictedCreateAgentsFields(started.client, started.cwd);
    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    expect(predicted).toEqual({ createAgentsUnavailableReason: undefined, ...expected });
    expect(createAgentsFields(agent)).toEqual(predicted);
  });

  test("makes no prediction when MCP support is decided per session, leaving it to the new session", async () => {
    const started = await startDaemon({
      supportsMcpServers: false,
      mcpServersDecidedPerSession: true,
    });

    const predicted = await predictedCreateAgentsFields(started.client, started.cwd);
    const agent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });

    expect(predicted).toEqual({
      canCreateAgents: undefined,
      createAgentsUnavailableReason: undefined,
    });
    expect(createAgentsFields(agent)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "tools_not_delivered",
    });
  });

  test("follows runtime changes to injection and provider policy", async () => {
    const started = await startDaemon({});

    await started.client.patchDaemonConfig({ mcp: { injectIntoAgents: false } });
    expect(await predictedCreateAgentsFields(started.client, started.cwd)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "tools_not_injected",
    });

    await started.client.patchDaemonConfig({
      mcp: { injectIntoAgents: true },
      providers: { codex: { osunaTools: { disabledTools: ["create_agent"] } } },
    });
    expect(await predictedCreateAgentsFields(started.client, started.cwd)).toEqual({
      canCreateAgents: false,
      createAgentsUnavailableReason: "create_agent_not_allowed",
    });

    await started.client.patchDaemonConfig({
      providers: { codex: { osunaTools: { disabledTools: [] } } },
    });
    expect(await predictedCreateAgentsFields(started.client, started.cwd)).toEqual({
      canCreateAgents: true,
      createAgentsUnavailableReason: undefined,
    });
  });
});
