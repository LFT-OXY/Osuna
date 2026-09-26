// 扫光按固定帧率分段前进，而不是每个显示帧都重绘：一屏多个运行中的工具行时也保持安静。
export const SHIMMER_FRAMES_PER_SECOND = 10;

/** 运行中状态行的一次扫光时长，与原型一致（2.4s 分 24 段）。 */
export const WORKING_SHIMMER_DURATION_SECONDS = 2.4;

export function shimmerSteps(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds * SHIMMER_FRAMES_PER_SECOND));
}

/** 原生扫光峰的宽度：约为扫过区域的 28%，限制在 32–120 之间。 */
export function resolveNativeShimmerPeakWidth(sweptWidth: number): number {
  return Math.max(32, Math.min(120, sweptWidth * 0.28));
}

/** 原生端的分段：把 0–1 的连续进度落到当前所在段的起点。 */
export function quantizeShimmerProgress(progress: number, steps: number): number {
  "worklet";
  return Math.floor(progress * steps) / steps;
}
