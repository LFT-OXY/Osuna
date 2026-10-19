import { describe, expect, it } from "vitest";
import type {
  ApiEndpoint,
  ApiEndpointFormatDetection,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  createConnectionFormModel,
  type ConnectionDetectRequest,
  type ConnectionDetectResult,
  type ConnectionFormDeps,
  type ConnectionRevealKeyResult,
  type ConnectionSaveRequest,
  type ConnectionSaveResult,
} from "./connection-form-model";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeDeps() {
  const saves: ConnectionSaveRequest[] = [];
  const detects: { request: ConnectionDetectRequest; signal: AbortSignal }[] = [];
  const reveals: string[] = [];
  let revealAnswer = deferred<ConnectionRevealKeyResult>();
  let saveResult: ConnectionSaveResult = { status: "saved", endpointId: "ep_new" };
  let detectAnswer = deferred<ConnectionDetectResult>();
  const deps: ConnectionFormDeps = {
    save: async (request) => {
      saves.push(request);
      return saveResult;
    },
    detect: (request, signal) => {
      detects.push({ request, signal });
      return detectAnswer.promise;
    },
    revealKey: (endpointId) => {
      reveals.push(endpointId);
      return revealAnswer.promise;
    },
  };
  return {
    deps,
    saves,
    detects,
    reveals,
    answerReveal(result: ConnectionRevealKeyResult) {
      revealAnswer.resolve(result);
      revealAnswer = deferred<ConnectionRevealKeyResult>();
    },
    answerDetect(result: ConnectionDetectResult) {
      detectAnswer.resolve(result);
      detectAnswer = deferred<ConnectionDetectResult>();
    },
    failSaveWith(message: string) {
      saveResult = { status: "failed", message };
    },
  };
}

function detection(
  format: string,
  url: string,
  status: string,
  httpStatus: number | null = status === "ok" ? 200 : 404,
): ApiEndpointFormatDetection {
  return { format, url, status, httpStatus, message: status === "ok" ? null : "nope" };
}

const DETECTED = [
  detection("anthropic_messages", "https://relay.example", "ok"),
  detection("openai_chat", "https://relay.example/v1", "ok"),
  detection("openai_responses", "https://relay.example/v1", "not_detected"),
];

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const SAVED_ENDPOINT: ApiEndpoint = {
  id: "ep_1",
  provider: "claude",
  name: "Relay",
  baseUrl: "https://relay.example",
  baseUrls: [
    { format: "anthropic_messages", url: "https://relay.example" },
    { format: "openai_chat", url: "https://relay.example/v1" },
  ],
  models: [{ id: "claude-sonnet-4-5" }, { id: "glm-4.6" }],
  defaultModelId: "claude-sonnet-4-5",
  modelMapping: { opus: "glm-4.6" },
  hasApiKey: true,
  enabled: true,
};

// 主机没声明 apiEndpointManagement：key 必填，和以前一样。
const KEY_REQUIRED = { isKeyOptional: false, canRevealKey: false };
const KEY_OPTIONAL = { isKeyOptional: true, canRevealKey: true };

describe("connection form: create", () => {
  it("cannot save or detect until a name, a key and an address are there", () => {
    const { deps } = fakeDeps();
    const model = createConnectionFormModel({ mode: "create" }, deps, KEY_REQUIRED);
    expect(model.getState()).toMatchObject({ canDetect: false, canSubmit: false });

    model.setName("Relay");
    model.setApiKey("sk-1");
    expect(model.getState().canDetect).toBe(false);
    model.setAddress("https://relay.example");
    expect(model.getState()).toMatchObject({ canDetect: true, canSubmit: false });
  });

  it("fills the formats that answered, labels each one, and then can save", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "create" }, fake.deps, KEY_REQUIRED);
    model.setName("Relay");
    model.setApiKey(" sk-1 ");
    model.setAddress("https://relay.example/");
    model.detect();

    expect(model.getState()).toMatchObject({ detecting: true, canSubmit: false });
    expect(fake.detects[0]?.request).toEqual({
      baseUrl: "https://relay.example/",
      apiKey: "sk-1",
    });

    fake.answerDetect({ status: "done", results: DETECTED });
    await flush();

    const state = model.getState();
    expect(state.detecting).toBe(false);
    expect(state.formats).toEqual([
      {
        format: "anthropic_messages",
        url: "https://relay.example",
        detection: "ok",
        invalid: false,
      },
      { format: "openai_chat", url: "https://relay.example/v1", detection: "ok", invalid: false },
      { format: "openai_responses", url: "", detection: "not_detected", invalid: false },
    ]);
    expect(state.urlGeneration).toBe(1);
    expect(state.keyRejected).toBe(false);
    expect(state.canSubmit).toBe(true);

    expect(await model.submit()).toEqual({ status: "saved", endpointId: "ep_new" });
    expect(fake.saves).toEqual([
      {
        name: "Relay",
        apiKey: "sk-1",
        baseUrls: [
          { format: "anthropic_messages", url: "https://relay.example" },
          { format: "openai_chat", url: "https://relay.example/v1" },
        ],
        models: [],
      },
    ]);
  });

  it("marks the key as rejected when the upstream refused it, until the key changes", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "create" }, fake.deps, KEY_REQUIRED);
    model.setName("Relay");
    model.setApiKey("sk-wrong");
    model.setAddress("https://relay.example");
    model.detect();
    fake.answerDetect({
      status: "done",
      results: [
        detection("anthropic_messages", "https://relay.example", "auth_failed", 401),
        detection("openai_chat", "https://relay.example/v1", "auth_failed", 401),
        detection("openai_responses", "https://relay.example/v1", "auth_failed", 401),
      ],
    });
    await flush();

    expect(model.getState()).toMatchObject({ keyRejected: true, canSubmit: false });
    expect(model.getState().formats.map((entry) => [entry.url, entry.detection])).toEqual([
      ["", "auth_failed"],
      ["", "auth_failed"],
      ["", "auth_failed"],
    ]);

    model.setApiKey("sk-right");
    expect(model.getState().keyRejected).toBe(false);
    expect(model.getState().formats.map((entry) => entry.detection)).toEqual([null, null, null]);
  });

  it("keeps what the user typed for a format that was not detected, and drops that format's label on edit", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "create" }, fake.deps, KEY_REQUIRED);
    model.setName("Relay");
    model.setApiKey("sk-1");
    model.setAddress("https://relay.example");
    model.setUrl("openai_responses", "https://other.example/v1");
    model.detect();
    fake.answerDetect({ status: "done", results: DETECTED });
    await flush();

    expect(model.getState().formats[2]).toEqual({
      format: "openai_responses",
      url: "https://other.example/v1",
      detection: "not_detected",
      invalid: false,
    });
    model.setUrl("openai_chat", "https://relay.example/v2");
    expect(model.getState().formats.map((entry) => entry.detection)).toEqual([
      "ok",
      null,
      "not_detected",
    ]);
  });

  it("refuses to save with an address that is not http, and shows a failed detection", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "create" }, fake.deps, KEY_REQUIRED);
    model.setName("Relay");
    model.setApiKey("sk-1");
    model.setUrl("openai_chat", "relay.example");
    expect(model.getState().formats[1]?.invalid).toBe(true);
    expect(model.getState().canSubmit).toBe(false);

    model.setAddress("https://relay.example");
    model.detect();
    fake.answerDetect({ status: "failed", message: "The host is offline" });
    await flush();
    expect(model.getState().detectError).toBe("The host is offline");
  });

  it("a cancelled or superseded detection changes nothing", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "create" }, fake.deps, KEY_REQUIRED);
    model.setName("Relay");
    model.setApiKey("sk-1");
    model.setAddress("https://relay.example");
    model.detect();
    model.cancelDetect();
    expect(fake.detects[0]?.signal.aborted).toBe(true);
    expect(model.getState().detecting).toBe(false);

    fake.answerDetect({ status: "done", results: DETECTED });
    await flush();
    expect(model.getState().formats.map((entry) => entry.url)).toEqual(["", "", ""]);
  });

  it("keeps the form and shows why when saving fails", async () => {
    const fake = fakeDeps();
    fake.failSaveWith("Name is required");
    const model = createConnectionFormModel({ mode: "create" }, fake.deps, KEY_REQUIRED);
    model.setName("Relay");
    model.setApiKey("sk-1");
    model.setUrl("openai_chat", "https://relay.example/v1");

    expect(await model.submit()).toEqual({ status: "failed", message: "Name is required" });
    expect(model.getState()).toMatchObject({ submitting: false, submitError: "Name is required" });
  });
});

describe("connection form: edit", () => {
  it("starts from the saved connection with an empty key that keeps the saved one", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_REQUIRED,
    );
    const state = model.getState();
    expect(state).toMatchObject({
      name: "Relay",
      apiKey: "",
      hasSavedKey: true,
      address: "https://relay.example",
      canDetect: true,
      canSubmit: true,
    });
    expect(state.formats.map((entry) => entry.url)).toEqual([
      "https://relay.example",
      "https://relay.example/v1",
      "",
    ]);

    model.detect();
    expect(fake.detects[0]?.request).toEqual({
      endpointId: "ep_1",
      baseUrl: "https://relay.example",
    });
    expect(model.getState().canSubmit).toBe(false);
    fake.answerDetect({ status: "done", results: DETECTED });
    await flush();

    model.setName("Relay 2");
    await model.submit();
    expect(fake.saves).toEqual([
      {
        endpointId: "ep_1",
        name: "Relay 2",
        baseUrls: [
          { format: "anthropic_messages", url: "https://relay.example" },
          { format: "openai_chat", url: "https://relay.example/v1" },
        ],
        models: [{ id: "claude-sonnet-4-5" }, { id: "glm-4.6" }],
        modelMapping: { opus: "glm-4.6" },
      },
    ]);
  });
});

describe("connection form: the key is optional when the host says so", () => {
  it("detects and saves without a key, and sends none", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "create" }, fake.deps, KEY_OPTIONAL);
    expect(model.getState()).toMatchObject({ isKeyOptional: true, canDetect: false });

    model.setName("Ollama");
    model.setAddress("http://127.0.0.1:11434");
    expect(model.getState()).toMatchObject({ canDetect: true, canSubmit: false });
    model.detect();
    expect(fake.detects[0]?.request).toEqual({ baseUrl: "http://127.0.0.1:11434" });
    fake.answerDetect({
      status: "done",
      results: [detection("openai_chat", "http://127.0.0.1:11434/v1", "ok")],
    });
    await flush();
    expect(model.getState().canSubmit).toBe(true);

    await model.submit();
    expect(fake.saves).toEqual([
      {
        name: "Ollama",
        baseUrls: [{ format: "openai_chat", url: "http://127.0.0.1:11434/v1" }],
        models: [],
      },
    ]);
  });

  it("an endpoint saved without a key can be edited and saved without one", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: { ...SAVED_ENDPOINT, hasApiKey: false } },
      fake.deps,
      KEY_OPTIONAL,
    );
    expect(model.getState()).toMatchObject({ hasSavedKey: false, canSubmit: true });

    await model.submit();
    expect(fake.saves[0]).not.toHaveProperty("apiKey");
  });

  it("an old host still needs a key", () => {
    const { deps } = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: { ...SAVED_ENDPOINT, hasApiKey: false } },
      deps,
      KEY_REQUIRED,
    );
    expect(model.getState()).toMatchObject({
      isKeyOptional: false,
      canDetect: false,
      canSubmit: false,
    });
  });
});

describe("connection form: duplicate", () => {
  const SOURCE: ApiEndpoint = {
    ...SAVED_ENDPOINT,
    apiKeyMask: "sk-r…a1b2",
    manualModels: [{ id: "by-hand" }],
    searchesWeb: true,
  };

  it("opens as a new endpoint filled with the original's connection, its name given, the key box empty", () => {
    const { deps } = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "duplicate", source: SOURCE, name: "Relay copy" },
      deps,
      KEY_OPTIONAL,
    );
    const state = model.getState();
    expect(state).toMatchObject({
      mode: "duplicate",
      name: "Relay copy",
      apiKey: "",
      address: "https://relay.example",
      canSubmit: true,
    });
    expect(state.formats.map((entry) => entry.url)).toEqual([
      "https://relay.example",
      "https://relay.example/v1",
      "",
    ]);
  });

  it("saves as a copy of the original: its models and mapping, no key unless one is typed", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "duplicate", source: SOURCE, name: "Relay copy" },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.detect();
    // 不填 key 时检测用原来那家的 key。
    expect(fake.detects[0]?.request).toEqual({
      endpointId: "ep_1",
      baseUrl: "https://relay.example",
    });
    fake.answerDetect({ status: "cancelled" });
    await flush();

    await model.submit();
    model.setApiKey("sk-second");
    await model.submit();

    const copy = {
      name: "Relay copy",
      baseUrls: [
        { format: "anthropic_messages", url: "https://relay.example" },
        { format: "openai_chat", url: "https://relay.example/v1" },
      ],
      models: [{ id: "claude-sonnet-4-5" }, { id: "glm-4.6" }],
      modelMapping: { opus: "glm-4.6" },
      copyOf: "ep_1",
    };
    expect(fake.saves).toEqual([copy, { ...copy, apiKey: "sk-second" }]);
  });
});

describe("connection form: show the saved key", () => {
  function editing(options = KEY_OPTIONAL) {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      options,
    );
    return { fake, model };
  }

  it("reads the key back into the box and shows it; hiding it empties the box again", async () => {
    const { fake, model } = editing();
    expect(model.getState()).toMatchObject({ canShowKey: true, isKeyVisible: false });

    model.toggleKeyVisible();
    expect(fake.reveals).toEqual(["ep_1"]);
    expect(model.getState().isRevealingKey).toBe(true);
    fake.answerReveal({ status: "revealed", apiKey: "sk-relay-a1b2" });
    await flush();

    const shown = model.getState();
    expect(shown).toMatchObject({
      isKeyVisible: true,
      isRevealingKey: false,
      keyBoxValue: "sk-relay-a1b2",
      // 读回来的不算新 key：直接保存仍保留原 key。
      apiKey: "",
    });
    await model.submit();
    expect(fake.saves[0]).not.toHaveProperty("apiKey");

    model.toggleKeyVisible();
    expect(model.getState()).toMatchObject({ isKeyVisible: false, keyBoxValue: "" });
    expect(model.getState().keyBoxGeneration).toBeGreaterThan(shown.keyBoxGeneration);

    // 不限次数。
    model.toggleKeyVisible();
    expect(fake.reveals).toEqual(["ep_1", "ep_1"]);
  });

  it("a key typed over the shown one is saved, and hiding keeps it", async () => {
    const { fake, model } = editing();
    model.toggleKeyVisible();
    fake.answerReveal({ status: "revealed", apiKey: "sk-relay-a1b2" });
    await flush();

    model.setApiKey("sk-new");
    model.toggleKeyVisible();
    expect(model.getState()).toMatchObject({ isKeyVisible: false, apiKey: "sk-new" });
    await model.submit();
    expect(fake.saves[0]?.apiKey).toBe("sk-new");
  });

  it("shows why it failed on the key and stays hidden, until the next try or a typed key", async () => {
    const { fake, model } = editing();
    model.toggleKeyVisible();
    fake.answerReveal({ status: "failed", message: "Host disconnected" });
    await flush();
    expect(model.getState()).toMatchObject({
      isKeyVisible: false,
      isRevealingKey: false,
      revealError: "Host disconnected",
      keyBoxValue: "",
    });

    model.toggleKeyVisible();
    expect(model.getState().revealError).toBeNull();
    fake.answerReveal({ status: "failed", message: "Host disconnected" });
    await flush();
    model.setApiKey("sk-typed");
    expect(model.getState().revealError).toBeNull();
  });

  it.each([
    { mode: "create" as const },
    { mode: "duplicate" as const, source: SAVED_ENDPOINT, name: "Relay copy" },
    { mode: "edit" as const, endpoint: { ...SAVED_ENDPOINT, hasApiKey: false } },
  ])("only shows what was typed when this endpoint has no saved key ($mode)", (seed) => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(seed, fake.deps, KEY_OPTIONAL);
    expect(model.getState().canShowKey).toBe(true);
    model.setApiKey("sk-typed");
    model.toggleKeyVisible();
    expect(fake.reveals).toEqual([]);
    expect(model.getState().isKeyVisible).toBe(true);
  });

  it("an old host has no Show", () => {
    const { fake, model } = editing(KEY_REQUIRED);
    expect(model.getState().canShowKey).toBe(false);
    model.toggleKeyVisible();
    expect(fake.reveals).toEqual([]);
    expect(model.getState().isKeyVisible).toBe(false);
  });
});
