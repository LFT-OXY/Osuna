const DEFAULT_TERMINAL_FONT_SIZE = 13;

// 常见的本机 Nerd Font，用作提示符/TUI 图标的回退。
export const NERD_FONT_FAMILIES: readonly string[] = [
  "JetBrainsMono Nerd Font",
  "JetBrainsMono NF",
  "MesloLGM Nerd Font",
  "MesloLGM NF",
  "Hack Nerd Font",
  "FiraCode Nerd Font",
  // PUA-only fallback (many Nerd glyphs live here on some systems).
  "Symbols Nerd Font",
];

// Web 端由外观模块（appearance/font-stack.ts）传入有效字体栈；这里的默认栈只在原生端
// 未设置字体时兜底，保持原生终端的实际字体不变。
export const DEFAULT_TERMINAL_FONT_FAMILY = [
  "JetBrains Mono",
  ...NERD_FONT_FAMILIES,
  // System fallbacks.
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "'Liberation Mono'",
  "monospace",
].join(", ");

export function resolveTerminalFontFamily(fontFamily: string | undefined): string {
  const trimmed = fontFamily?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_TERMINAL_FONT_FAMILY;
}

export function resolveTerminalFontSize(fontSize: number | undefined): number {
  return typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_TERMINAL_FONT_SIZE;
}
