import type { AppSettings } from "@/hooks/use-settings";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK } from "@/styles/theme";
import { resolveTerminalFontFamily } from "@/terminal/runtime/terminal-font";

// React Native 的 fontFamily 只认单个字体名，不支持逗号分隔的栈，所以原生端保持
// 用户值整串替换默认值。

export function resolveUiFontStack(userValue: string): string {
  return userValue.trim() || DEFAULT_UI_FONT_STACK;
}

export function resolveMonoFontStack(userValue: string): string {
  return userValue.trim() || DEFAULT_MONO_FONT_STACK;
}

// 原生终端只从栈里挑白名单字体，沿用终端运行时原有的默认栈，iOS/Android 的实际字体不变。
export function resolveTerminalFontStack(userValue: string): string {
  return resolveTerminalFontFamily(userValue);
}

export type TerminalFontSettings = Pick<
  AppSettings,
  "monoFontFamily" | "codeFontSize" | "terminalFontFamily" | "terminalFontSize"
>;

// 跟随规则与 Web 端一致：Terminal font 留空跟随 Code font，Terminal size 为 null 跟随 Code size。
export function resolveTerminalFont(settings: TerminalFontSettings): {
  fontFamily: string;
  fontSize: number;
} {
  const userValue = settings.terminalFontFamily.trim() || settings.monoFontFamily;
  return {
    fontFamily: resolveTerminalFontStack(userValue),
    fontSize: settings.terminalFontSize ?? settings.codeFontSize,
  };
}
