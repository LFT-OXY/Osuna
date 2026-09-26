import React, { useCallback, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/components/ui/text";
import { NativeShimmerSweep } from "./native-sweep";
import type { ShimmerTextProps } from "./shimmer-text-props";
import { resolveNativeShimmerPeakWidth, WORKING_SHIMMER_DURATION_SECONDS } from "./timing";

interface Size {
  width: number;
  height: number;
}

/** 一行弱色文字加原生扫光；扫光层的暂停与减少动态效果由 NativeShimmerSweep 处理。 */
export function ShimmerText({ text, testID }: ShimmerTextProps) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // 隐藏面板里量到的 0 尺寸不采用，保留上一次的有效尺寸。
    if (width <= 0 || height <= 0) return;
    setSize((previous) =>
      Math.abs(previous.width - width) > 0.5 || Math.abs(previous.height - height) > 0.5
        ? { width, height }
        : previous,
    );
  }, []);
  const renderMask = useCallback(
    () => (
      // 遮罩只看 alpha：默认的前景色不透明即可。
      <Text variant="label" style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    ),
    [text],
  );

  return (
    <View style={styles.frame}>
      <Text
        variant="label"
        color="foregroundMuted"
        style={styles.text}
        testID={testID}
        onLayout={handleLayout}
      >
        {text}
      </Text>
      <NativeShimmerSweep
        width={size.width}
        height={size.height}
        peakWidth={resolveNativeShimmerPeakWidth(size.width)}
        durationSeconds={WORKING_SHIMMER_DURATION_SECONDS}
        renderMask={renderMask}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "relative",
  },
  text: {
    fontVariant: ["tabular-nums"],
  },
});
