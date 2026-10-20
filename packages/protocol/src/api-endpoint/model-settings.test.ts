import { describe, expect, it } from "vitest";
import { distinctModelLabels, keptEfforts, resolveModelFacts } from "./model-settings";

const AUTO = {
  name: "GLM-5",
  context: 200_000,
  output: 128_000,
  efforts: ["low", "high", "max"],
  images: false,
};

describe("which value a model's setting takes", () => {
  it("is the model's own, then the endpoint's default, then what Osuna found", () => {
    const settings = {
      defaults: { context: 150_000, output: 32_000, compact: 120_000 },
      models: { "glm-5": { context: 100_000, compact: 80_000 } },
    };
    expect(resolveModelFacts({ settings, modelId: "glm-5", auto: AUTO })).toEqual({
      name: "GLM-5",
      context: 100_000,
      output: 32_000,
      efforts: ["low", "high", "max"],
      images: false,
      compact: 80_000,
      noThinking: false,
    });
    expect(resolveModelFacts({ settings, modelId: "kimi-k2", auto: {} })).toEqual({
      context: 150_000,
      output: 32_000,
      compact: 120_000,
      noThinking: false,
    });
    expect(resolveModelFacts({ settings: undefined, modelId: "glm-5", auto: AUTO })).toEqual({
      ...AUTO,
      noThinking: false,
    });
  });

  it("keeps the endpoint's context within a model's own known window, as magpie's provider/* does", () => {
    const settings = { defaults: { context: 512_000 } };
    expect(resolveModelFacts({ settings, modelId: "glm-5", auto: AUTO }).context).toBe(200_000);
    // 单个模型自己设的照用户的。
    const own = { ...settings, models: { "glm-5": { context: 512_000 } } };
    expect(resolveModelFacts({ settings: own, modelId: "glm-5", auto: AUTO }).context).toBe(
      512_000,
    );
  });

  it("offers only the levels kept, in the vendor's order; none kept sends no thinking", () => {
    const kept = { models: { "glm-5": { efforts: ["max", "low"], name: "My GLM" } } };
    const resolved = resolveModelFacts({ settings: kept, modelId: "glm-5", auto: AUTO });
    expect(resolved.efforts).toEqual(["low", "max"]);
    expect(resolved.name).toBe("My GLM");
    const none = { models: { "glm-5": { efforts: [] } } };
    expect(resolveModelFacts({ settings: none, modelId: "glm-5", auto: AUTO })).toMatchObject({
      efforts: [],
      noThinking: true,
    });
    // 档位不知道的模型：用户给的几档按 Osuna 认得的顺序。
    const unknown = { models: { mystery: { efforts: ["high", "minimal"] } } };
    expect(resolveModelFacts({ settings: unknown, modelId: "mystery", auto: {} }).efforts).toEqual([
      "minimal",
      "high",
    ]);
    // 清单换了、留的档位一个都不在了：给全部。
    const gone = { models: { "glm-5": { efforts: ["xhigh"] } } };
    expect(resolveModelFacts({ settings: gone, modelId: "glm-5", auto: AUTO }).efforts).toEqual(
      AUTO.efforts,
    );
  });

  it("takes the user's word on images over the list's", () => {
    const settings = { models: { "glm-5": { images: true } } };
    expect(resolveModelFacts({ settings, modelId: "glm-5", auto: AUTO }).images).toBe(true);
  });
});

describe("names in one picker", () => {
  it("shows the model id for names two models share, in any case", () => {
    expect(
      distinctModelLabels([
        { id: "glm-5", label: "GLM" },
        { id: "glm-5-air", label: "glm" },
        { id: "kimi-k2", label: "Kimi K2" },
        { id: "mystery", label: "mystery" },
      ]),
    ).toEqual(["glm-5", "glm-5-air", "Kimi K2", "mystery"]);
  });
});

describe("levels kept when saving", () => {
  it("are the model's own in its order, all of them is none set, and none of them is no thinking", () => {
    const known = ["low", "high", "max"];
    expect(keptEfforts({ picked: [" MAX", "low", "low"], known })).toEqual({
      kind: "kept",
      efforts: ["low", "max"],
    });
    expect(keptEfforts({ picked: ["max", "high", "low"], known })).toEqual({
      kind: "kept",
      efforts: undefined,
    });
    expect(keptEfforts({ picked: [], known })).toEqual({ kind: "kept", efforts: [] });
    expect(keptEfforts({ picked: ["xhigh"], known })).toEqual({ kind: "invalid", level: "xhigh" });
    // 档位不知道：Osuna 认得的几档都能给，全给也算设了。
    expect(keptEfforts({ picked: ["high", "none"], known: undefined })).toEqual({
      kind: "kept",
      efforts: ["none", "high"],
    });
    expect(keptEfforts({ picked: ["ultra"], known: [] })).toEqual({
      kind: "invalid",
      level: "ultra",
    });
  });
});
