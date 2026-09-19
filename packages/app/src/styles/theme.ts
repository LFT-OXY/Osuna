import { Platform } from "react-native";
import { darkHighlightColors, lightHighlightColors } from "@getpaseo/highlight";
import { USAGE_DARK_PALETTE, USAGE_LIGHT_PALETTE } from "./usage-palette";

export const baseColors = {
  // Base colors
  white: "#ffffff",
  black: "#000000",

  // Zinc scale (primary gray palette)
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    850: "#1a1a1d",
    900: "#18181b",
    950: "#121214",
  },

  // Gray scale
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },

  // Slate scale
  slate: {
    200: "#e2e8f0",
  },

  // Blue scale
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    950: "#172554",
  },

  // Green scale
  green: {
    100: "#dcfce7",
    200: "#bbf7d0",
    400: "#4ade80",
    500: "#22c55e",
    600: "#16a34a",
    800: "#166534",
    900: "#14532d",
  },

  // Red scale
  red: {
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    500: "#ef4444",
    600: "#dc2626",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Teal scale
  teal: {
    200: "#99f6e4",
  },

  // Amber scale
  amber: {
    500: "#f59e0b",
    700: "#b45309",
  },

  // Yellow scale
  yellow: {
    400: "#fbbf24",
  },

  // Purple scale
  purple: {
    500: "#a855f7",
    600: "#9333ea",
  },

  // Orange scale
  orange: {
    500: "#f97316",
    600: "#ea580c",
  },
} as const;

// Diff colors — the +/- inside a diff view, where the color *is* the signal and has to
// survive being scanned line by line, so it stays saturated. Light uses muted tones, dark
// uses the brighter palette values.
//
// A diff *stat* — the "+12 −3" footnote next to a title — is not this. It is a status
// signal, so it uses statusSuccess/statusDanger below rather than a tier of its own.
const lightDiffColors = {
  diffAddition: "#15803d", // green-700 — readable on white without screaming
  diffDeletion: "#b91c1c", // red-700
};

const darkDiffColors = {
  diffAddition: "#4ade80", // green-400
  diffDeletion: "#ef4444", // red-500
};

// Status colors — semantic signals for success/danger/warning/merged. There is exactly one
// token per signal, and every status surface uses it: PR state icons, CI check icons and
// pies, diff stats, file-change icons, status badges, usage bars. Status *dots* are the
// exception and have their own band below. A surface does not otherwise get a quieter or
// louder variant of a status color because of where it sits — if a dense list feels loud,
// that is a density or weight problem, not a color problem.
//
// The level is set by the densest consumer, the sidebar workspace list: quiet enough that a
// column of green checks reads as one line of subtitle and the single red row still stands
// out, saturated enough to name the state on its own. Every other surface follows it.
//
// Normalized, not hand-picked. Every color below shares one lightness and one chroma; only
// the hue changes, and each hue is the one that family already had. Chroma is a fixed
// fraction of what sRGB allows at that lightness and hue, because the gamut is lopsided —
// amber runs out of room long before red does, so a literal equal-chroma set leaves amber
// flat and red screaming. Equal fractions is what makes four hues read as one family.
// Regenerate with the same rule rather than nudging one value.
//
// Hues are fixed per family across both themes: success 150, danger 27, warning 70.5,
// merged 300.
const lightStatusColors = {
  // L=0.50, chroma 60% of gamut max
  statusSuccess: "#3e704a",
  statusDanger: "#9d433b",
  statusWarning: "#7b5d39",
  statusMerged: "#7347af",
};

const darkStatusColors = {
  // L=0.70, chroma 55% of gamut max
  statusSuccess: "#6cb17b",
  statusDanger: "#d8847b",
  statusWarning: "#c09664",
  statusMerged: "#a890d5",
};

// Status *dot* colors — the small filled discs on a sidebar row, and the glyphs that stand in
// for them. Same four hues and the same generation rule as the status colors above, but its
// own band, because a dot is doing a different job than a check icon or a host badge.
//
// A dot is 6pt of solid color with no shape to read and no label attached. At the status
// band's lightness the dots read dimmer than the static text and icons beside them on the same
// row, which is backwards — the dot is the row's state. The loudness comes from chroma: 90% of
// gamut max against the status family's 55-60%.
//
// Lightness is set by hue separation, not by distance from the surface. A dark dot on a light
// surface has plenty of contrast but the four hues collapse into each other at 6pt — dark green,
// dark red, dark amber and dark blue all read as "dark blob", and the point of the dot is telling
// them apart at a glance. So the light band runs as bright as the contrast floor allows: L=0.62
// is the last step where all four clear 3:1 against the sidebar's surface2 (success is the
// binding one at 3.10, and drops under 3 by L=0.64), which is WCAG's non-text minimum for a
// control that carries state.
//
// All four move together. A dot matching its siblings in lightness and chroma says only which
// state the row is in; one that does not says "this row matters more", which is a claim the
// color has no business making. Regenerate the set, never one hue.
//
// 90% and not 100%: at the gamut edge the lopsidedness is worst — green reaches C=0.215 while
// blue manages 0.116 — so the set stops reading as one family and green wins. Red running out
// of chroma as lightness climbs is what caps the dark band at L=0.72; higher turns the failed
// dot pink, and the light band pastels out the same way just above its own cap. Running is blue
// at hue 250, clear of
// identity-colors' blue at 256.6 so a blue host badge and a working dot on the same row do not
// read as related.
const lightStatusDotColors = {
  // L=0.62, chroma 90% of gamut max
  statusDotSuccess: "#299f51",
  statusDotDanger: "#f12e2f",
  statusDotWarning: "#b37824",
  statusDotRunning: "#268ae0",
};

const darkStatusDotColors = {
  // L=0.72, chroma 90% of gamut max
  statusDotSuccess: "#35c264",
  statusDotDanger: "#f7796d",
  statusDotWarning: "#db932e",
  statusDotRunning: "#5caaf6",
};

// 终端的 14 个彩色 ANSI 槽位。black / brightBlack 不在其中：它们随界面表面走
// （terminalBlack / terminalBrightBlack），以保证在该主题的终端底色上仍可见。
export interface TerminalAnsiPalette {
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface LightThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  foreground: string;
  foregroundMuted: string;
  foregroundExtraMuted: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  terminalBlack: string;
  terminalBrightBlack: string;
  /** Palette-specific ANSI colors; omitted themes share `lightTerminalAnsi`. */
  terminalAnsi?: TerminalAnsiPalette;
  terminalSelectionBackground?: string;
  ring: string;
}

// white / brightWhite 不能与白底同色：ANSI white 输出（如 ls 的部分条目）会直接消失。
// 两者都取对白底不低于 3:1 的灰，brightWhite 仍比 white 更亮以保留层级。
const lightTerminalAnsi = {
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#71717a",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#f59e0b",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#8a8a92",
} as const;

export function buildLightSemanticColors(tint: LightThemeConfig) {
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surface1,
    surfaceSidebarSelected: tint.surface3,
    surfaceWorkspace: tint.surface0,
    interactionHighlight: "rgba(0, 0, 0, 0.06)",

    foreground: tint.foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: tint.foregroundExtraMuted,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? tint.surface0,

    destructive: tint.destructive,
    destructiveForeground: tint.surface0,
    success: tint.accent,
    successForeground: tint.surface0,

    background: tint.surface0,
    popover: tint.surface0,
    popoverForeground: tint.foreground,
    primary: tint.primary,
    primaryForeground: tint.primaryForeground,
    secondary: tint.surface2,
    secondaryForeground: tint.foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: tint.ring,

    ...lightDiffColors,
    ...lightStatusColors,
    ...lightStatusDotColors,

    terminal: {
      background: tint.surface0,
      foreground: tint.foreground,
      cursor: tint.foreground,
      cursorAccent: tint.surface0,
      selectionBackground: tint.terminalSelectionBackground ?? "rgba(0, 0, 0, 0.15)",
      selectionForeground: tint.foreground,
      black: tint.terminalBlack,
      ...(tint.terminalAnsi ?? lightTerminalAnsi),
      brightBlack: tint.terminalBrightBlack,
    },
  };
}

const lightSemanticColors = buildLightSemanticColors({
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  surface3: "#e4e4e7",
  surface4: "#d4d4d8",
  surfaceDiffEmpty: "#f6f6f6",
  surfaceSidebar: "#f4f4f5",
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",
  foregroundExtraMuted: "#a1a1aa",
  border: "#e4e4e7",
  borderAccent: "#ececf1",
  accent: "#20744A",
  accentBright: "#239956",
  accentForeground: "#ffffff",
  primary: "#18181b",
  primaryForeground: "#fafafa",
  destructive: "#b04138",
  terminalBlack: "#1a1a1e",
  terminalBrightBlack: "#3f3f46",
  ring: "#18181b",
});

// ---------------------------------------------------------------------------
// Dark theme variant builder
// ---------------------------------------------------------------------------

export interface DarkThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  foregroundMuted: string;
  foregroundExtraMuted: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  destructive: string;
  terminalBlack: string;
  terminalBrightBlack: string;
  /** Palette-specific ANSI colors; omitted themes share `darkTerminalAnsi`. */
  terminalAnsi?: TerminalAnsiPalette;
  terminalSelectionBackground?: string;
  foreground?: string;
  ring?: string;
}

const darkTerminalAnsi = {
  red: "#e07070",
  green: "#5dba80",
  yellow: "#d4a44a",
  blue: "#6a9de0",
  magenta: "#b07ad0",
  cyan: "#4aabb8",
  white: "#d4d4d8",
  brightRed: "#e89090",
  brightGreen: "#7ecf9a",
  brightYellow: "#e0be6e",
  brightBlue: "#8ab4e8",
  brightMagenta: "#c49ae0",
  brightCyan: "#6ec2cc",
  brightWhite: "#f0f0f2",
} as const;

export function buildDarkSemanticColors(tint: DarkThemeConfig) {
  const foreground = tint.foreground ?? "#fafafa";
  const ring = tint.ring ?? "#d4d4d8";
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surface1,
    surfaceSidebarSelected: tint.surface2,
    surfaceWorkspace: tint.surface1,
    interactionHighlight: "rgba(255, 255, 255, 0.08)",

    foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: tint.foregroundExtraMuted,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? "#ffffff",

    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: foreground,
    primary: foreground,
    primaryForeground: tint.surface0,
    secondary: tint.surface2,
    secondaryForeground: foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring,

    ...darkDiffColors,
    ...darkStatusColors,
    ...darkStatusDotColors,

    terminal: {
      background: tint.surface0,
      foreground,
      cursor: foreground,
      cursorAccent: tint.surface0,
      selectionBackground: tint.terminalSelectionBackground ?? "rgba(255, 255, 255, 0.2)",
      selectionForeground: foreground,
      black: tint.terminalBlack,
      ...(tint.terminalAnsi ?? darkTerminalAnsi),
      brightBlack: tint.terminalBrightBlack,
    },
  };
}

// ---------------------------------------------------------------------------
// Dark tint definitions
// ---------------------------------------------------------------------------

// Paseo — subtle teal-green tint (default)
const paseoDarkColors = buildDarkSemanticColors({
  surface0: "#181B1A",
  surface1: "#1E2120",
  surface2: "#272A29",
  surface3: "#434645",
  surface4: "#595B5B",
  surfaceDiffEmpty: "#252827",
  surfaceSidebar: "#141716",
  foregroundMuted: "#A1A5A4",
  foregroundExtraMuted: "#717574",
  border: "#252B2A",
  borderAccent: "#2F3534",
  accent: "#20744A",
  accentBright: "#7ccba0",
  destructive: "#c64f43", // warm red, hue ~7 — reads as red (not pink) against the green tint
  terminalBlack: "#141716",
  terminalBrightBlack: "#434645",
});

// Zinc — neutral gray, no tint
const zincDarkColors = buildDarkSemanticColors({
  surface0: "#18181b",
  surface1: "#1f1f22",
  surface2: "#27272a",
  surface3: "#3f3f46",
  surface4: "#52525b",
  surfaceDiffEmpty: "#242427",
  surfaceSidebar: "#131316",
  foregroundMuted: "#a1a1aa",
  foregroundExtraMuted: "#71717a",
  border: "#27272a",
  borderAccent: "#303036",
  accent: "#e4e4e7",
  accentBright: "#fafafa",
  accentForeground: "#18181b", // monochrome zinc accent is near-white — needs dark text
  destructive: "#c44a4a", // neutral red, hue 0 — clearly red without screaming
  terminalBlack: "#131316",
  terminalBrightBlack: "#3f3f46",
});

// Midnight — subtle blue tint
const midnightDarkColors = buildDarkSemanticColors({
  surface0: "#161820",
  surface1: "#1c1e27",
  surface2: "#252731",
  surface3: "#3c3e4c",
  surface4: "#535564",
  surfaceDiffEmpty: "#222430",
  surfaceSidebar: "#121420",
  foregroundMuted: "#9a9db0",
  foregroundExtraMuted: "#6b6e82",
  border: "#242636",
  borderAccent: "#2e3040",
  accent: "#3b6fcf",
  accentBright: "#7eaaeb",
  destructive: "#c44a52", // red with a hint of cool lean against the blue tint
  terminalBlack: "#121420",
  terminalBrightBlack: "#3c3e4c",
});

// Claude — warm neutral with subtle orange undertone
const claudeDarkColors = buildDarkSemanticColors({
  surface0: "#1f1f1e",
  surface1: "#262523",
  surface2: "#2f2d2b",
  surface3: "#4a4745",
  surface4: "#605d5b",
  surfaceDiffEmpty: "#2a2826",
  surfaceSidebar: "#1a1918",
  foregroundMuted: "#ada9a5",
  foregroundExtraMuted: "#78746f",
  border: "#2c2a27",
  borderAccent: "#36332f",
  accent: "#d97757",
  accentBright: "#e89a7f",
  destructive: "#cf513e", // warm orange-red, hue ~10 — sits with the Claude orange accent
  terminalBlack: "#1a1918",
  terminalBrightBlack: "#4a4745",
});

// Ghostty — blue-tinted dark based on Ghostty default background
const ghosttyDarkColors = buildDarkSemanticColors({
  surface0: "#282c34",
  surface1: "#2f333d",
  surface2: "#383c48",
  surface3: "#4a4f5e",
  surface4: "#5b6175",
  surfaceDiffEmpty: "#323643",
  surfaceSidebar: "#21252d",
  foregroundMuted: "#c8ccd8",
  foregroundExtraMuted: "#a0a4b2",
  border: "#353a47",
  borderAccent: "#3f4454",
  accent: "#89b4fa",
  accentBright: "#b4d0fc",
  destructive: "#c44a55", // red with slight cool lean against the slate-blue surfaces
  terminalBlack: "#21252d",
  terminalBrightBlack: "#4a4f5e",
});

export const SPACING = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
} as const;

export const FONT_SIZE = {
  code: 12,
  content: 15,
  sm: 12,
  base: 14,
  lg: 16,
  xl: 18,
  "2xl": 20,
  "3xl": 22,
  "4xl": 26,
} as const;

export const LINE_HEIGHT = {
  diff: 22,
} as const;

export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

export const FONT_WEIGHT = {
  normal: "normal" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "bold" as const,
} as const;

export const BORDER_RADIUS = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999,
} as const;

export const BORDER_WIDTH = {
  0: 0,
  1: 1,
  2: 2,
} as const;

export const OPACITY = {
  0: 0,
  50: 0.5,
  100: 1,
} as const;

// Platform default font stacks — copied verbatim from constants/theme.ts `Fonts`
// (sans -> ui, mono -> mono). These seed the dynamic `fontFamily` theme token and
// are the fallback an empty user-supplied family resolves to at apply time.
export const DEFAULT_UI_FONT_STACK: string = Platform.select({
  ios: "system-ui",
  default: "normal",
  web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});

export const DEFAULT_MONO_FONT_STACK: string = Platform.select({
  ios: "ui-monospace",
  default: "monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

// `fontSize`, `fontFamily`, and `lineHeight` are deliberately widened to plain
// `number`/`string` (not narrowed by `as const`) so the appearance updater can patch
// them at runtime via `UnistylesRuntime.updateTheme`. The remaining tokens keep their
// literal types.
interface CommonTheme {
  spacing: typeof SPACING;
  fontSize: Record<keyof typeof FONT_SIZE, number>;
  fontFamily: { ui: string; mono: string };
  lineHeight: Record<keyof typeof LINE_HEIGHT, number>;
  iconSize: typeof ICON_SIZE;
  fontWeight: typeof FONT_WEIGHT;
  borderRadius: typeof BORDER_RADIUS;
  borderWidth: typeof BORDER_WIDTH;
  opacity: typeof OPACITY;
}

const commonTheme: CommonTheme = {
  spacing: SPACING,
  fontSize: FONT_SIZE,
  fontFamily: { ui: DEFAULT_UI_FONT_STACK, mono: DEFAULT_MONO_FONT_STACK },
  lineHeight: LINE_HEIGHT,
  iconSize: ICON_SIZE,
  fontWeight: FONT_WEIGHT,
  borderRadius: BORDER_RADIUS,
  borderWidth: BORDER_WIDTH,
  opacity: OPACITY,
};

const darkShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.25)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.20)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.40)",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

export function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
  return {
    colorScheme: "dark" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: darkHighlightColors,
      // The usage page is a visual island with its own neutral scale; it rides
      // on the theme so Unistyles tracks it like any other token.
      usage: USAGE_DARK_PALETTE,
    },
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

export const darkTheme = buildDarkTheme(paseoDarkColors);
export const darkZincTheme = buildDarkTheme(zincDarkColors);
export const darkMidnightTheme = buildDarkTheme(midnightDarkColors);
export const darkClaudeTheme = buildDarkTheme(claudeDarkColors);
export const darkGhosttyTheme = buildDarkTheme(ghosttyDarkColors);

// Pure black — zero-luminance background with high-contrast surfaces.
const pureBlackDarkColors = buildDarkSemanticColors({
  surface0: "#000000",
  surface1: "#0a0a0a",
  surface2: "#111111",
  surface3: "#202020",
  surface4: "#2d2d2d",
  surfaceDiffEmpty: "#0c0c0c",
  surfaceSidebar: "#000000",
  foregroundMuted: "#a1a1aa",
  foregroundExtraMuted: "#71717a",
  border: "#1c1c1c",
  borderAccent: "#242424",
  accent: "#20744A",
  accentBright: "#7ccba0",
  destructive: "#c44a4a",
  terminalBlack: "#595959",
  terminalBrightBlack: "#8a8a8a",
});

export const darkPureBlackTheme = buildDarkTheme(pureBlackDarkColors);

// Dark palette variants. Surfaces and text tiers come from each palette's own
// scale (interpolated where the palette has no tier that clears 3:1 on surface0);
// the 14 colored ANSI slots are the palette's terminal colors verbatim.
// black / brightBlack are the palette's gray tiers that stay visible on its
// background, and destructive is the palette red darkened enough for white text.

export const darkDraculaTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#282a36",
    surface1: "#2e303e",
    surface2: "#343746",
    surface3: "#44475a",
    surface4: "#565971",
    surfaceDiffEmpty: "#30323f",
    surfaceSidebar: "#21222c",
    foreground: "#f8f8f2",
    foregroundMuted: "#a9adc6",
    foregroundExtraMuted: "#6272a4",
    border: "#363948",
    borderAccent: "#44475a",
    accent: "#bd93f9",
    accentBright: "#d6acff",
    accentForeground: "#282a36",
    destructive: "#d84f4f",
    terminalBlack: "#44475a",
    terminalBrightBlack: "#6272a4",
    terminalSelectionBackground: "#44475a",
    terminalAnsi: {
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  }),
);

export const darkNordTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#2e3440",
    surface1: "#333a48",
    surface2: "#3b4252",
    surface3: "#434c5e",
    surface4: "#4c566a",
    surfaceDiffEmpty: "#353c4a",
    surfaceSidebar: "#272c36",
    foreground: "#d8dee9",
    foregroundMuted: "#b4bccb",
    foregroundExtraMuted: "#7b8698",
    border: "#3b4252",
    borderAccent: "#434c5e",
    accent: "#81a1c1",
    accentBright: "#88c0d0",
    accentForeground: "#2e3440",
    destructive: "#bf616a",
    terminalBlack: "#4c566a",
    terminalBrightBlack: "#616e88",
    terminalSelectionBackground: "#434c5e",
    terminalAnsi: {
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  }),
);

export const darkTokyoNightTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#1a1b26",
    surface1: "#1f2030",
    surface2: "#24283b",
    surface3: "#292e42",
    surface4: "#414868",
    surfaceDiffEmpty: "#222536",
    surfaceSidebar: "#16161e",
    foreground: "#c0caf5",
    foregroundMuted: "#9aa5ce",
    foregroundExtraMuted: "#565f89",
    border: "#292e42",
    borderAccent: "#3b4261",
    accent: "#7aa2f7",
    accentBright: "#7dcfff",
    accentForeground: "#1a1b26",
    destructive: "#db4b4b",
    terminalBlack: "#414868",
    terminalBrightBlack: "#565f89",
    terminalSelectionBackground: "#33467c",
    terminalAnsi: {
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  }),
);

export const darkCatppuccinMochaTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#1e1e2e",
    surface1: "#24243a",
    surface2: "#313244",
    surface3: "#45475a",
    surface4: "#585b70",
    surfaceDiffEmpty: "#292a3c",
    surfaceSidebar: "#181825",
    foreground: "#cdd6f4",
    foregroundMuted: "#a6adc8",
    foregroundExtraMuted: "#7f849c",
    border: "#313244",
    borderAccent: "#45475a",
    accent: "#cba6f7",
    accentBright: "#b4befe",
    accentForeground: "#1e1e2e",
    destructive: "#d95a7f",
    terminalBlack: "#45475a",
    terminalBrightBlack: "#585b70",
    terminalSelectionBackground: "#585b70",
    terminalAnsi: {
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  }),
);

export const darkGruvboxTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#282828",
    surface1: "#32302f",
    surface2: "#3c3836",
    surface3: "#504945",
    surface4: "#665c54",
    surfaceDiffEmpty: "#302e2c",
    surfaceSidebar: "#1d2021",
    foreground: "#ebdbb2",
    foregroundMuted: "#bdae93",
    foregroundExtraMuted: "#928374",
    border: "#3c3836",
    borderAccent: "#504945",
    accent: "#d79921",
    accentBright: "#fabd2f",
    accentForeground: "#282828",
    destructive: "#cc241d",
    terminalBlack: "#504945",
    terminalBrightBlack: "#928374",
    terminalSelectionBackground: "#504945",
    terminalAnsi: {
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  }),
);

export const darkSolarizedTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#002b36",
    surface1: "#03303c",
    surface2: "#073642",
    surface3: "#0f424f",
    surface4: "#1c4f5c",
    surfaceDiffEmpty: "#05323e",
    surfaceSidebar: "#00252f",
    foreground: "#839496",
    foregroundMuted: "#657b83",
    foregroundExtraMuted: "#586e75",
    border: "#073642",
    borderAccent: "#0f424f",
    accent: "#268bd2",
    accentBright: "#2aa198",
    destructive: "#dc322f",
    terminalBlack: "#586e75",
    terminalBrightBlack: "#657b83",
    terminalSelectionBackground: "#073642",
    terminalAnsi: {
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  }),
);

export const darkOneDarkTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#282c34",
    surface1: "#2c323c",
    surface2: "#353b45",
    surface3: "#3e4451",
    surface4: "#4b5263",
    surfaceDiffEmpty: "#2f353f",
    surfaceSidebar: "#21252b",
    foreground: "#abb2bf",
    foregroundMuted: "#8b93a1",
    foregroundExtraMuted: "#5c6370",
    border: "#353b45",
    borderAccent: "#3e4451",
    accent: "#61afef",
    accentBright: "#56b6c2",
    accentForeground: "#282c34",
    destructive: "#d55b63",
    terminalBlack: "#4b5263",
    terminalBrightBlack: "#5c6370",
    terminalSelectionBackground: "#3e4451",
    terminalAnsi: {
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  }),
);

export const darkRosePineTheme = buildDarkTheme(
  buildDarkSemanticColors({
    surface0: "#191724",
    surface1: "#1f1d2e",
    surface2: "#26233a",
    surface3: "#403d52",
    surface4: "#524f67",
    surfaceDiffEmpty: "#21202e",
    surfaceSidebar: "#14121d",
    foreground: "#e0def4",
    foregroundMuted: "#908caa",
    foregroundExtraMuted: "#6e6a86",
    border: "#26233a",
    borderAccent: "#403d52",
    accent: "#c4a7e7",
    accentBright: "#ebbcba",
    accentForeground: "#191724",
    destructive: "#d9527a",
    terminalBlack: "#524f67",
    terminalBrightBlack: "#6e6a86",
    terminalSelectionBackground: "#403d52",
    terminalAnsi: {
      red: "#eb6f92",
      green: "#31748f",
      yellow: "#f6c177",
      blue: "#9ccfd8",
      magenta: "#c4a7e7",
      cyan: "#ebbcba",
      white: "#e0def4",
      brightRed: "#eb6f92",
      brightGreen: "#31748f",
      brightYellow: "#f6c177",
      brightBlue: "#9ccfd8",
      brightMagenta: "#c4a7e7",
      brightCyan: "#ebbcba",
      brightWhite: "#e0def4",
    },
  }),
);

const lightShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.02)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.04)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.08)",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

export function buildLightTheme(semanticColors: ReturnType<typeof buildLightSemanticColors>) {
  return {
    colorScheme: "light" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: lightHighlightColors,
      usage: USAGE_LIGHT_PALETTE,
    },
    shadow: lightShadow,
    ...commonTheme,
  } as const;
}

export const lightTheme = buildLightTheme(lightSemanticColors);

// Light palette variants. Same rules as the dark variants, plus the light
// terminal rule: white / brightWhite / black must clear 3:1 on the terminal
// background, so a palette's near-background whites are swapped for its
// closest gray tier that still reads.

export const lightCatppuccinLatteTheme = buildLightTheme(
  buildLightSemanticColors({
    surface0: "#eff1f5",
    surface1: "#e6e9ef",
    surface2: "#dce0e8",
    surface3: "#ccd0da",
    surface4: "#bcc0cc",
    surfaceDiffEmpty: "#e9ecf1",
    surfaceSidebar: "#e6e9ef",
    foreground: "#4c4f69",
    foregroundMuted: "#5c5f77",
    foregroundExtraMuted: "#8c8fa1",
    border: "#dce0e8",
    borderAccent: "#ccd0da",
    accent: "#8839ef",
    accentBright: "#7287fd",
    accentForeground: "#ffffff",
    primary: "#4c4f69",
    primaryForeground: "#eff1f5",
    destructive: "#d20f39",
    terminalBlack: "#5c5f77",
    terminalBrightBlack: "#6c6f85",
    terminalSelectionBackground: "#acb0be",
    terminalAnsi: {
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#7c7f93",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#ea76cb",
      brightCyan: "#179299",
      brightWhite: "#838799",
    },
    ring: "#4c4f69",
  }),
);

export const lightSolarizedTheme = buildLightTheme(
  buildLightSemanticColors({
    surface0: "#fdf6e3",
    surface1: "#f7efd9",
    surface2: "#eee8d5",
    surface3: "#e3dcc6",
    surface4: "#d3cbb7",
    surfaceDiffEmpty: "#f6eedb",
    surfaceSidebar: "#eee8d5",
    // Shifted one tier darker than the palette (base02 / base01 / base00): the palette
    // foreground base00 sits at 4.0:1 on base3, so body text takes base02 and the muted
    // tiers keep their hierarchy at 4.99 and 4.13.
    foreground: "#073642",
    foregroundMuted: "#586e75",
    foregroundExtraMuted: "#657b83",
    border: "#e6dfca",
    borderAccent: "#d9d2bd",
    accent: "#268bd2",
    accentBright: "#2aa198",
    accentForeground: "#ffffff",
    primary: "#073642",
    primaryForeground: "#fdf6e3",
    destructive: "#dc322f",
    terminalBlack: "#073642",
    terminalBrightBlack: "#002b36",
    terminalSelectionBackground: "#eee8d5",
    terminalAnsi: {
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#657b83",
    },
    ring: "#586e75",
  }),
);

export const lightOneLightTheme = buildLightTheme(
  buildLightSemanticColors({
    surface0: "#fafafa",
    surface1: "#f0f0f1",
    surface2: "#eaeaeb",
    surface3: "#dbdbdc",
    surface4: "#c9c9cb",
    surfaceDiffEmpty: "#f2f2f2",
    surfaceSidebar: "#eaeaeb",
    foreground: "#383a42",
    foregroundMuted: "#696c77",
    foregroundExtraMuted: "#a0a1a7",
    border: "#dbdbdc",
    borderAccent: "#e5e5e6",
    accent: "#4078f2",
    accentBright: "#0184bc",
    accentForeground: "#ffffff",
    primary: "#383a42",
    primaryForeground: "#fafafa",
    destructive: "#e45649",
    terminalBlack: "#383a42",
    terminalBrightBlack: "#696c77",
    terminalSelectionBackground: "#e5e5e6",
    terminalAnsi: {
      red: "#e45649",
      green: "#50a14f",
      yellow: "#c18401",
      blue: "#4078f2",
      magenta: "#a626a4",
      cyan: "#0184bc",
      white: "#7f8188",
      brightRed: "#e45649",
      brightGreen: "#50a14f",
      brightYellow: "#c18401",
      brightBlue: "#4078f2",
      brightMagenta: "#a626a4",
      brightCyan: "#0184bc",
      brightWhite: "#8a8c93",
    },
    ring: "#383a42",
  }),
);

export const lightRosePineDawnTheme = buildLightTheme(
  buildLightSemanticColors({
    surface0: "#faf4ed",
    surface1: "#f4ede8",
    surface2: "#f2e9e1",
    surface3: "#dfdad9",
    surface4: "#cecacd",
    surfaceDiffEmpty: "#f6efe8",
    surfaceSidebar: "#f2e9e1",
    foreground: "#575279",
    foregroundMuted: "#6e6a8b",
    foregroundExtraMuted: "#9893a5",
    border: "#dfdad9",
    borderAccent: "#e4dfdc",
    accent: "#907aa9",
    accentBright: "#d7827e",
    accentForeground: "#ffffff",
    primary: "#575279",
    primaryForeground: "#faf4ed",
    destructive: "#b4637a",
    terminalBlack: "#575279",
    terminalBrightBlack: "#797593",
    terminalSelectionBackground: "#dfdad9",
    terminalAnsi: {
      red: "#b4637a",
      green: "#286983",
      yellow: "#ea9d34",
      blue: "#56949f",
      magenta: "#907aa9",
      cyan: "#d7827e",
      white: "#817d96",
      brightRed: "#b4637a",
      brightGreen: "#286983",
      brightYellow: "#ea9d34",
      brightBlue: "#56949f",
      brightMagenta: "#907aa9",
      brightCyan: "#d7827e",
      brightWhite: "#8c889f",
    },
    ring: "#575279",
  }),
);

export const lightGithubTheme = buildLightTheme(
  buildLightSemanticColors({
    surface0: "#ffffff",
    surface1: "#f6f8fa",
    surface2: "#eaeef2",
    surface3: "#d0d7de",
    surface4: "#afb8c1",
    surfaceDiffEmpty: "#f6f8fa",
    surfaceSidebar: "#f6f8fa",
    foreground: "#24292e",
    foregroundMuted: "#586069",
    foregroundExtraMuted: "#6a737d",
    border: "#d0d7de",
    borderAccent: "#e1e4e8",
    accent: "#0366d6",
    accentBright: "#005cc5",
    accentForeground: "#ffffff",
    primary: "#24292e",
    primaryForeground: "#ffffff",
    destructive: "#d73a49",
    terminalBlack: "#24292e",
    terminalBrightBlack: "#586069",
    terminalSelectionBackground: "#c8c8fa",
    terminalAnsi: {
      red: "#d73a49",
      green: "#28a745",
      yellow: "#dbab09",
      blue: "#0366d6",
      magenta: "#5a32a3",
      cyan: "#0598bc",
      white: "#6a737d",
      brightRed: "#cb2431",
      brightGreen: "#22863a",
      brightYellow: "#b08800",
      brightBlue: "#005cc5",
      brightMagenta: "#5a32a3",
      brightCyan: "#3192aa",
      brightWhite: "#8b949e",
    },
    ring: "#24292e",
  }),
);

// Keep compatibility with existing code
export const theme = darkTheme;

export const THEME_OPTIONS = [
  {
    name: "light",
    group: "primary",
    unistylesName: "light",
    theme: lightTheme,
    swatch: "#ffffff",
  },
  {
    name: "dark",
    group: "primary",
    unistylesName: "dark",
    theme: darkTheme,
    swatch: "#2D8B62",
  },
  { name: "auto", group: "primary" },
  {
    name: "zinc",
    group: "dark",
    unistylesName: "darkZinc",
    theme: darkZincTheme,
    swatch: "#808080",
  },
  {
    name: "midnight",
    group: "dark",
    unistylesName: "darkMidnight",
    theme: darkMidnightTheme,
    swatch: "#4A6BA8",
  },
  {
    name: "claude",
    group: "dark",
    unistylesName: "darkClaude",
    theme: darkClaudeTheme,
    swatch: "#D97757",
  },
  {
    name: "ghostty",
    group: "dark",
    unistylesName: "darkGhostty",
    theme: darkGhosttyTheme,
    swatch: "#8caaee",
  },
  {
    name: "pureBlack",
    group: "dark",
    unistylesName: "darkPureBlack",
    theme: darkPureBlackTheme,
    swatch: "#000000",
  },
  {
    name: "dracula",
    group: "dark",
    unistylesName: "darkDracula",
    theme: darkDraculaTheme,
    swatch: "#bd93f9",
  },
  {
    name: "nord",
    group: "dark",
    unistylesName: "darkNord",
    theme: darkNordTheme,
    swatch: "#88c0d0",
  },
  {
    name: "tokyoNight",
    group: "dark",
    unistylesName: "darkTokyoNight",
    theme: darkTokyoNightTheme,
    swatch: "#7aa2f7",
  },
  {
    name: "catppuccinMocha",
    group: "dark",
    unistylesName: "darkCatppuccinMocha",
    theme: darkCatppuccinMochaTheme,
    swatch: "#cba6f7",
  },
  {
    name: "gruvboxDark",
    group: "dark",
    unistylesName: "darkGruvbox",
    theme: darkGruvboxTheme,
    swatch: "#fe8019",
  },
  {
    name: "solarizedDark",
    group: "dark",
    unistylesName: "darkSolarized",
    theme: darkSolarizedTheme,
    swatch: "#268bd2",
  },
  {
    name: "oneDark",
    group: "dark",
    unistylesName: "darkOneDark",
    theme: darkOneDarkTheme,
    swatch: "#61afef",
  },
  {
    name: "rosePine",
    group: "dark",
    unistylesName: "darkRosePine",
    theme: darkRosePineTheme,
    swatch: "#ebbcba",
  },
  {
    name: "catppuccinLatte",
    group: "light",
    unistylesName: "lightCatppuccinLatte",
    theme: lightCatppuccinLatteTheme,
    swatch: "#8839ef",
  },
  {
    name: "solarizedLight",
    group: "light",
    unistylesName: "lightSolarized",
    theme: lightSolarizedTheme,
    swatch: "#cb4b16",
  },
  {
    name: "oneLight",
    group: "light",
    unistylesName: "lightOneLight",
    theme: lightOneLightTheme,
    swatch: "#4078f2",
  },
  {
    name: "rosePineDawn",
    group: "light",
    unistylesName: "lightRosePineDawn",
    theme: lightRosePineDawnTheme,
    swatch: "#d7827e",
  },
  {
    name: "githubLight",
    group: "light",
    unistylesName: "lightGithub",
    theme: lightGithubTheme,
    swatch: "#0366d6",
  },
] as const;

export const PLUGIN_THEME_PREFERENCE = "plugin";
export const PLUGIN_THEME_NAMES = {
  light: "pluginLight",
  dark: "pluginDark",
} as const;

export type ThemePreference =
  | (typeof THEME_OPTIONS)[number]["name"]
  | typeof PLUGIN_THEME_PREFERENCE;
export type ThemeName = Exclude<ThemePreference, "auto" | typeof PLUGIN_THEME_PREFERENCE>;
type ConcreteThemeOption = Exclude<(typeof THEME_OPTIONS)[number], { name: "auto" }>;
export type Theme = ConcreteThemeOption["theme"];
/** Built-in themes that render dark, i.e. what "System" may pick when the OS is dark. */
export type DarkThemeName = Extract<
  ConcreteThemeOption,
  { theme: { colorScheme: "dark" } }
>["name"];
/** Built-in themes that render light, i.e. what "System" may pick when the OS is light. */
export type LightThemeName = Extract<
  ConcreteThemeOption,
  { theme: { colorScheme: "light" } }
>["name"];

const CONCRETE_THEME_OPTIONS = THEME_OPTIONS.filter(
  (option): option is ConcreteThemeOption => option.name !== "auto",
);

type DarkThemeOption = Extract<ConcreteThemeOption, { theme: { colorScheme: "dark" } }>;
type LightThemeOption = Extract<ConcreteThemeOption, { theme: { colorScheme: "light" } }>;

export const DARK_THEME_NAMES: readonly DarkThemeName[] = CONCRETE_THEME_OPTIONS.filter(
  (option): option is DarkThemeOption => option.theme.colorScheme === "dark",
).map((option) => option.name);

export const LIGHT_THEME_NAMES: readonly LightThemeName[] = CONCRETE_THEME_OPTIONS.filter(
  (option): option is LightThemeOption => option.theme.colorScheme === "light",
).map((option) => option.name);

// 快捷键只在三个主值间轮转；从任何变体或插件主题出发都回到 light。
const THEME_CYCLE: readonly ThemePreference[] = ["light", "dark", "auto"];

type ThemeToUnistyles = {
  [Name in ThemeName]: Extract<ConcreteThemeOption, { name: Name }>["unistylesName"];
};

type ThemeSwatches = {
  [Name in ThemeName]: Extract<ConcreteThemeOption, { name: Name }>["swatch"];
};

type RegisteredThemes = {
  [Option in ConcreteThemeOption as Option["unistylesName"]]: Option["theme"];
} & {
  pluginLight: typeof lightTheme;
  pluginDark: typeof darkTheme;
};

export const THEME_TO_UNISTYLES = Object.fromEntries(
  CONCRETE_THEME_OPTIONS.map((option) => [option.name, option.unistylesName]),
) as ThemeToUnistyles;

export const THEME_SWATCHES = Object.fromEntries(
  CONCRETE_THEME_OPTIONS.map((option) => [option.name, option.swatch]),
) as ThemeSwatches;

export const REGISTERED_THEMES = {
  ...Object.fromEntries(
    CONCRETE_THEME_OPTIONS.map((option) => [option.unistylesName, option.theme]),
  ),
  [PLUGIN_THEME_NAMES.light]: lightTheme,
  [PLUGIN_THEME_NAMES.dark]: darkTheme,
} as RegisteredThemes;

export function getNextThemePreference(current: ThemePreference): ThemePreference {
  const currentIndex = THEME_CYCLE.indexOf(current);
  if (currentIndex === -1) return THEME_CYCLE[0];
  return THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length];
}
