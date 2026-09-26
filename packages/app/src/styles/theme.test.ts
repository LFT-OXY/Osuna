import { QueryClient } from "@tanstack/react-query";
import type { PluginThemeContribution } from "@getpaseo/plugin";
import { describe, expect, it } from "vitest";
import { collectPluginThemes } from "@/plugins/themes";
import type { InstalledPlugin } from "@/plugins/types";
import { contrastRatio } from "@/terminal/runtime/terminal-contrast";
import {
  BORDER_RADIUS,
  CONTROL_HEIGHT,
  DARK_THEME_NAMES,
  darkDraculaTheme,
  darkGruvboxTheme,
  darkNordTheme,
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  ICON_SIZE,
  LIGHT_THEME_NAMES,
  lightCatppuccinLatteTheme,
  lightGithubTheme,
  lightSolarizedTheme,
  lightTheme,
  RADIUS,
  THEME_OPTIONS,
  THEME_SWATCHES,
  type Theme,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

// 2026-09 之前的五套深色变体共享 darkTerminalAnsi；之后的每套都带自己的调色板。
const LEGACY_DARK_VARIANTS = ["zinc", "midnight", "claude", "ghostty", "pureBlack"] as const;

const PALETTE_DARK_VARIANTS = [
  "dracula",
  "nord",
  "tokyoNight",
  "catppuccinMocha",
  "gruvboxDark",
  "solarizedDark",
  "oneDark",
  "rosePine",
] as const;

const LIGHT_VARIANTS = [
  "catppuccinLatte",
  "solarizedLight",
  "oneLight",
  "rosePineDawn",
  "githubLight",
] as const;

describe("Theme catalog", () => {
  it("owns the picker order: main values, dark variants, light variants", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      ...LEGACY_DARK_VARIANTS,
      ...PALETTE_DARK_VARIANTS,
      ...LIGHT_VARIANTS,
    ]);
  });

  it("groups every entry by the color scheme it renders", () => {
    for (const option of THEME_OPTIONS) {
      if (!("theme" in option)) {
        expect(option.group).toBe("primary");
        continue;
      }
      if (option.group === "primary") continue;
      expect(option.group).toBe(option.theme.colorScheme);
    }
    expect(DARK_THEME_NAMES).toEqual(["dark", ...LEGACY_DARK_VARIANTS, ...PALETTE_DARK_VARIANTS]);
    expect(LIGHT_THEME_NAMES).toEqual(["light", ...LIGHT_VARIANTS]);
  });

  it("registers dark variants under the dark prefix and light variants under the light prefix", () => {
    for (const option of THEME_OPTIONS) {
      if (!("theme" in option) || option.group === "primary") continue;
      expect(option.unistylesName.startsWith(option.theme.colorScheme)).toBe(true);
    }
  });

  it("cycles the shortcut through the three main values only", () => {
    expect(getNextThemePreference("light")).toBe("dark");
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("auto")).toBe("light");
    expect(getNextThemePreference("pureBlack")).toBe("light");
    expect(getNextThemePreference("dracula")).toBe("light");
    expect(getNextThemePreference("githubLight")).toBe("light");
    expect(getNextThemePreference("plugin")).toBe("light");
  });
});

describe("Terminal palettes", () => {
  it("keeps the shared ANSI colors for themes that do not provide their own", () => {
    for (const name of LEGACY_DARK_VARIANTS) {
      const option = THEME_OPTIONS.find((entry) => entry.name === name);
      if (!option || !("theme" in option)) throw new Error(`missing ${name}`);
      expect(option.theme.colors.terminal.red).toBe(darkTheme.colors.terminal.red);
      expect(option.theme.colors.terminal.brightWhite).toBe(darkTheme.colors.terminal.brightWhite);
      expect(option.theme.colors.terminal.selectionBackground).toBe(
        darkTheme.colors.terminal.selectionBackground,
      );
    }
  });

  it("renders Dracula's own 14 ANSI colors and selection color", () => {
    expect(darkDraculaTheme.colors.terminal).toMatchObject({
      background: "#282a36",
      foreground: "#f8f8f2",
      selectionBackground: "#44475a",
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
    });
  });

  it("renders Catppuccin Latte's own 14 ANSI colors on its light surface", () => {
    expect(lightCatppuccinLatteTheme.colorScheme).toBe("light");
    expect(lightCatppuccinLatteTheme.colors.terminal).toMatchObject({
      background: "#eff1f5",
      foreground: "#4c4f69",
      selectionBackground: "#acb0be",
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
    });
  });

  it("gives every palette variant its own ANSI red and selection color", () => {
    for (const name of [...PALETTE_DARK_VARIANTS, ...LIGHT_VARIANTS]) {
      const option = THEME_OPTIONS.find((entry) => entry.name === name);
      if (!option || !("theme" in option)) throw new Error(`missing ${name}`);
      const shared = option.theme.colorScheme === "dark" ? darkTheme : lightTheme;
      expect(option.theme.colors.terminal.red).not.toBe(shared.colors.terminal.red);
      expect(option.theme.colors.terminal.selectionBackground).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("derives cursor colors from the surface and foreground so the daemon bridge gets pure hex", () => {
    for (const option of THEME_OPTIONS) {
      if (!("theme" in option)) continue;
      const { colors } = option.theme;
      expect(colors.terminal.background).toBe(colors.surface0);
      expect(colors.terminal.foreground).toBe(colors.foreground);
      expect(colors.terminal.cursor).toBe(colors.foreground);
      expect(colors.terminal.cursorAccent).toBe(colors.surface0);
    }
  });
});

describe("Variant accents", () => {
  it("uses the signature accents from the palette catalog", () => {
    expect(darkNordTheme.colors.accent).toBe("#81a1c1");
    expect(darkNordTheme.colors.accentBright).toBe("#88c0d0");
    expect(darkGruvboxTheme.colors.accent).toBe("#d79921");
    expect(lightGithubTheme.colors.accent).toBe("#0366d6");
    expect(THEME_SWATCHES.gruvboxDark).toBe("#fe8019");
    expect(THEME_SWATCHES.solarizedLight).toBe("#cb4b16");
  });

  it("shifts Solarized Light's text tiers one step darker than the palette", () => {
    expect(lightSolarizedTheme.colors.foreground).toBe("#073642");
    expect(lightSolarizedTheme.colors.foregroundMuted).toBe("#586e75");
    expect(lightSolarizedTheme.colors.foregroundExtraMuted).toBe("#657b83");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Paseo's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("derives sidebar hover from the surface scale and lifts selection clear of it", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe("#0a0a0a");
    // surface2 (#111111) 与 hover 只有 1.048:1，派生向前景色多叠 1% 到可辨。
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe("#131313");
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

// 期望值取自 t3code 仓库 packages/shared/src/themePalettes.ts 的默认主题色板；侧栏行态是设计稿里
// 半透明叠色折算成的不透明值（暗色 hover 为黑上 4% 白，选中为 7.5% 白）。
describe("Default palette", () => {
  it("paints Dark with the t3code canvas, surfaces, text and blue accent", () => {
    expect(darkTheme.colors).toMatchObject({
      surface0: "#0a0a0a",
      surfaceWorkspace: "#0a0a0a",
      surfaceChrome: "#0a0a0a",
      surfaceCard: "#111111",
      surfaceMessage: "#141414",
      surfaceSidebar: "#000000",
      foreground: "#f5f5f5",
      foregroundMuted: "#818181",
      border: "#191919",
      borderInput: "#1e1e1e",
      borderAccent: "#262626",
      accent: "#346bf1",
      accentForeground: "#ffffff",
    });
    expect(darkTheme.colors.terminal.background).toBe("#0a0a0a");
  });

  it("paints Light with the t3code canvas, surfaces, text and blue accent", () => {
    expect(lightTheme.colors).toMatchObject({
      surface0: "#fcfcfc",
      surfaceWorkspace: "#fcfcfc",
      surfaceChrome: "#fcfcfc",
      surfaceCard: "#ffffff",
      surfaceMessage: "#f4f4f5",
      surfaceSidebar: "#fafafa",
      foreground: "#27272a",
      foregroundMuted: "#71717b",
      border: "#e4e4e7",
      borderInput: "#d4d4d8",
      borderAccent: "#d4d4d8",
      accent: "#1b4ed8",
      accentForeground: "#ffffff",
    });
  });

  it("keeps the Dark sidebar darker than the canvas", () => {
    // 与纯黑的对比度随亮度单调递增，越暗越接近 1。
    const sidebar = ratio(darkTheme.colors.surfaceSidebar, "#000000");
    const canvas = ratio(darkTheme.colors.surfaceWorkspace, "#000000");
    expect(sidebar).toBeLessThan(canvas);
  });

  it("uses the designed sidebar row states", () => {
    expect(darkTheme.colors).toMatchObject({
      surfaceSidebarHover: "#0a0a0a",
      surfaceSidebarSelected: "#131313",
      borderSidebarSelected: "#212121",
    });
    expect(lightTheme.colors).toMatchObject({
      surfaceSidebarHover: "#f1f1f1",
      surfaceSidebarSelected: "#eaeaea",
      borderSidebarSelected: "#dadada",
    });
  });

  it("gives Light a composer shadow and Dark a top inner highlight instead", () => {
    expect(lightTheme.colors.shadowComposer).toBe("rgba(0, 0, 0, 0.4)");
    expect(lightTheme.colors.insetHighlight).toBe("transparent");
    expect(darkTheme.colors.shadowComposer).toBe("transparent");
    expect(darkTheme.colors.insetHighlight).toBe("rgba(255, 255, 255, 0.04)");
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#fcfcfc",
      successForeground: "#fcfcfc",
      terminal: {
        black: "#27272a",
        brightBlack: "#3f3f46",
      },
    });
  });
});

// 插件主题样例：插件最多贡献 8 个颜色，重设计角色全部靠派生。
const PLUGIN_SAMPLES: PluginThemeContribution[] = [
  {
    id: "mocha",
    name: "Sample Mocha",
    appearance: "dark",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      raised: "#313244",
      control: "#45475a",
      border: "#45475a",
      accent: "#cba6f7",
      mutedForeground: "#a6adc8",
      ring: "#6c7086",
    },
  },
  {
    id: "latte",
    name: "Sample Latte",
    appearance: "light",
    colors: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      raised: "#e6e9ef",
      control: "#dce0e8",
      border: "#ccd0da",
      mutedForeground: "#5c5f77",
      ring: "#9ca0b0",
    },
  },
];

interface CatalogEntry {
  name: string;
  theme: Theme;
}

function buildPluginSamples(): CatalogEntry[] {
  const plugin: InstalledPlugin = {
    id: "sample",
    cleanup: () => undefined,
    serverId: "host",
    clientBundle: "host",
    lifetime: new AbortController(),
    queryClient: new QueryClient(),
    settingsScreens: [],
    surfaces: [],
    sidebarItems: [],
    workspacePanels: [],
    commandCenterItems: [],
    clientSlashCommands: [],
    attachmentSources: [],
    themes: PLUGIN_SAMPLES,
    timelineTransformers: [],
    timelineRenderers: [],
  };
  return collectPluginThemes([plugin], new Set(["host"]), new Set()).map((option) => ({
    name: `plugin ${option.name}`,
    theme: option.theme,
  }));
}

const BUILT_IN_CATALOG: CatalogEntry[] = THEME_OPTIONS.flatMap((option): CatalogEntry[] =>
  "theme" in option ? [{ name: option.name, theme: option.theme }] : [],
);
const CATALOG: CatalogEntry[] = [...BUILT_IN_CATALOG, ...buildPluginSamples()];

const REDESIGN_ROLES = [
  "surfaceWorkspace",
  "surfaceChrome",
  "surfaceCard",
  "surfaceMessage",
  "surfaceSidebarHover",
  "surfaceSidebarActive",
  "surfaceSidebarSelected",
  "borderSidebarSelected",
  "borderInput",
  "diffAdditionBackground",
  "diffDeletionBackground",
  "diffAdditionBar",
  "diffDeletionBar",
  "shadowComposer",
  "insetHighlight",
] as const;

const COLOR_VALUE =
  /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\)|transparent)$/i;
// 可辨阈值：设计稿里最轻的一档（黑色侧栏上 4% 白的 hover）约 1.06:1。
const ROW_STATE_MINIMUM_CONTRAST = 1.05;

function ratio(a: string, b: string): number {
  const result = contrastRatio(a, b);
  if (result === undefined) throw new Error(`not a #rrggbb pair: ${a} / ${b}`);
  return result;
}

describe("Redesign roles across the catalog", () => {
  it("covers every built-in theme plus a dark and a light plugin theme", () => {
    expect(BUILT_IN_CATALOG.map(({ name }) => name)).toEqual([
      ...LIGHT_THEME_NAMES.slice(0, 1),
      ...DARK_THEME_NAMES,
      ...LIGHT_THEME_NAMES.slice(1),
    ]);
    expect(CATALOG).toHaveLength(BUILT_IN_CATALOG.length + PLUGIN_SAMPLES.length);
  });

  it.each(CATALOG)("gives $name a color for every redesign role", ({ theme }) => {
    for (const role of REDESIGN_ROLES) {
      expect(theme.colors[role], role).toMatch(COLOR_VALUE);
    }
  });

  it("derives the same plugin theme every time it is built", () => {
    expect(buildPluginSamples()).toEqual(buildPluginSamples());
  });

  // 现有阈值只约束 surface0 上的两级文字。新表面沿用同一阈值：主文字在每个新表面上都要达标，
  // 次级文字只要求画布。旧主题的次级文字落在 surface2 / surface3 这类抬升色阶上时本来就低于阈值，
  // 那些色阶不是本次新增，不逐套手调。
  it.each(CATALOG)(
    "keeps $name text above its scheme's minimum ratio on the new surfaces",
    ({ theme }) => {
      const minimum = theme.colorScheme === "light" ? 4.5 : 3;
      const { colors } = theme;
      for (const surface of [
        colors.surfaceWorkspace,
        colors.surfaceChrome,
        colors.surfaceCard,
        colors.surfaceMessage,
        colors.surfaceSidebar,
        colors.surfaceSidebarHover,
        colors.surfaceSidebarActive,
        colors.surfaceSidebarSelected,
      ]) {
        expect(ratio(colors.foreground, surface)).toBeGreaterThanOrEqual(minimum);
      }
      expect(ratio(colors.foregroundMuted, colors.surfaceWorkspace)).toBeGreaterThanOrEqual(
        minimum,
      );
    },
  );

  it.each(CATALOG)("keeps $name sidebar row states apart from each other", ({ theme }) => {
    const {
      surfaceSidebar,
      surfaceSidebarHover,
      surfaceSidebarActive,
      surfaceSidebarSelected,
      borderSidebarSelected,
    } = theme.colors;
    expect(ratio(surfaceSidebarHover, surfaceSidebar)).toBeGreaterThanOrEqual(
      ROW_STATE_MINIMUM_CONTRAST,
    );
    expect(ratio(surfaceSidebarActive, surfaceSidebarHover)).toBeGreaterThanOrEqual(
      ROW_STATE_MINIMUM_CONTRAST,
    );
    expect(ratio(surfaceSidebarSelected, surfaceSidebarHover)).toBeGreaterThanOrEqual(
      ROW_STATE_MINIMUM_CONTRAST,
    );
    expect(ratio(surfaceSidebarSelected, surfaceSidebar)).toBeGreaterThanOrEqual(
      ROW_STATE_MINIMUM_CONTRAST,
    );
    expect(ratio(surfaceSidebarActive, surfaceSidebarSelected)).toBeGreaterThanOrEqual(
      ROW_STATE_MINIMUM_CONTRAST,
    );
    expect(ratio(borderSidebarSelected, surfaceSidebarSelected)).toBeGreaterThanOrEqual(
      ROW_STATE_MINIMUM_CONTRAST,
    );
  });
});

describe("Status dots on the new sidebar", () => {
  // 状态点生成规则的约束：亮色一档四个点都要在侧栏静止与 hover 行上达到 3:1（WCAG 非文本最低值）。
  // 选中行不在约束内，改版前的选中底色同样不达标。
  it("keeps every Light status dot at 3:1 on the resting and hovered row", () => {
    const { colors } = lightTheme;
    const dots = [
      colors.statusDotSuccess,
      colors.statusDotDanger,
      colors.statusDotWarning,
      colors.statusDotRunning,
    ];
    for (const surface of [colors.surfaceSidebar, colors.surfaceSidebarHover]) {
      for (const dot of dots) {
        expect(ratio(dot, surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("Shape tokens", () => {
  it("adds the redesign radius ladder next to the unchanged legacy radii", () => {
    expect(RADIUS).toEqual({ sm: 6, md: 8, lg: 10, xl: 14, "2xl": 18, "3xl": 22, full: 9999 });
    expect(BORDER_RADIUS).toEqual({
      none: 0,
      sm: 2,
      base: 4,
      md: 6,
      lg: 8,
      xl: 12,
      "2xl": 16,
      full: 9999,
    });
    expect(darkTheme.radius).toBe(RADIUS);
    expect(lightTheme.radius).toBe(RADIUS);
  });

  it("offers three control heights and keeps 16 as the default icon size", () => {
    expect(CONTROL_HEIGHT).toEqual({ sm: 24, md: 28, lg: 32 });
    expect(darkTheme.controlHeight).toBe(CONTROL_HEIGHT);
    expect(ICON_SIZE).toMatchObject({ xs: 12, sm: 14, md: 16 });
  });
});
