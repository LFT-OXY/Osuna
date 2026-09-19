import { describe, expect, test } from "vitest";
import {
  buildPricingIndex,
  matchModelPrice,
  type PricingMatch,
  type PricingOverrideEntry,
} from "./matcher.js";
import type { PricingTable } from "./table.js";

function columns(input: number, cachedInput: number, cacheWrite: number, output: number) {
  return { input, cachedInput, cacheWrite, output };
}

const TABLE: PricingTable = {
  _meta: { source: "test", fetchedAt: "2026-09-18T00:00:00.000Z", etag: null, license: "MIT" },
  models: {
    "claude-sonnet-4-5": columns(3e-6, 3e-7, 3.75e-6, 1.5e-5),
    "claude-opus-4-1": columns(5e-6, 5e-7, 6.25e-6, 2.5e-5),
    "claude-opus-4-1-20250805": columns(9e-6, 9e-7, 9e-6, 9e-5),
    "gpt-5.1-codex": { input: 1.25e-6, cachedInput: 1.25e-7, cacheWrite: null, output: 1e-5 },
    "GLM-4.6": columns(6e-7, 1.1e-7, 0, 2.2e-6),
    "openrouter/anthropic/claude-sonnet-4.5": columns(4e-6, 4e-7, 4e-6, 2e-5),
    "deepinfra/qwen3-max": columns(1e-7, 0, 0, 2e-7),
    "zai/qwen3-max": columns(2e-7, 0, 0, 4e-7),
    "novita/qwen3-max": columns(3e-7, 0, 0, 6e-7),
    "novita/llama-4-scout": columns(7e-8, 0, 0, 1.4e-7),
    "deepinfra/llama-4-scout": columns(5e-8, 0, 0, 1e-7),
  },
};

const INDEX = buildPricingIndex(TABLE);
const NO_OVERRIDES = new Map<string, PricingOverrideEntry>();

function match(model: string, overrides = NO_OVERRIDES): PricingMatch {
  return matchModelPrice(model, TABLE, overrides, INDEX);
}

describe("table lookup", () => {
  test("takes the id as written", () => {
    expect(match("claude-sonnet-4-5")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "claude-sonnet-4-5",
      rates: columns(3e-6, 3e-7, 3.75e-6, 1.5e-5),
    });
  });

  test("falls back to the lowercase spelling", () => {
    expect(match("glm-4.6")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "GLM-4.6",
      rates: columns(6e-7, 1.1e-7, 0, 2.2e-6),
    });
  });

  test("normalizes the dotted Claude version to the dashed key", () => {
    expect(match("claude-sonnet-4.5")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "claude-sonnet-4-5",
      rates: columns(3e-6, 3e-7, 3.75e-6, 1.5e-5),
    });
  });

  test("adds the missing claude prefix", () => {
    expect(match("sonnet-4-5")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "claude-sonnet-4-5",
      rates: columns(3e-6, 3e-7, 3.75e-6, 1.5e-5),
    });
  });

  test("prefers the dated key over the undated one when both exist", () => {
    expect(match("claude-opus-4-1-20250805")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "claude-opus-4-1-20250805",
      rates: columns(9e-6, 9e-7, 9e-6, 9e-5),
    });
  });

  test("drops an unknown date suffix and retries", () => {
    expect(match("claude-opus-4-1-20991231")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "claude-opus-4-1",
      rates: columns(5e-6, 5e-7, 6.25e-6, 2.5e-5),
    });
  });

  test("strips the provider path and matches the bare key", () => {
    expect(match("anthropic/claude-sonnet-4.5")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "claude-sonnet-4-5",
      rates: columns(3e-6, 3e-7, 3.75e-6, 1.5e-5),
    });
  });

  test("picks the preferred vendor among gateway keys for the same bare id", () => {
    expect(match("together_ai/qwen3-max")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "zai/qwen3-max",
      rates: columns(2e-7, 0, 0, 4e-7),
    });
  });

  test("falls back to the smallest key when no preferred vendor carries it", () => {
    expect(match("together_ai/llama-4-scout")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "deepinfra/llama-4-scout",
      rates: columns(5e-8, 0, 0, 1e-7),
    });
  });

  test("reads a missing column as zero", () => {
    expect(match("gpt-5.1-codex")).toEqual({
      priced: true,
      priceSource: "table",
      matchedKey: "gpt-5.1-codex",
      rates: columns(1.25e-6, 1.25e-7, 0, 1e-5),
    });
  });

  test("reports an unknown model as unpriced with zero columns", () => {
    expect(match("some-local-model")).toEqual({
      priced: false,
      priceSource: null,
      matchedKey: null,
      rates: columns(0, 0, 0, 0),
    });
  });
});

describe("overrides", () => {
  const overrides = new Map<string, PricingOverrideEntry>([
    ["claude-sonnet-4-5", { model: "claude-sonnet-4-5", pricePerMillion: columns(1, 2, 3, 4) }],
    ["some-local-model", { model: "Some-Local-Model", pricePerMillion: columns(0, 0, 0, 0) }],
  ]);

  test("beats the table for a model the table also knows", () => {
    expect(match("claude-sonnet-4-5", overrides)).toEqual({
      priced: true,
      priceSource: "override",
      matchedKey: "claude-sonnet-4-5",
      rates: columns(1e-6, 2e-6, 3e-6, 4e-6),
    });
  });

  test("matches regardless of case and surrounding space", () => {
    expect(match("  Claude-Sonnet-4-5 ", overrides).priceSource).toBe("override");
  });

  test("counts all-zero as priced, not as missing data", () => {
    expect(match("some-local-model", overrides)).toEqual({
      priced: true,
      priceSource: "override",
      matchedKey: "Some-Local-Model",
      rates: columns(0, 0, 0, 0),
    });
  });

  test("does not apply to a different model", () => {
    expect(match("claude-opus-4-1", overrides).priceSource).toBe("table");
  });
});
