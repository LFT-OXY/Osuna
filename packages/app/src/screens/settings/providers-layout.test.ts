import { describe, expect, it } from "vitest";
import { resolveProvidersLayout, resolveSelectedProvider } from "./providers-layout";

describe("resolveProvidersLayout", () => {
  it.each([
    [735, false, "stacked"],
    [736, false, "split"],
    [1400, false, "split"],
    [1400, true, "stacked"],
  ] as const)("width %i compact %s → %s", (contentWidth, isCompact, expected) => {
    expect(resolveProvidersLayout({ contentWidth, isCompact })).toBe(expected);
  });
});

describe("resolveSelectedProvider", () => {
  const providerIds = ["claude", "codex", "opencode"];

  it("selects the provider named in the address when it exists", () => {
    expect(resolveSelectedProvider({ requested: "codex", providerIds })).toBe("codex");
  });

  it("falls back to the first provider when the address names an unknown one", () => {
    expect(resolveSelectedProvider({ requested: "gone", providerIds })).toBe("claude");
    expect(resolveSelectedProvider({ requested: null, providerIds })).toBe("claude");
  });

  it("selects nothing when the list is empty", () => {
    expect(resolveSelectedProvider({ requested: "claude", providerIds: [] })).toBeNull();
  });
});
