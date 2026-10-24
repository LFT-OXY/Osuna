import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  applyOmpConfig,
  applyOmpModels,
  inspectOmpConfig,
  inspectOmpModels,
  migrateOmpModelsJson,
  readOmpCliPicks,
  restoreOmpConfig,
  restoreOmpModels,
  type OmpProviderBlock,
} from "./omp-config-patch.js";
import { ompModelEntry, ompTakesMax } from "./omp-model-entries.js";
import type { PiModelsTakeover, PiSettingsTakeover } from "./pi-config-patch.js";
import type { PiModelSource } from "./pi-model-entries.js";

/*
 * OMP 的 models.yml 与 config.yml 补丁（任务 10-16-pi-omp-endpoints 工单 04），与 Pi、Claude Code、Codex 的配置改写套件并列：
 * 按 YAML 节点改，注释与列表写法不动；思考写成 thinking、旧版 OMP 的 max 降为 xhigh；旧 models.json 先迁移；关掉时放回。
 */

const GATEWAY = "http://127.0.0.1:6767/api-endpoint-gateway";

const BLOCK: OmpProviderBlock = {
  baseUrl: `${GATEWAY}/v1`,
  api: "openai-completions",
  auth: "apiKey",
  apiKey: "gw-token-omp",
  compat: { promptCacheSessionHeader: "x-session-affinity" },
  models: [{ id: "glm-5", name: "GLM 5", reasoning: false }],
};

// 用户手写的 models.yml：注释、flow 写法的列表、另一家服务商。
const USER_MODELS = `# my providers
providers:
  ollama: # local
    baseUrl: http://localhost:11434/v1
    api: openai-completions
    models: [{id: llama3}]
`;

const USER_CONFIG = `# omp settings
modelRoles:
  default: anthropic/claude-sonnet-4-5 # main model
  smol: [anthropic/claude-haiku-4-5]
enabledModels:
  - anthropic/claude-sonnet-4-5
  - openai/gpt-5
theme: dark
`;

function models(text: string | null, takeover: PiModelsTakeover | null = null, block = BLOCK) {
  const result = applyOmpModels({ text, block, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

interface ConfigCall {
  text: string | null;
  model: string;
  thinking?: string | null;
  takeover?: PiSettingsTakeover | null;
}

function config(call: ConfigCall) {
  const result = applyOmpConfig({
    text: call.text,
    wiring: { model: call.model, thinking: call.thinking ?? null },
    takeover: call.takeover ?? null,
    shouldRewriteModel: false,
  });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

function source(input: Partial<PiModelSource> & Pick<PiModelSource, "id">): PiModelSource {
  return { name: input.id, facts: {}, format: "openai_chat", cost: null, ...input };
}

describe("OMP models.yml", () => {
  it("adds providers.osuna beside the user's providers, keeping their comments and flow lists", () => {
    const { text } = models(USER_MODELS);
    expect(text).toBe(`# my providers
providers:
  ollama: # local
    baseUrl: http://localhost:11434/v1
    api: openai-completions
    models: [{id: llama3}]
  osuna:
    baseUrl: ${GATEWAY}/v1
    api: openai-completions
    auth: apiKey
    apiKey: gw-token-omp
    compat:
      promptCacheSessionHeader: x-session-affinity
    models:
      - id: glm-5
        name: GLM 5
        reasoning: false
`);
    expect(text).not.toContain("User-Agent");
  });

  it("keeps what the user wrote in providers.osuna, replacing the address, format, auth, key and models", () => {
    const own = `providers:
  osuna:
    baseUrl: http://elsewhere/v1
    auth: none
    headers:
      X-Team: core
    compat:
      supportsStore: false
    modelOverrides:
      glm-5:
        contextWindow: 1000
    discovery:
      type: openai-models-list
    disableStrictTools: true
    remoteCompaction:
      model: glm-5
    models:
      - id: old
`;
    const osuna = parse(models(own).text).providers.osuna;
    expect(osuna).toEqual({
      baseUrl: `${GATEWAY}/v1`,
      api: "openai-completions",
      auth: "apiKey",
      apiKey: "gw-token-omp",
      headers: { "X-Team": "core" },
      compat: { supportsStore: false, promptCacheSessionHeader: "x-session-affinity" },
      modelOverrides: { "glm-5": { contextWindow: 1000 } },
      discovery: { type: "openai-models-list" },
      disableStrictTools: true,
      remoteCompaction: { model: "glm-5" },
      models: BLOCK.models,
    });
  });

  it("restores the file byte for byte and drops providers it created", () => {
    const first = models(USER_MODELS);
    const restored = restoreOmpModels({
      text: first.text,
      takeover: first.takeover,
      configAfter: null,
    });
    expect(restored).toEqual({ kind: "patched", text: USER_MODELS });

    const fresh = models(null);
    expect(
      restoreOmpModels({ text: fresh.text, takeover: fresh.takeover, configAfter: null }),
    ).toEqual({ kind: "delete" });
  });

  it("keeps Osuna's provider while another role or a fallback chain still names osuna/", () => {
    const first = models(USER_MODELS);
    const configAfter = `modelRoles:
  slow: osuna/glm-5:high
`;
    expect(restoreOmpModels({ text: first.text, takeover: first.takeover, configAfter })).toEqual({
      kind: "kept",
    });
    const chain = `retry:
  fallbackChains:
    default: [anthropic/claude-sonnet-4-5, osuna/glm-5]
`;
    expect(
      restoreOmpModels({ text: first.text, takeover: first.takeover, configAfter: chain }),
    ).toEqual({ kind: "kept" });
    // 只是平铺在 enabledModels 里的 osuna/ 条目跟着服务商走。
    const plain = `enabledModels: [osuna/glm-5]\n`;
    expect(
      restoreOmpModels({ text: first.text, takeover: first.takeover, configAfter: plain }),
    ).toEqual({ kind: "patched", text: USER_MODELS });
  });

  it("reports the address changed outside Osuna, and names the file when it can't read it", () => {
    const first = models(USER_MODELS);
    const moved = first.text.replace(`${GATEWAY}/v1`, "http://elsewhere/v1");
    expect(inspectOmpModels({ text: moved, takeover: first.takeover })).toEqual({
      kind: "parsed",
      modifiedKeys: ["providers.osuna"],
    });
    expect(applyOmpModels({ text: "providers: [a\n", block: BLOCK, takeover: null })).toMatchObject(
      { kind: "unparsable", reason: { code: "syntax", line: 2 } },
    );
    expect(applyOmpModels({ text: "providers: 3\n", block: BLOCK, takeover: null })).toEqual({
      kind: "unparsable",
      message: '"providers" in models.yml is not a mapping',
      reason: { code: "key_not_object", key: "providers" },
    });
  });

  it("carries an older models.json over to YAML the way OMP does", () => {
    const migrated = migrateOmpModelsJson(`{
  // comment
  "providers": { "ollama": { "baseUrl": "http://localhost:11434/v1", "models": [{ "id": "llama3" }] } },
}`);
    expect(migrated).toEqual({
      kind: "migrated",
      text: `providers:
  ollama:
    baseUrl: http://localhost:11434/v1
    models:
      - id: llama3
`,
    });
    expect(migrateOmpModelsJson("[1]")).toMatchObject({
      kind: "unparsable",
      reason: { code: "root_not_object" },
    });
  });
});

describe("OMP model entries", () => {
  const context = { gatewayRoot: GATEWAY, takesMax: true };

  it("writes thinking as effort on Chat, budget on Anthropic, adaptive for a Claude that only thinks adaptively", () => {
    const efforts = ["low", "medium", "high", "max"];
    expect(
      ompModelEntry(source({ id: "glm-5", facts: { efforts, context: 200000 } }), context),
    ).toEqual({
      id: "glm-5",
      name: "glm-5",
      reasoning: true,
      thinking: { mode: "effort", efforts: ["low", "medium", "high", "max"] },
      contextWindow: 200000,
    });
    expect(
      ompModelEntry(
        source({
          id: "claude-sonnet-4-5",
          format: "anthropic_messages",
          facts: { efforts: ["low", "high"] },
        }),
        context,
      ),
    ).toEqual({
      id: "claude-sonnet-4-5",
      name: "claude-sonnet-4-5",
      api: "anthropic-messages",
      baseUrl: GATEWAY,
      reasoning: true,
      thinking: { mode: "budget", efforts: ["low", "high"] },
    });
    expect(
      ompModelEntry(
        source({
          id: "claude-opus-5-5",
          format: "anthropic_messages",
          facts: { efforts: ["high"] },
        }),
        context,
      ).thinking,
    ).toEqual({ mode: "anthropic-adaptive", efforts: ["high"] });
    expect(
      ompModelEntry(
        source({ id: "gpt-5", format: "openai_responses", facts: { images: false } }),
        context,
      ),
    ).toEqual({
      id: "gpt-5",
      name: "gpt-5",
      api: "openai-responses",
      reasoning: false,
      input: ["text"],
    });
  });

  it("offers xhigh in place of max to an OMP older than 16.4.0 or of unknown version", () => {
    expect(ompTakesMax("16.3.9")).toBe(false);
    expect(ompTakesMax(null)).toBe(false);
    expect(ompTakesMax("16.4.0")).toBe(true);
    expect(ompTakesMax("18.12.6")).toBe(true);
    const old = { gatewayRoot: GATEWAY, takesMax: false };
    expect(
      ompModelEntry(source({ id: "m", facts: { efforts: ["high", "max"] } }), old).thinking,
    ).toEqual({
      mode: "effort",
      efforts: ["high", "xhigh"],
    });
  });
});

describe("OMP config.yml", () => {
  it("points the default role at Osuna and moves it to the front of enabledModels, keeping the rest as written", () => {
    const { text } = config({ text: USER_CONFIG, model: "relay/glm-5", thinking: "xhigh" });
    expect(text).toBe(`# omp settings
modelRoles:
  default: osuna/relay/glm-5 # main model
  smol: [anthropic/claude-haiku-4-5]
enabledModels:
  - osuna/relay/glm-5
  - anthropic/claude-sonnet-4-5
  - openai/gpt-5
theme: dark
defaultThinkingLevel: xhigh
`);
  });

  it("carries the role's thinking level to the new model, as magpie does", () => {
    const { text } = config({ text: "modelRoles:\n  default: anthropic/x:high\n", model: "glm-5" });
    expect(parse(text).modelRoles.default).toBe("osuna/glm-5:high");
  });

  it("puts every key back on switch off, keeping the default role the user changed in OMP", () => {
    const first = config({ text: USER_CONFIG, model: "relay/glm-5", thinking: "xhigh" });
    expect(restoreOmpConfig({ text: first.text, takeover: first.takeover })).toEqual({
      kind: "patched",
      text: USER_CONFIG,
    });

    const changed = first.text.replace("default: osuna/relay/glm-5", "default: openai/gpt-5");
    expect(inspectOmpConfig({ text: changed, takeover: first.takeover })).toEqual({
      kind: "parsed",
      modifiedKeys: ["modelRoles.default"],
    });
    const restored = restoreOmpConfig({ text: changed, takeover: first.takeover });
    if (restored.kind !== "patched") throw new Error(`Expected a patch, got ${restored.kind}`);
    expect(parse(restored.text)).toEqual({
      modelRoles: { default: "openai/gpt-5", smol: ["anthropic/claude-haiku-4-5"] },
      enabledModels: ["anthropic/claude-sonnet-4-5", "openai/gpt-5"],
      theme: "dark",
    });
  });

  it("removes modelRoles and the list it emptied, and deletes a file it created", () => {
    const first = config({ text: "enabledModels: [osuna/relay/glm-5]\n", model: "relay/glm-5" });
    expect(first.text).toBe(
      "enabledModels: [osuna/relay/glm-5]\nmodelRoles:\n  default: osuna/relay/glm-5\n",
    );
    // 接管前就有的 osuna/ 条目是用户的，留着。
    expect(restoreOmpConfig({ text: first.text, takeover: first.takeover })).toEqual({
      kind: "patched",
      text: "enabledModels: [osuna/relay/glm-5]\n",
    });
    const fresh = config({ text: null, model: "glm-5" });
    expect(restoreOmpConfig({ text: fresh.text, takeover: fresh.takeover })).toEqual({
      kind: "delete",
    });
  });

  it("follows the default role OMP saved, without its thinking level", () => {
    const first = config({ text: "modelRoles:\n  default: anthropic/x\n", model: "relay/glm-5" });
    const changed = first.text.replace("default: osuna/relay/glm-5", "default: osuna/kimi-k2:low");
    expect(readOmpCliPicks({ text: changed, takeover: first.takeover })?.model).toEqual({
      now: "osuna/kimi-k2",
      isKept: false,
    });
  });
});
