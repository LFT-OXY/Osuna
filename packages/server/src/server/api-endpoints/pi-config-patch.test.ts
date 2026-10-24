import { describe, expect, it } from "vitest";
import {
  applyPiModels,
  applyPiSettings,
  inspectPiModels,
  inspectPiSettings,
  keepPiCliModel,
  readPiCliPicks,
  readPiModel,
  restorePiModels,
  restorePiSettings,
  type PiModelsTakeover,
  type PiProviderBlock,
  type PiSettingsTakeover,
  type PiSettingsWiring,
} from "./pi-config-patch.js";

/*
 * Pi 的 models.json 与 settings.json 补丁（任务 10-16-pi-omp-endpoints 工单 02），与 Claude Code、Codex 的配置改写套件并列：
 * 只动 providers.osuna、defaultProvider、defaultModel，其余字节与注释不动；关掉时放回原值。
 */

const BLOCK: PiProviderBlock = {
  baseUrl: "http://127.0.0.1:6767/api-endpoint-gateway/v1",
  api: "openai-completions",
  apiKey: "gw-token-pi",
  compat: { sendSessionAffinityHeaders: true },
  models: [{ id: "glm-5", name: "GLM 5", reasoning: false }],
};

// Pi 自己写的 models.json 带注释（Pi 读时会去掉），用户另有一家服务商。
const USER_MODELS = `{
  // my local ollama
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "llama3" }]
    }
  }
}
`;

const USER_SETTINGS = `{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "theme": "dark"
}
`;

function models(text: string | null, takeover: PiModelsTakeover | null = null, block = BLOCK) {
  const result = applyPiModels({ text, block, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

function settings(
  text: string | null,
  wiring: string | PiSettingsWiring,
  takeover: PiSettingsTakeover | null = null,
  shouldRewriteModel = false,
) {
  const shaped = typeof wiring === "string" ? { model: wiring, thinking: null } : wiring;
  const result = applyPiSettings({ text, wiring: shaped, takeover, shouldRewriteModel });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

describe("Pi models.json", () => {
  it("adds providers.osuna beside the user's providers and keeps their comment", () => {
    const { text } = models(USER_MODELS);
    expect(text).toContain("// my local ollama");
    const parsed = JSON.parse(text.replace(/\/\/.*\n/, "\n")) as {
      providers: Record<string, unknown>;
    };
    expect(Object.keys(parsed.providers)).toEqual(["ollama", "osuna"]);
    expect(parsed.providers.osuna).toEqual(BLOCK);
  });

  it("restores the file byte for byte when the switch goes off", () => {
    const { text, takeover } = models(USER_MODELS);
    const restored = restorePiModels({ text, takeover });
    expect(restored).toEqual({ kind: "patched", text: USER_MODELS });
  });

  it("deletes a models.json that did not exist before", () => {
    const { text, takeover } = models(null);
    expect(JSON.parse(text)).toEqual({ providers: { osuna: BLOCK } });
    expect(restorePiModels({ text, takeover })).toEqual({ kind: "delete" });
  });

  it("keeps the compat values and other keys the user put in Osuna's provider", () => {
    const first = models(USER_MODELS);
    const edited = first.text.replace(
      '"sendSessionAffinityHeaders": true',
      '"sendSessionAffinityHeaders": false,\n        "supportsDeveloperRole": false',
    );
    const userKeyed = edited.replace(
      '"apiKey": "gw-token-pi",',
      '"apiKey": "gw-token-pi",\n      "headers": { "x-team": "a" },',
    );
    const second = models(userKeyed, first.takeover, {
      ...BLOCK,
      models: [{ id: "kimi-k3", name: "Kimi K3", reasoning: true }],
    });
    const block = (
      JSON.parse(second.text.replace(/\/\/.*\n/, "\n")) as {
        providers: { osuna: Record<string, unknown> };
      }
    ).providers.osuna;
    expect(block.compat).toEqual({
      sendSessionAffinityHeaders: false,
      supportsDeveloperRole: false,
    });
    expect(block.headers).toEqual({ "x-team": "a" });
    expect(block.models).toEqual([{ id: "kimi-k3", name: "Kimi K3", reasoning: true }]);
  });

  it("reports a changed gateway address or token as an outside edit", () => {
    const { text, takeover } = models(USER_MODELS);
    expect(inspectPiModels({ text, takeover })).toMatchObject({ kind: "parsed", modifiedKeys: [] });
    const changed = text.replace("gw-token-pi", "someone-else");
    expect(inspectPiModels({ text: changed, takeover })).toMatchObject({
      modifiedKeys: ["providers.osuna"],
    });
  });

  it("refuses a file that is not valid JSON and names why", () => {
    const result = applyPiModels({ text: '{ "providers": ', block: BLOCK, takeover: null });
    expect(result).toMatchObject({ kind: "unparsable", reason: { code: "syntax" } });
    expect(
      applyPiModels({ text: '{ "providers": [] }', block: BLOCK, takeover: null }),
    ).toMatchObject({ kind: "unparsable", reason: { code: "key_not_object", key: "providers" } });
  });
});

describe("Pi settings.json", () => {
  it("points the default provider and model at Osuna and keeps the rest", () => {
    const { text } = settings(USER_SETTINGS, "relay/glm-5");
    expect(JSON.parse(text)).toEqual({
      defaultProvider: "osuna",
      defaultModel: "relay/glm-5",
      theme: "dark",
    });
    expect(readPiModel(text)).toBe("relay/glm-5");
    expect(readPiModel(USER_SETTINGS)).toBe("anthropic/claude-sonnet-4-5");
  });

  it("puts the user's default back when the switch goes off", () => {
    const first = settings(USER_SETTINGS, "glm-5");
    // 换了默认模型再写一次：原值仍是接管前的。
    const second = settings(first.text, "kimi-k3", first.takeover);
    expect(restorePiSettings({ text: second.text, takeover: second.takeover })).toEqual({
      kind: "patched",
      text: USER_SETTINGS,
    });
  });

  it("puts both keys back when the user only picked another of Osuna's models", () => {
    const { text, takeover } = settings(USER_SETTINGS, "glm-5");
    const changed = text.replace('"defaultModel": "glm-5"', '"defaultModel": "relay/kimi-k3"');
    expect(inspectPiSettings({ text: changed, takeover })).toMatchObject({
      modifiedKeys: ["defaultModel"],
    });
    // 分开放回会拼出 anthropic/relay/kimi-k3：Pi 里没有这个模型。
    expect(restorePiSettings({ text: changed, takeover })).toEqual({
      kind: "patched",
      text: USER_SETTINGS,
    });
  });

  it("keeps a default the user moved to another provider while the switch was on", () => {
    const { text, takeover } = settings(USER_SETTINGS, "glm-5");
    const changed = text
      .replace('"defaultProvider": "osuna"', '"defaultProvider": "openai"')
      .replace('"defaultModel": "glm-5"', '"defaultModel": "gpt-6"');
    const restored = restorePiSettings({ text: changed, takeover });
    if (restored.kind !== "patched") throw new Error("Expected a patch");
    expect(JSON.parse(restored.text)).toEqual({
      defaultProvider: "openai",
      defaultModel: "gpt-6",
      theme: "dark",
    });
  });

  it("deletes a settings.json that did not exist before", () => {
    const { text, takeover } = settings(null, "glm-5");
    expect(restorePiSettings({ text, takeover })).toEqual({ kind: "delete" });
  });
});

function restoredText(text: string, takeover: PiSettingsTakeover): string {
  const result = restorePiSettings({ text, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result.text;
}

describe("Pi settings.json default thinking", () => {
  it("writes defaultThinkingLevel only when it is set", () => {
    expect(JSON.parse(settings(USER_SETTINGS, "glm-5").text)).not.toHaveProperty(
      "defaultThinkingLevel",
    );
    const { text } = settings(USER_SETTINGS, { model: "glm-5", thinking: "high" });
    expect(JSON.parse(text)).toMatchObject({ defaultThinkingLevel: "high" });
  });

  it("puts the user's own level back when the switch goes off", () => {
    const user = USER_SETTINGS.replace(
      '"theme": "dark"',
      '"theme": "dark",\n  "defaultThinkingLevel": "low"',
    );
    const { text, takeover } = settings(user, { model: "glm-5", thinking: "xhigh" });
    expect(JSON.parse(text)).toMatchObject({ defaultThinkingLevel: "xhigh" });
    expect(restoredText(text, takeover)).toBe(user);
  });

  it("puts the user's level back once the default thinking is unset", () => {
    const user = USER_SETTINGS.replace(
      '"theme": "dark"',
      '"theme": "dark",\n  "defaultThinkingLevel": "low"',
    );
    const first = settings(user, { model: "glm-5", thinking: "xhigh" });
    const second = settings(first.text, "glm-5", first.takeover);
    expect(JSON.parse(second.text)).toMatchObject({ defaultThinkingLevel: "low" });
  });

  it("keeps a level the user picked in Pi when the switch goes off, and reads it as Pi's pick", () => {
    const { text, takeover } = settings(USER_SETTINGS, { model: "glm-5", thinking: "high" });
    const changed = text.replace(
      '"defaultThinkingLevel": "high"',
      '"defaultThinkingLevel": "minimal"',
    );
    expect(readPiCliPicks({ text: changed, takeover })).toMatchObject({
      model: null,
      level: "minimal",
    });
    expect(inspectPiSettings({ text: changed, takeover })).toMatchObject({ modifiedKeys: [] });
    expect(JSON.parse(restoredText(changed, takeover))).toMatchObject({
      defaultThinkingLevel: "minimal",
    });
  });
});

describe("Pi settings.json enabledModels", () => {
  const SCOPED = `{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "enabledModels": ["anthropic/claude-sonnet-4-5", "openai/gpt-5"]
}
`;

  function scopeOf(text: string): unknown {
    return (JSON.parse(text) as Record<string, unknown>).enabledModels;
  }

  it("puts the default model first in an existing list", () => {
    const { text } = settings(SCOPED, "relay/glm-5");
    expect(scopeOf(text)).toEqual([
      "osuna/relay/glm-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
    ]);
  });

  it("does not make a list when there is none", () => {
    expect(JSON.parse(settings(USER_SETTINGS, "glm-5").text)).not.toHaveProperty("enabledModels");
  });

  it("moves the previous default out of the front when the default changes", () => {
    const first = settings(SCOPED, "glm-5");
    const second = settings(first.text, "kimi-k3", first.takeover, true);
    expect(scopeOf(second.text)).toEqual([
      "osuna/kimi-k3",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
    ]);
  });

  it("moves an entry the user had back to where it was", () => {
    const user = SCOPED.replace('"openai/gpt-5"]', '"openai/gpt-5", "osuna/glm-5"]');
    const first = settings(user, "glm-5");
    expect(scopeOf(first.text)).toEqual([
      "osuna/glm-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
    ]);
    const second = settings(first.text, "kimi-k3", first.takeover, true);
    expect(scopeOf(second.text)).toEqual([
      "osuna/kimi-k3",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
      "osuna/glm-5",
    ]);
  });

  it("takes Osuna's entries out when the switch goes off", () => {
    const { text, takeover } = settings(SCOPED, "glm-5");
    // 开着期间用户在 Pi 里又加了 Osuna 的一个模型和一个通配符。
    const edited = text.replace(
      '"openai/gpt-5"',
      '"openai/gpt-5",\n    "osuna/kimi-k3",\n    "osuna/*"',
    );
    expect(scopeOf(restoredText(edited, takeover))).toEqual([
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
      "osuna/*",
    ]);
    expect(restoredText(text, takeover)).toBe(SCOPED);
  });

  it("removes a list left empty", () => {
    const user = `{\n  "enabledModels": ["osuna/glm-5"],\n  "theme": "dark"\n}\n`;
    const { text, takeover } = settings(user, "glm-5");
    expect(JSON.parse(restoredText(text, takeover))).toEqual({ theme: "dark" });
  });
});

describe("Pi settings.json defaults picked in Pi", () => {
  it("reads another of Osuna's models picked in Pi as Pi's pick and leaves it on the next rewrite", () => {
    const { text, takeover } = settings(USER_SETTINGS, "glm-5");
    const changed = text.replace('"defaultModel": "glm-5"', '"defaultModel": "relay/kimi-k3"');
    expect(readPiCliPicks({ text: changed, takeover })?.model).toEqual({
      now: "osuna/relay/kimi-k3",
      isKept: false,
    });
    const followed = keepPiCliModel({ text: changed, takeover, held: "followed" });
    if (!followed) throw new Error("Expected a takeover");
    expect(readPiCliPicks({ text: changed, takeover: followed })?.model).toBeNull();
    expect(inspectPiSettings({ text: changed, takeover: followed })).toMatchObject({
      modifiedKeys: [],
    });
    const rewritten = settings(changed, "glm-5", followed);
    expect(JSON.parse(rewritten.text)).toMatchObject({ defaultModel: "relay/kimi-k3" });
    // 在 Osuna 里换默认模型就写回。
    const again = settings(rewritten.text, "glm-5", rewritten.takeover, true);
    expect(JSON.parse(again.text)).toMatchObject({ defaultModel: "glm-5" });
    expect(again.takeover.modelHeld).toBeUndefined();
  });

  it("reads a model outside Osuna with its provider, and a kept one stays after the switch goes off", () => {
    const { text, takeover } = settings(USER_SETTINGS, "glm-5");
    const changed = text
      .replace('"defaultProvider": "osuna"', '"defaultProvider": "openai"')
      .replace('"defaultModel": "glm-5"', '"defaultModel": "gpt-6"');
    expect(readPiCliPicks({ text: changed, takeover })?.model).toEqual({
      now: "openai/gpt-6",
      isKept: false,
    });
    const kept = keepPiCliModel({ text: changed, takeover, held: "kept" });
    if (!kept) throw new Error("Expected a takeover");
    expect(readPiCliPicks({ text: changed, takeover: kept })?.model).toBeNull();
    expect(JSON.parse(restoredText(changed, kept))).toMatchObject({
      defaultProvider: "openai",
      defaultModel: "gpt-6",
    });
  });
});
