import type { TFunction } from "i18next";
import type { ComposerTrackPillSegment } from "@/composer/tracks";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { deriveSidebarStateBucket, STATUS_BUCKET_ORDER } from "@/utils/sidebar-agent-state";
import type { DispatchRowState, DispatchSubagent, SubagentRow } from "./select";
import { isFinishedSubagent } from "./archive-finished";
import { providerSubagentLifecycleStatus } from "./provider-store";

function presentationStatus(row: SubagentRow) {
  if (row.kind === "osuna") {
    if (row.turn.phase === "open") return "running";
    return row.status === "running" ? "idle" : row.status;
  }
  return providerSubagentLifecycleStatus(row.status);
}

export interface SubagentRowPresentationData {
  key: string;
  kind: "agent";
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
}

export function buildSubagentRowPresentationData(row: SubagentRow): SubagentRowPresentationData {
  // The task distinguishes siblings in a fan-out, so it names the row when present. Providers
  // own the compact secondary context because model, effort, and usage semantics differ.
  const description = resolveRowLabel(row.description);
  const title = resolveRowLabel(row.title);
  const label = description ?? title;
  const providerSubtitle = row.kind === "provider" ? resolveRowLabel(row.subtitle) : null;
  const subtitle = providerSubtitle ?? (description ? title : null);
  const status = presentationStatus(row);
  return {
    key: `${row.kind}_subagent_${row.id}`,
    kind: "agent",
    label: label ?? "",
    subtitle: subtitle ?? "",
    titleState: label ? "ready" : "loading",
    // requiresAttention 保持 false，否则已完成的子智能体会亮"待查看"；等待批准只看待批准计数。
    statusBucket: deriveSidebarStateBucket({
      status,
      pendingPermissionCount: row.pendingPermissionCount,
      requiresAttention: false,
    }),
  };
}

type ActiveStatusBucket = Exclude<SidebarStateBucket, "done">;

/** The sidebar's list order, minus the state that earns no mark. */
const ACTIVE_STATUS_BUCKET_ORDER = STATUS_BUCKET_ORDER.filter(
  (bucket): bucket is ActiveStatusBucket => bucket !== "done",
);

/** One state the pill reports, and how many children are in it. */
interface SubagentStatusCount {
  bucket: ActiveStatusBucket;
  count: number;
}

/** Everything the pill draws. Built together so no mark can end up next to another one's count. */
export interface SubagentPillPresentation {
  segments: ComposerTrackPillSegment[];
  accessibilityLabel: string;
}

/**
 * What the pill says about a fan-out, and which marks it says it with.
 *
 * A mark and a number sitting together answer the same question, so the pill cannot collapse a
 * mixed fan-out into the most urgent state the way a sidebar project row does: a red dot beside
 * "1 failed" over a child that is still working says the fan-out has stopped. Every state present
 * gets its own mark and its own count, in the order the sidebar's status groups list them.
 *
 * It stays one line because subagent rows only ever reach four states — see
 * `buildSubagentRowPresentationData`, which reports no attention of its own — so the pill is three
 * segments at worst, and falls back to naming what it opens once nothing is happening.
 */
export function buildSubagentPillPresentation(
  t: TFunction,
  rows: readonly SubagentRow[],
): SubagentPillPresentation {
  const counts = summarizeSubagentStatus(rows);
  if (counts.length === 0) {
    const label = totalLabel(t, rows.length);
    return { segments: [{ bucket: null, text: label }], accessibilityLabel: label };
  }
  const labels = counts.map(({ bucket, count }) => statusLabel(t, bucket, count));
  return {
    segments: counts.map(({ bucket }, index) => ({ bucket, text: labels[index] ?? "" })),
    // Marks separate the segments on screen; a screen reader needs the pause spelled out.
    accessibilityLabel: labels.join(", "),
  };
}

/** Wording comes from the sidebar's status groups — one name per state across the whole app. */
function statusLabel(t: TFunction, bucket: ActiveStatusBucket, count: number): string {
  switch (bucket) {
    case "running":
      return t("subagents.pillLabelWorking", { count });
    case "failed":
      return t("subagents.pillLabelFailed", { count });
    case "needs_input":
      return count === 1
        ? t("subagents.pillLabelNeedsInputOne")
        : t("subagents.pillLabelNeedsInputMany", { count });
    case "attention":
      return t("subagents.pillLabelReadyToReview", { count });
  }
}

/** Nothing is happening, so the pill is back to naming what it opens. */
function totalLabel(t: TFunction, total: number): string {
  return total === 1 ? t("subagents.pillLabelOne") : t("subagents.pillLabelMany", { count: total });
}

/**
 * Empty when every child is done: a finished fan-out is not worth a colour above the composer.
 */
function summarizeSubagentStatus(rows: readonly SubagentRow[]): SubagentStatusCount[] {
  const buckets = rows.map((row) => buildSubagentRowPresentationData(row).statusBucket);
  return ACTIVE_STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const count = buckets.filter((candidate) => candidate === bucket).length;
    return count > 0 ? [{ bucket, count }] : [];
  });
}

export function countFinishedSubagents(rows: readonly SubagentRow[]): number {
  return rows.filter(isFinishedSubagent).length;
}

export function resolveRowLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

/** 派发组的行多一个"启动中"：调用还在跑、子智能体还没进 store。 */
export type DispatchRowBucket = SidebarStateBucket | "starting";

/** 组头分段的顺序：track 的桶顺序，启动中排在已完成前面。 */
const DISPATCH_BUCKET_ORDER: readonly DispatchRowBucket[] = [
  ...ACTIVE_STATUS_BUCKET_ORDER,
  "starting",
  "done",
];

/**
 * 行尾显示什么。快照里没有"结束时间"，停下后用最后一次更新近似；归档会把最后一次更新改成
 * 归档时刻，所以已归档的行不显示时长。
 */
export type DispatchRowTiming =
  | { kind: "starting" }
  | { kind: "live"; startedAt: Date }
  | { kind: "frozen"; durationMs: number }
  | { kind: "none" };

/** 点开一行去哪：Osuna 子智能体是普通 agent 标签，provider 子智能体是只读面板。 */
export type DispatchOpenTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "provider_subagent"; parentAgentId: string; subagentId: string };

export interface DispatchRowPresentation {
  key: string;
  /** 启动中没有子智能体可开，为 null。 */
  open: DispatchOpenTarget | null;
  provider: string | null;
  label: string;
  subtitle: string;
  tone: "default" | "warning";
  bucket: DispatchRowBucket;
  timing: DispatchRowTiming;
}

export interface DispatchGroupHeaderSegment {
  bucket: DispatchRowBucket;
  text: string;
}

export interface DispatchGroupHeaderPresentation {
  title: string;
  segments: DispatchGroupHeaderSegment[];
  accessibilityLabel: string;
}

export function dispatchRowBucket(state: DispatchRowState): DispatchRowBucket {
  if (state.kind === "starting") return "starting";
  return buildSubagentRowPresentationData(state.subagent.row).statusBucket ?? "done";
}

function joinParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function subagentTiming(subagent: DispatchSubagent, bucket: DispatchRowBucket): DispatchRowTiming {
  if (subagent.archived) return { kind: "none" };
  const startedAt = subagent.row.createdAt;
  if (bucket === "running" || bucket === "needs_input") return { kind: "live", startedAt };
  return { kind: "frozen", durationMs: subagent.updatedAt.getTime() - startedAt.getTime() };
}

function subagentSubtitle(
  t: TFunction,
  subagent: DispatchSubagent,
  providerLabelOf: (provider: string) => string,
): string {
  if (subagent.row.kind === "provider") {
    return buildSubagentRowPresentationData(subagent.row).subtitle;
  }
  const archivedSuffix = subagent.archived ? t("subagents.dispatchArchived") : null;
  const detachedSuffix = subagent.detached ? t("subagents.dispatchDetached") : null;
  return joinParts([
    providerLabelOf(subagent.row.provider),
    subagent.model,
    subagent.modeLabel,
    archivedSuffix,
    detachedSuffix,
  ]);
}

function openTarget(row: SubagentRow): DispatchOpenTarget {
  if (row.kind === "provider") {
    return { kind: "provider_subagent", parentAgentId: row.parentAgentId, subagentId: row.id };
  }
  return { kind: "agent", agentId: row.id };
}

/**
 * Osuna 子智能体的标题取 `create_agent` 入参的 title，后来被改名，行上仍是派发时写的任务；
 * provider 子智能体没有入参，与 track 一样先取 description。
 */
export function buildDispatchRowPresentation({
  t,
  state,
  providerLabelOf,
}: {
  t: TFunction;
  state: DispatchRowState;
  providerLabelOf: (provider: string) => string;
}): DispatchRowPresentation {
  if (state.kind === "starting") {
    const { provider, model, modeId } = state.input;
    const providerLabel = provider ? providerLabelOf(provider) : null;
    return {
      key: state.key,
      open: null,
      provider,
      label: resolveRowLabel(state.input.title) ?? "",
      subtitle: joinParts([providerLabel, model, modeId]),
      tone: "default",
      bucket: "starting",
      timing: { kind: "starting" },
    };
  }
  const { subagent } = state;
  const bucket = dispatchRowBucket(state);
  const pendingTool = bucket === "needs_input" ? subagent.pendingPermissionName : null;
  const subtitle = pendingTool
    ? t("subagents.dispatchWaitingForApproval", { tool: pendingTool })
    : subagentSubtitle(t, subagent, providerLabelOf);
  const callTitle = state.kind === "subagent" ? resolveRowLabel(state.input.title) : null;
  const label = callTitle ?? buildSubagentRowPresentationData(subagent.row).label;
  const tone = pendingTool ? "warning" : "default";
  return {
    key: state.key,
    open: openTarget(subagent.row),
    provider: subagent.row.provider,
    label,
    subtitle,
    tone,
    bucket,
    timing: subagentTiming(subagent, bucket),
  };
}

// 组头照原型写"等待批准"，不用 pill 的"需要输入"：派发组的行只会因为权限请求进这个桶。
function dispatchStatusLabel(t: TFunction, bucket: DispatchRowBucket, count: number): string {
  switch (bucket) {
    case "needs_input":
      return t("subagents.dispatchWaitingCount", { count });
    case "starting":
      return t("subagents.dispatchStarting", { count });
    case "done":
      return t("subagents.dispatchDone", { count });
    default:
      return statusLabel(t, bucket, count);
  }
}

export function buildDispatchGroupHeaderPresentation(
  t: TFunction,
  rows: readonly DispatchRowState[],
): DispatchGroupHeaderPresentation {
  const buckets = rows.map(dispatchRowBucket);
  const segments = DISPATCH_BUCKET_ORDER.flatMap((bucket) => {
    const count = buckets.filter((candidate) => candidate === bucket).length;
    return count > 0 ? [{ bucket, text: dispatchStatusLabel(t, bucket, count) }] : [];
  });
  const title =
    rows.length === 1
      ? t("subagents.dispatchTitleOne")
      : t("subagents.dispatchTitleMany", { count: rows.length });
  return {
    title,
    segments,
    accessibilityLabel: `${title}: ${segments.map((segment) => segment.text).join(", ")}`,
  };
}
