import { describe, expect, it } from "vitest";
import { resolveProvidersView } from "./providers-view";

describe("resolveProvidersView", () => {
  const providerIds = ["claude", "codex"];

  it("shows the list on the section address", () => {
    expect(resolveProvidersView({ requested: null, providerIds })).toEqual({
      kind: "list",
    });
  });

  it("shows the detail of the provider named in the address", () => {
    expect(resolveProvidersView({ requested: "codex", providerIds })).toEqual({
      kind: "detail",
      provider: "codex",
    });
  });

  it("returns to the list when the address names an unknown provider", () => {
    expect(resolveProvidersView({ requested: "gone", providerIds })).toEqual({
      kind: "missing",
    });
    expect(resolveProvidersView({ requested: "claude", providerIds: [] })).toEqual({
      kind: "missing",
    });
  });

  it("keeps the address while the list has not arrived", () => {
    expect(resolveProvidersView({ requested: "codex", providerIds: null })).toEqual({
      kind: "list",
    });
  });
});
