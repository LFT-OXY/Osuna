import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { LOGIC_MAP_BRIEFED_LABEL, LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";

import { stripTrailingRoutingBlock } from "../agent/trailing-routing-block.js";
import { resolveLogicMapInstructionBlock } from "./logic-map-instruction-block.js";
import type { LogicMapOperation } from "./logic-map-operations.js";
import { createEmptyLogicMap, updateLogicMap } from "./logic-map-store.js";
import { READ_LOGIC_MAP_TOOL, UPDATE_LOGIC_MAP_TOOL } from "./logic-map-tools.js";

const JUDGE_FRAMEWORK = "First judge whether this project has a spec framework";
const LINK_PENDING_FIRST = "Before you continue the conversation";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 一个 workspace 目录和其中一张新建的空图。 */
async function workspaceWithMap(): Promise<{ cwd: string; mapName: string }> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-logic-map-block-"));
  tempDirs.push(cwd);
  return { cwd, mapName: await createEmptyLogicMap(cwd) };
}

function labelsFor(mapName: string): Record<string, string> {
  return { [LOGIC_MAP_LABEL]: mapName };
}

const LOGIN_NODES: LogicMapOperation[] = [
  { op: "set_title", title: "Login" },
  { op: "add_node", id: "start", title: "Open the page", kind: "start" },
  { op: "add_node", id: "check", title: "Check the password", kind: "step" },
  { op: "add_edge", from: "start", to: "check" },
];

test("an agent with the logic map on gets a block naming its map and the rules", async () => {
  const { cwd, mapName } = await workspaceWithMap();

  const block = await resolveLogicMapInstructionBlock({
    text: "add login",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(block).toMatch(/^<paseo-system>\n[\s\S]*\n<\/paseo-system>$/);
  expect(block).toContain(`"${mapName}"`);
  expect(block).toContain(`docs/logic-maps/${mapName}/`);
  expect(block).toContain("One node is one thing that can be explained, built, and accepted");
  expect(block).toContain("7 to 20 nodes");
  expect(block).toContain("subgraph node");
  expect(block).toContain("every branch, including the failure branch");
  expect(block).toContain("which nodes you added, changed, and removed");
  expect(block).toContain(`\`${READ_LOGIC_MAP_TOOL}\` tool`);
  expect(block).toContain(`\`${UPDATE_LOGIC_MAP_TOOL}\` tool`);
});

test("a map nobody has judged yet asks the agent to judge the spec framework first and tell the user", async () => {
  const { cwd, mapName } = await workspaceWithMap();

  const block = await resolveLogicMapInstructionBlock({
    text: "add login",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(block).toContain(JUDGE_FRAMEWORK);
  expect(block).toContain("`set_spec_framework`");
  expect(block).toContain("tell the user what you judged and where the node docs will point");
  expect(block).toContain("If the user corrects the judgment");
  expect(block).not.toContain(LINK_PENDING_FIRST);
});

test("the first message after switching on to a spec framework map gets interim summaries and links marked nodes first", async () => {
  const { cwd, mapName } = await workspaceWithMap();
  await updateLogicMap({ cwd, mapName }, [
    ...LOGIN_NODES,
    { op: "set_spec_framework", framework: { kind: "present", docsPath: ".atw/tasks" } },
    { op: "write_node_doc", id: "start", content: "Interim summary." },
    { op: "write_node_doc", id: "check", content: "Interim summary." },
  ]);

  const block = await resolveLogicMapInstructionBlock({
    text: "continue",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(block).not.toContain(JUDGE_FRAMEWORK);
  expect(block).toContain("This project has a spec framework; its docs are at .atw/tasks.");
  expect(block).toContain("3 to 6 sentences");
  expect(block).toContain("`link_node_doc`");
  expect(block).toContain("If the user corrects the judgment");
  expect(block).toContain(LINK_PENDING_FIRST);
  expect(block).toContain('"start", "check"');
});

test("later messages on a map with marked nodes do not ask to link them first again", async () => {
  const { cwd, mapName } = await workspaceWithMap();
  await updateLogicMap({ cwd, mapName }, [
    ...LOGIN_NODES,
    { op: "set_spec_framework", framework: { kind: "present", docsPath: ".atw/tasks" } },
    { op: "write_node_doc", id: "start", content: "Interim summary." },
  ]);

  const block = await resolveLogicMapInstructionBlock({
    text: "continue",
    labels: { ...labelsFor(mapName), [LOGIC_MAP_BRIEFED_LABEL]: mapName },
    cwd,
  });

  expect(block).toContain("3 to 6 sentences");
  expect(block).not.toContain(LINK_PENDING_FIRST);
});

test("a spec framework map whose nodes all point at the final docs has no link-first instruction", async () => {
  const { cwd, mapName } = await workspaceWithMap();
  await mkdir(path.join(cwd, "spec"));
  await writeFile(path.join(cwd, "spec", "prd.md"), "# Login\n\n## Open\n\n## Check\n");
  await updateLogicMap({ cwd, mapName }, [
    ...LOGIN_NODES,
    { op: "set_spec_framework", framework: { kind: "present", docsPath: "spec" } },
    { op: "link_node_doc", id: "start", path: "spec/prd.md", heading: "Open" },
    { op: "link_node_doc", id: "check", path: "spec/prd.md", heading: "Check" },
  ]);

  const block = await resolveLogicMapInstructionBlock({
    text: "continue",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(block).toContain("This project has a spec framework; its docs are at spec.");
  expect(block).not.toContain(LINK_PENDING_FIRST);
});

test("a project without a spec framework gets a complete node doc for every node", async () => {
  const { cwd, mapName } = await workspaceWithMap();
  await updateLogicMap({ cwd, mapName }, [
    ...LOGIN_NODES,
    { op: "set_spec_framework", framework: { kind: "none" } },
    { op: "write_node_doc", id: "start", content: "Full doc." },
  ]);

  const block = await resolveLogicMapInstructionBlock({
    text: "continue",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(block).not.toContain(JUDGE_FRAMEWORK);
  expect(block).toContain("This project has no spec framework.");
  expect(block).toContain("complete node doc");
  expect(block).toContain("If the user corrects the judgment");
  expect(block).not.toContain(LINK_PENDING_FIRST);
});

test("a map whose files are broken still gets the block, telling the agent which file and what is wrong", async () => {
  const { cwd, mapName } = await workspaceWithMap();
  await writeFile(path.join(cwd, "docs", "logic-maps", mapName, "map.json"), "{ broken");

  const block = await resolveLogicMapInstructionBlock({
    text: "continue",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(block).toContain(`docs/logic-maps/${mapName}/map.json`);
  expect(block).toContain("not valid JSON");
  expect(block).toContain("tell the user");
  expect(block).not.toContain(JUDGE_FRAMEWORK);
});

test("a map whose folder was deleted still gets the block, telling the agent the folder is gone", async () => {
  const { cwd, mapName } = await workspaceWithMap();
  await rm(path.join(cwd, "docs", "logic-maps", mapName), { recursive: true });

  const block = await resolveLogicMapInstructionBlock({
    text: "continue",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(block).toContain(`docs/logic-maps/${mapName}/ is missing from this workspace`);
  expect(block).not.toContain(JUDGE_FRAMEWORK);
});

test("an agent with the logic map off gets no block", async () => {
  const { cwd } = await workspaceWithMap();

  expect(await resolveLogicMapInstructionBlock({ text: "add login", labels: {}, cwd })).toBeNull();
});

test("a message with no text of its own gets no block, so it never turns into an envelope", async () => {
  const { cwd, mapName } = await workspaceWithMap();

  expect(
    await resolveLogicMapInstructionBlock({ text: "  \n", labels: labelsFor(mapName), cwd }),
  ).toBeNull();
});

test("the block is dropped again from the provider's echo of the message", async () => {
  const { cwd, mapName } = await workspaceWithMap();
  const block = await resolveLogicMapInstructionBlock({
    text: "add login",
    labels: labelsFor(mapName),
    cwd,
  });

  expect(stripTrailingRoutingBlock(`add login\n\n${block}`)).toBe("add login");
});
