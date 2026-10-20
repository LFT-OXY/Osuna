import { useCallback, useEffect, useMemo, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import {
  FIT_TRANSFORM,
  fitContentSize,
  isActivePinchUpdate,
  isPointInsideTransformedContent,
  topAlignedTransform,
  zoomContentAtPoint,
  type ViewportSize,
} from "./geometry";
import { ViewportToolbar, ViewportZoomBar } from "./toolbar";
import type { ZoomableViewportProps } from "./types";

const DEFAULT_MAX_SCALE = 8;
const DEFAULT_MIN_SCALE = 0.25;

export function ZoomableViewport({
  contentSize,
  children,
  actions = [],
  accessibilityLabel,
  fit,
  initialPosition = "center",
  controls = "hover-icons",
  renderAtContentSize = false,
  maxScale = DEFAULT_MAX_SCALE,
  minScale = DEFAULT_MIN_SCALE,
  onPressOutsideContent,
  style,
  testID,
}: ZoomableViewportProps) {
  const [viewport, setViewport] = useState<ViewportSize | null>(null);
  const [toolbarScale, setToolbarScale] = useState(1);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);
  const pinchReady = useSharedValue(false);
  const pinchTouchCount = useSharedValue(0);
  const fittedContent = useMemo(
    () => (viewport ? fitContentSize(contentSize, viewport, fit) : null),
    [contentSize, fit, viewport],
  );

  const initialTransform = useMemo(
    () =>
      initialPosition === "top" && fittedContent && viewport
        ? topAlignedTransform({ fittedContent, viewport, limits: { minScale, maxScale } })
        : FIT_TRANSFORM,
    [fittedContent, initialPosition, maxScale, minScale, viewport],
  );
  // 适配比例：内容原始尺寸到适配尺寸。按原始尺寸排版时缩放要再乘上它，百分比也按它算。
  const fitRatio = fittedContent ? fittedContent.width / contentSize.width : 1;
  const contentScaleRatio = renderAtContentSize ? fitRatio : 1;

  const reset = useCallback(() => {
    scale.value = initialTransform.scale;
    translateX.value = initialTransform.x;
    translateY.value = initialTransform.y;
    setToolbarScale(initialTransform.scale);
  }, [initialTransform, scale, translateX, translateY]);

  useEffect(() => reset(), [contentSize.height, contentSize.width, reset, viewport]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onBegin(() => {
          startX.value = translateX.value;
          startY.value = translateY.value;
        })
        .onUpdate((event) => {
          if (!fittedContent || !viewport || scale.value <= minScale) return;
          const maxX = Math.max(0, (fittedContent.width * scale.value - viewport.width) / 2);
          const maxY = Math.max(0, (fittedContent.height * scale.value - viewport.height) / 2);
          translateX.value = Math.min(maxX, Math.max(-maxX, startX.value + event.translationX));
          translateY.value = Math.min(maxY, Math.max(-maxY, startY.value + event.translationY));
        }),
    [fittedContent, minScale, scale, startX, startY, translateX, translateY, viewport],
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onTouchesDown((event) => {
          pinchTouchCount.value = event.numberOfTouches;
        })
        .onTouchesUp((event) => {
          pinchTouchCount.value = event.numberOfTouches;
        })
        .onBegin((event) => {
          pinchTouchCount.value = event.numberOfPointers;
          startScale.value = scale.value;
          startX.value = translateX.value;
          startY.value = translateY.value;
          pinchReady.value = false;
        })
        .onUpdate((event) => {
          if (!fittedContent || !viewport) return;
          // Android emits one final pinch update after a finger lifts. Its focal point belongs to
          // the remaining pointer, so applying it makes the content jump as the gesture ends.
          if (!isActivePinchUpdate(pinchTouchCount.value, event.numberOfPointers)) return;
          if (!pinchReady.value) {
            pinchFocalX.value = event.focalX;
            pinchFocalY.value = event.focalY;
            pinchReady.value = true;
          }
          const nextScale = Math.min(maxScale, Math.max(minScale, startScale.value * event.scale));
          const centerX = viewport.width / 2;
          const centerY = viewport.height / 2;
          const contentPointX = (pinchFocalX.value - centerX - startX.value) / startScale.value;
          const contentPointY = (pinchFocalY.value - centerY - startY.value) / startScale.value;
          const nextX = event.focalX - centerX - contentPointX * nextScale;
          const nextY = event.focalY - centerY - contentPointY * nextScale;
          const maxX = Math.max(0, (fittedContent.width * nextScale - viewport.width) / 2);
          const maxY = Math.max(0, (fittedContent.height * nextScale - viewport.height) / 2);
          scale.value = nextScale;
          translateX.value = Math.min(maxX, Math.max(-maxX, nextX));
          translateY.value = Math.min(maxY, Math.max(-maxY, nextY));
        })
        .onFinalize(() => {
          pinchTouchCount.value = 0;
          runOnJS(setToolbarScale)(scale.value);
        }),
    [
      fittedContent,
      maxScale,
      minScale,
      pinchFocalX,
      pinchFocalY,
      pinchReady,
      pinchTouchCount,
      scale,
      startScale,
      startX,
      startY,
      translateX,
      translateY,
      viewport,
    ],
  );
  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd((_event, success) => {
          if (success) runOnJS(reset)();
        }),
    [reset],
  );
  const backdropTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .onEnd((event, success) => {
          if (!success || !fittedContent || !viewport || !onPressOutsideContent) return;
          const isInside = isPointInsideTransformedContent({
            point: { x: event.x, y: event.y },
            transform: { scale: scale.value, x: translateX.value, y: translateY.value },
            fittedContent,
            viewport,
          });
          if (!isInside) runOnJS(onPressOutsideContent)();
        }),
    [fittedContent, onPressOutsideContent, scale, translateX, translateY, viewport],
  );
  const tapGesture = useMemo(
    () => Gesture.Exclusive(doubleTapGesture, backdropTapGesture),
    [backdropTapGesture, doubleTapGesture],
  );
  const transformGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  );
  const gesture = useMemo(
    () => Gesture.Exclusive(transformGesture, tapGesture),
    [tapGesture, transformGesture],
  );

  const zoomFromCenter = useCallback(
    (factor: number) => {
      if (!fittedContent || !viewport) return;
      const next = zoomContentAtPoint({
        transform: { scale: scale.value, x: translateX.value, y: translateY.value },
        scale: scale.value * factor,
        focalPoint: { x: viewport.width / 2, y: viewport.height / 2 },
        fittedContent,
        viewport,
        limits: { minScale, maxScale },
      });
      scale.value = next.scale;
      translateX.value = next.x;
      translateY.value = next.y;
      setToolbarScale(next.scale);
    },
    [fittedContent, maxScale, minScale, scale, translateX, translateY, viewport],
  );
  const zoomIn = useCallback(() => zoomFromCenter(1.25), [zoomFromCenter]);
  const zoomOut = useCallback(() => zoomFromCenter(0.8), [zoomFromCenter]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setViewport({ width, height });
  }, []);

  const translationStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));
  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * contentScaleRatio }],
  }));
  const frameStyle = useMemo(
    () => [
      styles.contentFrame,
      renderAtContentSize
        ? { width: contentSize.width, height: contentSize.height }
        : { width: fittedContent?.width ?? 0, height: fittedContent?.height ?? 0 },
      translationStyle,
    ],
    [contentSize, fittedContent, renderAtContentSize, translationStyle],
  );

  return (
    <View onLayout={handleLayout} style={[styles.root, style]} testID={testID}>
      <GestureDetector gesture={gesture}>
        <View
          accessibilityLabel={accessibilityLabel}
          accessibilityRole={accessibilityLabel ? "image" : undefined}
          style={styles.canvas}
          testID={testID ? `${testID}-canvas` : undefined}
        >
          {fittedContent ? (
            <Animated.View style={frameStyle}>
              <Animated.View style={[styles.content, scaleStyle]}>{children}</Animated.View>
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>
      {controls === "zoom-bar" ? (
        <ViewportZoomBar
          displayScale={toolbarScale * fitRatio}
          maxScale={maxScale}
          minScale={minScale}
          onReset={reset}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          resetDisabled={toolbarScale === initialTransform.scale}
          scale={toolbarScale}
        />
      ) : (
        <ViewportToolbar
          actions={actions}
          maxScale={maxScale}
          minScale={minScale}
          onReset={reset}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          resetDisabled={toolbarScale === initialTransform.scale}
          scale={toolbarScale}
          visible
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  root: { flex: 1, minHeight: 0, overflow: "hidden", position: "relative" },
  canvas: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  contentFrame: { flexShrink: 0 },
  content: { width: "100%", height: "100%" },
}));
