import { describe, expect, it } from "vitest";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  createApiEndpointFormModel,
  type ApiEndpointFetchModelsRequestInput,
  type ApiEndpointFetchModelsResult,
  type ApiEndpointSaveResult,
} from "./form-model";

const SAVED: ApiEndpoint = {
  id: "ep_1",
  provider: "claude",
  name: "Relay",
  baseUrl: "https://relay.example/api",
  models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
  defaultModelId: "relay/haiku",
  hasApiKey: true,
};

interface PendingFetch {
  request: ApiEndpointFetchModelsRequestInput;
  signal: AbortSignal;
  resolve: (result: ApiEndpointFetchModelsResult) => void;
}

function createForm(seed: Parameters<typeof createApiEndpointFormModel>[0]) {
  const requests: unknown[] = [];
  const fetches: PendingFetch[] = [];
  let result: ApiEndpointSaveResult = { ok: true };
  const model = createApiEndpointFormModel(seed, {
    save: async (request) => {
      requests.push(request);
      return result;
    },
    fetchModels: (request, signal) =>
      new Promise((resolve) => {
        fetches.push({ request, signal, resolve });
      }),
  });
  return {
    model,
    requests,
    fetches,
    failNext(message: string) {
      result = { ok: false, message };
    },
  };
}

// 让 fetchModels 的 then 回调跑完。
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

const UPSTREAM_MODELS = [
  { id: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "z-ai/glm-4.6", label: "GLM 4.6" },
];

function fillValidCreate(model: ReturnType<typeof createApiEndpointFormModel>) {
  model.setName("Relay");
  model.setBaseUrl("https://relay.example/api");
  model.setApiKey("sk-relay");
  model.setModelDraft("relay/sonnet");
  model.addModel();
}

describe("createApiEndpointFormModel", () => {
  it("cannot submit a new endpoint until name, URL, key, and a model are filled", () => {
    const { model } = createForm({ mode: "create", provider: "claude" });
    expect(model.getState().canSubmit).toBe(false);

    model.setName("Relay");
    model.setBaseUrl("https://relay.example/api");
    model.setModelDraft("relay/sonnet");
    model.addModel();
    expect(model.getState().canSubmit).toBe(false);

    model.setApiKey("sk-relay");
    expect(model.getState().canSubmit).toBe(true);
  });

  it("flags a Base URL that is not http(s), and only once something is typed", () => {
    const { model } = createForm({ mode: "create", provider: "claude" });
    expect(model.getState().baseUrlInvalid).toBe(false);

    model.setBaseUrl("relay.example");
    expect(model.getState().baseUrlInvalid).toBe(true);

    model.setBaseUrl("ftp://relay.example");
    expect(model.getState().baseUrlInvalid).toBe(true);

    model.setBaseUrl(" https://relay.example ");
    expect(model.getState().baseUrlInvalid).toBe(false);
  });

  it("makes the first added model the default and moves the default when it is removed", () => {
    const { model } = createForm({ mode: "create", provider: "claude" });
    model.setModelDraft(" relay/sonnet ");
    model.addModel();
    model.setModelDraft("relay/haiku");
    model.addModel();
    model.setModelDraft("relay/sonnet");
    model.addModel();

    expect(model.getState().models).toEqual([{ id: "relay/sonnet" }, { id: "relay/haiku" }]);
    expect(model.getState().defaultModelId).toBe("relay/sonnet");
    expect(model.getState().modelDraft).toBe("relay/sonnet");
    expect(model.getState().canAddModel).toBe(false);

    model.setDefaultModel("relay/haiku");
    model.removeModel("relay/haiku");
    expect(model.getState().defaultModelId).toBe("relay/sonnet");

    model.removeModel("relay/sonnet");
    expect(model.getState().defaultModelId).toBeNull();
    expect(model.getState().canSubmit).toBe(false);
  });

  it("sends the key when creating", async () => {
    const { model, requests } = createForm({ mode: "create", provider: "claude" });
    fillValidCreate(model);

    await expect(model.submit()).resolves.toBe(true);

    expect(requests).toEqual([
      {
        provider: "claude",
        name: "Relay",
        baseUrl: "https://relay.example/api",
        apiKey: "sk-relay",
        models: [{ id: "relay/sonnet" }],
        defaultModelId: "relay/sonnet",
      },
    ]);
  });

  it("seeds an edit from the saved endpoint and keeps the saved key when the field stays blank", async () => {
    const { model, requests } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });
    const state = model.getState();
    expect(state).toMatchObject({
      name: "Relay",
      baseUrl: "https://relay.example/api",
      apiKey: "",
      hasSavedKey: true,
      models: SAVED.models,
      defaultModelId: "relay/haiku",
      canSubmit: true,
    });

    await model.submit();

    expect(requests).toEqual([
      {
        provider: "claude",
        endpointId: "ep_1",
        name: "Relay",
        baseUrl: "https://relay.example/api",
        models: SAVED.models,
        defaultModelId: "relay/haiku",
      },
    ]);
  });

  it("replaces the saved key when a new one is typed", async () => {
    const { model, requests } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });
    model.setApiKey("  sk-rotated  ");

    await model.submit();

    expect(requests[0]).toMatchObject({ endpointId: "ep_1", apiKey: "sk-rotated" });
  });

  it("keeps the input and shows the daemon's reason when saving fails", async () => {
    const { model, failNext } = createForm({ mode: "create", provider: "claude" });
    fillValidCreate(model);
    failNext("settings.json could not be parsed");

    await expect(model.submit()).resolves.toBe(false);

    expect(model.getState()).toMatchObject({
      name: "Relay",
      submitting: false,
      submitError: "settings.json could not be parsed",
    });
  });

  it("notifies subscribers on every change and stops after close", () => {
    const { model } = createForm({ mode: "create", provider: "claude" });
    let calls = 0;
    model.subscribe(() => {
      calls += 1;
    });
    model.setName("A");
    expect(calls).toBe(1);

    model.close();
    model.setName("B");
    expect(calls).toBe(1);
  });
});

describe("createApiEndpointFormModel: fetching models", () => {
  it("needs a valid URL and a typed key to fetch a new endpoint", () => {
    const { model, fetches } = createForm({ mode: "create", provider: "claude" });
    model.setBaseUrl("relay.example");
    model.setApiKey("sk-relay");
    expect(model.getState().canFetch).toBe(false);

    model.setBaseUrl("https://relay.example/api");
    expect(model.getState().canFetch).toBe(true);
    model.fetchModels();

    expect(fetches.map((pending) => pending.request)).toEqual([
      { provider: "claude", baseUrl: "https://relay.example/api", apiKey: "sk-relay" },
    ]);
    expect(model.getState()).toMatchObject({ fetch: { status: "fetching" }, canFetch: false });
  });

  it("fetches an edit with the saved key by leaving the key out", () => {
    const { model, fetches } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });
    expect(model.getState().canFetch).toBe(true);

    model.fetchModels();

    expect(fetches[0]?.request).toEqual({
      provider: "claude",
      endpointId: "ep_1",
      baseUrl: "https://relay.example/api",
    });
  });

  it("searches the fetched list and saves only the checked models", async () => {
    const { model, fetches, requests } = createForm({ mode: "create", provider: "claude" });
    model.setName("Relay");
    model.setBaseUrl("https://relay.example/api");
    model.setApiKey("sk-relay");
    model.fetchModels();
    fetches[0]?.resolve({ status: "ok", models: UPSTREAM_MODELS });
    await settle();

    expect(model.getState().fetch).toEqual({ status: "fetched", models: UPSTREAM_MODELS });
    expect(model.getState().fetchedRows.map((row) => row.checked)).toEqual([false, false, false]);

    model.setModelSearch("claude");
    expect(model.getState().fetchedRows.map((row) => row.model.id)).toEqual([
      "anthropic/claude-opus-4.1",
      "anthropic/claude-sonnet-4.5",
    ]);
    model.setModelSearch("glm");
    expect(model.getState().fetchedRows.map((row) => row.model.id)).toEqual(["z-ai/glm-4.6"]);

    model.setModelSearch("");
    model.toggleModel("anthropic/claude-sonnet-4.5");
    model.toggleModel("z-ai/glm-4.6");
    expect(model.getState().defaultModelId).toBe("anthropic/claude-sonnet-4.5");
    expect(model.getState().fetchedRows.map((row) => row.checked)).toEqual([false, true, true]);

    model.toggleModel("anthropic/claude-sonnet-4.5");
    expect(model.getState().defaultModelId).toBe("z-ai/glm-4.6");

    await model.submit();
    expect(requests[0]).toMatchObject({
      models: [{ id: "z-ai/glm-4.6", label: "GLM 4.6" }],
      defaultModelId: "z-ai/glm-4.6",
    });
  });

  it("keeps checked models across a refetch and marks the saved ones as checked", async () => {
    const { model, fetches } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });
    model.fetchModels();
    fetches[0]?.resolve({
      status: "ok",
      models: [{ id: "relay/sonnet" }, { id: "relay/opus" }],
    });
    await settle();

    expect(model.getState().fetchedRows).toEqual([
      { model: { id: "relay/sonnet" }, checked: true },
      { model: { id: "relay/opus" }, checked: false },
    ]);
    // relay/haiku 上游没列出，但仍是勾选的模型。
    expect(model.getState().models.map((entry) => entry.id)).toEqual([
      "relay/sonnet",
      "relay/haiku",
    ]);
  });

  it("shows only the first matches of a long list and says how many are hidden", async () => {
    const { model, fetches } = createForm({ mode: "edit", provider: "codex", endpoint: SAVED });
    const many = Array.from({ length: 120 }, (_, index) => ({ id: `m-${index}` }));
    model.fetchModels();
    fetches[0]?.resolve({ status: "ok", models: many });
    await settle();

    expect(model.getState().fetchedRows).toHaveLength(50);
    expect(model.getState().hiddenFetchedCount).toBe(70);

    model.setModelSearch("m-11");
    expect(model.getState().fetchedRows.map((row) => row.model.id)).toEqual([
      "m-11",
      "m-110",
      "m-111",
      "m-112",
      "m-113",
      "m-114",
      "m-115",
      "m-116",
      "m-117",
      "m-118",
      "m-119",
    ]);
    expect(model.getState().hiddenFetchedCount).toBe(0);
  });

  it("shows the reason when the upstream cannot list models, and manual add still works", async () => {
    const { model, fetches } = createForm({ mode: "create", provider: "claude" });
    model.setBaseUrl("https://relay.example/api");
    model.setApiKey("sk-relay");
    model.fetchModels();
    fetches[0]?.resolve({ status: "failed", message: "This endpoint can't list models" });
    await settle();

    expect(model.getState().fetch).toEqual({
      status: "failed",
      message: "This endpoint can't list models",
    });
    expect(model.getState().canFetch).toBe(true);

    model.setModelDraft("relay/manual");
    model.addModel();
    expect(model.getState().models).toEqual([{ id: "relay/manual" }]);
  });

  it("cancels a pending fetch and ignores its late result", async () => {
    const { model, fetches } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });
    model.fetchModels();
    model.cancelFetch();

    expect(fetches[0]?.signal.aborted).toBe(true);
    expect(model.getState().fetch).toEqual({ status: "idle" });

    fetches[0]?.resolve({ status: "ok", models: UPSTREAM_MODELS });
    await settle();
    expect(model.getState().fetch).toEqual({ status: "idle" });
  });

  it("aborts a pending fetch when the form closes", () => {
    const { model, fetches } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });
    model.fetchModels();

    model.close();

    expect(fetches[0]?.signal.aborted).toBe(true);
  });
});

describe("createApiEndpointFormModel: Claude model mapping", () => {
  it("offers only the checked models and sends only the mapped tiers", async () => {
    const { model, requests } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });
    expect(model.getState().showMapping).toBe(true);
    expect(model.getState().mapping).toEqual({});

    model.setMapping("opus", "relay/opus");
    expect(model.getState().mapping).toEqual({});

    model.setMapping("opus", "relay/sonnet");
    model.setMapping("haiku", "relay/haiku");
    model.setMapping("haiku", null);
    model.setMapping("fable", "relay/haiku");

    await model.submit();
    expect(requests[0]).toMatchObject({
      modelMapping: { opus: "relay/sonnet", fable: "relay/haiku" },
    });
  });

  it("clears a tier when its model is unchecked or removed", () => {
    const { model } = createForm({
      mode: "edit",
      provider: "claude",
      endpoint: { ...SAVED, modelMapping: { opus: "relay/sonnet", haiku: "relay/haiku" } },
    });
    expect(model.getState().mapping).toEqual({ opus: "relay/sonnet", haiku: "relay/haiku" });

    model.removeModel("relay/haiku");
    expect(model.getState().mapping).toEqual({ opus: "relay/sonnet" });

    model.toggleModel("relay/sonnet");
    expect(model.getState().mapping).toEqual({});
  });

  it("leaves the mapping out when no tier is mapped", async () => {
    const { model, requests } = createForm({ mode: "edit", provider: "claude", endpoint: SAVED });

    await model.submit();

    expect(requests[0]).not.toHaveProperty("modelMapping");
  });

  it("has no mapping for Codex", async () => {
    const { model, requests } = createForm({ mode: "edit", provider: "codex", endpoint: SAVED });
    expect(model.getState().showMapping).toBe(false);

    model.setMapping("opus", "relay/sonnet");
    await model.submit();

    expect(requests[0]).not.toHaveProperty("modelMapping");
  });
});
