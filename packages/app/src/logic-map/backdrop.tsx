import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

const DOT_SPACING = 16;

/** 逻辑图画布的灰底；Web 上加点阵，点阵固定在视口上，不随画布平移。 */
export function LogicMapBackdrop({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={[styles.backdrop, isWeb && styles.dots]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
    backgroundColor: theme.colors.logicMap.canvas,
  },
  // CSS 背景图只在 Web 上有；RN 的 ViewStyle 没有这两个属性，交给 StyleSheet.create 推断，
  // react-native-web 与 Unistyles 的 Web 端原样输出为 CSS（同 styles/floating-surface.ts）。
  dots: {
    backgroundImage: `radial-gradient(${theme.colors.logicMap.dot} 1px, transparent 1px)`,
    backgroundSize: `${DOT_SPACING}px ${DOT_SPACING}px`,
  },
}));
