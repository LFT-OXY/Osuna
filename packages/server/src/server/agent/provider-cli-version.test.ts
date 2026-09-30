import { describe, expect, test } from "vitest";
import { parseCliVersion } from "./provider-cli-version.js";

// 样例取自各家 CLI 实际的 `--version` 输出（2026-10-01 本机与 npm 包实测）。
// Claude 不走这里，用的是 parseClaudeCodeVersion，真实样例见 claude/models.test.ts。
describe("parseCliVersion", () => {
  test.each([
    ["codex", "codex-cli 0.156.1\n", "0.156.1"],
    [
      "copilot",
      "GitHub Copilot CLI 1.0.89.\nRun 'copilot update' to check for updates.\n",
      "1.0.89",
    ],
    ["opencode", "1.15.10\n", "1.15.10"],
    ["pi", "0.99.1\n", "0.99.1"],
    ["omp", "omp/18.1.18\n", "18.1.18"],
  ])("reads the %s version", (_provider, output, expected) => {
    expect(parseCliVersion(output)).toBe(expected);
  });

  test("keeps only x.y.z from a prerelease", () => {
    expect(parseCliVersion("codex-cli 0.157.0-alpha.3")).toBe("0.157.0");
  });

  test("takes the first version when the output names several", () => {
    expect(parseCliVersion("tool 1.2.3 (node 22.4.0)")).toBe("1.2.3");
  });

  test.each([
    ["empty output", ""],
    ["no version at all", "unknown"],
    ["only major.minor", "copilot v2.1"],
    ["an error message", "error: unrecognized option '--version'"],
  ])("returns null for %s", (_label, output) => {
    expect(parseCliVersion(output)).toBeNull();
  });
});
