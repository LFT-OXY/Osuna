import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  FIT_TRANSFORM,
  fitContentSize,
  isPointInsideTransformedContent,
  panContent,
  topAlignedTransform,
  zoomContentAtPoint,
  type ViewportPoint,
  type ViewportSize,
  type ViewportTransform,
} from "./geometry";
import { ViewportToolbar, ViewportZoomBar } from "./toolbar";
import type { ZoomableViewportProps } from "./types";

const DEFAULT_MAX_SCALE = 8;
const DEFAULT_MIN_SCALE = 0.25;

interface DragGesture {
  type: "drag";
  pointerId: number;
  startPoint: ViewportPoint;
  startTransform: ViewportTransform;
}

interface PinchGesture {
  type: "pinch";
  distance: number;
  midpoint: ViewportPoint;
}

type ActiveGesture = DragGesture | PinchGesture;

function midpoint(points: ViewportPoint[]): ViewportPoint {
  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  };
}

function distance(points: ViewportPoint[]): number {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

/**
 * 指针真的拖动起来才捕获：按下就捕获的话，抬起和点击都落到画布上，内容里可点的东西（逻辑图的子图卡片）收不到。
 */
function capturePointer(event: React.PointerEvent<HTMLDivElement>) {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
}

export function ZoomableViewport({
  contentSize,
  children,
  actions = [],
  accessibilityLabel,
  fit,
  initialPosition = "center",
  controls = "hover-icons",
  renderAtContentSize = false,
  panWithinViewport = false,
  maxScale = DEFAULT_MAX_SCALE,
  minScale = DEFAULT_MIN_SCALE,
  onPressOutsideContent,
  style,
  testID,
  wheelActivation = "modifier",
  wheelPan = false,
}: ZoomableViewportProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, ViewportPoint>());
  const gestureRef = useRef<ActiveGesture | null>(null);
  const suppressClickRef = useRef(false);
  const transformRef = useRef<ViewportTransform>(FIT_TRANSFORM);
  const [viewport, setViewport] = useState<ViewportSize | null>(null);
  const [transform, setTransform] = useState<ViewportTransform>(FIT_TRANSFORM);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [hasTouchInput, setHasTouchInput] = useState(false);
  const fittedContent = useMemo(
    () => (viewport ? fitContentSize(contentSize, viewport, fit) : null),
    [contentSize, fit, viewport],
  );
  const limits = useMemo(
    () => ({ minScale, maxScale, panWithinViewport }),
    [maxScale, minScale, panWithinViewport],
  );
  const initialTransform = useMemo(
    () =>
      initialPosition === "top" && fittedContent && viewport
        ? topAlignedTransform({ fittedContent, viewport, limits })
        : FIT_TRANSFORM,
    [fittedContent, initialPosition, limits, viewport],
  );

  const commitTransform = useCallback((next: ViewportTransform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);
  const reset = useCallback(
    () => commitTransform(initialTransform),
    [commitTransform, initialTransform],
  );
  const canPanAt = useCallback(
    (scale: number) =>
      Boolean(
        fittedContent &&
        viewport &&
        (fittedContent.width * scale > viewport.width ||
          fittedContent.height * scale > viewport.height),
      ),
    [fittedContent, viewport],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => reset(), [contentSize.height, contentSize.width, reset, viewport]);

  const zoomAt = useCallback(
    (scale: number, focalPoint: ViewportPoint) => {
      if (!fittedContent || !viewport) return;
      commitTransform(
        zoomContentAtPoint({
          transform: transformRef.current,
          scale,
          focalPoint,
          fittedContent,
          viewport,
          limits,
        }),
      );
    },
    [commitTransform, fittedContent, limits, viewport],
  );
  const zoomFromCenter = useCallback(
    (factor: number) => {
      if (!viewport) return;
      zoomAt(transformRef.current.scale * factor, {
        x: viewport.width / 2,
        y: viewport.height / 2,
      });
    },
    [viewport, zoomAt],
  );
  const zoomIn = useCallback(() => zoomFromCenter(1.25), [zoomFromCenter]);
  const panBy = useCallback(
    (delta: ViewportPoint) => {
      if (!fittedContent || !viewport) return;
      commitTransform(
        panContent({ transform: transformRef.current, delta, fittedContent, viewport, limits }),
      );
    },
    [commitTransform, fittedContent, limits, viewport],
  );
  const zoomOut = useCallback(() => zoomFromCenter(0.8), [zoomFromCenter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const activeCanvas = canvas;
    function zoomWithWheel(event: WheelEvent) {
      const hasModifier = event.ctrlKey || event.metaKey;
      if (wheelActivation === "modifier" && !hasModifier) {
        if (wheelPan) {
          event.preventDefault();
          panBy({ x: -event.deltaX, y: -event.deltaY });
        }
        return;
      }
      event.preventDefault();
      const bounds = activeCanvas.getBoundingClientRect();
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.01)));
      zoomAt(transformRef.current.scale * factor, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    }
    activeCanvas.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => activeCanvas.removeEventListener("wheel", zoomWithWheel);
  }, [panBy, wheelActivation, wheelPan, zoomAt]);

  const beginPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.pointerType !== "mouse") setHasTouchInput(true);
      if (pointersRef.current.size === 0) suppressClickRef.current = false;
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = Array.from(pointersRef.current.values());
      if (points.length >= 2) {
        gestureRef.current = {
          type: "pinch",
          distance: distance(points),
          midpoint: midpoint(points),
        };
        setIsDragging(true);
        return;
      }
      gestureRef.current = {
        type: "drag",
        pointerId: event.pointerId,
        startPoint: points[0],
        startTransform: transformRef.current,
      };
      setIsDragging(canPanAt(transformRef.current.scale));
    },
    [canPanAt],
  );

  const movePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(event.pointerId) || !fittedContent || !viewport) return;
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const gesture = gestureRef.current;
      const points = Array.from(pointersRef.current.values());
      if (gesture?.type === "pinch" && points.length >= 2) {
        suppressClickRef.current = true;
        capturePointer(event);
        const nextMidpoint = midpoint(points);
        const nextDistance = distance(points);
        const panned = panContent({
          transform: transformRef.current,
          delta: {
            x: nextMidpoint.x - gesture.midpoint.x,
            y: nextMidpoint.y - gesture.midpoint.y,
          },
          fittedContent,
          viewport,
          limits,
        });
        const next = zoomContentAtPoint({
          transform: panned,
          scale: panned.scale * (nextDistance / gesture.distance),
          focalPoint: nextMidpoint,
          fittedContent,
          viewport,
          limits,
        });
        gestureRef.current = { type: "pinch", distance: nextDistance, midpoint: nextMidpoint };
        commitTransform(next);
        return;
      }
      if (gesture?.type !== "drag" || gesture.pointerId !== event.pointerId) return;
      if (
        Math.hypot(event.clientX - gesture.startPoint.x, event.clientY - gesture.startPoint.y) > 3
      ) {
        suppressClickRef.current = true;
        capturePointer(event);
      }
      commitTransform(
        panContent({
          transform: gesture.startTransform,
          delta: {
            x: event.clientX - gesture.startPoint.x,
            y: event.clientY - gesture.startPoint.y,
          },
          fittedContent,
          viewport,
          limits,
        }),
      );
    },
    [commitTransform, fittedContent, limits, viewport],
  );

  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const remaining = Array.from(pointersRef.current.entries());
      if (remaining.length === 1) {
        const [pointerId, point] = remaining[0];
        gestureRef.current = {
          type: "drag",
          pointerId,
          startPoint: point,
          startTransform: transformRef.current,
        };
        setIsDragging(canPanAt(transformRef.current.scale));
        return;
      }
      gestureRef.current = null;
      setIsDragging(false);
    },
    [canPanAt],
  );

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (!fittedContent || !viewport || !onPressOutsideContent) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const isInside = isPointInsideTransformedContent({
        point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        transform: transformRef.current,
        fittedContent,
        viewport,
      });
      if (!isInside) onPressOutsideContent();
    },
    [fittedContent, onPressOutsideContent, viewport],
  );

  const renderedCanvasStyle = useMemo<React.CSSProperties>(() => {
    let cursor: React.CSSProperties["cursor"] = "default";
    if (canPanAt(transform.scale)) cursor = isDragging ? "grabbing" : "grab";
    return { ...canvasDomStyle, cursor };
  }, [canPanAt, isDragging, transform.scale]);
  // 适配比例：内容原始尺寸到适配尺寸；百分比与按原始尺寸排版都要乘上它。
  const fitRatio = fittedContent ? fittedContent.width / contentSize.width : 1;
  const renderedContentStyle = useMemo<React.CSSProperties>(() => {
    if (renderAtContentSize && fittedContent) {
      // 子元素按原始尺寸排版，再连同适配比例一起缩放；居中排版下视觉上与按适配尺寸排版一致。
      return {
        ...contentDomStyle,
        width: contentSize.width,
        height: contentSize.height,
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale * fitRatio})`,
      };
    }
    return {
      ...contentDomStyle,
      width: fittedContent?.width ?? 0,
      height: fittedContent?.height ?? 0,
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
    };
  }, [contentSize, fitRatio, fittedContent, renderAtContentSize, transform]);
  const controlsVisible = isHovered || isFocusWithin || hasTouchInput;
  const isAtInitialView =
    transform.scale === initialTransform.scale &&
    transform.x === initialTransform.x &&
    transform.y === initialTransform.y;
  const handleFocus = useCallback(() => setIsFocusWithin(true), []);
  const handleBlur = useCallback(() => setIsFocusWithin(false), []);
  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  return (
    <View style={[styles.root, style]} testID={testID}>
      <div
        aria-label={accessibilityLabel}
        data-testid={testID ? `${testID}-canvas` : undefined}
        onClick={handleCanvasClick}
        onDoubleClick={reset}
        onFocusCapture={handleFocus}
        onBlurCapture={handleBlur}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerCancel={endPointer}
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        ref={canvasRef}
        role={accessibilityLabel ? "img" : undefined}
        style={renderedCanvasStyle}
      >
        <div style={renderedContentStyle}>{children}</div>
      </div>
      <div
        onBlurCapture={handleBlur}
        onFocusCapture={handleFocus}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={toolbarDomStyle}
      >
        {controls === "hover-icons" ? (
          <ViewportToolbar
            actions={actions}
            maxScale={maxScale}
            minScale={minScale}
            onReset={reset}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            resetDisabled={isAtInitialView}
            scale={transform.scale}
            visible={controlsVisible}
          />
        ) : null}
      </div>
      {controls === "zoom-bar" ? (
        <ViewportZoomBar
          displayScale={transform.scale * fitRatio}
          maxScale={maxScale}
          minScale={minScale}
          onReset={reset}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          resetDisabled={isAtInitialView}
          scale={transform.scale}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  root: { flex: 1, minHeight: 0, overflow: "hidden", position: "relative" },
}));

const canvasDomStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  touchAction: "none",
  userSelect: "none",
};
const contentDomStyle: React.CSSProperties = {
  flexShrink: 0,
  transformOrigin: "center center",
};
const toolbarDomStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  width: 200,
  height: 48,
  zIndex: 1,
};
