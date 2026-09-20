import { UnistylesRuntime } from "react-native-unistyles";
import {
  TERMINAL_VIEW_ATTRIBUTE_COLOR_PATTERN,
  type TerminalViewAttributes,
} from "@getpaseo/protocol/messages";

import type { Theme } from "@/styles/theme";

type TerminalPalette = Pick<Theme["colors"]["terminal"], "foreground" | "background" | "cursor">;

function toHexColor(value: string): string | undefined {
  const trimmed = value.trim();
  return TERMINAL_VIEW_ATTRIBUTE_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

// 把主题的终端三色转成 daemon 需要的 #rrggbb；任一颜色不是纯 hex 就整体不发，
// daemon 对未知主题保持沉默，好过把半套颜色告诉 TUI。
export function toTerminalViewAttributes(
  palette: TerminalPalette,
): TerminalViewAttributes | undefined {
  const foreground = toHexColor(palette.foreground);
  const background = toHexColor(palette.background);
  const cursor = toHexColor(palette.cursor);
  if (!foreground || !background || !cursor) {
    return undefined;
  }
  return { foreground, background, cursor };
}

// 创建终端时的一次性快照：daemon 在 PTY 启动前就拿到颜色，TUI 首帧即按真实主题渲染。
export function getCurrentTerminalViewAttributes(): TerminalViewAttributes | undefined {
  return toTerminalViewAttributes(UnistylesRuntime.getTheme().colors.terminal);
}
