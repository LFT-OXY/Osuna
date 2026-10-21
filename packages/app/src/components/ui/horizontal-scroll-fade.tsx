import { useId, type ReactNode } from "react";
import { ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import {
  HORIZONTAL_SCROLL_FADE_WIDTH,
  useHorizontalOverflow,
} from "./horizontal-scroll-fade-state";

function EdgeGradient({
  gradientId,
  color,
  side,
}: {
  gradientId: string;
  color: string;
  side: "start" | "end";
}) {
  const opaqueAt = side === "start" ? "0%" : "100%";
  const clearAt = side === "start" ? "100%" : "0%";
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset={opaqueAt} stopColor={color} stopOpacity={1} />
          <Stop offset={clearAt} stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedEdgeGradient = withUnistyles(EdgeGradient);

// 原生端没有遮罩：在有藏着内容的一侧叠一层淡入卡片底色的渐变。只用于卡片（surfaceCard）上。
const cardFillColor = (theme: Theme) => ({ color: theme.colors.surfaceCard });

/** 横向滚动区：哪一侧还有藏着的内容，就在那一侧淡出。 */
export function HorizontalScrollFade({
  style,
  contentContainerStyle,
  testID,
  children,
}: {
  // 外框：边框、占位这类不该跟着淡出的样式。
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}) {
  const { overflow, onScroll, onLayout, onContentSizeChange } = useHorizontalOverflow();
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <View style={style} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </ScrollView>
      {overflow.start ? (
        <View pointerEvents="none" style={[styles.edge, styles.start]}>
          <ThemedEdgeGradient
            gradientId={`fade-start-${baseId}`}
            side="start"
            uniProps={cardFillColor}
          />
        </View>
      ) : null}
      {overflow.end ? (
        <View pointerEvents="none" style={[styles.edge, styles.end]}>
          <ThemedEdgeGradient
            gradientId={`fade-end-${baseId}`}
            side="end"
            uniProps={cardFillColor}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: HORIZONTAL_SCROLL_FADE_WIDTH,
  },
  start: {
    left: 0,
  },
  end: {
    right: 0,
  },
});
