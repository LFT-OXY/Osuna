import { describe, expect, it } from "vitest";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK } from "@/styles/theme";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "@/terminal/runtime/terminal-font";
import {
  resolveMonoFontStack,
  resolveTerminalFont,
  resolveTerminalFontStack,
  resolveUiFontStack,
} from "./font-stack.native";

describe("native font stacks", () => {
  it("replaces the default stack with the chosen font instead of prepending", () => {
    expect(resolveUiFontStack("  Inter  ")).toBe("Inter");
    expect(resolveMonoFontStack("Menlo")).toBe("Menlo");
  });

  it("falls back to the platform default when unset", () => {
    expect(resolveUiFontStack("")).toBe(DEFAULT_UI_FONT_STACK);
    expect(resolveMonoFontStack(" ")).toBe(DEFAULT_MONO_FONT_STACK);
  });

  it("keeps the terminal on its pre-existing fallback stack", () => {
    expect(resolveTerminalFontStack("Menlo")).toBe("Menlo");
    expect(resolveTerminalFontStack("")).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });

  it("lets the terminal follow or override the code font and size", () => {
    const settings = {
      monoFontFamily: "Menlo",
      codeFontSize: 13,
      terminalFontFamily: "",
      terminalFontSize: null,
    };
    expect(resolveTerminalFont(settings)).toEqual({ fontFamily: "Menlo", fontSize: 13 });
    expect(
      resolveTerminalFont({ ...settings, terminalFontFamily: "Courier", terminalFontSize: 18 }),
    ).toEqual({ fontFamily: "Courier", fontSize: 18 });
    expect(resolveTerminalFont({ ...settings, monoFontFamily: "" }).fontFamily).toBe(
      DEFAULT_TERMINAL_FONT_FAMILY,
    );
  });
});
