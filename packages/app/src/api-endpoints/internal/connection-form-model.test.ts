import { describe, expect, it } from "vitest";
import type {
  ApiEndpoint,
  ApiEndpointFormatDetection,
  ApiEndpointTemplate,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  conciseUpstreamMessage,
  createConnectionFormModel,
  type ConnectionDetectRequest,
  type ConnectionDetectResult,
  type ConnectionFetchRequest,
  type ConnectionFetchResult,
  type ConnectionFormDeps,
  type ConnectionTestRequest,
  type ConnectionTestResult,
  type ConnectionRevealKeyResult,
  type ConnectionSaveRequest,
  type ConnectionSaveResult,
  type ConnectionIconResult,
} from "./connection-form-model";
import { curlOf, type CurlCommand } from "./curl-command";
import type { ConnectionCurlInputs } from "./connection-form-model";

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
  const fetches: { request: ConnectionFetchRequest; signal: AbortSignal }[] = [];
  const fetchAnswers: Deferred<ConnectionFetchResult>[] = [];
  const tests: { request: ConnectionTestRequest; signal: AbortSignal }[] = [];
  const testAnswers: Deferred<ConnectionTestResult>[] = [];
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
    fetchModels: (request, signal) => {
      fetches.push({ request, signal });
      const answer = deferred<ConnectionFetchResult>();
      fetchAnswers.push(answer);
      return answer.promise;
    },
    testConnection: (request, signal) => {
      tests.push({ request, signal });
      const answer = deferred<ConnectionTestResult>();
      testAnswers.push(answer);
      return answer.promise;
    },
  };
  return {
    deps,
    saves,
    detects,
    fetches,
    tests,
    // 按发出的先后回答第 index 次拉模型、测试。
    answerFetch(index: number, result: ConnectionFetchResult) {
      fetchAnswers[index]?.resolve(result);
    },
    answerTest(index: number, result: ConnectionTestResult) {
      testAnswers[index]?.resolve(result);
    },
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
  canPasteCurl: false,
  canCheckBeforeSave: false,
  followsListWhenNew: false,
  templates: [],
};
const KEY_OPTIONAL = {
  isKeyOptional: true,
  canRevealKey: true,
  canPickIcon: true,
  canPasteCurl: true,
  canCheckBeforeSave: true,
  followsListWhenNew: true,
  templates: [],
};

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

  it("lists how each format answered, fills them in on Use these, and then can save", async () => {
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

    fake.answerDetect({ status: "done", results: DETECTED, models: null });
    await flush();

    // 先只列结论，地址栏不动（照 magpie Detect）。
    const listed = model.getState();
    expect(listed.detecting).toBe(false);
    expect(listed.detection).toEqual({
      results: [
        {
          format: "anthropic_messages",
          url: "https://relay.example",
          label: "ok",
          httpStatus: 200,
          message: null,
          durationMs: null,
          modelId: null,
          reason: null,
        },
        {
          format: "openai_chat",
          url: "https://relay.example/v1",
          label: "ok",
          httpStatus: 200,
          message: null,
          durationMs: null,
          modelId: null,
          reason: null,
        },
        {
          format: "openai_responses",
          url: "https://relay.example/v1",
          label: "not_detected",
          httpStatus: 404,
          message: "nope",
          durationMs: null,
          modelId: null,
          reason: null,
        },
      ],
      byModel: null,
      askedOnlyFirst: null,
      singleFormatPins: [],
      isTaken: false,
      onlyChoices: null,
      canTake: true,
      // 还没有地址：先「采用这些」才能保存，表单要说一句。
      waitsForTake: true,
      noneAnswered: null,
    });
    expect(listed.formats.map((entry) => entry.url)).toEqual(["", "", ""]);
    expect(listed.canSubmit).toBe(false);

    model.takeDetected();
    const state = model.getState();
    expect(state.formats).toEqual([
      { format: "anthropic_messages", url: "https://relay.example", invalid: false },
      { format: "openai_chat", url: "https://relay.example/v1", invalid: false },
      { format: "openai_responses", url: "", invalid: false },
    ]);
    expect(state.urlGeneration).toBe(1);
    expect(state.detection).toMatchObject({ isTaken: true, canTake: false });
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
      models: null,
      results: [
        detection("anthropic_messages", "https://relay.example", "auth_failed", 401),
        detection("openai_chat", "https://relay.example/v1", "auth_failed", 401),
        detection("openai_responses", "https://relay.example/v1", "auth_failed", 401),
      ],
    });
    await flush();

    expect(model.getState()).toMatchObject({ keyRejected: true, canSubmit: false });
    expect(model.getState().detection).toMatchObject({ canTake: false, noneAnswered: "check" });

    model.setApiKey("sk-right");
    expect(model.getState().keyRejected).toBe(false);
    expect(model.getState().detection).toBeNull();
  });

  it("Use these keeps what the user typed for a format not detected, and clears one not found at the suggested address", async () => {
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
    fake.answerDetect({ status: "done", results: DETECTED, models: null });
    await flush();
    model.takeDetected();
    expect(model.getState().formats[2]?.url).toBe("https://other.example/v1");

    // 照 magpie useDetected：没在那里找到（404）、而地址栏正是建议地址的那栏清掉。
    model.setUrl("openai_responses", "https://relay.example/v1/");
    model.detect();
    fake.answerDetect({ status: "done", results: DETECTED, models: null });
    await flush();
    model.takeDetected();
    expect(model.getState().formats[2]?.url).toBe("");
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

    fake.answerDetect({ status: "done", results: DETECTED, models: null });
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
    fake.answerDetect({ status: "done", results: DETECTED, models: null });
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
      models: null,
      results: [detection("openai_chat", "http://127.0.0.1:11434/v1", "ok")],
    });
    await flush();
    model.takeDetected();
    expect(model.getState().canSubmit).toBe(true);

    await model.submit();
    expect(fake.saves).toEqual([
      {
        name: "Ollama",
        baseUrls: [{ format: "openai_chat", url: "http://127.0.0.1:11434/v1" }],
        models: [],
        // 新建的接口跟随接口清单。
        modelScope: "vendor",
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
    // 不填 key 时检测用原来那家的 key；没填试用模型时带上已选的模型挑（照 magpie picked）。
    expect(fake.detects[0]?.request).toEqual({
      endpointId: "ep_1",
      baseUrl: "https://relay.example",
      modelIds: ["claude-sonnet-4-5", "glm-4.6"],
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
        modelScope: "vendor",
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

// 下面的 curl 例子取自 magpie（https://github.com/yetone/magpie，internal/gui/tests/fixtures/curl 与
// provider-curl-paste.test.cjs，7597c132），是各厂商文档里原样的写法。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
const ANTHROPIC_CURL = `curl https://api.anthropic.com/v1/messages \\
  -H "x-api-key: $ANTHROPIC_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello, Claude"}
    ]
  }'
`;
const MOONSHOT_CURL = `curl https://api.moonshot.cn/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer $MOONSHOT_API_KEY" \\
    -d '{
        "model": "kimi-k3",
        "messages": [
            {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"},
            {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"}
        ]
   }'
`;
// 用户把自己的 key 填进 Anthropic 的例子
const OWN_KEY = "sk-ant-api03-Qx7vT2mK9pLw4RzN8bYc";
const CURL_EXAMPLES: Record<string, { text: string; want: Omit<CurlCommand, "url"> }> = {
  "openai-chat.sh": {
    text: `curl https://api.openai.com/v1/chat/completions \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "X-Client-Request-Id: 123e4567-e89b-12d3-a456-426614174000"
`,
    want: {
      format: "openai_chat",
      baseUrl: "https://api.openai.com/v1",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "$OPENAI_API_KEY",
      model: null,
    },
  },
  "openai-responses.sh": {
    text: `curl https://api.openai.com/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -d '{
    "model": "gpt-6-astra",
    "instructions": "You are a personal math tutor. When asked a math question, write and run code to answer the question.",
    "tools": [
      {
        "type": "code_interpreter",
        "container": { "type": "auto" }
      }
    ],
    "input": "I need to solve the equation 3x + 11 = 14. Can you help me?"
  }'
`,
    want: {
      format: "openai_responses",
      baseUrl: "https://api.openai.com/v1",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "$OPENAI_API_KEY",
      model: "gpt-6-astra",
    },
  },
  "anthropic.sh": {
    text: ANTHROPIC_CURL,
    want: {
      format: "anthropic_messages",
      baseUrl: "https://api.anthropic.com",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "$ANTHROPIC_API_KEY",
      model: "claude-opus-5-5",
    },
  },
  "deepseek.sh": {
    text: `curl https://api.deepseek.com/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${DEEPSEEK_API_KEY}" \\
  -d '{
        "model": "deepseek-flash",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Hello!"}
        ],
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high",
        "stream": false
      }'
`,
    want: {
      format: "openai_chat",
      baseUrl: "https://api.deepseek.com/v1",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "${DEEPSEEK_API_KEY}",
      model: "deepseek-flash",
    },
  },
  "zhipu.sh": {
    text: `curl -X POST "https://open.bigmodel.cn/api/paas/v4/chat/completions" \\
-H "Content-Type: application/json" \\
-H "Authorization: Bearer YOUR_API_KEY" \\
-d '{
    "model": "glm-5.3",
    "messages": [
        {
            "role": "system",
            "content": "你是一个有用的AI助手。"
        },
        {
            "role": "user",
            "content": "你好，请介绍一下自己。"
        }
    ],
    "temperature": 1.0,
    "stream": true
}'
`,
    want: {
      format: "openai_chat",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "YOUR_API_KEY",
      model: "glm-5.3",
    },
  },
  "moonshot.sh": {
    text: MOONSHOT_CURL,
    want: {
      format: "openai_chat",
      baseUrl: "https://api.moonshot.cn/v1",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "$MOONSHOT_API_KEY",
      model: "kimi-k3",
    },
  },
  "openrouter.sh": {
    text: `curl https://openrouter.ai/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \\
  -d '{
  "model": "~openai/gpt-sol-latest",
  "messages": [
    {
      "role": "user",
      "content": "What is the meaning of life?"
    }
  ]
}'
`,
    want: {
      format: "openai_chat",
      baseUrl: "https://openrouter.ai/api/v1",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "$OPENROUTER_API_KEY",
      model: "~openai/gpt-sol-latest",
    },
  },
  "bailian-cmd.bat": {
    text: `curl -X POST "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions" ^
-H "Authorization: Bearer %DASHSCOPE_API_KEY%" ^
-H "Content-Type: application/json" ^
-d "{
    \\"model\\": \\"qwen3.8-max\\",
    \\"messages\\": [
        {
            \\"role\\": \\"system\\",
            \\"content\\": \\"You are a helpful assistant.\\"
        },
        {
            \\"role\\": \\"user\\",
            \\"content\\": \\"你是谁？\\"
        }
    ]
}"
`,
    want: {
      format: "openai_chat",
      baseUrl: "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      urlPlaceholder: "{WorkspaceId}",
      apiKey: null,
      keyPlaceholder: "%DASHSCOPE_API_KEY%",
      model: "qwen3.8-max",
    },
  },
  "sap-ai-core.ps1": {
    text: `curl.exe --location "<Deployment_url>/chat/completions" --header "AI-Resource-Group: <resource_group>" --header "Content-Type: application/json" --header "Authorization: Bearer <token>" --data '{ \\"model\\": \\"meta--llama3.1-70b-instruct\\", \\"messages\\": [ { \\"role\\": \\"user\\", \\"content\\": \\"What is the difference between Accountability vs Responsibility, answer in 200 words?\\" } ], \\"max_tokens\\": 100 }'
`,
    want: {
      format: null,
      baseUrl: null,
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "<token>",
      model: "meta--llama3.1-70b-instruct",
    },
  },
  "unsloth-studio.ps1": {
    text: `curl.exe http://127.0.0.1:8888/v1/chat/completions \`
  -H "Authorization: Bearer sk-unsloth-YOUR_KEY" \`
  -H "Content-Type: application/json" \`
  -d "@body.json"
`,
    want: {
      format: "openai_chat",
      baseUrl: "http://127.0.0.1:8888/v1",
      urlPlaceholder: null,
      apiKey: null,
      keyPlaceholder: "sk-unsloth-YOUR_KEY",
      model: null,
    },
  },
};

describe("curlOf: a curl command from a vendor's docs", () => {
  it.each(Object.entries(CURL_EXAMPLES))(
    "reads %s as its docs show it, with LF or CRLF",
    (_name, example) => {
      const { url: _url, ...got } = curlOf(example.text) ?? { url: "" };
      expect(got).toEqual(example.want);
      const { url: _crlfUrl, ...crlf } = curlOf(example.text.replace(/\n/g, "\r\n")) ?? { url: "" };
      expect(crlf).toEqual(example.want);
    },
  );

  it("takes a key of the user's own", () => {
    const own = curlOf(ANTHROPIC_CURL.replace("$ANTHROPIC_API_KEY", OWN_KEY));
    expect(own?.apiKey).toBe(OWN_KEY);
    expect(own?.keyPlaceholder).toBeNull();
  });

  it("takes the key from api-key and from a header written -Hvalue; a body read from a file has no model", () => {
    const got = curlOf(
      "curl https://relay.example.com/responses -H'api-key: sk-relay-123' --json @body.json",
    );
    expect(got).toMatchObject({
      format: "openai_responses",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-relay-123",
      model: null,
    });
  });

  it.each([
    "https://api.moonshot.cn/v1",
    "sk-a\nsk-b",
    "curly braces",
    "  ",
    "echo curl https://api.openai.com/v1/chat/completions",
  ])("%j is no curl command", (text) => {
    expect(curlOf(text)).toBeNull();
  });
});

describe("connection form: a pasted curl command", () => {
  it("the custom form takes the address, its format, the model, and says the key is only a placeholder", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setName("Kimi");
    const inputs: ConnectionCurlInputs[] = [];
    model.subscribeCurlInputs((next) => inputs.push(next));
    expect(model.pasteCurl(MOONSHOT_CURL)).toBe(true);
    let state = model.getState();
    expect(state.address).toBe("https://api.moonshot.cn/v1");
    expect(urlOf(model, "openai_chat")).toBe("https://api.moonshot.cn/v1");
    expect(state.apiKey).toBe("");
    // 地址框与「模型」框按通知改写自己；没取到 key，key 框获得焦点
    expect(inputs).toEqual([
      { address: "https://api.moonshot.cn/v1", modelIds: ["kimi-k3"], focusesKey: true },
    ]);
    expect(state.modelIds).toEqual(["kimi-k3"]);
    expect(state.curlNote).toEqual({
      filled: [
        { kind: "baseUrl", format: "openai_chat" },
        { kind: "model", model: "kimi-k3" },
      ],
      isEndpointUnknown: false,
      urlPlaceholder: null,
      keyPlaceholder: "$MOONSHOT_API_KEY",
    });

    // 再贴 Anthropic 的、带自己的 key：另一种格式的地址填上，前一种留着，模型累加
    expect(model.pasteCurl(ANTHROPIC_CURL.replace("$ANTHROPIC_API_KEY", OWN_KEY))).toBe(true);
    state = model.getState();
    expect(state.address).toBe("https://api.anthropic.com");
    expect(urlOf(model, "anthropic_messages")).toBe("https://api.anthropic.com");
    expect(urlOf(model, "openai_chat")).toBe("https://api.moonshot.cn/v1");
    expect(state.apiKey).toBe(OWN_KEY);
    expect(state.keyBoxValue).toBe(OWN_KEY);
    expect(state.keyBoxGeneration).toBe(1);
    expect(inputs[1]).toEqual({
      address: "https://api.anthropic.com",
      modelIds: ["kimi-k3", "claude-opus-5-5"],
      focusesKey: false,
    });
    expect(state.modelIds).toEqual(["kimi-k3", "claude-opus-5-5"]);
    expect(state.curlNote).toEqual({
      filled: [
        { kind: "baseUrl", format: "anthropic_messages" },
        { kind: "apiKey" },
        { kind: "model", model: "claude-opus-5-5" },
      ],
      isEndpointUnknown: false,
      urlPlaceholder: null,
      keyPlaceholder: null,
    });

    await model.submit();
    expect(fake.saves[0]).toMatchObject({
      name: "Kimi",
      apiKey: OWN_KEY,
      baseUrls: [
        { format: "anthropic_messages", url: "https://api.anthropic.com" },
        { format: "openai_chat", url: "https://api.moonshot.cn/v1" },
      ],
      models: [{ id: "kimi-k3" }, { id: "claude-opus-5-5" }],
      manualModels: [{ id: "kimi-k3" }, { id: "claude-opus-5-5" }],
      // 打了模型也跟随接口清单：它们记作手动添加，跟随时总在服务。
      modelScope: "vendor",
    });
  });

  it("the models taken can be edited as ids separated by commas; none left saves none", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setName("Kimi");
    model.pasteCurl(MOONSHOT_CURL);
    model.setModelIds("kimi-k3, kimi-k3-turbo,\n");
    expect(model.getState().modelIds).toEqual(["kimi-k3", "kimi-k3-turbo"]);
    model.setModelIds(" ");
    expect(model.getState().modelIds).toEqual([]);
    expect(model.getState().hasModelField).toBe(true);
    await model.submit();
    expect(fake.saves[0].models).toEqual([]);
    expect(fake.saves[0]).not.toHaveProperty("manualModels");
  });

  it("says when the URL ends in no known endpoint, and which placeholder is left in the address", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.pasteCurl(
      'curl.exe --location "<Deployment_url>/chat/completion" --header "Authorization: Bearer <token>"',
    );
    expect(model.getState().curlNote).toEqual({
      filled: [],
      isEndpointUnknown: true,
      urlPlaceholder: null,
      keyPlaceholder: "<token>",
    });
    expect(model.getState().address).toBe("");

    model.pasteCurl(
      'curl "https://{WorkspaceId}.maas.aliyuncs.com/compatible-mode/v1/chat/completions" -H "Authorization: Bearer sk-own"',
    );
    expect(model.getState().curlNote).toEqual({
      filled: [{ kind: "baseUrl", format: "openai_chat" }, { kind: "apiKey" }],
      isEndpointUnknown: false,
      urlPlaceholder: "{WorkspaceId}",
      keyPlaceholder: null,
    });
  });

  it("a template's form takes only the key, and says nothing of its address", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "zhipu" },
      fake.deps,
      WITH_TEMPLATES,
    );
    expect(
      model.pasteCurl(
        'curl https://api.example.com/{x}/chat/completions -H "Authorization: Bearer sk-zhipu" -d \'{"model":"glm-5.3"}\'',
      ),
    ).toBe(true);
    const state = model.getState();
    expect(state.apiKey).toBe("sk-zhipu");
    expect(urlOf(model, "openai_chat")).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(state.modelIds).toEqual([]);
    expect(state.curlNote).toEqual({
      filled: [{ kind: "apiKey" }],
      isEndpointUnknown: false,
      urlPlaceholder: null,
      keyPlaceholder: null,
    });
  });

  it("editing a custom endpoint takes the address and key but leaves its models alone", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.pasteCurl(MOONSHOT_CURL);
    expect(model.getState().curlNote?.filled).toEqual([{ kind: "baseUrl", format: "openai_chat" }]);
    expect(model.getState().hasModelField).toBe(false);
    await model.submit();
    expect(fake.saves[0].models).toEqual(SAVED_ENDPOINT.models);
    expect(fake.saves[0]).not.toHaveProperty("manualModels");
  });

  it("a duplicate of a custom endpoint adds the model to the original's, in its models and its manual ones", async () => {
    const fake = fakeDeps();
    const source: ApiEndpoint = { ...SAVED_ENDPOINT, manualModels: [{ id: "glm-4.6" }] };
    const model = createConnectionFormModel(
      { mode: "duplicate", source, name: "Relay copy" },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.pasteCurl(MOONSHOT_CURL);
    expect(model.getState().modelIds).toEqual(["kimi-k3"]);
    expect(model.getState().hasModelField).toBe(true);
    await model.submit();
    expect(fake.saves[0]).toMatchObject({
      copyOf: "ep_1",
      models: [{ id: "claude-sonnet-4-5" }, { id: "glm-4.6" }, { id: "kimi-k3" }],
      manualModels: [{ id: "glm-4.6" }, { id: "kimi-k3" }],
      modelMapping: { opus: "glm-4.6" },
    });
  });

  it("a curl command with nothing to take or tell shows no note", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "zhipu" },
      fake.deps,
      WITH_TEMPLATES,
    );
    expect(model.pasteCurl("curl https://example.com/v1/chat/completions")).toBe(true);
    expect(model.getState().curlNote).toBeNull();
  });

  it("text that isn't curl, or an old host, is pasted as before", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    expect(model.pasteCurl("https://api.moonshot.cn/v1")).toBe(false);
    expect(model.getState().curlNote).toBeNull();
    const oldHost = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
    expect(oldHost.pasteCurl(MOONSHOT_CURL)).toBe(false);
    expect(oldHost.getState().address).toBe("");
  });
});

describe("connection form: checking before saving", () => {
  function zhipuForm() {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: "zhipu" },
      fake.deps,
      WITH_TEMPLATES,
    );
    model.setApiKey("sk-zhipu");
    model.setRegion("coding");
    return { fake, model };
  }

  it("Auto-detect asks with the model typed to try, and shows each format's time and model", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setAddress("https://relay.example");
    model.setModelIds("kimi-k2, gpt-6");
    model.setDetectModel(" my-model ");
    model.detect();
    expect(fake.detects[0]?.request).toEqual({
      baseUrl: "https://relay.example",
      modelId: "my-model",
      modelIds: ["kimi-k2", "gpt-6"],
    });

    fake.answerDetect({
      status: "done",
      models: null,
      results: [
        {
          ...detection("openai_chat", "https://relay.example/v1", "ok"),
          durationMs: 412,
          modelId: "my-model",
        },
        { ...detection("a_future_format", "https://relay.example/x", "ok") },
      ],
    });
    await flush();
    expect(model.getState().detection?.results).toEqual([
      {
        format: "openai_chat",
        url: "https://relay.example/v1",
        label: "ok",
        httpStatus: 200,
        message: null,
        durationMs: 412,
        modelId: "my-model",
        reason: null,
      },
    ]);
  });

  it("when none answered without any key it says to paste one first", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setAddress("https://relay.example");
    model.detect();
    fake.answerDetect({
      status: "done",
      models: null,
      results: [detection("openai_chat", "https://relay.example/v1", "auth_failed", 401)],
    });
    await flush();
    expect(model.getState().detection).toMatchObject({ canTake: false, noneAnswered: "keyless" });
  });

  it("an old host gets no model to try, no Fetch models and no Test connection", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_REQUIRED,
    );
    model.setName("Relay");
    model.setApiKey("sk-1");
    model.setUrl("openai_chat", "https://relay.example/v1");
    model.setModelIds("kimi-k2");
    expect(model.getState()).toMatchObject({
      canCheckBeforeSave: false,
      canFetchModels: false,
      canTest: false,
      hasModelField: false,
    });
    model.fetchModels();
    model.testConnection();
    expect(fake.fetches).toEqual([]);
    expect(fake.tests).toEqual([]);
  });

  it("Fetch models asks once with every address of the form, its template and plan, and the daemon merges the lists", async () => {
    const { fake, model } = zhipuForm();
    expect(model.getState()).toMatchObject({ hasModelField: true, canFetchModels: true });

    model.fetchModels();
    expect(model.getState()).toMatchObject({
      catalogFetch: { status: "fetching" },
      canSubmit: false,
    });
    expect(fake.fetches).toHaveLength(1);
    expect(fake.fetches[0]?.request).toEqual({
      apiKey: "sk-zhipu",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      format: "anthropic_messages",
      baseUrls: [
        { format: "anthropic_messages", url: "https://open.bigmodel.cn/api/anthropic" },
        { format: "openai_chat", url: "https://open.bigmodel.cn/api/coding/paas/v4" },
        { format: "openai_responses", url: "https://open.bigmodel.cn/api/v1" },
      ],
      preview: true,
      templateId: "zhipu",
      region: "coding",
    });
    fake.answerFetch(0, {
      status: "done",
      models: [{ id: "glm-5.3", label: "GLM 5.3" }, { id: "glm-5" }],
    });
    await flush();
    expect(model.getState().catalogFetch).toEqual({
      status: "fetched",
      models: [{ id: "glm-5.3", label: "GLM 5.3" }, { id: "glm-5" }],
    });
  });

  it("models picked from the list go into Models, and the save carries the picks and the list", async () => {
    const { fake, model } = zhipuForm();
    model.fetchModels();
    fake.answerFetch(0, {
      status: "done",
      models: [{ id: "glm-5.3" }, { id: "glm-5" }, { id: "glm-4.6" }],
    });
    await flush();

    model.toggleModel("glm-5");
    model.pickModels(["glm-5.3", "glm-5"]);
    expect(model.getState()).toMatchObject({
      modelIds: ["glm-5", "glm-5.3"],
      modelIdsGeneration: 2,
    });
    model.toggleModel("glm-5");
    model.setModelIds("glm-5.3, my-own");
    model.unpickModels(["glm-5.3", "glm-5", "glm-4.6"]);
    expect(model.getState().modelIds).toEqual(["my-own"]);
    model.toggleModel("glm-4.6");

    await model.submit();
    expect(fake.saves[0]).toMatchObject({
      models: [{ id: "my-own" }, { id: "glm-4.6" }],
      catalog: [{ id: "glm-5.3" }, { id: "glm-5" }, { id: "glm-4.6" }],
      templateId: "zhipu",
      region: "coding",
    });
  });

  it("a failed fetch says why; a cancelled one goes back to nothing", async () => {
    const { fake, model } = zhipuForm();
    model.fetchModels();
    fake.answerFetch(0, { status: "failed", message: "HTTP 402" });
    await flush();
    expect(model.getState().catalogFetch).toEqual({ status: "failed", message: "HTTP 402" });

    model.fetchModels();
    model.cancelFetchModels();
    expect(fake.fetches[1]?.signal.aborted).toBe(true);
    fake.answerFetch(1, { status: "done", models: [{ id: "late" }] });
    await flush();
    expect(model.getState().catalogFetch).toEqual({ status: "idle" });
    await model.submit();
    expect(fake.saves[0]?.catalog).toBeUndefined();
  });

  it("Test connection asks every address with the form's template and models, each with its own result", async () => {
    const { fake, model } = zhipuForm();
    model.setModelIds("glm-5.3");
    model.testConnection();
    expect(model.getState()).toMatchObject({ isTesting: true, canTest: false });
    expect(fake.tests.map((entry) => entry.request)).toEqual(
      [
        ["anthropic_messages", "https://open.bigmodel.cn/api/anthropic"],
        ["openai_chat", "https://open.bigmodel.cn/api/coding/paas/v4"],
        ["openai_responses", "https://open.bigmodel.cn/api/v1"],
      ].map(([format, baseUrl]) => ({
        apiKey: "sk-zhipu",
        baseUrl,
        format,
        templateId: "zhipu",
        region: "coding",
        modelIds: ["glm-5.3"],
      })),
    );

    fake.answerTest(0, {
      status: "done",
      result: { ok: true, status: 200, durationMs: 830, error: null },
    });
    fake.answerTest(1, {
      status: "done",
      result: {
        ok: false,
        status: 401,
        durationMs: 120,
        error: { code: "auth_failed", message: "invalid key" },
      },
    });
    fake.answerTest(2, { status: "failed", message: "The host is offline" });
    await flush();
    expect(model.getState().tests).toEqual([
      {
        format: "anthropic_messages",
        url: "https://open.bigmodel.cn/api/anthropic",
        outcome: { kind: "ok", durationMs: 830 },
      },
      {
        format: "openai_chat",
        url: "https://open.bigmodel.cn/api/coding/paas/v4",
        outcome: { kind: "authFailed", status: 401, message: "invalid key" },
      },
      {
        format: "openai_responses",
        url: "https://open.bigmodel.cn/api/v1",
        outcome: { kind: "failed", status: null, message: "The host is offline" },
      },
    ]);
    expect(model.getState()).toMatchObject({ isTesting: false, keyRejected: true });

    model.setApiKey("sk-other");
    expect(model.getState()).toMatchObject({ tests: [], keyRejected: false });
  });

  it("a cancelled test drops its rows; a duplicate tests with the original's key and its models and list", async () => {
    const { fake, model } = zhipuForm();
    model.testConnection();
    model.cancelTest();
    expect(fake.tests.every((entry) => entry.signal.aborted)).toBe(true);
    fake.answerTest(0, {
      status: "done",
      result: { ok: true, status: 200, durationMs: 1, error: null },
    });
    await flush();
    expect(model.getState()).toMatchObject({ tests: [], isTesting: false });

    const copy = fakeDeps();
    const duplicate = createConnectionFormModel(
      {
        mode: "duplicate",
        source: {
          ...SAVED_ENDPOINT,
          catalog: {
            fetchedAt: "2026-10-01T00:00:00Z",
            models: [{ id: "glm-4.6" }, { id: "gpt-6" }],
          },
        },
        name: "Relay copy",
      },
      copy.deps,
      KEY_OPTIONAL,
    );
    duplicate.testConnection();
    expect(copy.tests[0]?.request).toEqual({
      endpointId: "ep_1",
      baseUrl: "https://relay.example",
      format: "anthropic_messages",
      modelIds: ["claude-sonnet-4-5", "glm-4.6", "gpt-6"],
    });
    duplicate.fetchModels();
    expect(copy.fetches[0]?.request).toEqual({
      endpointId: "ep_1",
      baseUrl: "https://relay.example",
      format: "anthropic_messages",
      baseUrls: [
        { format: "anthropic_messages", url: "https://relay.example" },
        { format: "openai_chat", url: "https://relay.example/v1" },
      ],
      preview: true,
    });
  });

  it("the edit window tests but does not fetch models", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_OPTIONAL,
    );
    expect(model.getState()).toMatchObject({
      canTest: true,
      canFetchModels: false,
      hasModelField: false,
    });
  });

  it("a changed address or key drops the list fetched and the test results, and stops those still running", async () => {
    const { fake, model } = zhipuForm();
    model.fetchModels();
    fake.answerFetch(0, { status: "done", models: [{ id: "glm-5" }] });
    await flush();
    model.testConnection();
    expect(model.getState().catalogFetch.status).toBe("fetched");

    model.setUrl("openai_chat", "https://open.bigmodel.cn/api/paas/v5");
    expect(model.getState()).toMatchObject({ catalogFetch: { status: "idle" }, tests: [] });
    expect(fake.tests.every((entry) => entry.signal.aborted)).toBe(true);

    model.fetchModels();
    model.setApiKey("sk-other");
    expect(fake.fetches[1]?.signal.aborted).toBe(true);
    expect(model.getState().catalogFetch).toEqual({ status: "idle" });
  });

  it("a test's failure names the status once and only the path past the address", async () => {
    const { fake, model } = zhipuForm();
    model.testConnection();
    fake.answerTest(2, {
      status: "done",
      result: {
        ok: false,
        status: 404,
        durationMs: 3,
        error: {
          code: "upstream_error",
          message: "POST https://open.bigmodel.cn/api/v1/responses: HTTP 404: Not Found",
        },
      },
    });
    await flush();
    expect(model.getState().tests.at(-1)?.outcome).toEqual({
      kind: "failed",
      status: 404,
      message: "HTTP 404: Not Found · /responses",
    });
  });
});

describe("conciseUpstreamMessage", () => {
  it("drops the address the row already shows and keeps other text as sent", () => {
    expect(
      conciseUpstreamMessage({
        message: "POST https://relay.example/v1/chat/completions: HTTP 500: busy",
        url: "https://relay.example/v1/",
      }),
    ).toBe("HTTP 500: busy · /chat/completions");
    expect(
      conciseUpstreamMessage({
        message: "POST https://other.example/x: connection refused",
        url: "https://relay.example/v1",
      }),
    ).toBe("connection refused · https://other.example/x");
    expect(
      conciseUpstreamMessage({ message: "No response within 30s", url: "https://relay.example" }),
    ).toBe("No response within 30s");
  });
});

// 接口管理好用性工单 15：自动检测后「只在 {格式} 上问 {模型}」（照 magpie Detect 的 Ask {model} on {api} only）。
describe("connection form: asking the detected model in one format only", () => {
  const API_FORMATS = ["anthropic_messages", "openai_chat", "openai_responses"];
  const PICKED_ONLY = [
    { ...detection("anthropic_messages", "https://relay.example", "ok"), modelId: "glm-4.6" },
    { ...detection("openai_chat", "https://relay.example/v1", "ok"), modelId: "glm-4.6" },
    {
      ...detection("openai_responses", "https://relay.example/v1", "not_detected"),
      modelId: "glm-4.6",
    },
  ];

  async function detectedOn(input: {
    endpoint?: ApiEndpoint;
    mode?: "edit" | "create";
    model: string;
    results: ApiEndpointFormatDetection[];
  }) {
    const fake = fakeDeps();
    const seed =
      input.mode === "create"
        ? ({ mode: "create", templateId: null } as const)
        : ({ mode: "edit", endpoint: input.endpoint ?? SAVED_ENDPOINT } as const);
    const model = createConnectionFormModel(seed, fake.deps, KEY_OPTIONAL);
    if (input.mode === "create") model.setAddress("https://relay.example");
    model.setDetectModel(input.model);
    model.detect();
    fake.answerDetect({ status: "done", results: input.results, models: null });
    await flush();
    return { fake, model };
  }

  it("offers each format that answered when only some did, and saves the one picked with the endpoint", async () => {
    const { fake, model } = await detectedOn({ model: " glm-4.6 ", results: PICKED_ONLY });
    expect(model.getState().detection?.onlyChoices).toEqual({
      modelId: "glm-4.6",
      formats: ["anthropic_messages", "openai_chat"],
      staged: null,
      isPending: false,
    });

    model.askOnlyOn("openai_chat");
    expect(model.getState().detection?.onlyChoices).toMatchObject({
      staged: "openai_chat",
      isPending: true,
    });
    await model.submit();
    expect(fake.saves[0]?.modelSettings).toEqual({
      models: { "glm-4.6": { format: "openai_chat" } },
    });
    expect(fake.saves[0]?.baseUrls).toEqual(SAVED_ENDPOINT.baseUrls);
  });

  it("picking the chosen format again takes it back, and a saved one can be taken away", async () => {
    const { model } = await detectedOn({ model: "glm-4.6", results: PICKED_ONLY });
    model.askOnlyOn("openai_chat");
    model.askOnlyOn("openai_chat");
    expect(model.getState().detection?.onlyChoices).toMatchObject({
      staged: null,
      isPending: false,
    });

    const endpoint: ApiEndpoint = {
      ...SAVED_ENDPOINT,
      modelSettings: { models: { "glm-4.6": { format: "openai_chat", name: "GLM" } } },
    };
    const saved = await detectedOn({ endpoint, model: "glm-4.6", results: PICKED_ONLY });
    saved.model.askOnlyOn("openai_chat");
    expect(saved.model.getState().detection?.onlyChoices).toMatchObject({
      staged: null,
      isPending: true,
    });
    await saved.model.submit();
    expect(saved.fake.saves[0]?.modelSettings).toEqual({ models: { "glm-4.6": { name: "GLM" } } });
  });

  it("takes the detected addresses when the endpoint has no address in that format yet", async () => {
    const results = [
      { ...detection("anthropic_messages", "https://relay.example", "not_detected") },
      { ...detection("openai_chat", "https://relay.example/v1", "not_detected") },
      { ...detection("openai_responses", "https://relay.example/v1", "ok"), modelId: "glm-4.6" },
    ];
    const { fake, model } = await detectedOn({ model: "glm-4.6", results });
    model.askOnlyOn("openai_responses");
    expect(model.getState().detection?.isTaken).toBe(true);
    await model.submit();
    expect(fake.saves[0]?.baseUrls).toContainEqual({
      format: "openai_responses",
      url: "https://relay.example/v1",
    });
    expect(fake.saves[0]?.modelSettings?.models?.["glm-4.6"]).toEqual({
      format: "openai_responses",
    });
  });

  it("keeps the model's other settings, and leaving the saved format chosen stages nothing", async () => {
    const endpoint: ApiEndpoint = {
      ...SAVED_ENDPOINT,
      modelSettings: {
        defaults: { upstreamName: "zhipu/*" },
        models: { "glm-4.6": { name: "GLM", format: "anthropic_messages" } },
      },
    };
    const { fake, model } = await detectedOn({ endpoint, model: "glm-4.6", results: PICKED_ONLY });
    expect(model.getState().detection?.onlyChoices?.staged).toBe("anthropic_messages");
    model.askOnlyOn("openai_chat");
    await model.submit();
    expect(fake.saves[0]?.modelSettings).toEqual({
      defaults: { upstreamName: "zhipu/*" },
      models: { "glm-4.6": { name: "GLM", format: "openai_chat" } },
    });

    const again = await detectedOn({ endpoint, model: "glm-4.6", results: PICKED_ONLY });
    again.model.askOnlyOn("openai_chat");
    again.model.askOnlyOn("anthropic_messages");
    await again.model.submit();
    expect(again.fake.saves[0]?.modelSettings).toBeUndefined();
  });

  it("a newly typed key is still sent with the endpoint, so the host asks under its upstream names", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setApiKey("sk-new");
    model.setDetectModel("glm-4.6");
    model.detect();
    expect(fake.detects[0]?.request).toEqual({
      endpointId: "ep_1",
      apiKey: "sk-new",
      baseUrl: "https://relay.example",
      modelId: "glm-4.6",
      modelIds: ["claude-sonnet-4-5", "glm-4.6"],
    });
    fake.answerDetect({ status: "done", results: PICKED_ONLY, models: null });
    await flush();
    model.testConnection();
    expect(fake.tests[0]?.request).toMatchObject({ endpointId: "ep_1", apiKey: "sk-new" });
  });

  it("is not offered when adding, for a model the endpoint lacks, with no model typed, or when every format answered", async () => {
    const adding = await detectedOn({ mode: "create", model: "glm-4.6", results: PICKED_ONLY });
    expect(adding.model.getState().detection?.onlyChoices).toBeNull();
    const unknown = await detectedOn({ model: "kimi-k2", results: PICKED_ONLY });
    expect(unknown.model.getState().detection?.onlyChoices).toBeNull();
    const untyped = await detectedOn({ model: "", results: PICKED_ONLY });
    expect(untyped.model.getState().detection?.onlyChoices).toBeNull();
    const all = API_FORMATS.map((format) =>
      Object.assign(detection(format, "https://relay.example", "ok"), { modelId: "glm-4.6" }),
    );
    const everywhere = await detectedOn({ model: "glm-4.6", results: all });
    expect(everywhere.model.getState().detection?.onlyChoices).toBeNull();
  });
});

function labelsByModel(rows: { modelId: string; cells: { label: string }[] }[] | null | undefined) {
  return (rows ?? []).map((row) => [row.modelId, row.cells.map((cell) => cell.label)]);
}

// 接口管理好用性工单 21：自动识别「逐个模型」（照 magpie Detect 的 Each picked model）。
describe("connection form: detecting each picked model", () => {
  function cell(input: {
    format: string;
    url: string;
    modelId: string;
    isOk: boolean;
  }): ApiEndpointFormatDetection {
    const { format, url, modelId, isOk } = input;
    return {
      format,
      url,
      status: isOk ? "ok" : "not_detected",
      httpStatus: isOk ? 200 : 400,
      message: isOk ? null : `POST ${url}/x: HTTP 400: model ${modelId} not supported`,
      durationMs: 120,
      modelId,
    };
  }

  // 按 Anthropic、Chat、Responses 答没答上。
  function modelRow(modelId: string, answers: [boolean, boolean, boolean]) {
    const urls = ["https://relay.example", "https://relay.example/v1", "https://relay.example/v1"];
    const formats = ["anthropic_messages", "openai_chat", "openai_responses"];
    return {
      modelId,
      results: formats.map((format, index) =>
        cell({ format, url: urls[index] ?? "", modelId, isOk: answers[index] === true }),
      ),
    };
  }

  const EACH_ROWS = [
    modelRow("claude-sonnet-4-5", [true, true, false]),
    modelRow("glm-4.6", [false, true, false]),
  ];
  const EACH_SUMMARY = [
    cell({
      format: "anthropic_messages",
      url: "https://relay.example",
      modelId: "claude-sonnet-4-5",
      isOk: true,
    }),
    cell({
      format: "openai_chat",
      url: "https://relay.example/v1",
      modelId: "claude-sonnet-4-5",
      isOk: true,
    }),
    cell({
      format: "openai_responses",
      url: "https://relay.example/v1",
      modelId: "claude-sonnet-4-5",
      isOk: false,
    }),
  ];

  it("asks the endpoint's picked models on every format and shows them model by model", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_OPTIONAL,
    );
    expect(model.getState().canDetectEach).toBe(true);
    model.detectEachModel();
    expect(model.getState()).toMatchObject({ detecting: true, canDetectEach: false });
    expect(fake.detects[0]?.request).toEqual({
      endpointId: "ep_1",
      baseUrl: "https://relay.example",
      modelIds: ["claude-sonnet-4-5", "glm-4.6"],
      eachModel: true,
    });

    fake.answerDetect({ status: "done", results: EACH_SUMMARY, models: EACH_ROWS });
    await flush();
    const detected = model.getState().detection;
    expect(detected?.results.map((result) => result.label)).toEqual(["ok", "ok", "not_detected"]);
    expect(labelsByModel(detected?.byModel)).toEqual([
      ["claude-sonnet-4-5", ["ok", "ok", "not_detected"]],
      ["glm-4.6", ["not_detected", "ok", "not_detected"]],
    ]);
    expect(detected?.byModel?.[1]?.cells[0]).toMatchObject({
      durationMs: 120,
      message: "HTTP 400: model glm-4.6 not supported · /x",
    });
    // 只在一种格式上答上的才给「只用这种格式」；试了一个模型的那排按钮这时没有。
    expect(detected?.singleFormatPins).toEqual([{ modelId: "glm-4.6", format: "openai_chat" }]);
    expect(detected?.onlyChoices).toBeNull();
    expect(detected?.askedOnlyFirst).toBeNull();
  });

  it("Use these fills the addresses and makes each model that answered on one format only use it, with the save", async () => {
    const endpoint: ApiEndpoint = {
      ...SAVED_ENDPOINT,
      baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
      modelSettings: { models: { "glm-4.6": { name: "GLM" } } },
    };
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "edit", endpoint }, fake.deps, KEY_OPTIONAL);
    model.detectEachModel();
    fake.answerDetect({ status: "done", results: EACH_SUMMARY, models: EACH_ROWS });
    await flush();

    model.takeDetected();
    expect(model.getState().detection).toMatchObject({ isTaken: true, canTake: false });
    await model.submit();
    expect(fake.saves[0]?.baseUrls).toEqual([
      { format: "anthropic_messages", url: "https://relay.example" },
      { format: "openai_chat", url: "https://relay.example/v1" },
    ]);
    expect(fake.saves[0]?.modelSettings).toEqual({
      models: { "glm-4.6": { name: "GLM", format: "openai_chat" } },
    });
  });

  it("a model already using that format only stages nothing", async () => {
    const endpoint: ApiEndpoint = {
      ...SAVED_ENDPOINT,
      modelSettings: { models: { "glm-4.6": { format: "openai_chat" } } },
    };
    const fake = fakeDeps();
    const model = createConnectionFormModel({ mode: "edit", endpoint }, fake.deps, KEY_OPTIONAL);
    model.detectEachModel();
    fake.answerDetect({ status: "done", results: EACH_SUMMARY, models: EACH_ROWS });
    await flush();
    model.takeDetected();
    await model.submit();
    expect(fake.saves[0]?.modelSettings).toBeUndefined();
  });

  it("a new endpoint asks the models typed in, says when only the first were asked, and gives no model a format", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setName("Relay");
    model.setAddress("https://relay.example");
    const typed = Array.from({ length: 32 }, (_, index) => `m-${index}`);
    model.setModelIds(typed.join(", "));
    model.detectEachModel();
    expect(fake.detects[0]?.request).toEqual({
      baseUrl: "https://relay.example",
      modelIds: typed,
      eachModel: true,
    });
    const rows = typed.slice(0, 30).map((id) => modelRow(id, [false, true, false]));
    fake.answerDetect({ status: "done", results: EACH_SUMMARY, models: rows });
    await flush();
    expect(model.getState().detection).toMatchObject({
      askedOnlyFirst: { asked: 30, picked: 32 },
      singleFormatPins: [],
    });
  });

  it("with no model picked it says to pick some first and asks nothing", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "create", templateId: null },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.setName("Relay");
    model.setAddress("https://relay.example");
    model.detectEachModel();
    expect(fake.detects).toEqual([]);
    expect(model.getState()).toMatchObject({ eachNeedsModels: true, detecting: false });
    model.setModelIds("glm-4.6");
    expect(model.getState().eachNeedsModels).toBe(false);
  });

  it("a detection that failed says why, and one can be cancelled", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.detectEachModel();
    fake.answerDetect({ status: "failed", message: "No model to try: pick the models first" });
    await flush();
    expect(model.getState()).toMatchObject({
      detecting: false,
      detectError: "No model to try: pick the models first",
      detection: null,
    });

    model.detectEachModel();
    model.cancelDetect();
    expect(fake.detects[1]?.signal.aborted).toBe(true);
    expect(model.getState()).toMatchObject({ detecting: false, detection: null });
  });

  it("keeps the host's own reasons as codes to be said in the app's language", async () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_OPTIONAL,
    );
    model.detectEachModel();
    const coded = (format: string, code: string, params?: Record<string, string>) => ({
      ...cell({ format, url: "https://relay.example", modelId: "slow", isOk: false }),
      httpStatus: null,
      message: "English from the host",
      code,
      ...(params ? { params } : {}),
    });
    const row = {
      modelId: "slow",
      results: [
        coded("anthropic_messages", "upstream_timeout", { seconds: "12" }),
        coded("openai_chat", "not_asked"),
        coded("openai_responses", "something_new"),
        coded("openai_chat", "wrong_shape", { format: "openai_chat" }),
        coded("openai_chat", "upstream_unreachable", { detail: "fetch failed" }),
      ],
    };
    fake.answerDetect({ status: "done", results: row.results, models: [row] });
    await flush();
    const reasons = model.getState().detection?.byModel?.[0]?.cells.map((c) => c.reason);
    expect(reasons).toEqual([
      { code: "upstream_timeout", seconds: "12" },
      { code: "not_asked" },
      null,
      { code: "wrong_shape", format: "openai_chat" },
      { code: "upstream_unreachable", detail: "fetch failed" },
    ]);
  });

  it("a host without the capability has no Each picked model", () => {
    const fake = fakeDeps();
    const model = createConnectionFormModel(
      { mode: "edit", endpoint: SAVED_ENDPOINT },
      fake.deps,
      KEY_REQUIRED,
    );
    expect(model.getState().canDetectEach).toBe(false);
    model.detectEachModel();
    expect(fake.detects).toEqual([]);
  });
});
