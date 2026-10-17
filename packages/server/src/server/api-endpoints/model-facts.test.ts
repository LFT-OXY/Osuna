import { describe, expect, test } from "vitest";
import {
  indexModelsDev,
  indexSamplingByHost,
  lookupModelFacts,
  samplingFor,
} from "./model-facts.js";

// models.dev 的 api.json：按服务商分组，同一个模型可能被多家列出、各家的数不一样。
const MODELS_DEV = {
  openai: {
    models: {
      "gpt-6-sol": {
        id: "gpt-6-sol",
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
      },
    },
  },
  relay_a: {
    models: {
      "gpt-6-sol": {
        id: "gpt-6-sol",
        limit: { context: 1_000_000, output: 64_000 },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
      },
      "openai/gpt-6-sol": {
        id: "openai/gpt-6-sol",
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
      },
      "kimi-k2.5": { id: "kimi-k2.5", limit: { context: 262_144, output: 98_304 } },
      // 小于 2048 的窗口是列表写错了，不算知道。
      "tiny-free": { id: "tiny-free", limit: { context: 512, output: 256 } },
    },
  },
  relay_b: {
    models: {
      "kimi-k2.5": { id: "kimi-k2.5", limit: { context: 131_072, output: 32_768 } },
    },
  },
};

describe("models.dev facts", () => {
  test("takes what most providers give, the input limit before the whole window", () => {
    const index = indexModelsDev(MODELS_DEV);
    expect(lookupModelFacts(index, "gpt-6-sol")).toEqual({
      context: 922_000,
      output: 128_000,
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
  });

  test("a tie goes to the smaller number, and a model listed with no levels is known to have none", () => {
    const index = indexModelsDev(MODELS_DEV);
    expect(lookupModelFacts(index, "kimi-k2.5")).toEqual({
      context: 131_072,
      output: 32_768,
      efforts: [],
    });
  });

  test("finds a model by a vendor prefix, another casing or a :variant suffix", () => {
    const index = indexModelsDev(MODELS_DEV);
    const expected = lookupModelFacts(index, "gpt-6-sol");
    expect(lookupModelFacts(index, "openai/GPT-6-Sol")).toEqual(expected);
    expect(lookupModelFacts(index, "gpt-6-sol:thinking")).toEqual(expected);
  });

  test("knows nothing of an unlisted model or a window too small to be real", () => {
    const index = indexModelsDev(MODELS_DEV);
    expect(lookupModelFacts(index, "my-own-model")).toEqual({});
    expect(lookupModelFacts(index, "tiny-free")).toEqual({ output: 256, efforts: [] });
  });

  test("ignores entries that are not models without losing the rest", () => {
    const index = indexModelsDev({
      broken: { models: { a: null, b: { limit: { context: "big" } } } },
      fine: { models: { c: { limit: { context: 200_000, output: 64_000 } } } },
      noise: "not a provider",
    });
    expect(lookupModelFacts(index, "c")).toEqual({ context: 200_000, output: 64_000, efforts: [] });
    expect(lookupModelFacts(index, "b")).toEqual({ efforts: [] });
  });

  test("temperature is read per provider, by its API host, never voted across providers", () => {
    const byHost = indexSamplingByHost({
      deepseek: {
        api: "https://api.DeepSeek.com/v1",
        models: {
          "deepseek-reasoner": { temperature: false },
          "deepseek-chat": { temperature: true },
        },
      },
      relay: {
        api: "https://relay.example/v1",
        models: { "deepseek-reasoner": { temperature: true } },
      },
      // 没有 api 地址的服务商不算。
      plain: { models: { "deepseek-chat": { temperature: false } } },
    });
    const ask = (hosts: string[], modelId: string) => samplingFor({ byHost, hosts, modelId });
    expect(ask(["api.deepseek.com"], "deepseek/DeepSeek-Reasoner:thinking")).toBe(false);
    expect(ask(["api.deepseek.com"], "deepseek-chat")).toBe(true);
    expect(ask(["relay.example"], "deepseek-reasoner")).toBe(true);
    expect(ask(["other.example", "api.deepseek.com"], "deepseek-reasoner")).toBe(false);
    expect(ask(["other.example"], "deepseek-reasoner")).toBeUndefined();
  });
});
