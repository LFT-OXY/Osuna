import type { StreamItem, ToolCallItem } from "@/types/stream";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import {
  groupLiveToolCalls,
  isGroupableToolCall,
  prepareGroupedHistory,
  type GroupedHistory,
  type GroupedToolCalls,
  type ToolCallRun,
  type ToolCallRunKeyOf,
} from "./grouping";
import { buildOverviewGroup, type OverviewToolCallGroup } from "./overview/model";
import {
  buildDispatchGroup,
  isDispatchToolCall,
  type DispatchToolCallGroup,
} from "./dispatch/model";

export type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
export type ToolCallDetailGroup = OverviewToolCallGroup | DispatchToolCallGroup;

type ToolCallRunKey = ToolCallDetailGroup["mode"];

export interface PreparedToolCallHistory {
  mode: ToolCallDetailLevel;
  dispatchGroups: boolean;
  grouped: GroupedHistory<ToolCallDetailGroup, ToolCallRunKey>;
}

export interface ToolCallDetailProjection extends GroupedToolCalls<ToolCallDetailGroup> {}

const EMPTY_TOOL_CALL_GROUPS = new Map<string, ToolCallDetailGroup>();

function overviewRunKey(item: ToolCallItem): ToolCallRunKey | null {
  return isGroupableToolCall(item) ? "overview" : null;
}

function overviewWithDispatchRunKey(item: ToolCallItem): ToolCallRunKey | null {
  return isDispatchToolCall(item) ? "dispatch" : overviewRunKey(item);
}

function dispatchOnlyRunKey(item: ToolCallItem): ToolCallRunKey | null {
  return isDispatchToolCall(item) ? "dispatch" : null;
}

// 派发组在两种细节级别下都成组；detailed 下其余调用照旧一条一行。
function resolveRunKey(
  level: ToolCallDetailLevel,
  dispatchGroups: boolean,
): ToolCallRunKeyOf<ToolCallRunKey> | null {
  if (level === "detailed") {
    return dispatchGroups ? dispatchOnlyRunKey : null;
  }
  return dispatchGroups ? overviewWithDispatchRunKey : overviewRunKey;
}

function buildGroup(run: ToolCallRun, key: ToolCallRunKey): ToolCallDetailGroup {
  return key === "dispatch" ? buildDispatchGroup(run) : buildOverviewGroup(run);
}

// Approval UI owns pending plan presentation. Retain the canonical tool in the
// stream model so resolving it can reveal a card at its original position.
const visibleItemsCache = new WeakMap<StreamItem[], StreamItem[]>();
function visibleToolCallItems(items: StreamItem[]): StreamItem[] {
  const cached = visibleItemsCache.get(items);
  if (cached) return cached;
  const visible = items.filter((item) => {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") return true;
    const data = item.payload.data;
    return (
      data.name !== "ExitPlanMode" && !(data.name === "plan_approval" && data.status === "running")
    );
  });
  const result = visible.length === items.length ? items : visible;
  visibleItemsCache.set(items, result);
  return result;
}

export function prepareToolCallHistory({
  level,
  tail,
  dispatchGroups,
}: {
  level: ToolCallDetailLevel;
  tail: StreamItem[];
  dispatchGroups: boolean;
}): PreparedToolCallHistory | null {
  const runKeyOf = resolveRunKey(level, dispatchGroups);
  if (!runKeyOf) {
    return null;
  }
  return {
    mode: level,
    dispatchGroups,
    grouped: prepareGroupedHistory({
      tail: visibleToolCallItems(tail),
      runKeyOf,
      buildGroup,
    }),
  };
}

export function projectToolCallDetailLevel(input: {
  level: ToolCallDetailLevel;
  tail: StreamItem[];
  head: StreamItem[];
  preparedHistory: PreparedToolCallHistory | null;
  isTurnActive: boolean;
  dispatchGroups: boolean;
}): ToolCallDetailProjection {
  const runKeyOf = resolveRunKey(input.level, input.dispatchGroups);
  if (!runKeyOf) {
    return {
      tail: visibleToolCallItems(input.tail),
      head: visibleToolCallItems(input.head),
      groupsByHostId: EMPTY_TOOL_CALL_GROUPS,
      historyGroupUpdatesByHostId: EMPTY_TOOL_CALL_GROUPS,
    };
  }
  if (
    !input.preparedHistory ||
    input.preparedHistory.mode !== input.level ||
    input.preparedHistory.dispatchGroups !== input.dispatchGroups
  ) {
    throw new Error(`Missing prepared ${input.level} tool call history`);
  }
  return groupLiveToolCalls({
    history: input.preparedHistory.grouped,
    head: visibleToolCallItems(input.head),
    isTurnActive: input.isTurnActive,
    runKeyOf,
    buildGroup,
  });
}
