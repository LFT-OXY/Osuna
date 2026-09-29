import { describe, expect, it } from "vitest";
import { findActiveFileMention } from "./file-mention-autocomplete";

describe("findActiveFileMention", () => {
  it("detects mentions at the start of input", () => {
    const mention = findActiveFileMention({
      text: "@src/components",
      cursorIndex: "@src/components".length,
      blockBoundary: 0,
    });
    expect(mention).toEqual({
      start: 0,
      end: "@src/components".length,
      query: "src/components",
    });
  });

  it("detects mentions in the middle of input using cursor position", () => {
    const text = 'read "@src/com" before merging';
    const cursorIndex = text.indexOf('"') + 9;
    const mention = findActiveFileMention({
      text,
      cursorIndex,
      blockBoundary: 0,
    });
    expect(mention).toEqual({
      start: text.indexOf("@"),
      end: cursorIndex,
      query: "src/com",
    });
  });

  it("returns null when cursor is outside the mention token", () => {
    const text = "please review @src/components now";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
      blockBoundary: 0,
    });
    expect(mention).toBeNull();
  });

  it("returns null when @ at start is followed by a delimiter", () => {
    const mention = findActiveFileMention({
      text: "@ ",
      cursorIndex: 2,
      blockBoundary: 0,
    });
    expect(mention).toBeNull();
  });

  it("does not reach back past an inline block", () => {
    // 光标紧跟 File mention，块的链接目标里有 @。
    const text = "see [x.ts](node_modules/@types/x.ts)";
    expect(
      findActiveFileMention({ text, cursorIndex: text.length, blockBoundary: text.length }),
    ).toBeNull();
  });

  it("finds a mention typed right after an inline block", () => {
    const block = "[x.ts](src/x.ts)";
    const text = `${block}@lib`;
    expect(
      findActiveFileMention({ text, cursorIndex: text.length, blockBoundary: block.length }),
    ).toEqual({ start: block.length, end: text.length, query: "lib" });
  });
});
