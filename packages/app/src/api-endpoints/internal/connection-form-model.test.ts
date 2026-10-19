import { describe, expect, it } from "vitest";
import type {
  ApiEndpoint,
  ApiEndpointFormatDetection,
  ApiEndpointTemplate,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  createConnectionFormModel,
  type ConnectionDetectRequest,
  type ConnectionDetectResult,
  type ConnectionFormDeps,
  type ConnectionRevealKeyResult,
  type ConnectionSaveRequest,
  type ConnectionSaveResult,
  type ConnectionIconResult,
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
  const storedIcons: Uint8Array[] = [];
  const siteIconRequests: { baseUrl: string; name: string }[] = [];
  let revealAnswer = deferred<ConnectionRevealKeyResult>();
  let storeIconAnswer = deferred<ConnectionIconResult>();
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
    storeIcon: (bytes) => {
      storedIcons.push(bytes);
      return storeIconAnswer.promise;
    },
    fetchSiteIcon: (input) => {
      siteIconRequests.push(input);
      return storeIconAnswer.promise;
    },
  };
  return {
    deps,
    saves,
    detects,
    reveals,
    storedIcons,
    siteIconRequests,
    answerStoreIcon(result: ConnectionIconResult) {
      storeIconAnswer.resolve(result);
      storeIconAnswer = deferred<ConnectionIconResult>();
    },
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
const KEY_REQUIRED = {
  isKeyOptional: false,
  canRevealKey: false,
  canPickIcon: false,
  templates: [],
};
const KEY_OPTIONAL = { isKeyOptional: true, canRevealKey: true, canPickIcon: true, templates: [] };

describe("connection form: create", () => {
  it("cannot save or detect until a name, a key and an address are there", () => {
    const { deps } = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      deps,
      KEY_REQUIRED,
    );
    expect(model.getState()).toMatchObject({ canDetect: false, canSubmit: false });

    model.setName("Relay");
    model.setApiKey("sk-1");
    expect(model.getState().canDetect).toBe(false);
    model.setAddress("https://relay.example");
    expect(model.getState()).toMatchObject({ canDetect: true, canSubmit: false });
  });

  it("fills the formats that answered, labels each one, and then can save", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
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
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
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
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
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
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
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
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
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
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
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
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
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
    { mode: "create" as const, templateId: null },
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

const ZHIPU: ApiEndpointTemplate = {
  id: "zhipu",
  name: "Zhipu GLM",
  group: "vendor",
  baseUrls: [
    { format: "anthropic_messages", url: "https://open.bigmodel.cn/api/anthropic" },
    { format: "openai_chat", url: "https://open.bigmodel.cn/api/paas/v4" },
  ],
  keysUrl: "https://open.bigmodel.cn/keys",
  website: "https://open.bigmodel.cn",
  modelsDevIds: ["zhipuai"],
  regionLabel: "plan",
  regions: [
    {
      id: "api",
      name: "Pay as you go",
      baseUrls: [
        { format: "anthropic_messages", url: "https://open.bigmodel.cn/api/anthropic" },
        { format: "openai_chat", url: "https://open.bigmodel.cn/api/paas/v4" },
      ],
    },
    {
      id: "coding",
      name: "Coding Plan",
      baseUrls: [
        { format: "anthropic_messages", url: "https://open.bigmodel.cn/api/anthropic" },
        { format: "openai_chat", url: "https://open.bigmodel.cn/api/coding/paas/v4" },
        { format: "openai_responses", url: "https://open.bigmodel.cn/api/v1" },
      ],
      keysUrl: "https://open.bigmodel.cn/coding-keys",
      website: "https://docs.bigmodel.cn/coding",
    },
  ],
};

const STEPFUN: ApiEndpointTemplate = {
  id: "stepfun",
  name: "StepFun",
  group: "vendor",
  baseUrls: [{ format: "openai_chat", url: "https://api.stepfun.ai/step_plan/v1" }],
  keysUrl: "https://platform.stepfun.ai/interface-key",
  modelsDevIds: [],
  regionLabel: "plan",
  regions: [
    {
      id: "plan",
      name: "Step Plan",
      baseUrls: [{ format: "openai_chat", url: "https://api.stepfun.ai/step_plan/v1" }],
    },
    {
      id: "api",
      name: "Pay as you go",
      baseUrls: [{ format: "openai_chat", url: "https://api.stepfun.ai/v1" }],
    },
  ],
};

const STEPFUN_CN: ApiEndpointTemplate = {
  ...STEPFUN,
  id: "stepfun-cn",
  name: "StepFun (China)",
  baseUrls: [{ format: "openai_chat", url: "https://api.stepfun.com/step_plan/v1" }],
  keysUrl: "https://platform.stepfun.com/interface-key",
  regions: [
    {
      id: "plan",
      name: "Step Plan",
      baseUrls: [{ format: "openai_chat", url: "https://api.stepfun.com/step_plan/v1" }],
    },
    {
      id: "api",
      name: "Pay as you go",
      baseUrls: [{ format: "openai_chat", url: "https://api.stepfun.com/v1" }],
    },
  ],
};

const WITH_TEMPLATES = { ...KEY_OPTIONAL, templates: [ZHIPU, STEPFUN, STEPFUN_CN] };

function urlOf(model: ReturnType<typeof createConnectionFormModel>, format: string): string {
  return model.getState().formats.find((field) => field.format === format)?.url ?? "";
}

describe("connection form: from a template", () => {
  it("starts with the template's name, its first plan's addresses and that plan's key page", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "zhipu" },
      fake.deps,
      WITH_TEMPLATES,
    );
    const state = model.getState();
    expect(state.name).toBe("Zhipu GLM");
    expect(state.template).toMatchObject({
      id: "zhipu",
      regionLabel: "plan",
      regions: [
        { id: "api", name: "Pay as you go" },
        { id: "coding", name: "Coding Plan" },
      ],
      regionId: "api",
      sites: null,
      keysUrl: "https://open.bigmodel.cn/keys",
      websiteUrl: "https://open.bigmodel.cn",
    });
    expect(urlOf(model, "openai_chat")).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(urlOf(model, "openai_responses")).toBe("");
    expect(state.canSubmit).toBe(true);
  });

  it("switching the plan swaps the addresses and the key page, and keeps the key and the name", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "zhipu" },
      fake.deps,
      WITH_TEMPLATES,
    );
    model.setName("My GLM");
    model.setApiKey("sk-zhipu");

    model.setRegion("coding");

    const state = model.getState();
    expect(state.template?.regionId).toBe("coding");
    expect(state.template?.keysUrl).toBe("https://open.bigmodel.cn/coding-keys");
    expect(state.template?.websiteUrl).toBe("https://docs.bigmodel.cn/coding");
    expect(state.apiKey).toBe("sk-zhipu");
    expect(state.name).toBe("My GLM");
    expect(urlOf(model, "openai_chat")).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
    expect(urlOf(model, "openai_responses")).toBe("https://open.bigmodel.cn/api/v1");
    await model.submit();
    expect(fake.saves).toEqual([
      {
        name: "My GLM",
        apiKey: "sk-zhipu",
        baseUrls: [
          { format: "anthropic_messages", url: "https://open.bigmodel.cn/api/anthropic" },
          { format: "openai_chat", url: "https://open.bigmodel.cn/api/coding/paas/v4" },
          { format: "openai_responses", url: "https://open.bigmodel.cn/api/v1" },
        ],
        models: [],
        templateId: "zhipu",
        region: "coding",
      },
    ]);
  });

  it("switching to the China site keeps only the key; its plans and key page follow", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "stepfun" },
      fake.deps,
      WITH_TEMPLATES,
    );
    expect(model.getState().template?.sites).toEqual([
      { templateId: "stepfun", area: "global" },
      { templateId: "stepfun-cn", area: "china" },
    ]);
    model.setName("Renamed");
    model.setApiKey("sk-step");
    model.setRegion("api");

    model.setSite("stepfun-cn");

    const state = model.getState();
    expect(state.name).toBe("StepFun (China)");
    expect(state.apiKey).toBe("sk-step");
    expect(state.template).toMatchObject({
      id: "stepfun-cn",
      regionId: "plan",
      keysUrl: "https://platform.stepfun.com/interface-key",
    });
    expect(urlOf(model, "openai_chat")).toBe("https://api.stepfun.com/step_plan/v1");
    await model.submit();
    expect(fake.saves[0]).toMatchObject({ templateId: "stepfun-cn", region: "plan" });
  });

  it("a template it does not know opens the custom form", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "gone" },
      fake.deps,
      WITH_TEMPLATES,
    );
    expect(model.getState().template).toBeNull();
    expect(model.getState().name).toBe("");
  });

  it("the custom form has no template and saves none", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      WITH_TEMPLATES,
    );
    model.setName("Relay");
    model.setUrl("openai_chat", "https://relay.example/v1");
    await model.submit();
    expect(model.getState().template).toBeNull();
    expect(fake.saves[0]).not.toHaveProperty("templateId");
    expect(fake.saves[0]).not.toHaveProperty("region");
  });

  it("editing an endpoint from a template starts at its plan, can switch it, and has no China switch", async () => {
    const fake = fakeDeps();
    const endpoint: ApiEndpoint = {
      ...SAVED_ENDPOINT,
      name: "Step",
      baseUrls: STEPFUN.regions?.[1]?.baseUrls,
      templateId: "stepfun",
      region: "api",
    };
    const model = createConnectionFormModel({ mode: "edit", endpoint }, fake.deps, WITH_TEMPLATES);
    expect(model.getState().template).toMatchObject({
      id: "stepfun",
      regionId: "api",
      sites: null,
    });

    model.setRegion("plan");
    await model.submit();

    expect(fake.saves[0]).toMatchObject({
      endpointId: "ep_1",
      name: "Step",
      baseUrls: [{ format: "openai_chat", url: "https://api.stepfun.ai/step_plan/v1" }],
      templateId: "stepfun",
      region: "plan",
    });
    expect(fake.saves[0]).not.toHaveProperty("apiKey");
  });
});

const AZURE: ApiEndpointTemplate = {
  id: "azure",
  name: "Azure OpenAI",
  group: "vendor",
  baseUrls: [],
  modelsDevIds: ["azure", "openai"],
  endpointExample: "https://<resource>.openai.azure.com",
  endpointHint: "Your resource's endpoint, from Keys and Endpoint in the Azure portal.",
  keysUrl: "https://portal.azure.com/keys",
};

describe("connection form: a template at the user's own resource", () => {
  const options = { ...KEY_OPTIONAL, templates: [AZURE] };

  it("asks for the resource's endpoint and saves it as the Chat and Responses address", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "azure" },
      fake.deps,
      options,
    );
    expect(model.getState().template).toMatchObject({
      endpointExample: "https://<resource>.openai.azure.com",
      endpointHint: "Your resource's endpoint, from Keys and Endpoint in the Azure portal.",
    });
    expect(model.getState().endpoint).toBe("");
    expect(model.getState().canSubmit).toBe(false);

    // 门户里列的只有资源名也算，daemon 保存时放到资源的 v1 API 上。
    model.setEndpoint("my-resource");
    model.setApiKey("azure-key");

    expect(model.getState().canSubmit).toBe(true);
    await model.submit();
    expect(fake.saves[0]).toMatchObject({
      templateId: "azure",
      apiKey: "azure-key",
      baseUrls: [
        { format: "openai_chat", url: "my-resource" },
        { format: "openai_responses", url: "my-resource" },
      ],
    });
  });

  it("editing starts from the saved address", () => {
    const fake = fakeDeps();
    const url = "https://my-resource.openai.azure.com/openai/v1";
    const endpoint: ApiEndpoint = {
      ...SAVED_ENDPOINT,
      name: "Azure OpenAI",
      baseUrls: [
        { format: "openai_chat", url },
        { format: "openai_responses", url },
      ],
      templateId: "azure",
    };
    const model = createConnectionFormModel({ mode: "edit", endpoint }, fake.deps, options);
    expect(model.getState().endpoint).toBe(url);
  });
});

const OLLAMA: ApiEndpointTemplate = {
  id: "ollama",
  name: "Ollama",
  group: "local",
  keyOptional: true,
  baseUrls: [
    { format: "anthropic_messages", url: "http://localhost:11434" },
    { format: "openai_chat", url: "http://localhost:11434/v1" },
  ],
  modelsDevIds: [],
};

describe("connection form: a server on this machine", () => {
  const options = { ...KEY_OPTIONAL, templates: [OLLAMA] };

  it("asks only for the server's address, starting at the template's, and saves the template's addresses", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "ollama" },
      fake.deps,
      options,
    );
    expect(model.getState()).toMatchObject({
      serviceAddress: "http://localhost:11434",
      serviceAddressInvalid: false,
      template: { asksServiceAddress: true, keyOptional: true },
      canSubmit: true,
    });

    await model.submit();

    expect(fake.saves[0]).toMatchObject({
      templateId: "ollama",
      baseUrls: [
        { format: "anthropic_messages", url: "http://localhost:11434" },
        { format: "openai_chat", url: "http://localhost:11434/v1" },
      ],
    });
    expect(fake.saves[0]?.apiKey).toBeUndefined();
  });

  it("a new address moves every format's address there, each keeping its path (as magpie AtAddress)", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "ollama" },
      fake.deps,
      options,
    );

    // 不写协议按 http，带上的路径不算。
    model.setServiceAddress("192.168.1.20:11500/v1");
    await model.submit();

    expect(fake.saves[0]?.baseUrls).toEqual([
      { format: "anthropic_messages", url: "http://192.168.1.20:11500" },
      { format: "openai_chat", url: "http://192.168.1.20:11500/v1" },
    ]);
  });

  it("an address that is none can't be saved until it is fixed; an empty one keeps the addresses", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "ollama" },
      fake.deps,
      options,
    );

    for (const address of ["http://localhost:99999", "local host", "ftp://localhost:21"]) {
      model.setServiceAddress(address);
      expect(model.getState(), address).toMatchObject({
        serviceAddressInvalid: true,
        canSubmit: false,
      });
    }
    model.setServiceAddress("");
    expect(model.getState()).toMatchObject({ serviceAddressInvalid: false, canSubmit: true });
    await model.submit();
    expect(fake.saves[0]?.baseUrls).toEqual(OLLAMA.baseUrls);
  });

  it("editing starts at the saved address and moves the saved addresses", async () => {
    const fake = fakeDeps();
    const endpoint: ApiEndpoint = {
      ...SAVED_ENDPOINT,
      name: "Ollama",
      hasApiKey: false,
      baseUrls: [
        { format: "anthropic_messages", url: "http://box.local:11500" },
        { format: "openai_chat", url: "http://box.local:11500/v1" },
      ],
      templateId: "ollama",
    };
    const model = createConnectionFormModel({ mode: "edit", endpoint }, fake.deps, options);
    expect(model.getState().serviceAddress).toBe("http://box.local:11500");

    model.setServiceAddress("https://box.local:8443");
    await model.submit();

    expect(fake.saves[0]?.baseUrls).toEqual([
      { format: "anthropic_messages", url: "https://box.local:8443" },
      { format: "openai_chat", url: "https://box.local:8443/v1" },
    ]);
  });
});

describe("connection form: the icon of a custom endpoint", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it("saves the built-in icon picked; Default takes it off", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    expect(model.getState()).toMatchObject({ canPickIcon: true, icon: null });
    model.setName("Home relay");
    model.setUrl("openai_chat", "https://home.example/v1");

    model.setIcon("deepseek-color");
    expect(model.getState().icon).toBe("deepseek-color");
    await model.submit();
    const edit = createConnectionFormModel(
      { mode: "edit", endpoint: { ...SAVED_ENDPOINT, icon: "deepseek-color" } },
      fake.deps,
      KEY_OPTIONAL,
    );
    edit.setIcon(null);
    await edit.submit();

    expect(fake.saves.map((save) => save.icon)).toEqual(["deepseek-color", null]);
  });

  it("a picture is stored on the host first, then saved by the value the host gave", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setName("Home relay");
    model.setUrl("openai_chat", "https://home.example/v1");

    model.pickIconImage(PNG);
    expect(model.getState()).toMatchObject({ iconTask: "picture", canSubmit: false });
    fake.answerStoreIcon({ status: "stored", icon: "file:0123456789abcdef.png" });
    await flush();

    expect(fake.storedIcons).toEqual([PNG]);
    expect(model.getState()).toMatchObject({
      iconTask: null,
      icon: "file:0123456789abcdef.png",
      iconError: null,
      canSubmit: true,
    });
    await model.submit();
    expect(fake.saves[0]?.icon).toBe("file:0123456789abcdef.png");
  });

  it("a picture over 1 MB is refused without sending it; one the host refuses shows why and keeps the icon", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setIcon("deepseek-color");

    model.pickIconImage(new Uint8Array((1 << 20) + 1));
    expect(fake.storedIcons).toEqual([]);
    expect(model.getState()).toMatchObject({
      icon: "deepseek-color",
      iconError: { code: "icon_too_large" },
    });

    model.pickIconImage(new TextEncoder().encode("just text"));
    fake.answerStoreIcon({
      status: "failed",
      error: {
        code: "icon_not_image",
        message: "Not a picture: use PNG, JPEG, GIF, WebP, ICO or SVG",
      },
    });
    await flush();
    expect(model.getState()).toMatchObject({
      iconTask: null,
      icon: "deepseek-color",
      iconError: { code: "icon_not_image" },
    });

    // 再选一次就清掉上次的失败。
    model.setIcon("openai");
    expect(model.getState().iconError).toBeNull();
  });

  it("From the website asks the host with the first address filled in and the name; a failure says why and keeps the icon", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setName(" Home relay ");
    model.setUrl("anthropic_messages", "https://home.example");
    model.setUrl("openai_responses", "https://api.home.example/v1");

    model.fetchSiteIcon();
    expect(model.getState()).toMatchObject({ iconTask: "website", canSubmit: false });
    expect(fake.siteIconRequests).toEqual([
      { baseUrl: "https://api.home.example/v1", name: "Home relay" },
    ]);
    fake.answerStoreIcon({
      status: "failed",
      error: { code: "site_icon_not_found", message: "Couldn't find the site's icon" },
    });
    await flush();
    expect(model.getState()).toMatchObject({
      iconTask: null,
      icon: null,
      iconError: { code: "site_icon_not_found" },
    });

    model.fetchSiteIcon();
    fake.answerStoreIcon({ status: "stored", icon: "file:fedcba9876543210.svg" });
    await flush();
    expect(model.getState()).toMatchObject({ icon: "file:fedcba9876543210.svg", iconError: null });
  });

  it("editing starts at the icon it had and leaves it to the host unless changed; a template's endpoint and an old host pick none", async () => {
    const fake = fakeDeps();
    const edit = createConnectionFormModel(
      { mode: "edit", endpoint: { ...SAVED_ENDPOINT, icon: "file:0123456789abcdef.png" } },
      fake.deps,
      KEY_OPTIONAL,
    );
    expect(edit.getState().icon).toBe("file:0123456789abcdef.png");
    await edit.submit();
    expect(fake.saves[0]).not.toHaveProperty("icon");

    const fromTemplate = createConnectionFormModel(
      { mode: "create", templateId: "ollama" },
      fake.deps,
      { ...KEY_OPTIONAL, templates: [OLLAMA] },
    );
    expect(fromTemplate.getState().canPickIcon).toBe(false);
    await fromTemplate.submit();
    expect(fake.saves[1]).not.toHaveProperty("icon");

    const oldHost = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      {
        ...KEY_REQUIRED,
      },
    );
    expect(oldHost.getState().canPickIcon).toBe(false);
    await oldHost.submit();
    expect(fake.saves[2]).not.toHaveProperty("icon");
  });
});
