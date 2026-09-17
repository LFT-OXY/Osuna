import { describe, expect, it } from "vitest";

import { lightTheme, THEME_OPTIONS } from "@/styles/theme";
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

describe("light terminal palette", () => {
  it("keeps ANSI white and brightWhite at least 3:1 against the terminal background", () => {
    const { background, white, brightWhite } = lightTheme.colors.terminal;
    expect(contrastRatio(white, background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(brightWhite, background)).toBeGreaterThanOrEqual(3);
  });
});
