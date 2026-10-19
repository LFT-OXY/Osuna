export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ViewportScaleLimits {
  minScale: number;
  maxScale: number;
  /** 内容比视口小的方向上也能在视口内移动，不强制居中（内容始终整个留在视口里）。 */
  panWithinViewport?: boolean;
}

export interface ViewportFitOptions {
  padding?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** contain：整块放进视口（默认）；width：只按宽度铺满，高出的部分靠拖动看。 */
  mode?: "contain" | "width";
  /** 适配时最多放大到的倍数；不填则可以放大。 */
  maxFitScale?: number;
  /** 适配时最少缩到的倍数；内容更宽时不再缩小，超出的部分靠拖动看。 */
  minFitScale?: number;
}

export const FIT_TRANSFORM: ViewportTransform = { scale: 1, x: 0, y: 0 };

export function isActivePinchUpdate(activeTouches: number, reportedPointers: number): boolean {
  "worklet";
  return activeTouches >= 2 && reportedPointers >= 2;
}

export function isPointInsideTransformedContent(input: {
  point: ViewportPoint;
  transform: ViewportTransform;
  fittedContent: ViewportSize;
  viewport: ViewportSize;
}): boolean {
  "worklet";
  const centerX = input.viewport.width / 2 + input.transform.x;
  const centerY = input.viewport.height / 2 + input.transform.y;
  const halfWidth = (input.fittedContent.width * input.transform.scale) / 2;
  const halfHeight = (input.fittedContent.height * input.transform.scale) / 2;
  return (
    input.point.x >= centerX - halfWidth &&
    input.point.x <= centerX + halfWidth &&
    input.point.y >= centerY - halfHeight &&
    input.point.y <= centerY + halfHeight
  );
}

export function fitContentSize(
  content: ViewportSize,
  viewport: ViewportSize,
  options: ViewportFitOptions = {},
): ViewportSize {
  const padding = options.padding ?? 0;
  const availableWidth = Math.max(
    0,
    Math.min(viewport.width - padding * 2, options.maxWidth ?? Number.POSITIVE_INFINITY),
  );
  const availableHeight = Math.max(
    0,
    Math.min(viewport.height - padding * 2, options.maxHeight ?? Number.POSITIVE_INFINITY),
  );
  const widthScale = availableWidth / content.width;
  const containScale = Math.min(widthScale, availableHeight / content.height);
  const fitScale = Math.max(
    options.minFitScale ?? 0,
    Math.min(
      options.mode === "width" ? widthScale : containScale,
      options.maxFitScale ?? Number.POSITIVE_INFINITY,
    ),
  );
  return {
    width: content.width * fitScale,
    height: content.height * fitScale,
  };
}

function clampScale(scale: number, limits: ViewportScaleLimits): number {
  return Math.min(limits.maxScale, Math.max(limits.minScale, scale));
}

function clampOffset(offset: number, maximum: number): number {
  if (maximum === 0) {
    return 0;
  }
  return Math.min(maximum, Math.max(-maximum, offset));
}

export function clampTransform(
  transform: ViewportTransform,
  fittedContent: ViewportSize,
  viewport: ViewportSize,
  limits: ViewportScaleLimits,
): ViewportTransform {
  const scale = clampScale(transform.scale, limits);
  const slack = (content: number, available: number) =>
    limits.panWithinViewport
      ? Math.abs(content * scale - available) / 2
      : Math.max(0, (content * scale - available) / 2);
  const maxX = slack(fittedContent.width, viewport.width);
  const maxY = slack(fittedContent.height, viewport.height);
  return {
    scale,
    x: clampOffset(transform.x, maxX),
    y: clampOffset(transform.y, maxY),
  };
}

export function zoomContentAtPoint(input: {
  transform: ViewportTransform;
  scale: number;
  focalPoint: ViewportPoint;
  fittedContent: ViewportSize;
  viewport: ViewportSize;
  limits: ViewportScaleLimits;
}): ViewportTransform {
  const scale = clampScale(input.scale, input.limits);
  const viewportCenter = {
    x: input.viewport.width / 2,
    y: input.viewport.height / 2,
  };
  const contentPoint = {
    x: (input.focalPoint.x - viewportCenter.x - input.transform.x) / input.transform.scale,
    y: (input.focalPoint.y - viewportCenter.y - input.transform.y) / input.transform.scale,
  };
  return clampTransform(
    {
      scale,
      x: input.focalPoint.x - viewportCenter.x - contentPoint.x * scale,
      y: input.focalPoint.y - viewportCenter.y - contentPoint.y * scale,
    },
    input.fittedContent,
    input.viewport,
    input.limits,
  );
}

export function panContent(input: {
  transform: ViewportTransform;
  delta: ViewportPoint;
  fittedContent: ViewportSize;
  viewport: ViewportSize;
  limits: ViewportScaleLimits;
}): ViewportTransform {
  return clampTransform(
    {
      ...input.transform,
      x: input.transform.x + input.delta.x,
      y: input.transform.y + input.delta.y,
    },
    input.fittedContent,
    input.viewport,
    input.limits,
  );
}

/**
 * 打开和复位时的"从顶部看起"：内容顶边贴着视口顶边；比视口宽时左边缘贴着视口左边，否则水平居中。
 * 内容比视口矮时，只有允许在视口内移动（panWithinViewport）才能贴顶，否则仍居中。
 */
export function topAlignedTransform(input: {
  fittedContent: ViewportSize;
  viewport: ViewportSize;
  limits: ViewportScaleLimits;
}): ViewportTransform {
  return clampTransform(
    {
      scale: 1,
      x: Math.max(0, (input.fittedContent.width - input.viewport.width) / 2),
      y: (input.fittedContent.height - input.viewport.height) / 2,
    },
    input.fittedContent,
    input.viewport,
    input.limits,
  );
}
