import { getOsunaToolLeafName } from "@osuna/protocol/tool-name-normalization";
import { isAgentToolCallItem, type AgentToolCallItem, type StreamItem } from "@/types/stream";
import type { ToolCallRun } from "../grouping";

/**
 * 同一段输出里连续的子智能体调用：`create_agent` 与 provider 子智能体调用混在一组；
 * 每个调用能否关联到子智能体在渲染时才定。
 */
export interface DispatchToolCallGroup {
  mode: "dispatch";
  run: ToolCallRun;
  calls: readonly AgentToolCallItem[];
}

export interface CreateAgentCallInput {
  title: string | null;
  provider: string | null;
  model: string | null;
  modeId: string | null;
}

// 只认 Osuna 工具的两种标准写法：OpenCode、Pi、OMP 的 adapter 规范出的 `osuna.create_agent`，
// 以及 Claude、Codex 原生的 `mcp__osuna__create_agent`。认不出的照常走通用工具卡。
export function isCreateAgentCall(item: StreamItem): item is AgentToolCallItem {
  return (
    item.kind === "tool_call" &&
    item.payload.source === "agent" &&
    getOsunaToolLeafName(item.payload.data.name) === "create_agent"
  );
}

/** provider 自己的子智能体调用，adapter 把它们的细节统一成 `sub_agent`。关联不上描述符的照常是通用卡。 */
export function isProviderSubagentCall(item: StreamItem): item is AgentToolCallItem {
  return (
    item.kind === "tool_call" &&
    item.payload.source === "agent" &&
    item.payload.data.detail.type === "sub_agent"
  );
}

export function isDispatchToolCall(item: StreamItem): item is AgentToolCallItem {
  return isCreateAgentCall(item) || isProviderSubagentCall(item);
}

export function buildDispatchGroup(run: ToolCallRun): DispatchToolCallGroup {
  return { mode: "dispatch", run, calls: run.calls.filter(isAgentToolCallItem) };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `create_agent` 的 provider 入参写成 `provider/model`，也可以只写 provider。 */
function splitProviderModel(
  value: string | null,
): Pick<CreateAgentCallInput, "provider" | "model"> {
  const slash = value?.indexOf("/") ?? -1;
  if (!value || slash <= 0) {
    return { provider: value, model: null };
  }
  const model = value.slice(slash + 1);
  return { provider: value.slice(0, slash), model: model.length > 0 ? model : null };
}

/** 子智能体还没进 store 时，"启动中"那一行只能用调用入参来画。 */
export function readCreateAgentCallInput(call: AgentToolCallItem): CreateAgentCallInput {
  const detail = call.payload.data.detail;
  const input = detail.type === "unknown" && isRecord(detail.input) ? detail.input : {};
  const settings = isRecord(input.settings) ? input.settings : {};
  const { provider, model } = splitProviderModel(readString(input, "provider"));
  return {
    title: readString(input, "title"),
    provider,
    model,
    modeId: readString(settings, "modeId"),
  };
}
