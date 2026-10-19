import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";
import { LOGIC_MAPS_DIRECTORY } from "@getpaseo/protocol/logic-map-docs";
import type { LogicMapSkeleton } from "@getpaseo/protocol/messages";

import { formatSystemNotificationPrompt } from "../agent/agent-prompt.js";
import { LogicMapCorruptError, LogicMapNotFoundError } from "./logic-map-errors.js";
import { readLogicMap } from "./logic-map-store.js";
import { READ_LOGIC_MAP_TOOL, UPDATE_LOGIC_MAP_TOOL } from "./logic-map-tools.js";

export interface ResolveLogicMapInstructionBlockInput {
  /** 用户这条消息的文字。 */
  text: string;
  /** 发送时 Agent 的 labels；带逻辑图标签就是开关开着。 */
  labels: Readonly<Record<string, string>>;
  /** Agent 的 workspace 目录，图在它下面。 */
  cwd: string;
}

/** 发送时磁盘上这张图的样子，决定说明块里 spec 框架那几条怎么写。 */
type LogicMapOnDisk =
  | { kind: "ok"; skeleton: LogicMapSkeleton }
  | { kind: "unreadable"; problem: string };

const CORRECTION_RULE =
  "- If the user corrects the judgment, record the corrected one with `set_spec_framework` and tell them what changed.";

function specFrameworkLines(map: LogicMapOnDisk): string[] {
  if (map.kind === "unreadable") {
    return [
      `The logic map files cannot be read: ${map.problem}. Do not try to update the map; tell the user which file is broken and what is wrong.`,
    ];
  }
  const framework = map.skeleton.specFramework;
  if (framework === null) {
    return [
      [
        "Spec framework:",
        "- First judge whether this project has a spec framework: a requirement doc system of its own, such as ATW's `.atw/tasks/<task>/prd.md`. Record the judgment with the `set_spec_framework` operation in your first update.",
        "- In that same reply, tell the user what you judged and where the node docs will point: the framework's docs, or this map's own folder.",
        CORRECTION_RULE,
      ].join("\n"),
    ];
  }
  if (framework.kind === "none") {
    return [
      [
        "Spec framework:",
        "- This project has no spec framework. Write a complete node doc for every node with `write_node_doc`: how this part works, its rules and branches, so it can be built from that doc alone.",
        CORRECTION_RULE,
      ].join("\n"),
    ];
  }
  const pendingIds = map.skeleton.nodes
    .filter((node) => node.doc?.kind === "own" && node.doc.pendingLink)
    .map((node) => `"${node.id}"`);
  const lines = [
    [
      "Spec framework:",
      `- This project has a spec framework; its docs are at ${framework.docsPath}. Do not write the final requirement into the map. Until the framework has a doc for a node, give the node an interim summary of 3 to 6 sentences with \`write_node_doc\`: what the step does, its rules, and which branch it takes. Such a node carries a "not linked to the final doc yet" marker.`,
      "- Once the framework writes the doc for a node, point the node at that section with `link_node_doc`.",
      CORRECTION_RULE,
    ].join("\n"),
  ];
  if (pendingIds.length > 0) {
    lines.push(
      `Before you continue the conversation, check the framework docs for these nodes, which are not linked to the final doc yet: ${pendingIds.join(", ")}. Link every node whose section now exists with \`link_node_doc\`, then carry on.`,
    );
  }
  return lines;
}

function formatLogicMapInstructionBlock(mapName: string, map: LogicMapOnDisk): string {
  return formatSystemNotificationPrompt(
    [
      `The logic map is on for this conversation. You maintain the logic map "${mapName}", stored in this workspace at ${LOGIC_MAPS_DIRECTORY}/${mapName}/.`,
      `Read it with the \`${READ_LOGIC_MAP_TOOL}\` tool and change it only with the \`${UPDATE_LOGIC_MAP_TOOL}\` tool; do not edit its files directly.`,
      [
        "Rules:",
        '- A logic map is a flowchart of one feature. Each line means "what happens next". Each decision shows every branch, including the failure branch.',
        "- Only the top layer may split the feature into its parts; each part then becomes a flow.",
        "- One node is one thing that can be explained, built, and accepted on its own.",
        "- Keep each layer to about 7 to 20 nodes. Move extra nodes into a subgraph node that holds the next layer.",
        "- Whenever this turn reaches a new conclusion about the feature, update the logic map before you finish the turn.",
        "- After each update, tell the user in one or two sentences which nodes you added, changed, and removed.",
      ].join("\n"),
      ...specFrameworkLines(map),
    ].join("\n\n"),
  );
}

async function readLogicMapOnDisk(cwd: string, mapName: string): Promise<LogicMapOnDisk> {
  try {
    return { kind: "ok", skeleton: await readLogicMap({ cwd, mapName }) };
  } catch (error) {
    if (error instanceof LogicMapCorruptError) {
      return { kind: "unreadable", problem: `${error.file}: ${error.problem}` };
    }
    if (error instanceof LogicMapNotFoundError) {
      return {
        kind: "unreadable",
        problem: `${LOGIC_MAPS_DIRECTORY}/${mapName}/ is missing from this workspace`,
      };
    }
    throw error;
  }
}

/**
 * 逻辑图说明块；Agent 没开逻辑图，或这条消息没有文字时为 null。
 * 发送时现读这张图：没判断过 spec 框架就先要求判断，还有没指向正式文档的节点就要求先补指向。
 * 和 Routing block 一样只附在发给 provider 的那份里，由 `stripTrailingRoutingBlock` 剥掉。
 */
export async function resolveLogicMapInstructionBlock(
  input: ResolveLogicMapInstructionBlockInput,
): Promise<string | null> {
  if (input.text.trim().length === 0) return null;
  const mapName = getLogicMapNameFromLabels(input.labels);
  if (!mapName) return null;
  return formatLogicMapInstructionBlock(mapName, await readLogicMapOnDisk(input.cwd, mapName));
}
