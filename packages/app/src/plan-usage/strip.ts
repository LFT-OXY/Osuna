import { clampPct, formatPct } from "@/usage/format";
import { displayPercent } from "@/usage/model";
import type { UsageDisplayAs } from "@/usage/preferences";
import { windowTone } from "@/usage/tone";
import type { UsageReportEntry, UsageTone, UsageWindow } from "@/usage/types";
import { formatShortDuration } from "@/usage-stats/relative-time";
import type { UsageText } from "@/usage-stats/text";

// 提供方自己没有同名的套餐用量来源时，它的订阅额度来自这里列的来源。
const SUBSCRIPTION_SOURCE_IDS: Record<string, readonly string[]> = {
  opencode: ["opencode-go"],
};

export interface PlanUsageStripReportInput {
  /** 当前 Agent（或草稿）所属的提供方。 */
  providerId: string;
  /**
   * daemon 按这个 Agent 实际所用的登录报出的账号。null 表示没有可问的 Agent（草稿）、
   * 还没问到，或者没问成。
   */
  agentReports: readonly UsageReportEntry[] | null;
  /** 主机上的全部账号；null 表示还没取到。 */
  hostReports: readonly UsageReportEntry[] | null;
}

/**
 * 用量条显示哪个账号。daemon 说得出这个 Agent 用的是哪个账号时就是它，与上下文圆环
 * 悬浮卡里的是同一个；说不出时（草稿、提供方不随会话报账号）退回主机上该提供方的第一个账号。
 */
export function selectPlanUsageStripReport(
  input: PlanUsageStripReportInput,
): UsageReportEntry | null {
  const agentReport = input.agentReports?.[0];
  if (agentReport) return agentReport;
  const providerId = input.providerId.toLowerCase();
  const subscriptionSourceIds = SUBSCRIPTION_SOURCE_IDS[providerId] ?? [];
  for (const entry of input.hostReports ?? []) {
    const sourceId = entry.sourceId.toLowerCase();
    if (sourceId === providerId) return entry;
    if (subscriptionSourceIds.includes(sourceId)) return entry;
  }
  return null;
}

export interface PlanUsageStripInput {
  /** `selectPlanUsageStripReport` 选出的账号；没有时整块不显示。 */
  entry: UsageReportEntry | null;
  /**
   * 该提供方启用了第三方接口时，套餐额度不代表实际消耗。null 表示提供方快照还没到，
   * 先不显示，免得仪表出现后又因为第三方接口消失。
   */
  hasActiveApiEndpoint: boolean | null;
  /** 百分比写已用还是剩余，跟随套餐用量的偏好。 */
  displayAs: UsageDisplayAs;
  now: number;
}

/** 窗口的尾部文字：重置时长，或者会在重置前用完时的用完时长（atRisk，危险色）。 */
export interface PlanUsageStripTrailing {
  text: UsageText;
  atRisk: boolean;
}

export interface PlanUsageStripPlanSegment {
  kind: "plan";
  key: "plan";
  /** 来源的图标（SVG 原文）；来源没带图标时为 null。 */
  icon: string | null;
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
  tone: UsageTone;
  /** 短说法：只写时长，或者「X后用完」。 */
  trailing: PlanUsageStripTrailing | null;
  accessibilityLabel: UsageText;
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
 * Composer context strip 上的套餐仪表。返回 null 表示整块不显示：没有账号可显示、
 * 账号不可用，或者它没有可显示的窗口。余额和明细只在悬停卡片里。
 */
export function resolvePlanUsageStrip(input: PlanUsageStripInput): PlanUsageStripSegment[] | null {
  const { entry } = input;
  if (!entry) return null;
  const isKnownOfficialEndpoint = input.hasActiveApiEndpoint === false;
  if (!isKnownOfficialEndpoint) return null;
  const usage = entry.report;
  if (usage.status !== "available") return null;
  if (usage.windows.length === 0) return null;
  const segments: PlanUsageStripSegment[] = [];
  const { planLabel } = usage;
  if (planLabel) {
    const icon = entry.icon ?? null;
    const provider = entry.sourceLabel;
    segments.push({
      kind: "plan",
      key: "plan",
      icon,
      label: planLabel,
      accessibilityLabel: {
        key: "usage.planUsage.strip.planA11y",
        params: { provider, plan: planLabel },
      },
    });
  }
  for (const window of usage.windows) {
    segments.push(resolveWindowSegment(window, input));
  }
  return segments;
}

function resolveShortName(window: UsageWindow): UsageText {
  const key = SHORT_NAME_KEYS[window.id];
  if (key) return { key };
  if (window.label.startsWith(SCOPED_WEEKLY_PREFIX)) {
    return { text: window.label.slice(SCOPED_WEEKLY_PREFIX.length) };
  }
  return { text: window.label };
}

/** 完整说法里的「还有多久重置」。到点了说「正在重置」，而不是倒数一个负数。 */
function describeReset(iso: string | null | undefined, now: number): UsageText | null {
  if (!iso) return null;
  const remaining = new Date(iso).getTime() - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return { key: "usage.planUsage.resettingNow" };
  const duration = formatShortDuration(iso, now);
  if (!duration) return null;
  return { key: "usage.planUsage.resets", params: { duration } };
}

/**
 * 完整说法（「4d 后重置」「1h 后用完」），读屏用。与上游窗口条同一批翻译键；这里另算一遍
 * 是因为用量条跟着传进来的时钟倒数，上游的 `formatResetLabel` 读的是系统时间。
 */
function resolveFullTrailing(window: UsageWindow, now: number): PlanUsageStripTrailing | null {
  if (window.runsOutAt != null && window.shortfallPct != null) {
    const duration = formatShortDuration(window.runsOutAt, now);
    if (duration) {
      return { text: { key: "usage.planUsage.runsOut", params: { duration } }, atRisk: true };
    }
  }
  const reset = describeReset(window.resetsAt, now);
  if (!reset) return null;
  return { text: reset, atRisk: false };
}

/** 窄栏只写时长；用完写「X后用完」，到点后没有时长可写，沿用完整说法「正在重置」。 */
function shortenTrailing(
  window: UsageWindow,
  trailing: PlanUsageStripTrailing,
  now: number,
): PlanUsageStripTrailing {
  if (trailing.atRisk) {
    const duration = formatShortDuration(window.runsOutAt, now);
    if (!duration) return trailing;
    return { text: { key: "usage.planUsage.strip.runsOut", params: { duration } }, atRisk: true };
  }
  const duration = formatShortDuration(window.resetsAt, now);
  if (!duration) return trailing;
  return { text: { text: duration }, atRisk: false };
}

function resolveWindowSegment(
  window: UsageWindow,
  input: Pick<PlanUsageStripInput, "displayAs" | "now">,
): PlanUsageStripWindowSegment {
  const shownPct = displayPercent(window, input.displayAs);
  let percentText = "—";
  if (shownPct != null) percentText = formatPct(shownPct);
  const fullTrailing = resolveFullTrailing(window, input.now);
  let trailing: PlanUsageStripTrailing | null = null;
  if (fullTrailing) trailing = shortenTrailing(window, fullTrailing, input.now);
  const accessibilityLabel = describeWindow({
    label: window.label,
    percent: percentText,
    displayAs: input.displayAs,
    trailing: fullTrailing,
  });
  const shortName = resolveShortName(window);
  const ringPct = clampPct(shownPct ?? 0);
  const tone = windowTone(window);
  return {
    kind: "window",
    key: window.id,
    shortName,
    ringPct,
    percentText,
    tone,
    trailing,
    accessibilityLabel,
  };
}

interface WindowDescriptionInput {
  label: string;
  percent: string;
  displayAs: UsageDisplayAs;
  trailing: PlanUsageStripTrailing | null;
}

// 圆环旁只写数字；读屏的说法里写明它是已用的还是剩下的。
const WINDOW_A11Y_KEYS = {
  used: {
    withTrailing: "usage.planUsage.strip.windowA11y",
    alone: "usage.planUsage.strip.windowA11yNoTrailing",
  },
  remaining: {
    withTrailing: "usage.planUsage.strip.windowA11yLeft",
    alone: "usage.planUsage.strip.windowA11yLeftNoTrailing",
  },
} as const satisfies Record<UsageDisplayAs, { withTrailing: string; alone: string }>;

function describeWindow({
  label,
  percent,
  displayAs,
  trailing,
}: WindowDescriptionInput): UsageText {
  const keys = WINDOW_A11Y_KEYS[displayAs];
  if (!trailing) return { key: keys.alone, params: { label, percent } };
  return { key: keys.withTrailing, params: { label, percent, trailing: trailing.text } };
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
