import { useId, type ReactNode } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { AUTOCOMPLETE_FADE_HEIGHT } from "./autocomplete-utils";

function FadeGradient({ gradientId, color }: { gradientId: string; color: string }) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor={color} stopOpacity={0} />
          <Stop offset="100%" stopColor={color} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedFadeGradient = withUnistyles(FadeGradient);

const panelFillColor = (theme: Theme) => ({ color: theme.colors.surfaceCard });

/** 原生端面板不透明（surfaceCard）：在视口底部叠一层淡入面板底色的渐变，等同于把内容淡出。 */
export function AutocompleteFadeFrame({ children }: { children: ReactNode }) {
  const gradientId = `autocomplete-fade-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <View style={styles.frame}>
      {children}
      <View pointerEvents="none" style={styles.fade}>
        <ThemedFadeGradient gradientId={gradientId} uniProps={panelFillColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 1,
    minHeight: 0,
  },
  fade: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    height: AUTOCOMPLETE_FADE_HEIGHT,
  },
});
