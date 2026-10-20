import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";
import { z } from "zod";

import type { AgentManager } from "../agent/agent-manager.js";
import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import { ensureValidJson } from "../json-utils.js";
import { LogicMapOffError } from "./logic-map-errors.js";
import { LogicMapOperationSchema } from "./logic-map-operations.js";
import {
  readLogicMap,
  updateLogicMap,
  type LogicMapChangedEvent,
  type LogicMapLocation,
} from "./logic-map-store.js";

/** 说明块里写给 Agent 的工具名，与这里注册的一致。 */
export const READ_LOGIC_MAP_TOOL = "read_logic_map";
export const UPDATE_LOGIC_MAP_TOOL = "update_logic_map";

export interface RegisterLogicMapToolsOptions {
  registerTool: (
    name: string,
    config: PaseoToolConfig,
    handler: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool inputs are validated by the catalog before execution.
      input: any,
      context: PaseoToolExecutionContext,
    ) => Promise<PaseoToolResult>,
  ) => void;
  agentManager: Pick<AgentManager, "getAgent">;
  callerAgentId?: string;
  onLogicMapChanged?: (event: LogicMapChangedEvent) => void;
}

interface CallerLogicMap extends LogicMapLocation {
  workspaceId: string | undefined;
}

const UpdateLogicMapInputShape = {
  operations: z.array(LogicMapOperationSchema).min(1),
};
type UpdateLogicMapInput = z.infer<z.ZodObject<typeof UpdateLogicMapInputShape>>;

/** 逻辑图的两个 Agent 工具：按调用方 Agent 的标签找到它维护的图，图跟着它的 cwd 走。 */
export function registerLogicMapTools(options: RegisterLogicMapToolsOptions): void {
  const { registerTool, agentManager, callerAgentId, onLogicMapChanged } = options;

  function resolveCallerMap(): CallerLogicMap {
    const agent = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
    const mapName = getLogicMapNameFromLabels(agent?.labels);
    if (!agent || !mapName) {
      throw new LogicMapOffError(callerAgentId ?? null);
    }
    return { cwd: agent.cwd, mapName, workspaceId: agent.workspaceId };
  }

  registerTool(
    READ_LOGIC_MAP_TOOL,
    {
      title: "Read logic map",
      description:
        "Read the whole logic map this conversation maintains: title, spec framework judgment, nodes and lines. Use it before continuing an existing map.",
      inputSchema: {},
    },
    async () => {
      const target = resolveCallerMap();
      const map = await readLogicMap(target);
      return {
        content: [],
        structuredContent: ensureValidJson({ mapName: target.mapName, map }),
      };
    },
  );

  registerTool(
    UPDATE_LOGIC_MAP_TOOL,
    {
      title: "Update logic map",
      description: [
        "Apply a batch of changes to the logic map this conversation maintains. Either every operation is applied or none is; a rejected batch returns what to fix.",
        "Rules checked: node ids are unique; both ends of a line exist and sit in the same layer; a decision has at least two outgoing lines with a condition; a parentId names a subgraph node; a linked doc is a file in this workspace that has the given heading; the first update sets the title.",
        "write_node_doc stores the node's own doc in the map folder. link_node_doc points the node at a heading in an existing doc and deletes its own doc.",
      ].join("\n"),
      inputSchema: UpdateLogicMapInputShape,
    },
    async ({ operations }: UpdateLogicMapInput) => {
      const target = resolveCallerMap();
      const result = await updateLogicMap(target, operations);
      if (target.workspaceId) {
        onLogicMapChanged?.({ workspaceId: target.workspaceId, mapName: target.mapName });
      }
      return {
        content: [],
        structuredContent: ensureValidJson({
          mapName: target.mapName,
          warnings: result.warnings,
        }),
      };
    },
  );
}
