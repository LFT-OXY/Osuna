import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AUTOCOMPLETE_FADE_HEIGHT } from "./autocomplete-utils";

// Web 面板是毛玻璃，叠一层底色渐变会盖住背后的模糊，所以直接遮罩视口。遮罩只读 alpha，#000 是"完全露出"。
const FADE_MASK = `linear-gradient(to bottom, #000 calc(100% - ${AUTOCOMPLETE_FADE_HEIGHT}px), transparent)`;

export function AutocompleteFadeFrame({ children }: { children: ReactNode }) {
  return <View style={styles.frame}>{children}</View>;
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 1,
    minHeight: 0,
    WebkitMaskImage: FADE_MASK,
    maskImage: FADE_MASK,
  },
});
