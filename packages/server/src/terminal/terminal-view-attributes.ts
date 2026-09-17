import {
  TERMINAL_VIEW_ATTRIBUTE_COLOR_PATTERN,
  type TerminalViewAttributes,
} from "@getpaseo/protocol/messages";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ResolvedTerminalViewAttributes {
  foreground: RgbColor;
  background: RgbColor;
  cursor: RgbColor;
}

export type TerminalColorScheme = "dark" | "light";

function parseHexColor(value: string): RgbColor | null {
  if (!TERMINAL_VIEW_ATTRIBUTE_COLOR_PATTERN.test(value)) {
    return null;
  }
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

// wire 层已按正则校验，这里只是把 string 类型的程序内调用同样兜住：
// 任一颜色无法解析就整体视为未知，宁可沉默也不用半套颜色回答 TUI。
export function resolveTerminalViewAttributes(
  attributes: TerminalViewAttributes | undefined,
): ResolvedTerminalViewAttributes | null {
  if (!attributes) {
    return null;
  }
  const foreground = parseHexColor(attributes.foreground);
  const background = parseHexColor(attributes.background);
  const cursor = parseHexColor(attributes.cursor);
  if (!foreground || !background || !cursor) {
    return null;
  }
  return { foreground, background, cursor };
}

// OSC 10/11/12 应答用 xterm 的 16 位通道写法（0b -> 0b0b），与可见 xterm 的回复字节一致。
export function toOscColorResponse(color: RgbColor): string {
  const channel = (value: number): string => {
    const hex = value.toString(16).padStart(2, "0");
    return `${hex}${hex}`;
  };
  return `rgb:${channel(color.r)}/${channel(color.g)}/${channel(color.b)}`;
}

// WCAG 相对亮度，与 xterm 的对比度计算一致。
function relativeLuminance(color: RgbColor): number {
  const linear = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

// 深浅按背景与前景的相对亮度判定，不按 app 的 light/dark 开关。
export function resolveTerminalColorScheme(
  attributes: ResolvedTerminalViewAttributes,
): TerminalColorScheme {
  return relativeLuminance(attributes.background) < relativeLuminance(attributes.foreground)
    ? "dark"
    : "light";
}

// CSI ?996n 的应答：?997;1n 为深色，?997;2n 为浅色。
export function toColorSchemeReport(scheme: TerminalColorScheme): string {
  return scheme === "dark" ? "\x1b[?997;1n" : "\x1b[?997;2n";
}
