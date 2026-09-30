import { useEffect, useMemo } from "react";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { PARENT_TOOL_CALL_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentToolCallItem } from "@/types/stream";
import {
  readCreateAgentCallInput,
  type CreateAgentCallInput,
} from "@/tool-calls/detail-level/dispatch/model";

export interface PaseoSubagentRow {
  kind: "paseo";
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  /** Managed agents have a real title, so the union's task line is always absent for them. */
  description: null;
  subtitle: null;
  status: Agent["status"];
  turn: Agent["turn"];
  requiresAttention: Agent["requiresAttention"];
  pendingPermissionCount: number;
  createdAt: Agent["createdAt"];
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  // `title` is the subagent type ("Explore", "general-purpose") and repeats across a fan-out;
  // `description` is the task it was given. Both are carried so presentation can choose which
  // one names the row — collapsing them here is what makes every row read alike.
  title: string | null;
  description: string | null;
  /** Compact provider-owned context. The app displays it without interpreting its contents. */
  subtitle: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
  /** 派出它的那次工具调用；时间线派发组按父 agentId 加它关联。 */
  toolCallId: string | null;
}

export type SubagentRow = PaseoSubagentRow | ProviderSubagentRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
  /** Select children of this provider subagent instead of children of the managed agent. */
  providerParentSubagentId?: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];

function toSubagentRow(agent: Agent): PaseoSubagentRow {
  return {
    kind: "paseo",
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    description: null,
    subtitle: null,
    status: agent.status,
    turn: agent.turn,
    requiresAttention: agent.requiresAttention,
    pendingPermissionCount: agent.pendingPermissions.length,
    createdAt: agent.createdAt,
  };
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  const rows: SubagentRow[] = [];
  for (const agent of agents.values()) {
    if (
      agent.archivedAt ||
      pendingArchiveIds.has(agent.id) ||
      agent.parentAgentId !== params.parentAgentId
    ) {
      continue;
    }
    rows.push(toSubagentRow(agent));
  }

  if (rows.length === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

function toProviderSubagentRow(subagent: ProviderSubagentDescriptorPayload): ProviderSubagentRow {
  return {
    kind: "provider",
    id: subagent.id,
    parentAgentId: subagent.parentAgentId,
    provider: subagent.provider,
    title: subagent.title,
    description: subagent.description,
    subtitle: subagent.subtitle ?? null,
    status: subagent.status,
    requiresAttention: subagent.status === "failed",
    createdAt: new Date(subagent.createdAt),
    toolCallId: subagent.toolCallId,
  };
}

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
  nestingSupported = false,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  if (params.providerParentSubagentId && !nestingSupported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
    if (
      nestingSupported &&
      (subagent.parentSubagentId ?? null) !== (params.providerParentSubagentId ?? null)
    ) {
      continue;
    }
    rows.push(toProviderSubagentRow(subagent));
  }
  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  const paseoRows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSubagentsForParent(state, params, pendingArchiveIds),
    equal,
  );
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) =>
      state.sessions[params.serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) => selectProviderSubagentsForParent(state, params, supported, nestingSupported),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);

  useEffect(() => {
    if (!client || !supported) return;
    void refreshProviderSubagents(client, params.serverId, params.parentAgentId).catch(
      () => undefined,
    );
  }, [client, params.parentAgentId, params.serverId, supported]);

  return useMemo(() => {
    if (params.providerParentSubagentId) return providerRows;
    if (providerRows.length === 0) return paseoRows;
    const rows = [...paseoRows, ...providerRows];
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return rows;
  }, [params.providerParentSubagentId, paseoRows, providerRows]);
}

/** 派发组一行需要的子智能体数据。状态与 Subagents track 同源，都从 `SubagentRow` 分桶。 */
export interface DispatchSubagent {
  row: SubagentRow;
  model: string | null;
  modeLabel: string | null;
  pendingPermissionName: string | null;
  updatedAt: Date;
  archived: boolean;
  /** 脱离只清父标签，关联标签还在，所以脱离后的子智能体照样找得到。 */
  detached: boolean;
}

export function toDispatchSubagent(agent: Agent): DispatchSubagent {
  const currentMode = agent.availableModes.find((mode) => mode.id === agent.currentModeId);
  const modeLabel = currentMode?.label ?? agent.currentModeId;
  const model = agent.model ?? agent.runtimeInfo?.model ?? null;
  const pendingPermissionName = agent.pendingPermissions[0]?.name ?? null;
  return {
    row: toSubagentRow(agent),
    model,
    modeLabel,
    pendingPermissionName,
    updatedAt: agent.updatedAt,
    archived: Boolean(agent.archivedAt),
    detached: agent.parentAgentId === null,
  };
}

/**
 * 这次调用派出的子智能体是否仍算在本父智能体名下：父标签对得上，或者已经脱离。脱离会清掉父标签，
 * 只剩 callId 能对；tool call id 由 provider 随机生成，不会撞到别的会话。代价是导入的会话会关联到
 * 原会话里已脱离的子智能体。
 */
export function isDispatchChildOf(agent: Agent, parentAgentId: string): boolean {
  return agent.parentAgentId === parentAgentId || agent.parentAgentId === null;
}

export interface DispatchSubagentsParams {
  serverId: string;
  parentAgentId: string;
}

/** 本父智能体派出过的子智能体，按 `paseo.parent-tool-call-id` 的 callId 建索引。 */
export function selectDispatchSubagents(
  state: SessionStoreSnapshot,
  params: DispatchSubagentsParams,
): Record<string, DispatchSubagent> {
  const agents = state.sessions[params.serverId]?.agents;
  const linked: Record<string, DispatchSubagent> = {};
  if (!agents) {
    return linked;
  }
  for (const agent of agents.values()) {
    const callId = agent.labels[PARENT_TOOL_CALL_ID_LABEL];
    if (callId && isDispatchChildOf(agent, params.parentAgentId)) {
      linked[callId] = toDispatchSubagent(agent);
    }
  }
  return linked;
}

/**
 * 时间线（派发组的集合 owner）只订阅这一次，再把索引交给各组；session store 是热 store，
 * agents 没换就直接返回上次的结果，不在每次更新时重扫整张表。
 */
export function createDispatchSubagentsSelector(
  params: DispatchSubagentsParams,
): (state: SessionStoreSnapshot) => Record<string, DispatchSubagent> {
  let lastAgents: Map<string, Agent> | undefined;
  let lastLinked: Record<string, DispatchSubagent> = {};
  return (state) => {
    const agents = state.sessions[params.serverId]?.agents;
    if (agents !== lastAgents) {
      lastAgents = agents;
      lastLinked = selectDispatchSubagents(state, params);
    }
    return lastLinked;
  };
}

/** provider 子智能体没有模型、模式与归档这些 Paseo 字段；等待批准的归属由 adapter 另补。 */
function toProviderDispatchSubagent(subagent: ProviderSubagentDescriptorPayload): DispatchSubagent {
  return {
    row: toProviderSubagentRow(subagent),
    model: null,
    modeLabel: null,
    pendingPermissionName: null,
    updatedAt: new Date(subagent.updatedAt),
    archived: false,
    detached: false,
  };
}

/**
 * 本父智能体的 provider 子智能体，按描述符的 `toolCallId` 建索引。一次调用可能派出多个（OMP 的 task），
 * 按创建时间排。track 里被收起的照样在：那只是把 track 清空，时间线上的调用还在。
 */
export function selectProviderDispatchSubagents(
  state: ProviderSubagentStoreSnapshot,
  params: DispatchSubagentsParams,
): Record<string, DispatchSubagent[]> {
  const linked: Record<string, DispatchSubagent[]> = {};
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    const belongsToParent = key.startsWith(prefix);
    if (!belongsToParent || !subagent.toolCallId) continue;
    const subagents = linked[subagent.toolCallId] ?? [];
    subagents.push(toProviderDispatchSubagent(subagent));
    linked[subagent.toolCallId] = subagents;
  }
  for (const subagents of Object.values(linked)) {
    subagents.sort((left, right) => left.row.createdAt.getTime() - right.row.createdAt.getTime());
  }
  return linked;
}

/** 与 `createDispatchSubagentsSelector` 同理：描述符表没换就返回上次的结果。 */
export function createProviderDispatchSubagentsSelector(
  params: DispatchSubagentsParams,
): (state: ProviderSubagentStoreSnapshot) => Record<string, DispatchSubagent[]> {
  let lastDescriptors: ProviderSubagentStoreSnapshot["descriptors"] | undefined;
  let lastLinked: Record<string, DispatchSubagent[]> = {};
  return (state) => {
    if (state.descriptors !== lastDescriptors) {
      lastDescriptors = state.descriptors;
      lastLinked = selectProviderDispatchSubagents(state, params);
    }
    return lastLinked;
  };
}

/** active 目录之外按关联标签查一次（含已归档）的结果。 */
export type DispatchLookup =
  | { status: "pending" }
  | { status: "found"; subagent: DispatchSubagent }
  | { status: "missing" };

export const PENDING_DISPATCH_LOOKUP: DispatchLookup = { status: "pending" };

/**
 * `key` 在一组里唯一：Paseo 子智能体一次调用一个，就用 callId；provider 的一次调用可能派出多个，
 * 用 callId 加子智能体 id。provider 行没有 `create_agent` 入参。
 */
export type DispatchCallState =
  | {
      kind: "subagent";
      key: string;
      callId: string;
      input: CreateAgentCallInput;
      subagent: DispatchSubagent;
    }
  | { kind: "provider"; key: string; callId: string; subagent: DispatchSubagent }
  | { kind: "starting"; key: string; callId: string; input: CreateAgentCallInput }
  | { kind: "generic"; call: AgentToolCallItem };

export type DispatchRowState = Exclude<DispatchCallState, { kind: "generic" }>;

export type DispatchSegment =
  | { kind: "group"; key: string; rows: DispatchRowState[] }
  | { kind: "generic"; call: AgentToolCallItem };

/**
 * 一次 `create_agent` 调用落到哪种呈现。store 里的子智能体优先，它是实时的；查询结果只画最终状态。
 * 还在执行、或还没查完的调用画成"启动中"。
 */
export function resolveDispatchCall(input: {
  call: AgentToolCallItem;
  subagent: DispatchSubagent | undefined;
  lookup: DispatchLookup;
}): DispatchCallState {
  const callId = input.call.payload.data.callId;
  const callInput = readCreateAgentCallInput(input.call);
  const lookedUp = input.lookup.status === "found" ? input.lookup.subagent : undefined;
  const subagent = input.subagent ?? lookedUp;
  if (subagent) {
    return { kind: "subagent", key: callId, callId, input: callInput, subagent };
  }
  if (input.call.payload.data.status === "running" || input.lookup.status === "pending") {
    return { kind: "starting", key: callId, callId, input: callInput };
  }
  return { kind: "generic", call: input.call };
}

/**
 * provider 子智能体调用落到哪种呈现。没有"启动中"：app 分不出哪些 provider 会发描述符（Pi 就
 * 不发），执行中先画启动中会让它们一直停在不可点的行上；描述符一到，通用卡就换成行。
 */
export function resolveProviderDispatchCall(input: {
  call: AgentToolCallItem;
  subagents: readonly DispatchSubagent[] | undefined;
}): DispatchCallState[] {
  const callId = input.call.payload.data.callId;
  if (!input.subagents) {
    return [{ kind: "generic", call: input.call }];
  }
  return input.subagents.map((subagent) => ({
    kind: "provider",
    key: `${callId}:${subagent.row.id}`,
    callId,
    subagent,
  }));
}

/** 退回通用卡的调用把一组切开，两边各成一张卡，与原型的连续规则一致。 */
export function splitDispatchSegments(states: readonly DispatchCallState[]): DispatchSegment[] {
  const segments: DispatchSegment[] = [];
  let rows: DispatchRowState[] = [];
  const flush = () => {
    const first = rows[0];
    if (first) {
      segments.push({ kind: "group", key: first.key, rows });
    }
    rows = [];
  };
  for (const state of states) {
    if (state.kind === "generic") {
      flush();
      segments.push(state);
      continue;
    }
    rows.push(state);
  }
  flush();
  return segments;
}
