import { describe, expect, test } from "vitest";

import type { TerminalSession } from "./terminal.js";
import { applyTerminalSize, applyTerminalViewAttributes } from "./terminal-size-ownership.js";

function createTerminal(): {
  terminal: TerminalSession;
  appliedSizes: string[];
  appliedBackgrounds: string[];
} {
  const appliedSizes: string[] = [];
  const appliedBackgrounds: string[] = [];
  let size = { rows: 24, cols: 80 };
  const terminal = {
    getSize: () => size,
    send: (message: Parameters<TerminalSession["send"]>[0]) => {
      if (message.type === "resize") {
        size = { rows: message.rows, cols: message.cols };
        appliedSizes.push(`${message.cols}x${message.rows}`);
      } else if (message.type === "view_attributes") {
        appliedBackgrounds.push(message.attributes.background);
      }
    },
  } as TerminalSession;
  return { terminal, appliedSizes, appliedBackgrounds };
}

function viewAttributes(background: string) {
  return { foreground: "#1a1a1e", background, cursor: "#1a1a1e" };
}

describe("terminal size ownership", () => {
  test("only the latest claimant can update a terminal size", () => {
    const { terminal, appliedSizes } = createTerminal();
    const ownerA = {};
    const ownerB = {};

    expect(applyTerminalSize(terminal, ownerA, { rows: 30, cols: 100, intent: "claim" })).toBe(
      true,
    );
    expect(applyTerminalSize(terminal, ownerA, { rows: 31, cols: 101, intent: "update" })).toBe(
      true,
    );
    expect(applyTerminalSize(terminal, ownerB, { rows: 32, cols: 102, intent: "update" })).toBe(
      false,
    );
    expect(applyTerminalSize(terminal, ownerB, { rows: 33, cols: 103, intent: "claim" })).toBe(
      true,
    );
    expect(applyTerminalSize(terminal, ownerA, { rows: 34, cols: 104, intent: "update" })).toBe(
      false,
    );
    expect(applyTerminalSize(terminal, ownerA, { rows: 35, cols: 105 })).toBe(true);
    expect(applyTerminalSize(terminal, ownerB, { rows: 36, cols: 106, intent: "update" })).toBe(
      false,
    );

    expect(appliedSizes).toEqual(["100x30", "101x31", "103x33", "105x35"]);
  });

  test("transfers ownership when a new claimant reports the current size", () => {
    const { terminal, appliedSizes } = createTerminal();
    const ownerA = {};
    const ownerB = {};

    applyTerminalSize(terminal, ownerA, { rows: 30, cols: 100, intent: "claim" });
    applyTerminalSize(terminal, ownerB, { rows: 30, cols: 100, intent: "claim" });
    applyTerminalSize(terminal, ownerA, { rows: 31, cols: 101, intent: "update" });
    applyTerminalSize(terminal, ownerB, { rows: 32, cols: 102, intent: "update" });

    expect(appliedSizes).toEqual(["100x30", "102x32"]);
  });

  test("only the current size owner can push view attributes", () => {
    const { terminal, appliedBackgrounds } = createTerminal();
    const ownerA = {};
    const ownerB = {};

    // 还没有任何所有者：静默忽略。
    expect(applyTerminalViewAttributes(terminal, ownerA, viewAttributes("#000000"))).toBe(false);

    applyTerminalSize(terminal, ownerA, { rows: 30, cols: 100, intent: "claim" });
    expect(applyTerminalViewAttributes(terminal, ownerA, viewAttributes("#ffffff"))).toBe(true);
    expect(applyTerminalViewAttributes(terminal, ownerB, viewAttributes("#111111"))).toBe(false);

    applyTerminalSize(terminal, ownerB, { rows: 30, cols: 100, intent: "claim" });
    expect(applyTerminalViewAttributes(terminal, ownerB, viewAttributes("#222222"))).toBe(true);
    expect(applyTerminalViewAttributes(terminal, ownerA, viewAttributes("#333333"))).toBe(false);

    expect(appliedBackgrounds).toEqual(["#ffffff", "#222222"]);
  });
});
