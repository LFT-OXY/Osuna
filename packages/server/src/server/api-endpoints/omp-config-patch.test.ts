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
import type { PiLikeRoleWiring, PiModelsTakeover, PiSettingsTakeover } from "./pi-config-patch.js";
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
  roles?: PiLikeRoleWiring[];
  takeover?: PiSettingsTakeover | null;
}

function config(call: ConfigCall) {
  const result = applyOmpConfig({
    text: call.text,
    wiring: { model: call.model, thinking: call.thinking ?? null, roles: call.roles ?? [] },
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
      block: BLOCK,
    });
    expect(restored).toEqual({ kind: "patched", text: USER_MODELS });

    const fresh = models(null);
    expect(
      restoreOmpModels({
        text: fresh.text,
        takeover: fresh.takeover,
        configAfter: null,
        block: BLOCK,
      }),
    ).toEqual({ kind: "delete" });
  });

  it("keeps Osuna's provider while another role or a fallback chain still names osuna/, writing its wiring afresh", () => {
    const first = models(USER_MODELS);
    // 留下来的接线指错了地方：照 magpie dropMagpie 的 writeMagpie 重写一遍。
    const stale = first.text.replace(`${GATEWAY}/v1`, "http://127.0.0.1:1/api-endpoint-gateway/v1");
    const configAfter = `modelRoles:
  slow: osuna/glm-5:high
`;
    expect(
      restoreOmpModels({ text: stale, takeover: first.takeover, configAfter, block: BLOCK }),
    ).toEqual({ kind: "kept", text: first.text });
    const chain = `retry:
  fallbackChains:
    default: [anthropic/claude-sonnet-4-5, osuna/glm-5]
`;
    expect(
      restoreOmpModels({
        text: first.text,
        takeover: first.takeover,
        configAfter: chain,
        block: BLOCK,
      }),
    ).toEqual({ kind: "kept", text: first.text });
    // 只是平铺在 enabledModels 里的 osuna/ 条目跟着服务商走。
    const plain = `enabledModels: [osuna/glm-5, osuna/**]\n`;
    expect(
      restoreOmpModels({
        text: first.text,
        takeover: first.takeover,
        configAfter: plain,
        block: BLOCK,
      }),
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
  - osuna/**
theme: dark
defaultThinkingLevel: xhigh
`);
  });

  it("adds osuna/** once, and not where the user already chose which of Osuna's models the list takes", () => {
    const first = config({ text: USER_CONFIG, model: "relay/glm-5" });
    const second = config({ text: first.text, model: "kimi-k2", takeover: first.takeover });
    expect(parse(second.text).enabledModels).toEqual([
      "osuna/kimi-k2",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
      "osuna/**",
    ]);
    const own = config({
      text: "enabledModels: [openai/gpt-5, osuna/relay/*]\n",
      model: "relay/glm-5",
    });
    expect(parse(own.text).enabledModels).toEqual([
      "osuna/relay/glm-5",
      "openai/gpt-5",
      "osuna/relay/*",
    ]);
    const levelled = config({
      text: "enabledModels: [openai/gpt-5, osuna/kimi-k2:high]\n",
      model: "glm-5",
    });
    expect(parse(levelled.text).enabledModels).toEqual([
      "osuna/glm-5",
      "openai/gpt-5",
      "osuna/kimi-k2:high",
    ]);
  });

  it("leaves enabledModels' osuna/ entries on switch off while another role still names osuna/", () => {
    const first = config({ text: USER_CONFIG, model: "relay/glm-5" });
    const withSlow = first.text.replace("  smol:", "  slow: osuna/kimi-k2\n  smol:");
    const restored = restoreOmpConfig({ text: withSlow, takeover: first.takeover });
    if (restored.kind !== "patched") throw new Error(`Expected a patch, got ${restored.kind}`);
    expect(parse(restored.text)).toMatchObject({
      modelRoles: { default: "anthropic/claude-sonnet-4-5", slow: "osuna/kimi-k2" },
      enabledModels: [
        "osuna/relay/glm-5",
        "anthropic/claude-sonnet-4-5",
        "openai/gpt-5",
        "osuna/**",
      ],
    });
  });

  it("keeps the role's thinking level when the same model is written again", () => {
    const first = config({ text: "modelRoles:\n  default: anthropic/x:high\n", model: "glm-5" });
    const again = config({
      text: first.text,
      model: "glm-5",
      thinking: "low",
      takeover: first.takeover,
    });
    expect(parse(again.text).modelRoles.default).toBe("osuna/glm-5:high");
    const third = config({ text: again.text, model: "glm-5", takeover: again.takeover });
    expect(parse(third.text).modelRoles.default).toBe("osuna/glm-5:high");
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
      "enabledModels: [osuna/relay/glm-5, osuna/**]\nmodelRoles:\n  default: osuna/relay/glm-5\n",
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

  it("writes a role set in Osuna as osuna/<model>:<level>, leaving the roles it wasn't given to OMP", () => {
    const { text } = config({
      text: USER_CONFIG,
      model: "relay/glm-5",
      roles: [
        { role: "slow", model: "relay/glm-5", thinking: "high" },
        { role: "task", model: "kimi-k2", thinking: null },
      ],
    });
    expect(parse(text).modelRoles).toEqual({
      default: "osuna/relay/glm-5",
      smol: ["anthropic/claude-haiku-4-5"],
      slow: "osuna/relay/glm-5:high",
      task: "osuna/kimi-k2",
    });
  });

  it("puts back what a role had when it is cleared or on switch off, keeping one the user changed in OMP", () => {
    const first = config({
      text: USER_CONFIG,
      model: "relay/glm-5",
      roles: [
        { role: "smol", model: "kimi-k2", thinking: "low" },
        { role: "plan", model: "glm-5", thinking: null },
      ],
    });
    expect(parse(first.text).modelRoles).toMatchObject({
      smol: "osuna/kimi-k2:low",
      plan: "osuna/glm-5",
    });
    const cleared = config({
      text: first.text,
      model: "relay/glm-5",
      roles: [{ role: "plan", model: "glm-5", thinking: null }],
      takeover: first.takeover,
    });
    expect(parse(cleared.text).modelRoles).toEqual({
      default: "osuna/relay/glm-5",
      smol: ["anthropic/claude-haiku-4-5"],
      plan: "osuna/glm-5",
    });
    expect(cleared.text).toContain("  smol: [anthropic/claude-haiku-4-5]\n");

    expect(restoreOmpConfig({ text: first.text, takeover: first.takeover })).toEqual({
      kind: "patched",
      text: USER_CONFIG,
    });
    const userPlan = first.text.replace("plan: osuna/glm-5", "plan: openai/gpt-5");
    const restored = restoreOmpConfig({ text: userPlan, takeover: first.takeover });
    if (restored.kind !== "patched") throw new Error(`Expected a patch, got ${restored.kind}`);
    expect(parse(restored.text).modelRoles).toEqual({
      default: "anthropic/claude-sonnet-4-5",
      smol: ["anthropic/claude-haiku-4-5"],
      plan: "openai/gpt-5",
    });
  });

  it("leaves a role the user moved off Osuna in OMP when Osuna clears it", () => {
    const first = config({
      text: null,
      model: "glm-5",
      roles: [{ role: "vision", model: "glm-5", thinking: null }],
    });
    const moved = first.text.replace("vision: osuna/glm-5", "vision: openai/gpt-5");
    const cleared = config({ text: moved, model: "glm-5", takeover: first.takeover });
    expect(parse(cleared.text).modelRoles.vision).toBe("openai/gpt-5");
    expect(cleared.takeover.keys["modelRoles.vision"]).toBeUndefined();
  });

  it("reports a role OMP saved on another of Osuna's models, with its level, and one moved off Osuna", () => {
    const first = config({
      text: null,
      model: "glm-5",
      roles: [
        { role: "slow", model: "glm-5", thinking: null },
        { role: "tiny", model: "glm-5", thinking: null },
        { role: "memory", model: "glm-5", thinking: null },
      ],
    });
    const changed = first.text
      .replace("slow: osuna/glm-5", "slow: osuna/relay/kimi-k2:xhigh")
      .replace("tiny: osuna/glm-5", "tiny: openai/gpt-5")
      .replace("  memory: osuna/glm-5\n", "");
    expect(readOmpCliPicks({ text: changed, takeover: first.takeover })?.roles).toEqual({
      slow: { now: "osuna/relay/kimi-k2", level: "xhigh" },
      tiny: { now: "openai/gpt-5", level: null },
      memory: { now: null, level: null },
    });
  });
});
