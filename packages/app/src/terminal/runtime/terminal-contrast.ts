import type { ITheme } from "@xterm/xterm";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const LIGHT_BACKGROUND_MINIMUM_CONTRAST_RATIO = 4.5;
const DARK_BACKGROUND_MINIMUM_CONTRAST_RATIO = 3;
// xterm 的默认值：不做对比度修正。
const DISABLED_MINIMUM_CONTRAST_RATIO = 1;

// WCAG 相对亮度，与 xterm 内部的对比度计算和 daemon 的深浅判定用同一公式。
function relativeLuminance(hexColor: string): number | undefined {
  const trimmed = hexColor.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return undefined;
  }
  const linear = (channel: string): number => {
    const srgb = Number.parseInt(channel, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(trimmed.slice(1, 3)) +
    0.7152 * linear(trimmed.slice(3, 5)) +
    0.0722 * linear(trimmed.slice(5, 7))
  );
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === undefined || backgroundLuminance === undefined) {
    return undefined;
  }
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

// 浅底文字更容易被洗淡，取 4.5；深底只需温和提亮接近背景色的文字，取 3，避免把鲜艳颜色洗白。
// 深浅按背景与前景的相对亮度判定（与 daemon 对 CSI ?996n 的判定一致），不按 app 的主题开关。
// 主题颜色不是纯 #rrggbb 时无从判定，保持 xterm 默认的不修正。
export function resolveTerminalMinimumContrastRatio(theme: ITheme): number {
  const backgroundLuminance = relativeLuminance(theme.background ?? "");
  const foregroundLuminance = relativeLuminance(theme.foreground ?? "");
  if (backgroundLuminance === undefined || foregroundLuminance === undefined) {
    return DISABLED_MINIMUM_CONTRAST_RATIO;
  }
  return backgroundLuminance < foregroundLuminance
    ? DARK_BACKGROUND_MINIMUM_CONTRAST_RATIO
    : LIGHT_BACKGROUND_MINIMUM_CONTRAST_RATIO;
}
