import { describe, expect, it } from "vitest";
import {
  DARK_THEME_NAMES,
  darkDraculaTheme,
  darkGruvboxTheme,
  darkNordTheme,
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  LIGHT_THEME_NAMES,
  lightCatppuccinLatteTheme,
  lightGithubTheme,
  lightSolarizedTheme,
  lightTheme,
  THEME_OPTIONS,
  THEME_SWATCHES,
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

  it("uses Osuna's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("derives sidebar interaction surfaces from the surface scale", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(darkPureBlackTheme.colors.surface1);
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe(
      darkPureBlackTheme.colors.surface2,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Sidebar interaction surfaces", () => {
  it("keeps Light selection distinct from the sidebar surface", () => {
    expect(lightTheme.colors.surfaceSidebarHover).toBe(lightTheme.colors.surface1);
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface3);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
  });

  it("derives Dark hover and selection from the first two raised surfaces", () => {
    expect(darkTheme.colors.surfaceSidebarHover).toBe(darkTheme.colors.surface1);
    expect(darkTheme.colors.surfaceSidebarSelected).toBe(darkTheme.colors.surface2);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});
