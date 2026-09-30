import { describe, expect, it } from "vitest";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { createApiEndpointFormModel, type ApiEndpointSaveResult } from "./form-model";

const SAVED: ApiEndpoint = {
  id: "ep_1",
  provider: "claude",
  name: "Relay",
  baseUrl: "https://relay.example/api",
  models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
  defaultModelId: "relay/haiku",
  hasApiKey: true,
};

function createForm(seed: Parameters<typeof createApiEndpointFormModel>[0]) {
  const requests: unknown[] = [];
  let result: ApiEndpointSaveResult = { ok: true };
  const model = createApiEndpointFormModel(seed, {
    save: async (request) => {
      requests.push(request);
      return result;
    },
  });
  return {
    model,
    requests,
    failNext(message: string) {
      result = { ok: false, message };
    },
  };
}

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
