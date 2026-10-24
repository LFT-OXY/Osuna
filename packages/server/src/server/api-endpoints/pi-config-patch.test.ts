import { describe, expect, it } from "vitest";
import {
  applyPiModels,
  applyPiSettings,
  inspectPiModels,
  inspectPiSettings,
  readPiModel,
  restorePiModels,
  restorePiSettings,
  type PiModelsTakeover,
  type PiProviderBlock,
  type PiSettingsTakeover,
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

function settings(text: string | null, model: string, takeover: PiSettingsTakeover | null = null) {
  const result = applyPiSettings({ text, model, takeover });
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

  it("keeps a default the user changed while the switch was on", () => {
    const { text, takeover } = settings(USER_SETTINGS, "glm-5");
    const changed = text.replace('"defaultModel": "glm-5"', '"defaultModel": "gpt-6"');
    expect(inspectPiSettings({ text: changed, takeover })).toMatchObject({
      modifiedKeys: ["defaultModel"],
    });
    const restored = restorePiSettings({ text: changed, takeover });
    if (restored.kind !== "patched") throw new Error("Expected a patch");
    expect(JSON.parse(restored.text)).toEqual({
      defaultProvider: "anthropic",
      defaultModel: "gpt-6",
      theme: "dark",
    });
  });

  it("deletes a settings.json that did not exist before", () => {
    const { text, takeover } = settings(null, "glm-5");
    expect(restorePiSettings({ text, takeover })).toEqual({ kind: "delete" });
  });
});
