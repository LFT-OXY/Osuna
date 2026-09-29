import { describe, expect, it } from "vitest";
import { resolveMonoFontStack, resolveTerminalFont, resolveTerminalFontStack } from "./font-stack";

const WEB_DEFAULT_MONO_STACK =
  "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const NERD_FALLBACKS =
  '"JetBrainsMono Nerd Font", "JetBrainsMono NF", "MesloLGM Nerd Font", "MesloLGM NF", ' +
  '"Hack Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font"';

describe("resolveMonoFontStack", () => {
  it("gives code surfaces the default mono stack when the code font is empty", () => {
    expect(resolveMonoFontStack("  ")).toBe(WEB_DEFAULT_MONO_STACK);
  });

  it("places a chosen code font in front of the default mono stack", () => {
    expect(resolveMonoFontStack("Maple Mono")).toBe(`"Maple Mono", ${WEB_DEFAULT_MONO_STACK}`);
  });
});

describe("resolveTerminalFontStack", () => {
  it("follows the default mono stack, then Nerd Fonts, then monospace when unset", () => {
    expect(resolveTerminalFontStack("")).toBe(
      "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', " +
        `${NERD_FALLBACKS}, monospace`,
    );
  });

  it("keeps Nerd Fonts ahead of the one trailing monospace when the code font names a generic", () => {
    expect(resolveTerminalFontStack("Maple Mono, monospace")).toBe(
      '"Maple Mono", SFMono-Regular, Menlo, Monaco, Consolas, ' +
        `'Liberation Mono', 'Courier New', ${NERD_FALLBACKS}, monospace`,
    );
  });
});

describe("resolveTerminalFont", () => {
  const followingSettings = {
    monoFontFamily: "Maple Mono",
    codeFontSize: 13,
    terminalFontFamily: "",
    terminalFontSize: null,
  };
  const mapleTerminalStack =
    '"Maple Mono", SFMono-Regular, Menlo, Monaco, Consolas, ' +
    `'Liberation Mono', 'Courier New', ${NERD_FALLBACKS}, monospace`;

  it("follows the code font and code size when the terminal has no override", () => {
    expect(resolveTerminalFont(followingSettings)).toEqual({
      fontFamily: mapleTerminalStack,
      fontSize: 13,
    });
  });

  it("uses the terminal font and size over the code font and size when set", () => {
    expect(
      resolveTerminalFont({
        ...followingSettings,
        terminalFontFamily: "Hack Nerd Font",
        terminalFontSize: 16,
      }),
    ).toEqual({
      fontFamily:
        '"Hack Nerd Font", SFMono-Regular, Menlo, Monaco, Consolas, ' +
        `'Liberation Mono', 'Courier New', ${NERD_FALLBACKS}, monospace`,
      fontSize: 16,
    });
  });

  it("treats a whitespace-only terminal font as following the code font", () => {
    expect(resolveTerminalFont({ ...followingSettings, terminalFontFamily: "  " }).fontFamily).toBe(
      mapleTerminalStack,
    );
  });
});
