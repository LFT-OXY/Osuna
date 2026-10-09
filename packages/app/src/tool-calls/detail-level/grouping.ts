import type { ToolCallDetail } from "@osuna/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";

export interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

export interface ToolCallRun {
  id: string;
  calls: readonly ToolCallItem[];
  latest: ToolCallItem;
  isSealed: boolean;
}

export interface GroupedHistory<TGroup, TKey extends string = string> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingCalls: readonly ToolCallItem[];
  pendingKey: TKey | null;
}

/** 连续且键相同的工具调用合成一组；`null` 表示这个调用不进任何组。 */
export type ToolCallRunKeyOf<TKey extends string> = (item: ToolCallItem) => TKey | null;

export interface GroupedToolCalls<TGroup> {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: ToolCallGroupLookup<TGroup>;
  historyGroupUpdatesByHostId: ToolCallGroupLookup<TGroup>;
}

export interface ToolCallGroupLookup<TGroup> {
  readonly size: number;
  get(id: string): TGroup | undefined;
  has(id: string): boolean;
}

const EMPTY_GROUPS = new Map<string, never>();

export function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
      error: data.error,
      metadata: data.metadata,
    };
  }

  const { data } = item.payload;
  return {
    detail: {
      type: "unknown",
      input: data.arguments ?? null,
      output: data.result ?? null,
    },
    name: data.toolName,
    status: data.status,
    error: data.error,
  };
}

export function isGroupableToolCall(item: StreamItem): item is ToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return descriptor.detail.type !== "plan" && descriptor.name.trim().toLowerCase() !== "speak";
}

function createRun(calls: readonly ToolCallItem[], isSealed: boolean): ToolCallRun {
  const first = calls[0];
  const latest = calls.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot group an empty tool call run");
  }
  return { id: first.id, calls, latest, isSealed };
}

function createHost(run: ToolCallRun): ToolCallItem {
  if (run.calls.length === 1) {
    return run.latest;
  }
  return { ...run.latest, id: run.id };
}

function isRunning(call: ToolCallItem): boolean {
  const status = describeToolCall(call).status;
  return status === "running" || status === "executing";
}

function runKeyOfItem<TKey extends string>(
  item: StreamItem,
  runKeyOf: ToolCallRunKeyOf<TKey>,
): TKey | null {
  return item.kind === "tool_call" ? runKeyOf(item) : null;
}

function appendRun<TGroup, TKey extends string>(input: {
  calls: readonly ToolCallItem[];
  key: TKey | null;
  isSealed: boolean;
  output: StreamItem[];
  groups: Map<string, TGroup>;
  buildGroup: (run: ToolCallRun, key: TKey) => TGroup;
}): void {
  if (input.calls.length === 0 || input.key === null) {
    return;
  }
  const run = createRun(input.calls, input.isSealed);
  const host = createHost(run);
  input.output.push(host);
  input.groups.set(host.id, input.buildGroup(run, input.key));
}

export function prepareGroupedHistory<TGroup, TKey extends string>(input: {
  tail: StreamItem[];
  runKeyOf: ToolCallRunKeyOf<TKey>;
  buildGroup: (run: ToolCallRun, key: TKey) => TGroup;
}): GroupedHistory<TGroup, TKey> {
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  let pending: ToolCallItem[] = [];
  let pendingKey: TKey | null = null;
  const flush = () => {
    appendRun({
      calls: pending,
      key: pendingKey,
      isSealed: true,
      output,
      groups,
      buildGroup: input.buildGroup,
    });
    pending = [];
    pendingKey = null;
  };

  for (const item of input.tail) {
    const key = runKeyOfItem(item, input.runKeyOf);
    if (item.kind === "tool_call" && key !== null) {
      if (key !== pendingKey) {
        flush();
      }
      pending.push(item);
      pendingKey = key;
      continue;
    }
    flush();
    output.push(item);
  }

  const pendingCalls = pending;
  const trailingKey = pendingKey;
  flush();

  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    pendingCalls,
    pendingKey: trailingKey,
  };
}

export function groupLiveToolCalls<TGroup, TKey extends string>(input: {
  history: GroupedHistory<TGroup, TKey>;
  head: StreamItem[];
  isTurnActive: boolean;
  runKeyOf: ToolCallRunKeyOf<TKey>;
  buildGroup: (run: ToolCallRun, key: TKey) => TGroup;
}): GroupedToolCalls<TGroup> {
  const head: StreamItem[] = [];
  const liveGroups = new Map<string, TGroup>();
  let pending = [...input.history.pendingCalls];
  let pendingKey = input.history.pendingKey;
  let hostPlacement: "history" | "head" | null = pending.length > 0 ? "history" : null;
  let pendingIncludesHead = false;

  const flush = (isSealed: boolean) => {
    if (pending.length === 0 || pendingKey === null) {
      return;
    }
    const run = createRun(pending, isSealed);
    if (hostPlacement === "head") {
      head.push(createHost(run));
    }
    if (hostPlacement === "head" || pendingIncludesHead || !isSealed) {
      liveGroups.set(run.id, input.buildGroup(run, pendingKey));
    }
    pending = [];
    pendingKey = null;
    hostPlacement = null;
    pendingIncludesHead = false;
  };

  for (const item of input.head) {
    const key = runKeyOfItem(item, input.runKeyOf);
    if (item.kind === "tool_call" && key !== null) {
      if (pending.length > 0 && key !== pendingKey) {
        flush(true);
      }
      if (pending.length === 0) {
        hostPlacement = "head";
        pendingKey = key;
      }
      pending.push(item);
      pendingIncludesHead = true;
      continue;
    }
    flush(true);
    head.push(item);
  }
  // Tool calls live in retained tail rather than the streaming head. The agent
  // lifecycle snapshot can still be idle while a newly received tool call is
  // already running, so its direct timeline status is the authoritative start
  // signal. The lifecycle state continues to keep completed calls live between
  // sequential tool updates.
  const trailingRunIsActive = input.isTurnActive || pending.some(isRunning);
  flush(!trailingRunIsActive);

  if (liveGroups.size === 0) {
    return {
      tail: input.history.tail,
      head: input.head,
      groupsByHostId: input.history.groupsByHostId,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  if (input.history.groupsByHostId.size === 0) {
    return {
      tail: input.history.tail,
      head,
      groupsByHostId: liveGroups,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  const groupsByHostId = new Map(input.history.groupsByHostId);
  let historyGroupUpdatesByHostId: Map<string, TGroup> | null = null;
  for (const [id, group] of liveGroups) {
    groupsByHostId.set(id, group);
    if (input.history.groupsByHostId.has(id)) {
      historyGroupUpdatesByHostId ??= new Map();
      historyGroupUpdatesByHostId.set(id, group);
    }
  }
  return {
    tail: input.history.tail,
    head,
    groupsByHostId,
    historyGroupUpdatesByHostId: historyGroupUpdatesByHostId ?? EMPTY_GROUPS,
  };
}
