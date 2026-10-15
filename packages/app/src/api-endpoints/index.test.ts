import { describe, expect, it } from "vitest";
import { supportsApiEndpoints } from "./index";

describe("supportsApiEndpoints", () => {
  it("is limited to the built-in Claude Code and Codex providers", () => {
    expect(supportsApiEndpoints("claude")).toBe(true);
    expect(supportsApiEndpoints("codex")).toBe(true);
    expect(supportsApiEndpoints("my-claude-relay")).toBe(false);
    expect(supportsApiEndpoints("my-codex-relay")).toBe(false);
    expect(supportsApiEndpoints("opencode")).toBe(false);
  });
});
