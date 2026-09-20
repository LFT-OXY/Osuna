import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type { UsagePricingOverride, UsageTokenTotals } from "@osuna/protocol/usage/types";
import { UsageStore } from "../store.js";
import { UsagePricingService } from "./service.js";
import type { PricingTable } from "./table.js";

const NOW = Date.parse("2026-09-18T23:00:00.000Z");

/**
 * A dollar per token in the first column and a power of ten in each of the
 * others, so one estimate says which column every token was billed against.
 */
const SNAPSHOT: PricingTable = {
  _meta: { source: "test", fetchedAt: "2026-09-18T00:00:00.000Z", etag: "etag-0", license: "MIT" },
  models: { "claude-opus-5": { input: 1, cachedInput: 10, cacheWrite: 100, output: 1000 } },
};

/** The same model priced by the upstream file, plus the one the snapshot lacks. */
const UPSTREAM = {
  "claude-opus-5": { input_cost_per_token: 1, output_cost_per_token: 1000 },
  "gpt-6-astra": { input_cost_per_token: 2, output_cost_per_token: 2000 },
};

const TOTALS: UsageTokenTotals = {
  input: 2,
  cachedInput: 3,
  cacheWrite: 5,
  output: 7,
  reasoning: 11,
};

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Started {
  service: UsagePricingService;
  updates: () => number;
}

async function start(overrides: UsagePricingOverride[] = []): Promise<Started> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "osuna-pricing-"));
  temps.push(dir);
  const logger = pino({ level: "silent" });
  let updates = 0;
  const service = new UsagePricingService({
    store: new UsageStore({ dir: path.join(dir, "usage"), logger }),
    logger,
    now: () => NOW,
    autoUpdate: false,
    overrides,
    snapshot: SNAPSHOT,
    fetch: async () =>
      new Response(JSON.stringify(UPSTREAM), { status: 200, headers: { etag: "etag-1" } }),
    timers: { schedule: () => () => undefined },
    onUpdated: () => {
      updates += 1;
    },
  });
  await service.start();
  return { service, updates: () => updates };
}

describe("cost", () => {
  test("bills the four columns at their own rates and leaves reasoning out", async () => {
    const { service } = await start();

    expect(service.estimateCost(TOTALS, "claude-opus-5")).toBe(2 * 1 + 3 * 10 + 5 * 100 + 7 * 1000);
  });

  test("costs a model with no price nothing", async () => {
    const { service } = await start();

    expect(service.estimateCost(TOTALS, "gpt-6-astra")).toBe(0);
    expect(service.priceFor("gpt-6-astra")).toEqual({
      priced: false,
      priceSource: null,
      matchedKey: null,
      rates: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
    });
  });
});

describe("the answer cache", () => {
  test("drops a remembered miss when an override arrives for it", async () => {
    const { service, updates } = await start();
    expect(service.estimateCost(TOTALS, "gpt-6-astra")).toBe(0);

    service.applyConfig({
      autoUpdate: false,
      overrides: [
        {
          model: "gpt-6-astra",
          pricePerMillion: { input: 1e6, cachedInput: 0, cacheWrite: 0, output: 2e6 },
        },
      ],
    });

    expect(service.estimateCost(TOTALS, "gpt-6-astra")).toBe(2 * 1 + 7 * 2);
    expect(updates()).toBe(1);
  });

  test("drops a remembered miss when a refreshed table prices it", async () => {
    const { service, updates } = await start();
    expect(service.estimateCost(TOTALS, "gpt-6-astra")).toBe(0);

    expect(await service.refresh()).toEqual({
      result: "updated",
      fetchedAt: "2026-09-18T23:00:00.000Z",
      error: null,
    });

    expect(service.estimateCost(TOTALS, "gpt-6-astra")).toBe(2 * 2 + 7 * 2000);
    expect(updates()).toBe(1);
  });

  test("drops a remembered price when the override that set it is removed", async () => {
    const { service } = await start([
      {
        model: "claude-opus-5",
        pricePerMillion: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
      },
    ]);
    expect(service.estimateCost(TOTALS, "claude-opus-5")).toBe(0);

    service.applyConfig({ autoUpdate: false, overrides: [] });

    expect(service.estimateCost(TOTALS, "claude-opus-5")).toBe(2 * 1 + 3 * 10 + 5 * 100 + 7 * 1000);
  });
});
