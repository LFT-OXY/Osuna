import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { PARENT_AGENT_ID_LABEL, PARENT_TOOL_CALL_ID_LABEL } from "@osuna/protocol/agent-labels";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOsunaDaemon, type TestOsunaDaemon } from "../test-utils/osuna-daemon.js";

const tempDirs: string[] = [];
let daemon: TestOsunaDaemon | null = null;
let client: DaemonClient | null = null;
let mcpClient: Client | null = null;

async function startDaemon(): Promise<{
  daemon: TestOsunaDaemon;
  client: DaemonClient;
  cwd: string;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "osuna-subagent-call-links-"));
  tempDirs.push(cwd);
  daemon = await createTestOsunaDaemon({
    agentClients: { codex: createTestAgentClient("codex", { supportsMcpServers: true }) },
  });
  client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return { daemon, client, cwd };
}

async function connectAsParent(port: number, parentAgentId: string): Promise<Client> {
  mcpClient = new Client({ name: "subagent-call-links-test", version: "0.0.0" });
  await mcpClient.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/agents?callerAgentId=${parentAgentId}`),
    ),
  );
  return mcpClient;
}

async function createSubagent(input: {
  parent: Client;
  meta?: Record<string, unknown>;
  labels?: Record<string, string>;
}): Promise<string> {
  const result = await input.parent.callTool({
    name: "create_agent",
    arguments: {
      relationship: { kind: "subagent" },
      workspace: { kind: "current" },
      title: "Child",
      provider: "codex/gpt-5.4",
      initialPrompt: "Do work",
      ...(input.labels ? { labels: input.labels } : {}),
    },
    ...(input.meta ? { _meta: input.meta } : {}),
  });
  return z.object({ agentId: z.string() }).parse(result.structuredContent).agentId;
}

async function fetchLabels(daemonClient: DaemonClient, agentId: string) {
  const result = await daemonClient.fetchAgent(agentId);
  if (!result) throw new Error(`Agent ${agentId} not found`);
  return result.agent.labels;
}

afterEach(async () => {
  await mcpClient?.close().catch(() => undefined);
  await client?.close().catch(() => undefined);
  await daemon?.close().catch(() => undefined);
  mcpClient = null;
  client = null;
  daemon = null;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("subagent call links", () => {
  test("advertises subagentCallLinks in server_info", async () => {
    const started = await startDaemon();

    expect(started.client.getLastServerInfoMessage()?.features?.subagentCallLinks).toBe(true);
  });

  test("labels a create_agent child with the caller's tool call id and overrides the model's value", async () => {
    const started = await startDaemon();
    const parentAgent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });
    const parent = await connectAsParent(started.daemon.port, parentAgent.id);

    const childId = await createSubagent({
      parent,
      meta: { callId: "call_codex_1" },
      labels: { [PARENT_TOOL_CALL_ID_LABEL]: "call_spoofed" },
    });

    const labels = await fetchLabels(started.client, childId);
    expect(labels[PARENT_AGENT_ID_LABEL]).toBe(parentAgent.id);
    expect(labels[PARENT_TOOL_CALL_ID_LABEL]).toBe("call_codex_1");
  });

  test("writes no tool call id label when the provider sends none", async () => {
    const started = await startDaemon();
    const parentAgent = await started.client.createAgent({ provider: "codex", cwd: started.cwd });
    const parent = await connectAsParent(started.daemon.port, parentAgent.id);

    const childId = await createSubagent({
      parent,
      labels: { [PARENT_TOOL_CALL_ID_LABEL]: "call_spoofed" },
    });

    const labels = await fetchLabels(started.client, childId);
    expect(labels[PARENT_AGENT_ID_LABEL]).toBe(parentAgent.id);
    expect(labels).not.toHaveProperty(PARENT_TOOL_CALL_ID_LABEL);
  });
});
