const testTheme = {
  colorScheme: "light",
  colors: {
    foreground: "#111111",
    foregroundMuted: "#666666",
    foregroundExtraMuted: "#a1a1aa",
    accentBright: "#3160db",
    statusSuccess: "#15803d",
    statusDanger: "#b91c1c",
    statusWarning: "#d97706",
    statusMerged: "#7c3aed",
    // The light band's values, so a test can name the colour it expects.
    statusDotSuccess: "#299f51",
    statusDotDanger: "#f12e2f",
    statusDotWarning: "#b37824",
    statusDotRunning: "#268ae0",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    destructive: "#dc2626",
    destructiveForeground: "#ffffff",
    surface0: "#ffffff",
    surface1: "#fafafa",
    surface2: "#f4f4f5",
    surface3: "#e4e4e7",
    border: "#e4e4e7",
    // 侧栏与行三态（<Row>），取默认亮色主题的值。
    surfaceSidebar: "#fafafa",
    surfaceSidebarHover: "#f1f1f1",
    surfaceSidebarActive: "#e4e4e4",
    surfaceSidebarSelected: "#eaeaea",
    borderSidebarSelected: "#dadada",
    borderAccent: "#a1a1aa",
    // 浮层（菜单、对话框）的卡片、毛玻璃与遮罩，取默认亮色主题的值。
    surfaceCard: "#ffffff",
    surfaceGlass: "rgba(255, 255, 255, 0.8)",
    overlayScrim: "rgba(0, 0, 0, 0.18)",
    palette: {
      amber: { 500: "#f59e0b" },
      blue: { 300: "#93c5fd" },
      green: { 500: "#22c55e" },
      red: { 300: "#fca5a5" },
      white: "#ffffff",
    },
    // 终端三色：前景/光标沿用浅色主题的 foreground，背景为白。
    terminal: {
      foreground: "#1a1a1e",
      background: "#ffffff",
      cursor: "#1a1a1e",
    },
  },
  borderWidth: { 1: 1 },
  spacing: [0, 4, 8, 12, 16, 20, 24, 28, 32],
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
  },
  fontFamily: {
    ui: "sans-serif",
    mono: "monospace",
  },
  // <Text> 阶梯，取 14px 界面字号下的原值。
  typeScale: {
    micro: { fontSize: 11, lineHeight: 15 },
    caption: { fontSize: 12, lineHeight: 16 },
    label: { fontSize: 13, lineHeight: 18 },
    body: { fontSize: 14, lineHeight: 20 },
    "body-lg": { fontSize: 15, lineHeight: 22 },
    "title-sm": { fontSize: 16, lineHeight: 24 },
    title: { fontSize: 18, lineHeight: 28 },
    "title-lg": { fontSize: 20, lineHeight: 28 },
    display: { fontSize: 24, lineHeight: 32 },
    prose: { fontSize: 14, lineHeight: 22 },
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
  },
  borderRadius: {
    base: 4,
    md: 6,
    lg: 8,
    xl: 12,
    full: 9999,
  },
  radius: { sm: 6, md: 8, lg: 10, xl: 14, "2xl": 18, "3xl": 22, full: 9999 },
  controlHeight: { sm: 24, md: 28, lg: 32 },
  iconSize: { sm: 16, md: 20 },
  opacity: { 50: 0.5 },
  shadow: {
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
  },
};

type StyleFactory<T> = (theme: typeof testTheme) => T;

function isStyleFactory<T>(styles: T | StyleFactory<T>): styles is StyleFactory<T> {
  return typeof styles === "function";
}

export const StyleSheet = {
  create: <T>(styles: T | StyleFactory<T>): T =>
    isStyleFactory(styles) ? styles(testTheme) : styles,
};

export const withUnistyles = <T>(Component: T): T => Component;

export const useUnistyles = () => ({
  theme: testTheme,
  rt: {},
  breakpoint: undefined,
});

export const UnistylesRuntime = {
  setTheme: () => undefined,
  getTheme: () => testTheme,
  themeName: "light",
};
