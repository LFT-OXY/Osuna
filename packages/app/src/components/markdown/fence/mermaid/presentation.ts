import type { TextStyle, ViewStyle } from "react-native";

export function getDiagramBoxStyle(style: TextStyle): ViewStyle {
  return {
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth,
    marginBottom: style.marginBottom,
    marginTop: style.marginTop,
    marginVertical: style.marginVertical,
    // 代码块的内边距上窄下宽（上方留给头部一行）；图框没有头部，四边取水平内边距。
    padding: style.paddingHorizontal ?? style.padding,
  };
}
