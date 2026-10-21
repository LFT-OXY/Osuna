import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const tempDirs: string[] = [];
const daemons: TestPaseoDaemon[] = [];
const closers: Array<() => Promise<void>> = [];

interface Scenario {
  daemon: TestPaseoDaemon;
  client: DaemonClient;
  cwd: string;
  workspaceId: string;
  agentId: string;
  mapName: string;
  changes: SessionOutboundMessage[];
}

async function start(): Promise<Scenario> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-logic-map-tools-ws-"));
  tempDirs.push(cwd);
  const daemon = await createTestPaseoDaemon({
    agentClients: { codex: createTestAgentClient("codex") },
  });
  daemons.push(daemon);
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  closers.push(() => client.close());
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  const changes: SessionOutboundMessage[] = [];
  await client.observeEvents(["workspace.logic_map.changed"]);
  client.on("workspace.logic_map.changed", (message) => changes.push(message));

  const agent = await client.createAgent({ provider: "codex", cwd });
  const { mapName } = await client.setAgentLogicMapEnabled({
    target: { kind: "agent", agentId: agent.id },
    enabled: true,
  });
  if (!mapName || !agent.workspaceId) throw new Error("Expected a map and a workspace");
  return {
    daemon,
    client,
    cwd,
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    mapName,
    changes,
  };
}

async function connectAgentMcp(scenario: Scenario): Promise<Client> {
  const url = new URL(`http://127.0.0.1:${scenario.daemon.port}/mcp/agents`);
  url.searchParams.set("callerAgentId", scenario.agentId);
  const mcp = new Client({ name: "logic-map-e2e", version: "0.0.0" });
  await mcp.connect(new StreamableHTTPClientTransport(url));
  closers.push(() => mcp.close());
  return mcp;
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close().catch(() => undefined)));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Logic map tools and reads", () => {
  test("an agent's update reaches the client as a change event, a listing and a read", async () => {
    const scenario = await start();
    const mcp = await connectAgentMcp(scenario);

    const result = await mcp.callTool({
      name: "update_logic_map",
      arguments: {
        operations: [
          { op: "set_title", title: "Checkout" },
          { op: "add_node", id: "cart", title: "Review the cart", kind: "start" },
          { op: "add_node", id: "pay", title: "Pay", kind: "end" },
          { op: "add_edge", from: "cart", to: "pay" },
        ],
      },
    });

    expect(result.isError).not.toBe(true);
    await expect.poll(() => scenario.changes).toHaveLength(1);
    expect(scenario.changes[0]).toMatchObject({
      type: "workspace.logic_map.changed",
      payload: { workspaceId: scenario.workspaceId, mapName: scenario.mapName },
    });
    expect(await scenario.client.listWorkspaceLogicMaps(scenario.workspaceId)).toEqual([
      { name: scenario.mapName, title: "Checkout" },
    ]);
    expect(
      await scenario.client.getWorkspaceLogicMap({
        workspaceId: scenario.workspaceId,
        mapName: scenario.mapName,
      }),
    ).toEqual({
      kind: "ok",
      map: {
        title: "Checkout",
        specFramework: null,
        nodes: [
          {
            id: "cart",
            title: "Review the cart",
            kind: "start",
            parentId: null,
            failure: false,
            doc: null,
          },
          { id: "pay", title: "Pay", kind: "end", parentId: null, failure: false, doc: null },
        ],
        edges: [{ from: "cart", to: "pay", condition: null }],
      },
    });
  });

  test("a map file broken by hand reads back as which map, which file and what problem", async () => {
    const scenario = await start();
    await writeFile(
      path.join(scenario.cwd, "docs", "logic-maps", scenario.mapName, "map.json"),
      JSON.stringify({ title: "x", specFramework: null, nodes: [{ id: "a" }], edges: [] }),
    );

    const result = await scenario.client.getWorkspaceLogicMap({
      workspaceId: scenario.workspaceId,
      mapName: scenario.mapName,
    });

    expect(result).toMatchObject({
      kind: "corrupt",
      file: `docs/logic-maps/${scenario.mapName}/map.json`,
    });
    expect(result.kind === "corrupt" ? result.problem : "").toMatch(/^nodes\.0\.title: /);
    expect(await scenario.client.listWorkspaceLogicMaps(scenario.workspaceId)).toEqual([
      { name: scenario.mapName, title: null },
    ]);
  });

  test("a map or workspace that does not exist is a readable error", async () => {
    const scenario = await start();

    expect(
      await scenario.client.getWorkspaceLogicMap({
        workspaceId: scenario.workspaceId,
        mapName: "missing",
      }),
    ).toEqual({ kind: "error", message: "Logic map not found: missing" });
    expect(
      await scenario.client.getWorkspaceLogicMap({
        workspaceId: scenario.workspaceId,
        mapName: "../../etc",
      }),
    ).toEqual({ kind: "error", message: "Logic map not found: ../../etc" });
    await expect(scenario.client.listWorkspaceLogicMaps("no-such-workspace")).rejects.toThrow(
      /Workspace not found: no-such-workspace/,
    );
  });
});
