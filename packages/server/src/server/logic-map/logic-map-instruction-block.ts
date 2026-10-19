import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";

import { formatSystemNotificationPrompt } from "../agent/agent-prompt.js";
import { LOGIC_MAPS_DIRECTORY } from "./logic-map-store.js";

export interface ResolveLogicMapInstructionBlockInput {
  /** 用户这条消息的文字。 */
  text: string;
  /** 发送时 Agent 的 labels；带逻辑图标签就是开关开着。 */
  labels: Readonly<Record<string, string>>;
}

function formatLogicMapInstructionBlock(mapName: string): string {
  return formatSystemNotificationPrompt(
    [
      `The logic map is on for this conversation. You maintain the logic map "${mapName}", stored in this workspace at ${LOGIC_MAPS_DIRECTORY}/${mapName}/.`,
      [
        "Rules:",
        '- A logic map is a flowchart of one feature. Each line means "what happens next". Each decision shows every branch, including the failure branch.',
        "- Only the top layer may split the feature into its parts; each part then becomes a flow.",
        "- One node is one thing that can be explained, built, and accepted on its own.",
        "- Keep each layer to about 7 to 20 nodes. Move extra nodes into a subgraph node that holds the next layer.",
        "- Whenever this turn reaches a new conclusion about the feature, update the logic map before you finish the turn.",
        "- After each update, tell the user in one or two sentences which nodes you added, changed, and removed.",
      ].join("\n"),
    ].join("\n\n"),
  );
}

/**
 * 逻辑图说明块；Agent 没开逻辑图，或这条消息没有文字时为 null。
 * 和 Routing block 一样只附在发给 provider 的那份里，由 `stripTrailingRoutingBlock` 剥掉。
 */
export function resolveLogicMapInstructionBlock(
  input: ResolveLogicMapInstructionBlockInput,
): string | null {
  if (input.text.trim().length === 0) return null;
  const mapName = getLogicMapNameFromLabels(input.labels);
  return mapName ? formatLogicMapInstructionBlock(mapName) : null;
}
