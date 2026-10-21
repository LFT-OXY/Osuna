import type { ReactNode } from "react";
import { ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  HORIZONTAL_SCROLL_FADE_WIDTH,
  useHorizontalOverflow,
} from "./horizontal-scroll-fade-state";

// 遮罩只读 alpha，#000 是完全露出：不管底下是什么底色都一样淡出，毛玻璃上也不盖住模糊。
const FADE = HORIZONTAL_SCROLL_FADE_WIDTH;
const START = `transparent, #000 ${FADE}px`;
const END = `#000 calc(100% - ${FADE}px), transparent`;
const START_MASK = `linear-gradient(to right, ${START}, #000)`;
const END_MASK = `linear-gradient(to right, #000, ${END})`;
const BOTH_MASK = `linear-gradient(to right, ${START}, ${END})`;

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
  let mask = null;
  if (overflow.start && overflow.end) mask = styles.both;
  else if (overflow.start) mask = styles.start;
  else if (overflow.end) mask = styles.end;
  return (
    <View style={style} testID={testID}>
      <View style={mask}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  start: {
    minWidth: 0,
    WebkitMaskImage: START_MASK,
    maskImage: START_MASK,
  },
  end: {
    minWidth: 0,
    WebkitMaskImage: END_MASK,
    maskImage: END_MASK,
  },
  both: {
    minWidth: 0,
    WebkitMaskImage: BOTH_MASK,
    maskImage: BOTH_MASK,
  },
});
