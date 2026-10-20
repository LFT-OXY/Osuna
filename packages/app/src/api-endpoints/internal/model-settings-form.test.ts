import { describe, expect, it } from "vitest";
import type {
  ApiEndpoint,
  ApiEndpointModelSettings,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  openModelDefaultsForm,
  openModelSettingsForm,
  parseTokens,
  tokenFormatOf,
  withModelFormat,
  type SaveModelSettings,
} from "./model-settings-form";
import { LANGUAGE_OPTIONS } from "@/i18n/locales";

const ENDPOINT: ApiEndpoint = {
  id: "ep_1",
  provider: "codex",
  name: "Relay",
  baseUrl: "https://relay.example/v1",
  models: [{ id: "glm-5" }, { id: "kimi-k2" }],
  defaultModelId: "glm-5",
  hasApiKey: true,
  modelSettings: {
    defaults: { context: 150_000 },
    models: { "kimi-k2": { name: "Kimi", output: 8_000 } },
  },
  modelFacts: {
    "glm-5": { name: "GLM-5", context: 200_000, output: 128_000, efforts: ["low", "high", "max"] },
    "kimi-k2": { images: true },
  },
};

const EN = tokenFormatOf("en");

function recorder(result: string | null = null) {
  const saved: ApiEndpointModelSettings[] = [];
  const save: SaveModelSettings = (update) => {
    saved.push(update(ENDPOINT.modelSettings));
    return Promise.resolve(result);
  };
  return { saved, save };
}

describe("the model settings form", () => {
  it("opens on the automatic values: the endpoint's defaults over what Osuna found", () => {
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "glm-5",
      ...recorder(),
      tokenFormat: EN,
    });
    const state = form.getState();
    expect(state.name.text).toBe("");
    expect(state.name.automatic).toBe("GLM-5");
    expect(state.context.automatic).toBe(150_000);
    expect(state.output.automatic).toBe(128_000);
    expect(state.compact.automatic).toBeNull();
    expect(state.efforts).toEqual({
      levels: ["low", "high", "max"],
      picked: ["low", "high", "max"],
      isSet: false,
    });
    expect(state.images).toEqual({ value: false, isSet: false });
    expect(state.canSubmit).toBe(false);
  });

  it("saves only what was changed, merged into the endpoint's other settings", async () => {
    const deps = recorder();
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "glm-5",
      ...deps,
      tokenFormat: EN,
    });
    form.setName(" My GLM ");
    form.setTokens("context", "180,000");
    form.setTokens("compact", "120000");
    form.toggleEffort("low");
    form.setImages(true);
    expect(form.getState().canSubmit).toBe(true);
    expect(await form.submit()).toBe("saved");
    expect(deps.saved).toEqual([
      {
        defaults: { context: 150_000 },
        models: {
          "kimi-k2": { name: "Kimi", output: 8_000 },
          "glm-5": {
            name: "My GLM",
            context: 180_000,
            compact: 120_000,
            efforts: ["high", "max"],
            images: true,
          },
        },
      },
    ]);
  });

  it("unticking every level saves none, so no thinking is sent", async () => {
    const deps = recorder();
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "glm-5",
      ...deps,
      tokenFormat: EN,
    });
    for (const level of ["low", "high", "max"]) form.toggleEffort(level);
    expect(form.getState().efforts.picked).toEqual([]);
    await form.submit();
    expect(deps.saved[0]?.models?.["glm-5"]).toEqual({ efforts: [] });
  });

  it("refuses a token count that is not a whole number above zero, in place", async () => {
    const deps = recorder();
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "glm-5",
      ...deps,
      tokenFormat: EN,
    });
    form.setTokens("output", "12.5");
    expect(form.getState().output.invalid).toBe(true);
    expect(form.getState().canSubmit).toBe(false);
    expect(await form.submit()).toBe("invalid");
    expect(deps.saved).toEqual([]);
  });

  it("restore default takes the model's settings away; a failure stays with the inputs kept", async () => {
    const failing = recorder("disk full");
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "kimi-k2",
      ...failing,
      tokenFormat: EN,
    });
    expect(form.getState().name.text).toBe("Kimi");
    expect(form.getState().images).toEqual({ value: true, isSet: false });
    expect(await form.restoreDefaults()).toBe("failed");
    expect(failing.saved).toEqual([{ defaults: { context: 150_000 } }]);
    expect(form.getState().status).toEqual({ kind: "failed", message: "disk full" });
    expect(form.getState().name.text).toBe("Kimi");

    const working = recorder();
    const again = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "kimi-k2",
      ...working,
      tokenFormat: EN,
    });
    expect(await again.restoreDefaults()).toBe("saved");
    expect(again.getState().status).toEqual({ kind: "idle" });
  });

  it("restores the name alone to its default before saving", async () => {
    const deps = recorder();
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "kimi-k2",
      ...deps,
      tokenFormat: EN,
    });
    const generation = form.getState().name.generation;
    form.restoreName();
    expect(form.getState().name).toMatchObject({ text: "", generation: generation + 1 });
    await form.submit();
    expect(deps.saved[0]?.models?.["kimi-k2"]).toEqual({ output: 8_000 });
  });

  it("a model whose levels aren't known offers every level, none ticked until one is", () => {
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "kimi-k2",
      ...recorder(),
      tokenFormat: EN,
    });
    expect(form.getState().efforts).toEqual({
      levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      picked: [],
      isSet: false,
    });
    form.toggleEffort("high");
    expect(form.getState().efforts).toMatchObject({ picked: ["high"], isSet: true });
  });
});

describe("the endpoint's defaults for all models", () => {
  it("saves the three numbers over the model settings, blank ones left out", async () => {
    const deps = recorder();
    const form = openModelDefaultsForm({ endpoint: ENDPOINT, ...deps, tokenFormat: EN });
    expect(form.getState().context.text).toBe("150,000");
    expect(form.getState().canSubmit).toBe(false);
    form.setTokens("context", "");
    form.setTokens("compact", "90000");
    expect(await form.submit()).toBe("saved");
    expect(deps.saved).toEqual([
      { defaults: { compact: 90_000 }, models: ENDPOINT.modelSettings?.models },
    ]);
    expect(form.getState().canSubmit).toBe(false);
  });

  it("keeps the inputs and says why when saving fails", async () => {
    const form = openModelDefaultsForm({
      endpoint: ENDPOINT,
      ...recorder("offline"),
      tokenFormat: EN,
    });
    form.setTokens("output", "4096");
    expect(await form.submit()).toBe("failed");
    expect(form.getState()).toMatchObject({
      output: { text: "4096" },
      status: { kind: "failed", message: "offline" },
      canSubmit: true,
    });
  });

  it("reads numbers written the way the language groups them", async () => {
    const deps = recorder();
    const es = tokenFormatOf("es");
    const form = openModelDefaultsForm({ endpoint: ENDPOINT, ...deps, tokenFormat: es });
    expect(form.getState().context.text).toBe(es.format(150_000));
    form.setTokens("output", es.format(32_000));
    await form.submit();
    expect(deps.saved[0]?.defaults).toEqual({ context: 150_000, output: 32_000 });
  });
});

describe("token counts in every app language", () => {
  it.each(LANGUAGE_OPTIONS.flatMap((option) => (option.value === "system" ? [] : [option.value])))(
    "%s: a number as the form shows it reads back as the same number",
    (locale) => {
      const tokenFormat = tokenFormatOf(locale);
      for (const value of [4_096, 150_000, 1_000_000]) {
        expect(parseTokens(tokenFormat.format(value), tokenFormat)).toEqual({
          kind: "count",
          value,
        });
      }
    },
  );
});

describe("what counts as a change, by the daemon's own rules", () => {
  it("ticking every level back, or the image switch back, is no change", () => {
    const form = openModelSettingsForm({
      endpoint: ENDPOINT,
      modelId: "glm-5",
      ...recorder(),
      tokenFormat: EN,
    });
    form.toggleEffort("low");
    expect(form.getState().canSubmit).toBe(true);
    form.toggleEffort("low");
    expect(form.getState().efforts.isSet).toBe(true);
    expect(form.getState().canSubmit).toBe(false);
    form.setImages(true);
    expect(form.getState().canSubmit).toBe(true);
    form.setImages(false);
    expect(form.getState()).toMatchObject({ images: { isSet: false }, canSubmit: false });
    form.setName("   ");
    expect(form.getState().canSubmit).toBe(false);
  });
});

describe("magpie's shorthand (ParseTokens, parseContexts)", () => {
  it("reads k and m, a decimal before them, any case, underscores and spaces", () => {
    const read = (text: string) => parseTokens(text, EN);
    expect(read("272k")).toEqual({ kind: "count", value: 272_000 });
    expect(read("1.5m")).toEqual({ kind: "count", value: 1_500_000 });
    expect(read(" 1M ")).toEqual({ kind: "count", value: 1_000_000 });
    expect(read("128_000")).toEqual({ kind: "count", value: 128_000 });
    expect(read("0.5K")).toEqual({ kind: "count", value: 500 });
  });

  it("refuses what is no token count", () => {
    for (const text of ["k", "1.5", "1,5m", "0k", "0.0001k", "2g", "-1k", "1.2.3m"]) {
      expect(parseTokens(text, EN)).toEqual({ kind: "invalid" });
    }
  });

  it("works in a language that groups with a dot, and in its own digits", () => {
    expect(parseTokens("1.5m", tokenFormatOf("es"))).toEqual({ kind: "count", value: 1_500_000 });
    const ar = tokenFormatOf("ar");
    expect(parseTokens(`${ar.format(272)}k`, ar)).toEqual({ kind: "count", value: 272_000 });
  });
});

// 接口管理好用性工单 15：上游模型名与只用这种格式。
describe("upstream name and the one format", () => {
  const TWO_FORMATS: ApiEndpoint = {
    ...ENDPOINT,
    baseUrls: [
      { format: "anthropic_messages", url: "https://relay.example" },
      { format: "openai_chat", url: "https://relay.example/v1" },
    ],
    modelSettings: {
      defaults: { upstreamName: "zhipu/*" },
      models: { "kimi-k2": { format: "openai_responses", name: "Kimi" } },
    },
  };

  function open(endpoint: ApiEndpoint, modelId: string) {
    const saved: ApiEndpointModelSettings[] = [];
    const save: SaveModelSettings = (update) => {
      saved.push(update(endpoint.modelSettings));
      return Promise.resolve(null);
    };
    const form = openModelSettingsForm({ endpoint, modelId, save, tokenFormat: EN });
    return { form, saved };
  }

  it("shows the name sent now, the endpoint's * template filled in, and saves a typed one trimmed", async () => {
    const { form, saved } = open(TWO_FORMATS, "glm-5");
    expect(form.getState().upstreamName).toEqual({ text: "", automatic: "zhipu/glm-5" });
    form.setUpstreamName("  vendor/glm-5-pro ");
    await form.submit();
    expect(saved[0]?.models?.["glm-5"]).toEqual({ upstreamName: "vendor/glm-5-pro" });
  });

  it("offers Automatic and each format the endpoint has a URL for, and saves the one picked", async () => {
    const { form, saved } = open(TWO_FORMATS, "glm-5");
    expect(form.getState().format).toEqual({
      options: ["anthropic_messages", "openai_chat"],
      value: null,
      voidFormat: null,
    });
    form.setFormat("openai_chat");
    expect(form.getState().canSubmit).toBe(true);
    await form.submit();
    expect(saved[0]?.models?.["glm-5"]).toEqual({ format: "openai_chat" });
  });

  it("says a format whose URL is gone no longer applies, and Automatic takes it away", async () => {
    const { form, saved } = open(TWO_FORMATS, "kimi-k2");
    expect(form.getState().format).toEqual({
      options: ["anthropic_messages", "openai_chat", "openai_responses"],
      value: "openai_responses",
      voidFormat: "openai_responses",
    });
    form.setFormat(null);
    expect(form.getState().format.voidFormat).toBeNull();
    await form.submit();
    expect(saved[0]?.models?.["kimi-k2"]).toEqual({ name: "Kimi" });
  });

  it("offers no format choice for an endpoint with one URL", () => {
    const { form } = open(ENDPOINT, "glm-5");
    expect(form.getState().format.options).toEqual([]);
  });

  it("the defaults save an upstream name for every model", async () => {
    const saved: ApiEndpointModelSettings[] = [];
    const save: SaveModelSettings = (update) => {
      saved.push(update(TWO_FORMATS.modelSettings));
      return Promise.resolve(null);
    };
    const form = openModelDefaultsForm({ endpoint: TWO_FORMATS, save, tokenFormat: EN });
    expect(form.getState().upstreamName).toBe("zhipu/*");
    form.setUpstreamName(" vendor/* ");
    await form.submit();
    expect(saved[0]).toEqual({
      defaults: { upstreamName: "vendor/*" },
      models: TWO_FORMATS.modelSettings?.models,
    });
  });

  it("the row menu sets one model's format and keeps its other settings", () => {
    expect(
      withModelFormat({ current: TWO_FORMATS.modelSettings, modelId: "kimi-k2", format: null }),
    ).toEqual({ defaults: { upstreamName: "zhipu/*" }, models: { "kimi-k2": { name: "Kimi" } } });
    expect(
      withModelFormat({ current: undefined, modelId: "glm-5", format: "openai_chat" }),
    ).toEqual({ models: { "glm-5": { format: "openai_chat" } } });
  });
});
