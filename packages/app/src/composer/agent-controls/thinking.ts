import { baseColors } from "@/styles/theme";
import { mixHexColor } from "@/utils/color";

// 渐变起点：品牌色向白色混合的比例。
export const THINKING_BRAND_TINT = 0.55;

const PARTICLE_COUNT_MIN = 3;
const PARTICLE_COUNT_MAX = 12;
// 一颗光点从填充区左端走到右端所用的时间。
const PARTICLE_TRAVEL_MS_SLOWEST = 2600;
const PARTICLE_TRAVEL_MS_FASTEST = 900;

export interface ThinkingGradient {
  from: string;
  to: string;
}

/** hidden：没有思考选项；locked：只有 1 档，触发器置灰不可点；slider：2 档及以上。 */
export type ThinkingControlState = "hidden" | "locked" | "slider";

export interface ThinkingParticles {
  count: number;
  travelMs: number;
}

export interface ThinkingParticleLayout {
  /** 出发高度，填充区高度的 0 到 1。 */
  top: number;
  size: number;
  /** 本颗光点在流动周期里的起始偏移，0 到 1。 */
  phase: number;
  /** 走完一趟闪烁几次。 */
  twinkles: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function resolveThinkingControlState(optionCount: number): ThinkingControlState {
  if (optionCount <= 0) return "hidden";
  return optionCount === 1 ? "locked" : "slider";
}

/** 各档在轨道上的位置，0 为最左、1 为最右。 */
export function resolveThinkingStopPositions(optionCount: number): number[] {
  if (optionCount <= 1) return [0];
  return Array.from({ length: optionCount }, (_, index) => index / (optionCount - 1));
}

/** 把轨道上的位置（0 到 1，可越界）吸附到最近一档；正好在两档中点时取高的一档。 */
export function snapThinkingPosition(position: number, optionCount: number): number {
  if (optionCount <= 1) return 0;
  return Math.round(clamp01(position) * (optionCount - 1));
}

export function stepThinkingIndex(index: number, delta: 1 | -1, optionCount: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(optionCount - 1, 0));
}

/** 档位序号在整段区间里的线性位置，最低档 0，最高档 1。 */
export function resolveThinkingParticleIntensity(index: number, optionCount: number): number {
  if (optionCount <= 1) return 0;
  return clamp01(index / (optionCount - 1));
}

export function resolveThinkingParticles(intensity: number): ThinkingParticles {
  const level = clamp01(intensity);
  return {
    count: Math.round(PARTICLE_COUNT_MIN + level * (PARTICLE_COUNT_MAX - PARTICLE_COUNT_MIN)),
    travelMs: Math.round(
      PARTICLE_TRAVEL_MS_SLOWEST -
        level * (PARTICLE_TRAVEL_MS_SLOWEST - PARTICLE_TRAVEL_MS_FASTEST),
    ),
  };
}

// 黄金分割序列：光点参数固定可复现，任意前 n 颗都能大致均匀地错开，数量变化时不用重排。
const GOLDEN_RATIO_FRACTION = 0.618033988749895;

export function resolveThinkingParticleLayout(index: number): ThinkingParticleLayout {
  const spread = (seed: number) => (seed * GOLDEN_RATIO_FRACTION) % 1;
  return {
    top: 0.18 + spread(index * 7 + 3) * 0.64,
    size: 2 + Math.round(spread(index * 3 + 2) * 2),
    phase: spread(index + 1),
    twinkles: 2 + Math.round(spread(index * 5 + 4) * 2),
  };
}

/** 已填充部分的渐变：品牌色的浅色版到品牌色；没有品牌色时用主题给的兜底渐变。 */
export function resolveThinkingGradient(
  brandColor: string | null,
  fallback: ThinkingGradient,
): ThinkingGradient {
  if (!brandColor) return fallback;
  return {
    from: mixHexColor(brandColor, baseColors.white, THINKING_BRAND_TINT),
    to: brandColor,
  };
}
