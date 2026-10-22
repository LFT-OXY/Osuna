import { describe, expect, it } from "vitest";
import type { ApiEndpointBalanceWindow } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { paceOf, tightestWindow } from "./balance-windows";

function window(id: string, usedPct: number | null, aside?: boolean): ApiEndpointBalanceWindow {
  return {
    id,
    label: id,
    usedPct,
    remainingPct: usedPct === null ? null : 100 - usedPct,
    ...(aside ? { aside } : {}),
  };
}

describe("tightestWindow", () => {
  it("is the window with the least left, leaving out the windows aside", () => {
    expect(
      tightestWindow([window("5h", 30), window("7d", 60), window("mcp_month", 95, true)])?.id,
    ).toBe("7d");
  });

  it("is none when every window is aside or tells no share", () => {
    expect(tightestWindow([window("mcp_month", 95, true), window("x", null)])).toBeNull();
    expect(tightestWindow([])).toBeNull();
  });
});

describe("paceOf", () => {
  it("writes the pace rounded, with its sign, and says when it runs out before the reset", () => {
    expect(paceOf({ pacePct: 12.4, displayAs: "used" })).toEqual({ text: "+12%", over: true });
    expect(paceOf({ pacePct: -8.2, displayAs: "used" })).toEqual({ text: "−8%", over: false });
    expect(paceOf({ pacePct: 0.3, displayAs: "used" })).toEqual({ text: "±0%", over: false });
  });

  it("read as what is left, the sign turns over as magpie shows it, still over when used faster", () => {
    expect(paceOf({ pacePct: 12.4, displayAs: "remaining" })).toEqual({
      text: "−12%",
      over: true,
    });
  });

  it("is none without a pace", () => {
    expect(paceOf({ pacePct: null, displayAs: "used" })).toBeNull();
    expect(paceOf({ pacePct: undefined, displayAs: "used" })).toBeNull();
  });
});
