import { baseColors } from "@/styles/theme";
import { mixHexColor } from "@/utils/color";

// 少于 2 档的滑条没有意义，多于 6 档时档位太挤，这两种情况都回到列表。
export const THINKING_SLIDER_MIN_OPTIONS = 2;
export const THINKING_SLIDER_MAX_OPTIONS = 6;

// 渐变起点：品牌色向白色混合的比例。
export const THINKING_BRAND_TINT = 0.55;

const PARTICLE_COUNT_MIN = 3;
const PARTICLE_COUNT_MAX = 14;
const PARTICLE_DRIFT_MS_SLOWEST = 3400;
const PARTICLE_DRIFT_MS_FASTEST = 1200;

export interface ThinkingGradient {
  from: string;
  to: string;
}

export interface ThinkingParticles {
  count: number;
  driftMs: number;
}

export interface ThinkingParticleLayout {
  /** 在填充区内的位置，0 到 1。 */
  left: number;
  top: number;
  size: number;
  /** 本颗光点动画的起始偏移，0 到 1 个周期。 */
  phase: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function shouldUseThinkingSlider(optionCount: number): boolean {
  return optionCount >= THINKING_SLIDER_MIN_OPTIONS && optionCount <= THINKING_SLIDER_MAX_OPTIONS;
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
    driftMs: Math.round(
      PARTICLE_DRIFT_MS_SLOWEST - level * (PARTICLE_DRIFT_MS_SLOWEST - PARTICLE_DRIFT_MS_FASTEST),
    ),
  };
}

// 黄金分割序列：光点位置固定可复现，又不会排成整齐的格子。
const GOLDEN_RATIO_FRACTION = 0.618033988749895;

export function resolveThinkingParticleLayout(index: number): ThinkingParticleLayout {
  const spread = (seed: number) => (seed * GOLDEN_RATIO_FRACTION) % 1;
  return {
    left: 0.06 + spread(index + 1) * 0.88,
    top: 0.2 + spread(index * 7 + 3) * 0.6,
    size: 2 + Math.round(spread(index * 3 + 2) * 2),
    phase: spread(index * 5 + 1),
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
