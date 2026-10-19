import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "../agent/agent-manager.js";
import { AgentStorage } from "../agent/agent-storage.js";
import { createAgentMcpServer } from "../agent/mcp-server.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createProviderSnapshotManagerStub } from "../test-utils/session-stubs.js";
import type { LogicMapChangedEvent } from "./logic-map-store.js";
import { createEmptyLogicMap } from "./logic-map-store.js";

const WORKSPACE_ID = "wks_logic_map";
const logger = createTestLogger();

interface Harness {
  cwd: string;
  mapName: string;
  changes: LogicMapChangedEvent[];
  agentManager: AgentManager;
  storage: AgentStorage;
}

interface ToolOutcome {
  isError: boolean;
  text: string;
  structured: Record<string, unknown> | undefined;
}

const harnesses: Harness[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.agentManager.flush();
    await harness.storage.flush();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setUp(): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-logic-map-tools-"));
  tempDirs.push(root);
  const cwd = path.join(root, "workspace");
  await mkdir(cwd);
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const agentManager = new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
  const mapName = await createEmptyLogicMap(cwd);
  const harness = { cwd, mapName, changes: [], agentManager, storage };
  harnesses.push(harness);
  return harness;
}

async function connectAgent(
  harness: Harness,
  input: { logicMap: boolean } = { logicMap: true },
): Promise<Client> {
  const agent = await harness.agentManager.createAgent(
    { provider: "codex", cwd: harness.cwd },
    undefined,
    {
      workspaceId: WORKSPACE_ID,
      ...(input.logicMap ? { labels: { [LOGIC_MAP_LABEL]: harness.mapName } } : {}),
    },
  );
  const server = await createAgentMcpServer({
    agentManager: harness.agentManager,
    agentStorage: harness.storage,
    callerAgentId: agent.id,
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    onLogicMapChanged: (event) => harness.changes.push(event),
    logger,
  });
  const client = new Client({ name: "logic-map-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args });
  const content = z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .parse(result.content);
  return {
    isError: result.isError === true,
    text: content.map((block) => block.text ?? "").join("\n"),
    structured: result.structuredContent as Record<string, unknown> | undefined,
  };
}

function update(client: Client, operations: unknown[]): Promise<ToolOutcome> {
  return callTool(client, "update_logic_map", { operations });
}

function mapDir(harness: Harness): string {
  return path.join(harness.cwd, "docs", "logic-maps", harness.mapName);
}

async function readSkeleton(harness: Harness): Promise<unknown> {
  return JSON.parse(await readFile(path.join(mapDir(harness), "map.json"), "utf8"));
}

/** 图文件夹里每个文件的内容，用来确认被拒绝的更新一个字节都没动。 */
async function snapshotMapFolder(harness: Harness): Promise<Record<string, string>> {
  const files = (await readdir(mapDir(harness))).sort();
  const entries = await Promise.all(
    files.map(async (file) => [file, await readFile(path.join(mapDir(harness), file), "utf8")]),
  );
  return Object.fromEntries(entries);
}

const TITLE = { op: "set_title", title: "Password login" };
const LOGIN_FLOW = [
  TITLE,
  { op: "add_node", id: "start", title: "Open the login page", kind: "start" },
  { op: "add_node", id: "check", title: "Check the password", kind: "decision" },
  { op: "add_node", id: "home", title: "Show the home page", kind: "end" },
  { op: "add_node", id: "locked", title: "Lock the account", kind: "end", failure: true },
  { op: "add_edge", from: "start", to: "check" },
  { op: "add_edge", from: "check", to: "home", condition: "Password matches" },
  { op: "add_edge", from: "check", to: "locked", condition: "Wrong 5 times" },
];

function node(id: string, title: string, kind: string, extra: Record<string, unknown> = {}) {
  return { id, title, kind, parentId: null, failure: false, doc: null, ...extra };
}

describe("update_logic_map", () => {
  test("a valid batch is written to the skeleton and node docs, announced, and read back", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);

    const result = await update(client, [
      ...LOGIN_FLOW,
      { op: "write_node_doc", id: "check", content: "# Check the password\n\nCompare hashes.\n" },
    ]);

    expect(result.isError).toBe(false);
    expect(result.structured).toEqual({ mapName: harness.mapName, warnings: [] });
    const expected = {
      title: "Password login",
      specFramework: null,
      nodes: [
        node("start", "Open the login page", "start"),
        node("check", "Check the password", "decision", {
          doc: { kind: "own", file: "check.md", pendingLink: false },
        }),
        node("home", "Show the home page", "end"),
        node("locked", "Lock the account", "end", { failure: true }),
      ],
      edges: [
        { from: "start", to: "check", condition: null },
        { from: "check", to: "home", condition: "Password matches" },
        { from: "check", to: "locked", condition: "Wrong 5 times" },
      ],
    };
    expect(await readSkeleton(harness)).toEqual(expected);
    expect(await readFile(path.join(mapDir(harness), "check.md"), "utf8")).toBe(
      "# Check the password\n\nCompare hashes.\n",
    );
    expect(harness.changes).toEqual([{ workspaceId: WORKSPACE_ID, mapName: harness.mapName }]);
    const read = await callTool(client, "read_logic_map", {});
    expect(read.structured).toEqual({ mapName: harness.mapName, map: expected });
  });

  test.each([
    {
      rule: "a node id is used twice",
      operations: [...LOGIN_FLOW, { op: "add_node", id: "home", title: "Again", kind: "step" }],
      message: /node "home" already exists/,
    },
    {
      rule: "a line ends at a node that does not exist",
      operations: [...LOGIN_FLOW, { op: "add_edge", from: "home", to: "nowhere" }],
      message: /line home → nowhere: node "nowhere" does not exist/,
    },
    {
      rule: "a decision has fewer than two lines with a condition",
      operations: [
        TITLE,
        { op: "add_node", id: "check", title: "Check", kind: "decision" },
        { op: "add_node", id: "home", title: "Home", kind: "end" },
        { op: "add_edge", from: "check", to: "home", condition: "OK" },
      ],
      message: /decision "check" needs at least two outgoing lines with a condition, it has 1/,
    },
    {
      rule: "a node points at a file that does not exist",
      operations: [
        ...LOGIN_FLOW,
        { op: "link_node_doc", id: "check", path: "docs/prd.md", heading: "Password" },
      ],
      message: /node "check": docs\/prd\.md does not exist/,
    },
    {
      rule: "a node points at a file outside the workspace",
      operations: [
        ...LOGIN_FLOW,
        { op: "link_node_doc", id: "check", path: "../outside.md", heading: "Password" },
      ],
      message: /node "check": \.\.\/outside\.md is outside the workspace/,
    },
    {
      rule: "the first update gives the map no title",
      operations: LOGIN_FLOW.slice(1),
      message: /set_title/,
    },
    {
      rule: "a line joins nodes in different layers",
      operations: [
        ...LOGIN_FLOW,
        { op: "add_node", id: "sms", title: "SMS login", kind: "subgraph" },
        { op: "add_node", id: "send", title: "Send the code", kind: "step", parentId: "sms" },
        { op: "add_edge", from: "home", to: "send" },
      ],
      message: /line home → send: both ends must be in the same layer/,
    },
    {
      rule: "a node sits inside a node that is not a subgraph",
      operations: [
        ...LOGIN_FLOW,
        { op: "add_node", id: "send", title: "Send the code", kind: "step", parentId: "home" },
      ],
      message: /node "send": parent "home" is not a subgraph node/,
    },
  ])("rejects the whole batch when $rule", async ({ operations, message }) => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    const before = await snapshotMapFolder(harness);

    const result = await update(client, operations);

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(message);
    expect(await snapshotMapFolder(harness)).toEqual(before);
    expect(harness.changes).toEqual([]);
  });

  test("a batch that turns invalid halfway leaves the earlier map and its docs untouched", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await update(client, [...LOGIN_FLOW, { op: "write_node_doc", id: "home", content: "Home" }]);
    const before = await snapshotMapFolder(harness);

    const result = await update(client, [
      { op: "update_node", id: "home", title: "Dashboard" },
      { op: "write_node_doc", id: "home", content: "Rewritten" },
      { op: "remove_node", id: "locked" },
    ]);

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/decision "check" needs at least two outgoing lines/);
    expect(await snapshotMapFolder(harness)).toEqual(before);
    expect(harness.changes).toHaveLength(1);
  });

  test("two conversations updating the same map at once both keep their changes", async () => {
    const harness = await setUp();
    const first = await connectAgent(harness);
    const second = await connectAgent(harness);
    await update(first, LOGIN_FLOW);

    const results = await Promise.all([
      update(first, [{ op: "add_node", id: "forgot", title: "Reset password", kind: "step" }]),
      update(second, [{ op: "add_node", id: "signup", title: "Sign up", kind: "step" }]),
    ]);

    expect(results.map((result) => result.isError)).toEqual([false, false]);
    const skeleton = z
      .object({ nodes: z.array(z.object({ id: z.string() })) })
      .parse(await readSkeleton(harness));
    expect(skeleton.nodes.map((entry) => entry.id).sort()).toEqual(
      ["check", "forgot", "home", "locked", "signup", "start"].sort(),
    );
  });

  test("pointing a node at an external doc deletes its own doc file", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await mkdir(path.join(harness.cwd, "docs", "spec"), { recursive: true });
    await writeFile(
      path.join(harness.cwd, "docs", "spec", "prd.md"),
      "# Login\n\n## Password check\n\nRules.\n",
    );
    await update(client, [
      ...LOGIN_FLOW,
      { op: "set_spec_framework", framework: { kind: "present", docsPath: "docs/spec" } },
      { op: "write_node_doc", id: "check", content: "Interim summary." },
    ]);
    expect(await readSkeleton(harness)).toMatchObject({
      specFramework: { kind: "present", docsPath: "docs/spec" },
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "check",
          doc: { kind: "own", file: "check.md", pendingLink: true },
        }),
      ]),
    });

    const result = await update(client, [
      {
        op: "link_node_doc",
        id: "check",
        path: "docs/spec/prd.md",
        heading: "## Password check",
      },
    ]);

    expect(result.isError).toBe(false);
    expect(await readSkeleton(harness)).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "check",
          doc: { kind: "external", path: "docs/spec/prd.md", heading: "Password check" },
        }),
      ]),
    });
    expect(await readdir(mapDir(harness))).toEqual(["map.json"]);
  });

  test("the not-yet-linked mark follows the spec framework judgement and the doc source", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await writeFile(path.join(harness.cwd, "prd.md"), "# Password check\n");
    async function marks(): Promise<Record<string, unknown>> {
      const skeleton = z
        .object({ nodes: z.array(z.object({ id: z.string(), doc: z.unknown() })) })
        .parse(await readSkeleton(harness));
      return Object.fromEntries(skeleton.nodes.map((entry) => [entry.id, entry.doc]));
    }
    const own = (file: string, pendingLink: boolean) => ({ kind: "own", file, pendingLink });

    await update(client, [
      ...LOGIN_FLOW,
      { op: "write_node_doc", id: "start", content: "Start." },
      { op: "write_node_doc", id: "check", content: "Check." },
    ]);
    expect(await marks()).toMatchObject({
      start: own("start.md", false),
      check: own("check.md", false),
    });

    await update(client, [
      { op: "set_spec_framework", framework: { kind: "present", docsPath: "docs" } },
    ]);
    expect(await marks()).toMatchObject({
      start: own("start.md", true),
      check: own("check.md", true),
    });

    await update(client, [
      { op: "link_node_doc", id: "check", path: "prd.md", heading: "Password check" },
    ]);
    expect(await marks()).toMatchObject({
      start: own("start.md", true),
      check: { kind: "external", path: "prd.md", heading: "Password check" },
    });

    await update(client, [{ op: "set_spec_framework", framework: { kind: "none" } }]);
    expect(await marks()).toMatchObject({ start: own("start.md", false) });
  });

  test("a write that fails halfway rolls back the docs it already wrote", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await update(client, LOGIN_FLOW);
    const before = await snapshotMapFolder(harness);
    // 文件名本身合法，但写入时的临时文件名超过系统上限，第二份文档在真实磁盘上写失败。
    const longId = "n".repeat(240);

    const result = await update(client, [
      { op: "write_node_doc", id: "home", content: "Home." },
      { op: "add_node", id: longId, title: "Long", kind: "step" },
      { op: "write_node_doc", id: longId, content: "Long." },
    ]);

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/ENAMETOOLONG/);
    expect(await snapshotMapFolder(harness)).toEqual(before);
    expect(harness.changes).toHaveLength(1);
  });

  test.each([
    {
      name: "a setext heading",
      markdown: "Intro\n\nPassword check\n---\n",
      heading: "Password check",
    },
    {
      name: "a level-one setext heading",
      markdown: "Password check\n===\n",
      heading: "Password check",
    },
    {
      name: "a heading with inline code",
      markdown: "## Check the `password` field\n",
      heading: "Check the password field",
    },
    {
      name: "a heading with a link",
      markdown: "## Check against [the spec](spec.md)\n",
      heading: "Check against the spec",
    },
    {
      name: "a heading quoted with its markup",
      markdown: "## Check against [the spec](spec.md)\n",
      heading: "## Check against [the spec](spec.md)",
    },
  ])("links to $name", async ({ markdown, heading }) => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await writeFile(path.join(harness.cwd, "prd.md"), markdown);

    const result = await update(client, [
      ...LOGIN_FLOW,
      { op: "link_node_doc", id: "check", path: "prd.md", heading },
    ]);

    expect(result.text).not.toMatch(/rejected/);
    expect(result.isError).toBe(false);
  });

  test("a heading-looking line inside a code block is not a heading", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await writeFile(path.join(harness.cwd, "prd.md"), "# Login\n\n```\n# Password check\n```\n");

    const result = await update(client, [
      ...LOGIN_FLOW,
      { op: "link_node_doc", id: "check", path: "prd.md", heading: "Password check" },
    ]);

    expect(result.text).toMatch(/prd\.md has no heading "Password check"/);
  });

  test("a linked path that is a folder is rejected as not a file", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await mkdir(path.join(harness.cwd, "specs"));

    const result = await update(client, [
      ...LOGIN_FLOW,
      { op: "link_node_doc", id: "check", path: "specs", heading: "Password check" },
    ]);

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/node "check": specs is a folder, not a file/);
  });

  test("a heading the linked file does not have is rejected", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await writeFile(path.join(harness.cwd, "prd.md"), "# Login\n");

    const result = await update(client, [
      ...LOGIN_FLOW,
      { op: "link_node_doc", id: "check", path: "prd.md", heading: "Password check" },
    ]);

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/node "check": prd\.md has no heading "Password check"/);
  });

  test("an agent with the logic map off is refused and nothing is written", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness, { logicMap: false });
    const before = await snapshotMapFolder(harness);

    const result = await update(client, LOGIN_FLOW);

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/logic map is off/i);
    expect(await snapshotMapFolder(harness)).toEqual(before);
    expect(harness.changes).toEqual([]);
  });

  test("a layer with more than 20 nodes is written with a reminder to use a subgraph", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    const steps = Array.from({ length: 21 }, (_, index) => ({
      op: "add_node",
      id: `step-${index + 1}`,
      title: `Step ${index + 1}`,
      kind: "step",
    }));

    const result = await update(client, [TITLE, ...steps]);

    expect(result.isError).toBe(false);
    expect(result.structured).toEqual({
      mapName: harness.mapName,
      warnings: [
        "The top layer has 21 nodes. Keep a layer to about 7 to 20 nodes: move some into a subgraph node.",
      ],
    });
    expect(await readSkeleton(harness)).toMatchObject({
      nodes: expect.arrayContaining([expect.objectContaining({ id: "step-21" })]),
    });
  });
});

describe("read_logic_map", () => {
  test.each([
    { problem: "an empty node id", node: { id: "", title: "A" }, message: /nodes\.0\.id: / },
    { problem: "an empty node title", node: { id: "a", title: "" }, message: /nodes\.0\.title: / },
    {
      problem: "a field the map format does not have",
      node: { id: "a", title: "A", colour: "red" },
      message: /nodes\.0: .*colour/,
    },
  ])("a map file with $problem is reported as broken", async ({ node: written, message }) => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await writeFile(
      path.join(mapDir(harness), "map.json"),
      JSON.stringify({
        title: "x",
        specFramework: null,
        nodes: [{ kind: "step", parentId: null, doc: null, ...written }],
        edges: [],
      }),
    );

    const result = await callTool(client, "read_logic_map", {});

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(message);
  });

  test("a node written without the failure flag reads back as not failing", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await writeFile(
      path.join(mapDir(harness), "map.json"),
      JSON.stringify({
        title: "x",
        specFramework: null,
        nodes: [{ id: "a", title: "A", kind: "step", parentId: null, doc: null }],
        edges: [],
      }),
    );

    const result = await callTool(client, "read_logic_map", {});

    expect(result.structured).toMatchObject({ map: { nodes: [{ id: "a", failure: false }] } });
  });

  test("a map file broken by hand is a readable error naming the map, the file and the problem", async () => {
    const harness = await setUp();
    const client = await connectAgent(harness);
    await writeFile(path.join(mapDir(harness), "map.json"), '{"title": "x", "nodes": [');

    const result = await callTool(client, "read_logic_map", {});

    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      `Logic map "${harness.mapName}" is broken: docs/logic-maps/${harness.mapName}/map.json`,
    );
    expect(result.text).toMatch(/not valid JSON/);
  });
});
