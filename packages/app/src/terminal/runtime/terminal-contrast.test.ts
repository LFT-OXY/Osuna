import { describe, expect, it } from "vitest";

import { THEME_OPTIONS } from "@/styles/theme";
import { contrastRatio, resolveTerminalMinimumContrastRatio } from "./terminal-contrast";

describe("resolveTerminalMinimumContrastRatio", () => {
  it("returns 4.5 for a light background with dark text", () => {
    expect(
      resolveTerminalMinimumContrastRatio({ background: "#ffffff", foreground: "#1a1a1e" }),
    ).toBe(4.5);
  });

  it("returns 3 for a dark background with light text", () => {
    expect(
      resolveTerminalMinimumContrastRatio({ background: "#181b1a", foreground: "#e6e6e6" }),
    ).toBe(3);
  });

  it("classifies by relative luminance rather than by hex ordering", () => {
    // 纯蓝 (#0000ff) 的十六进制值大于中灰，但相对亮度只有 0.07。
    expect(
      resolveTerminalMinimumContrastRatio({ background: "#0000ff", foreground: "#808080" }),
    ).toBe(3);
  });

  it("leaves xterm's correction disabled when the theme colors cannot be parsed", () => {
    expect(
      resolveTerminalMinimumContrastRatio({ background: "rgba(0, 0, 0, 0.5)", foreground: "#fff" }),
    ).toBe(1);
    expect(resolveTerminalMinimumContrastRatio({})).toBe(1);
  });

  it("matches the ratio every built-in theme resolves to", () => {
    for (const option of THEME_OPTIONS) {
      if (!("theme" in option)) continue;
      const terminal = option.theme.colors.terminal;
      expect(
        resolveTerminalMinimumContrastRatio({
          background: terminal.background,
          foreground: terminal.foreground,
        }),
      ).toBe(option.theme.colorScheme === "light" ? 4.5 : 3);
    }
  });
});

const BUILT_IN_THEMES = THEME_OPTIONS.flatMap((option) =>
  "theme" in option ? [{ name: option.name, theme: option.theme }] : [],
);
const LIGHT_THEMES = BUILT_IN_THEMES.filter(({ theme }) => theme.colorScheme === "light");
// 2026-09 之前的深色主题把 ANSI black 放在底色同阶，作为既有行为保留；
// 之后加入的每一套深色变体都要让 black / brightBlack 在底色上可见。
const LEGACY_DARK_THEME_NAMES = new Set([
  "dark",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "pureBlack",
]);
const PALETTE_DARK_THEMES = BUILT_IN_THEMES.filter(
  ({ name, theme }) => theme.colorScheme === "dark" && !LEGACY_DARK_THEME_NAMES.has(name),
);

describe("built-in terminal palettes", () => {
  it("covers every light variant and every palette dark variant", () => {
    expect(LIGHT_THEMES.map(({ name }) => name)).toEqual([
      "light",
      "catppuccinLatte",
      "solarizedLight",
      "oneLight",
      "rosePineDawn",
      "githubLight",
    ]);
    expect(PALETTE_DARK_THEMES.map(({ name }) => name)).toEqual([
      "dracula",
      "nord",
      "tokyoNight",
      "catppuccinMocha",
      "gruvboxDark",
      "solarizedDark",
      "oneDark",
      "rosePine",
    ]);
  });

  it.each(LIGHT_THEMES)(
    "keeps ANSI white, brightWhite, black and brightBlack at least 3:1 on the $name light background",
    ({ theme }) => {
      const { background, white, brightWhite, black, brightBlack } = theme.colors.terminal;
      for (const color of [white, brightWhite, black, brightBlack]) {
        expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it.each(PALETTE_DARK_THEMES)(
    "keeps ANSI black and brightBlack visible on the $name dark background",
    ({ theme }) => {
      const { background, black, brightBlack } = theme.colors.terminal;
      expect(contrastRatio(black, background)).toBeGreaterThanOrEqual(1.5);
      expect(contrastRatio(brightBlack, background)).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(BUILT_IN_THEMES)(
    "keeps $name body text above the minimum ratio for its scheme",
    ({ theme }) => {
      const minimum = theme.colorScheme === "light" ? 4.5 : 3;
      const { surface0, foreground, foregroundMuted } = theme.colors;
      expect(contrastRatio(foreground, surface0)).toBeGreaterThanOrEqual(minimum);
      expect(contrastRatio(foregroundMuted, surface0)).toBeGreaterThanOrEqual(minimum);
    },
  );

  it.each(BUILT_IN_THEMES)("hands the daemon bridge pure #rrggbb colors for $name", ({ theme }) => {
    const { background, foreground, cursor } = theme.colors.terminal;
    for (const color of [background, foreground, cursor]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
