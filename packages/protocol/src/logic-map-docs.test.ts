import { describe, expect, it } from "vitest";
import { findMarkdownHeadingLine, logicMapOwnDocPath, markdownHeadings } from "./logic-map-docs.js";

const SPEC = [
  "# 登录",
  "",
  "总述。",
  "",
  "## 密码登录",
  "",
  "```md",
  "## 锁定账号",
  "```",
  "",
  "锁定账号",
  "--------",
  "",
  "## `锁定` 账号 ##",
  "",
  "## 密码登录",
].join("\n");

describe("findMarkdownHeadingLine", () => {
  it("returns the 1-based line of an ATX heading", () => {
    expect(findMarkdownHeadingLine(SPEC, "密码登录")).toBe(5);
  });

  it("returns the first line of a setext heading and skips fenced code", () => {
    expect(findMarkdownHeadingLine(SPEC, "锁定账号")).toBe(11);
  });

  it("matches with the daemon's normalization (inline code, closing hashes)", () => {
    expect(findMarkdownHeadingLine(SPEC, "## `锁定` 账号")).toBe(14);
  });

  it("returns the first of duplicated headings", () => {
    expect(findMarkdownHeadingLine(SPEC, "密码登录")).toBe(5);
    expect(markdownHeadings(SPEC).filter((heading) => heading === "密码登录")).toHaveLength(2);
  });

  it("returns null when the heading has been removed", () => {
    expect(findMarkdownHeadingLine(SPEC, "验证码登录")).toBeNull();
  });

  it("counts CRLF lines the same way", () => {
    expect(findMarkdownHeadingLine("intro\r\n\r\n## Next\r\n", "Next")).toBe(3);
  });
});

describe("logicMapOwnDocPath", () => {
  it("places an own doc inside the map folder", () => {
    expect(logicMapOwnDocPath("login", "check-password.md")).toBe(
      "docs/logic-maps/login/check-password.md",
    );
  });
});
