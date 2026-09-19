/**
 * The usage page is a deliberate visual island: it copies the reference
 * dashboard's own neutral scale instead of the Paseo design tokens. The two
 * sets still ride on the theme as `theme.colors.usage`, because that is the
 * only value Unistyles tracks — a palette picked from `theme.colorScheme`
 * inside a style factory is computed once and never follows a theme change.
 */
export interface UsagePalette {
  card: string;
  cardBorder: string;
  cardBorderHover: string;
  ink: string;
  ink2: string;
  ink3: string;
  inkMuted: string;
  inkFaint: string;
  tile: string;
  divider2: string;
  brand: string;
  amberBg: string;
  amberBorder: string;
  amberFg: string;
  amberDot: string;
  segBg: string;
  track: string;
  controlBorder: string;
  statusOnline: string;
}

export const USAGE_LIGHT_PALETTE: UsagePalette = {
  card: "#ffffff",
  cardBorder: "#e5e5e5",
  cardBorderHover: "#d4d4d4",
  ink: "#0a0a0a",
  ink2: "#525252",
  ink3: "#404040",
  inkMuted: "#737373",
  inkFaint: "#a3a3a3",
  tile: "#fafafa",
  divider2: "#e5e5e5",
  brand: "#059669",
  amberBg: "#fffbeb",
  amberBorder: "#fcd34d",
  amberFg: "#b45309",
  amberDot: "#f59e0b",
  segBg: "#f5f5f5",
  track: "#f5f5f5",
  controlBorder: "#d4d4d4",
  statusOnline: "#10b981",
};

export const USAGE_DARK_PALETTE: UsagePalette = {
  card: "#171717",
  cardBorder: "#262626",
  cardBorderHover: "#404040",
  ink: "#fafafa",
  ink2: "#d4d4d4",
  ink3: "#e5e5e5",
  inkMuted: "#d4d4d4",
  inkFaint: "#a3a3a3",
  tile: "#262626",
  divider2: "#404040",
  brand: "#10b981",
  amberBg: "rgba(245,158,11,0.1)",
  amberBorder: "rgba(245,158,11,0.3)",
  amberFg: "#fcd34d",
  amberDot: "#f59e0b",
  segBg: "#262626",
  track: "#262626",
  controlBorder: "#404040",
  statusOnline: "#10b981",
};
