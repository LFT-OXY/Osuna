import { createContext, useContext, useMemo } from "react";
import type { ViewStyle } from "react-native";
import { DEFAULT_CONTENT_MAX_WIDTH } from "@/styles/theme";

/**
 * 聊天行外框的最大宽度，从 React 传给每一行。
 *
 * 外框的样式是主题样式与行内对象合并出来的，Unistyles 在 Web 上按合并后的值生成样式类；主题里的
 * 数值变了，已挂载又不重渲染的行拿不到新值。只靠主题时，改完「内容宽度」回到已打开的聊天，输入框
 * 变了而消息没变。
 */
const StreamRowMaxWidthContext = createContext(DEFAULT_CONTENT_MAX_WIDTH);

export const StreamRowMaxWidthProvider = StreamRowMaxWidthContext.Provider;

export function useStreamRowMaxWidthStyle(): ViewStyle {
  const maxWidth = useContext(StreamRowMaxWidthContext);
  return useMemo(() => ({ maxWidth }), [maxWidth]);
}
