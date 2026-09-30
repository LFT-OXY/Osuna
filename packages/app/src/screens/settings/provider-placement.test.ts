import { describe, expect, it } from "vitest";
import { resolveProviderPlacement } from "./provider-placement";

describe("resolveProviderPlacement", () => {
  it.each(["ready", "loading", "error"] as const)(
    "keeps an enabled provider that is %s in the list",
    (status) => {
      expect(resolveProviderPlacement({ status, enabled: true })).toEqual({ kind: "list" });
    },
  );

  it("moves a turned-off provider to Not enabled, whatever its status", () => {
    expect(resolveProviderPlacement({ status: "unavailable", enabled: false })).toEqual({
      kind: "notEnabled",
      mark: "turnedOff",
    });
    expect(resolveProviderPlacement({ status: "ready", enabled: false })).toEqual({
      kind: "notEnabled",
      mark: "turnedOff",
    });
  });

  it("moves an enabled provider whose CLI is missing to Not enabled as not installed", () => {
    expect(resolveProviderPlacement({ status: "unavailable", enabled: true })).toEqual({
      kind: "notEnabled",
      mark: "notInstalled",
    });
  });
});
