import { formatShortDuration } from "@/usage/relative-time";
import type { UsageText } from "@/usage/text";
import {
  clampPct,
  describeReset,
  describeRunsOut,
  formatPct,
  resolveWindowUsedPct,
} from "./format";
import { deriveTone } from "./tone";
import { findProviderUsage } from "./view";
import type { ProviderUsageTone, ProviderUsageView, ProviderUsageWindow } from "./types";

export interface PlanUsageStripInput {
  view: ProviderUsageView;
  /** 当前 Agent（或草稿）所属的提供方。 */
  providerId: string;
  /**
   * 该提供方启用了第三方接口时，套餐额度不代表实际消耗。null 表示提供方快照还没到，
   * 先不显示，免得仪表出现后又因为第三方接口消失。
   */
  hasActiveApiEndpoint: boolean | null;
  now: number;
}

export interface PlanUsageStripPlanSegment {
  kind: "plan";
  key: "plan";
  providerId: string;
  label: string;
  accessibilityLabel: UsageText;
}

export interface PlanUsageStripWindowSegment {
  kind: "window";
  key: string;
  shortName: UsageText;
  /** 圆环的填充比例（0–100），没有数据时是 0，只画轨道。 */
  ringPct: number;
  percentText: string;
  tone: ProviderUsageTone;
  trailing: PlanUsageStripTrailing | null;
  accessibilityLabel: UsageText;
}

/** 窗口段尾部：重置时长，或者会在重置前用完时的「X后用完」（atRisk，危险色）。 */
export interface PlanUsageStripTrailing {
  text: UsageText;
  atRisk: boolean;
}

export type PlanUsageStripSegment = PlanUsageStripPlanSegment | PlanUsageStripWindowSegment;

const SHORT_NAME_KEYS: Record<string, string> = {
  five_hour: "usage.planUsage.strip.windows.fiveHour",
  session: "usage.planUsage.strip.windows.fiveHour",
  weekly: "usage.planUsage.strip.windows.weekly",
  code_review: "usage.planUsage.strip.windows.codeReview",
};

// Claude 按模型细分的周窗口，label 由 daemon 拼成 `Weekly · <模型>`。
const SCOPED_WEEKLY_PREFIX = "Weekly · ";

/**
 * Composer context strip 上的套餐仪表。返回 null 表示整块不显示：取数没就绪、
 * 出错、主机过旧，或者当前提供方没有可显示的窗口。余额和明细只在悬停卡片里。
 */
export function resolvePlanUsageStrip(input: PlanUsageStripInput): PlanUsageStripSegment[] | null {
  if (input.view.kind !== "ready") return null;
  const isKnownOfficialEndpoint = input.hasActiveApiEndpoint === false;
  if (!isKnownOfficialEndpoint) return null;
  const usage = findProviderUsage(input.view.payload.providers, input.providerId);
  if (!usage) return null;
  const hasWindowsToShow = usage.status === "available" && usage.windows.length > 0;
  if (!hasWindowsToShow) return null;
  const segments: PlanUsageStripSegment[] = [];
  if (usage.planLabel) {
    segments.push({
      kind: "plan",
      key: "plan",
      providerId: usage.providerId,
      label: usage.planLabel,
      accessibilityLabel: {
        key: "usage.planUsage.strip.planA11y",
        params: { provider: usage.displayName, plan: usage.planLabel },
      },
    });
  }
  for (const window of usage.windows) {
    segments.push(resolveWindowSegment(window, input.now));
  }
  return segments;
}

function resolveShortName(window: ProviderUsageWindow): UsageText {
  const key = SHORT_NAME_KEYS[window.id];
  if (key) return { key };
  if (window.label.startsWith(SCOPED_WEEKLY_PREFIX)) {
    return { text: window.label.slice(SCOPED_WEEKLY_PREFIX.length) };
  }
  return { text: window.label };
}

interface WindowTrailing {
  short: PlanUsageStripTrailing;
  /** 无障碍描述里用完整说法（「4d 后重置」），窄栏上只写时长。 */
  full: UsageText;
}

function resolveTrailing(window: ProviderUsageWindow, now: number): WindowTrailing | null {
  const runsOutBeforeReset = window.runsOutAt != null && window.shortfallPct != null;
  if (runsOutBeforeReset) {
    const duration = formatShortDuration(window.runsOutAt, now);
    const full = describeRunsOut(window.runsOutAt, now);
    if (duration && full) {
      const text: UsageText = { key: "usage.planUsage.strip.runsOut", params: { duration } };
      return { short: { text, atRisk: true }, full };
    }
  }
  const full = describeReset(window.resetsAt, now);
  if (!full) return null;
  const duration = formatShortDuration(window.resetsAt, now);
  // 到点后没有时长可写，窄栏也说「正在重置」。
  let text: UsageText = full;
  if (duration) text = { text: duration };
  return { short: { text, atRisk: false }, full };
}

function resolveWindowSegment(
  window: ProviderUsageWindow,
  now: number,
): PlanUsageStripWindowSegment {
  const usedPct = resolveWindowUsedPct(window);
  let percentText = "—";
  if (usedPct !== null) percentText = formatPct(usedPct);
  const ringPct = clampPct(usedPct ?? 0);
  const tone = window.tone ?? deriveTone(usedPct);
  const shortName = resolveShortName(window);
  const trailing = resolveTrailing(window, now);
  const shortTrailing = trailing ? trailing.short : null;
  const accessibilityLabel = describeWindow({
    label: window.label,
    percent: percentText,
    trailing,
  });
  return {
    kind: "window",
    key: window.id,
    shortName,
    ringPct,
    percentText,
    tone,
    trailing: shortTrailing,
    accessibilityLabel,
  };
}

interface WindowDescriptionInput {
  label: string;
  percent: string;
  trailing: WindowTrailing | null;
}

function describeWindow({ label, percent, trailing }: WindowDescriptionInput): UsageText {
  if (!trailing) {
    return { key: "usage.planUsage.strip.windowA11yNoTrailing", params: { label, percent } };
  }
  return {
    key: "usage.planUsage.strip.windowA11y",
    params: { label, percent, trailing: trailing.full },
  };
}

export interface PlanUsageStripMeasuredSegment extends Pick<PlanUsageStripSegment, "key" | "kind"> {
  width: number;
}

/** 窄栏量出来、交给套餐仪表做取舍的空间。 */
export interface PlanUsageStripSpace {
  /** 分支名和套餐仪表一起能用的宽度，已扣除两者之间的间距。 */
  availableWidth: number;
  /** 空间不够时分支名要保留的宽度；没有分支名时为 0。 */
  branchReservedWidth: number;
}

export interface PlanUsageStripFitInput extends PlanUsageStripSpace {
  /** 按显示顺序排列的分段及其实测宽度（含仪表外框）。 */
  segments: readonly PlanUsageStripMeasuredSegment[];
}

/**
 * 窄栏放不下时的取舍，返回要显示的分段 key：先从末尾隐藏窗口段，再隐藏套餐名段，
 * 第一个窗口段始终保留。分支名在剩下的空间里照常截断。
 */
export function fitPlanUsageStripSegments(input: PlanUsageStripFitInput): string[] {
  const budget = input.availableWidth - input.branchReservedWidth;
  const windows = input.segments.filter((segment) => segment.kind === "window");
  const plans = input.segments.filter((segment) => segment.kind === "plan");
  const hideOrder = [...windows.slice(1).toReversed(), ...plans];
  let width = input.segments.reduce((total, segment) => total + segment.width, 0);
  const hidden = new Set<string>();
  for (const segment of hideOrder) {
    if (width <= budget) break;
    hidden.add(segment.key);
    width -= segment.width;
  }
  return input.segments.filter((segment) => !hidden.has(segment.key)).map((segment) => segment.key);
}
