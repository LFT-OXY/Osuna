import { expect, test } from "vitest";
import { LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";

import { stripTrailingRoutingBlock } from "../agent/trailing-routing-block.js";
import { resolveLogicMapInstructionBlock } from "./logic-map-instruction-block.js";
import { READ_LOGIC_MAP_TOOL, UPDATE_LOGIC_MAP_TOOL } from "./logic-map-tools.js";

const LABELS = { [LOGIC_MAP_LABEL]: "untitled-1a2b3c4d" };

test("an agent with the logic map on gets a block naming its map and the rules", () => {
  const block = resolveLogicMapInstructionBlock({ text: "add login", labels: LABELS });

  expect(block).toMatch(/^<paseo-system>\n[\s\S]*\n<\/paseo-system>$/);
  expect(block).toContain('"untitled-1a2b3c4d"');
  expect(block).toContain("docs/logic-maps/untitled-1a2b3c4d/");
  expect(block).toContain("One node is one thing that can be explained, built, and accepted");
  expect(block).toContain("7 to 20 nodes");
  expect(block).toContain("subgraph node");
  expect(block).toContain("every branch, including the failure branch");
  expect(block).toContain("which nodes you added, changed, and removed");
});

test("the block names the tools the agent reads and updates the map with", () => {
  const block = resolveLogicMapInstructionBlock({ text: "add login", labels: LABELS });

  expect(block).toContain(`\`${READ_LOGIC_MAP_TOOL}\` tool`);
  expect(block).toContain(`\`${UPDATE_LOGIC_MAP_TOOL}\` tool`);
});

test("an agent with the logic map off gets no block", () => {
  expect(resolveLogicMapInstructionBlock({ text: "add login", labels: {} })).toBeNull();
});

test("a message with no text of its own gets no block, so it never turns into an envelope", () => {
  expect(resolveLogicMapInstructionBlock({ text: "  \n", labels: LABELS })).toBeNull();
});

test("the block is dropped again from the provider's echo of the message", () => {
  const block = resolveLogicMapInstructionBlock({ text: "add login", labels: LABELS });

  expect(stripTrailingRoutingBlock(`add login\n\n${block}`)).toBe("add login");
});
