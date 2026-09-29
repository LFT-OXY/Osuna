import type { AppSettings } from "@/hooks/use-settings";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK } from "@/styles/theme";
import { NERD_FONT_FAMILIES } from "@/terminal/runtime/terminal-font";
import { formatFontFamily, isGenericFontFamily, splitFontStack } from "./font-family-name";

// Interface font、Code font 与终端的有效字体栈只在这里解析；主题 token、终端、diff 画布
// 和设置页预览都从这里取值。原生端语义见 font-stack.native.ts。

function formatUserFamilies(userValue: string): string[] {
  return splitFontStack(userValue).map(formatFontFamily);
}

// 用户值放在默认栈前面：用户字体缺字或没装时由默认栈补上。
function prependToDefaultStack(userValue: string, defaultStack: string): string {
  const userFamilies = formatUserFamilies(userValue);
  if (userFamilies.length === 0) return defaultStack;
  return [...userFamilies, defaultStack].join(", ");
}

export function resolveUiFontStack(userValue: string): string {
  return prependToDefaultStack(userValue, DEFAULT_UI_FONT_STACK);
}

export function resolveMonoFontStack(userValue: string): string {
  return prependToDefaultStack(userValue, DEFAULT_MONO_FONT_STACK);
}

/**
 * 终端有效栈 = 用户值、默认等宽栈里的具体字体、常见 Nerd Font、`monospace`。
 * generic 关键字总能命中，排在它后面的字体用不上，所以用户值里的 generic 关键字被去掉，
 * 只在末尾保留一个 `monospace`。
 */
export function resolveTerminalFontStack(userValue: string): string {
  const concreteFamilies = [
    ...formatUserFamilies(userValue),
    ...splitFontStack(DEFAULT_MONO_FONT_STACK),
    ...NERD_FONT_FAMILIES.map(formatFontFamily),
  ].filter((family) => !isGenericFontFamily(family));
  return [...concreteFamilies, "monospace"].join(", ");
}

export type TerminalFontSettings = Pick<
  AppSettings,
  "monoFontFamily" | "codeFontSize" | "terminalFontFamily" | "terminalFontSize"
>;

// Terminal font 留空跟随 Code font，Terminal size 为 null 跟随 Code size。
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
