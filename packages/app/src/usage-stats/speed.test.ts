import type { UsageSpeedGroup } from "@getpaseo/protocol/usage/types";
import { describe, expect, it } from "vitest";
import { mergeUsageSpeed, usageGroupSpeed, usageGroupWaitMs } from "./speed";

function group(overrides: Partial<UsageSpeedGroup>): UsageSpeedGroup {
  return {
    cli: null,
    model: null,
    endpoint: null,
    tokens: 0,
    ttftCount: 0,
    ttftMs: 0,
    speedCount: 0,
    speedOutput: 0,
    speedMs: 0,
    ...overrides,
  };
}

const RELAY = { endpointId: "ep_a", name: "Relay A", deleted: false };

describe("the Speed card across hosts", () => {
  it("adds one endpoint's sums across hosts by name, weighting the speed by tokens, and orders the fastest first", () => {
    const merged = mergeUsageSpeed([
      {
        serverId: "host-1",
        speed: {
          groupBy: "endpoint",
          groups: [
            group({
              endpoint: RELAY,
              tokens: 100,
              ttftCount: 1,
              ttftMs: 1000,
              speedCount: 1,
              speedOutput: 100,
              speedMs: 1000,
            }),
            group({
              endpoint: { endpointId: null, name: null, deleted: false },
              tokens: 50,
              ttftCount: 1,
              ttftMs: 500,
              speedCount: 1,
              speedOutput: 400,
              speedMs: 1000,
            }),
          ],
        },
      },
      {
        serverId: "host-2",
        speed: {
          groupBy: "endpoint",
          groups: [
            group({
              endpoint: { endpointId: "ep_other_id", name: "Relay A", deleted: false },
              tokens: 300,
              ttftCount: 2,
              ttftMs: 3000,
              speedCount: 1,
              speedOutput: 500,
              speedMs: 4000,
            }),
          ],
        },
      },
    ]);
    expect(merged?.groups.map((row) => row.endpoint?.name ?? "official")).toEqual([
      "official",
      "Relay A",
    ]);
    const relay = merged?.groups[1];
    // (100 + 500) token / (1 + 4) s = 120 token/s，不是两台速度的平均 112.5。
    expect(relay && usageGroupSpeed(relay)).toBe(120);
    expect(relay && usageGroupWaitMs(relay)).toBe(4000 / 3);
    expect(relay?.speedCount).toBe(2);
  });

  it("weights by tokens, not by reply", () => {
    // 10 token / 1 s 与 990 token / 9 s：加权是 100 token/s，按条平均是 60。
    const merged = mergeUsageSpeed([
      {
        serverId: "host-1",
        speed: {
          groupBy: "model",
          groups: [group({ model: "kimi-k2", speedCount: 1, speedOutput: 10, speedMs: 1000 })],
        },
      },
      {
        serverId: "host-2",
        speed: {
          groupBy: "model",
          groups: [group({ model: "kimi-k2", speedCount: 1, speedOutput: 990, speedMs: 9000 })],
        },
      },
    ]);
    expect(merged?.groups).toHaveLength(1);
    expect(merged?.groups[0] && usageGroupSpeed(merged.groups[0])).toBe(100);
  });

  it("keeps two live endpoints of one name on a host apart, and says nothing without a timed reply", () => {
    const merged = mergeUsageSpeed([
      {
        serverId: "host-1",
        speed: {
          groupBy: "endpoint",
          groups: [
            group({ endpoint: RELAY, ttftCount: 1, ttftMs: 100 }),
            group({ endpoint: { ...RELAY, endpointId: "ep_b" }, ttftCount: 1, ttftMs: 100 }),
          ],
        },
      },
    ]);
    expect(merged?.groups).toHaveLength(2);
    expect(merged?.groups[0] && usageGroupSpeed(merged.groups[0])).toBeNull();
    expect(mergeUsageSpeed([])).toBeUndefined();
  });
});
