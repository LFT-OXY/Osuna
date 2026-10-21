import pino from "pino";
import { describe, expect, test } from "vitest";
import { CatalogRefreshSchedule, type CatalogRefreshOutcome } from "./catalog-refresh.js";

// 定时器由测试手动到点；时钟由测试推。
function manualTimers() {
  let pending: (() => void) | null = null;
  return {
    timers: {
      schedule(handler: () => void) {
        pending = handler;
        return () => {
          if (pending === handler) pending = null;
        };
      },
    },
    async fire(): Promise<void> {
      const handler = pending;
      if (!handler) throw new Error("Expected a scheduled check");
      pending = null;
      handler();
      await expect.poll(() => pending !== null).toBe(true);
    },
  };
}

describe("daily model list refresh", () => {
  test("a refresh that throws is not retried before the retry interval, and the next endpoint is still refreshed", async () => {
    let clock = new Date("2026-10-20T08:00:00.000Z");
    const asked: string[] = [];
    const { timers, fire } = manualTimers();
    const schedule = new CatalogRefreshSchedule({
      logger: pino({ level: "silent" }),
      now: () => clock,
      isAllowed: () => true,
      candidates: () => [
        { id: "broken", enabled: true, fetchedAt: undefined },
        { id: "fine", enabled: true, fetchedAt: undefined },
      ],
      refresh: async (endpointId): Promise<CatalogRefreshOutcome> => {
        asked.push(endpointId);
        if (endpointId === "broken") throw new Error("EACCES: permission denied");
        return "failed";
      },
      timers,
    });
    schedule.start();

    await fire();
    expect(asked).toEqual(["broken", "fine"]);

    clock = new Date(clock.getTime() + 60 * 1000);
    await fire();
    expect(asked).toEqual(["broken", "fine"]);

    clock = new Date(clock.getTime() + 15 * 60 * 1000);
    await fire();
    expect(asked).toEqual(["broken", "fine", "broken", "fine"]);
    schedule.dispose();
  });
});
