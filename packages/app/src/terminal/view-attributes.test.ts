import { describe, expect, it } from "vitest";
import { getCurrentTerminalViewAttributes, toTerminalViewAttributes } from "./view-attributes";

describe("toTerminalViewAttributes", () => {
  it("maps the theme's terminal foreground, background and cursor to lowercase #rrggbb", () => {
    expect(
      toTerminalViewAttributes({
        foreground: "#1a1a1e",
        background: "#FFFFFF",
        cursor: "#1A1A1E",
      }),
    ).toEqual({ foreground: "#1a1a1e", background: "#ffffff", cursor: "#1a1a1e" });
  });

  it("returns undefined when any color is not a #rrggbb value, so nothing is sent", () => {
    expect(
      toTerminalViewAttributes({
        foreground: "#1a1a1e",
        background: "rgba(255, 255, 255, 0.2)",
        cursor: "#1a1a1e",
      }),
    ).toBeUndefined();
    expect(
      toTerminalViewAttributes({ foreground: "#fff", background: "#ffffff", cursor: "#000000" }),
    ).toBeUndefined();
  });
});

describe("getCurrentTerminalViewAttributes", () => {
  it("snapshots the three colors of the currently active theme", () => {
    // 期望值来自 test-stubs/react-native-unistyles.ts 里的 fixture 主题。
    expect(getCurrentTerminalViewAttributes()).toEqual({
      foreground: "#1a1a1e",
      background: "#ffffff",
      cursor: "#1a1a1e",
    });
  });
});
