import { describe, expect, it } from "vitest";
import {
  applyClaudeApiEndpoint,
  inspectClaudeSettings,
  keepClaudeCliModel,
  readClaudeCliPicks,
  restoreClaudeOfficial,
  type ClaudeSettingsTakeover,
} from "./claude-settings-patch.js";

const GATEWAY = {
  baseUrl: "http://127.0.0.1:6767/api-endpoint-gateway",
  token: "gw-token",
  model: "kimi-k2",
  modelPicker: [],
  hintEnv: {},
  allowWebSearch: false,
  isAutoModeReviewed: true,
  defaultThinking: null,
  ultraCode: null,
};

// 接口模型的提示：起始模型的上下文、最短的回复上限、各模型的思考档位。
const HINTS = {
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: "922000",
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000",
  CLAUDE_CODE_MODEL_CAPABILITIES: "kimi-k2=effort,xhigh_effort",
};

// 两家接口各一个已选模型：/model 里的两行。
const PICKER = [
  { model: "relay/kimi-k2", label: "kimi-k2", description: "Relay" },
  { model: "backup/gpt-6", label: "GPT 6", description: "Backup" },
];

// Claude Code 与终端 hooks 安装器都按 JSON.stringify(…, 2) 写这份文件，这是最常见的形状。
const USER_SETTINGS = `{
  "permissions": {
    "allow": [
      "Bash(npm run *)"
    ],
    "deny": [
      "Read(./.env)"
    ]
  },
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "notify"
          }
        ]
      }
    ]
  },
  "enabledPlugins": {
    "demo@market": true
  },
  "env": {
    "DISABLE_TELEMETRY": "1"
  },
  "theme": "dark"
}
`;

function apply(text: string | null, takeover: ClaudeSettingsTakeover | null = null) {
  const result = applyClaudeApiEndpoint({ text, wiring: GATEWAY, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

function applyPicker(
  text: string | null,
  modelPicker: typeof PICKER,
  takeover: ClaudeSettingsTakeover | null = null,
) {
  const result = applyClaudeApiEndpoint({ text, wiring: { ...GATEWAY, modelPicker }, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

function applyHints(
  text: string | null,
  hintEnv: Partial<typeof HINTS>,
  takeover: ClaudeSettingsTakeover | null = null,
) {
  const result = applyClaudeApiEndpoint({ text, wiring: { ...GATEWAY, hintEnv }, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

/** 换掉 env 里一个键的值，模拟用户手改。 */
function setEnv(text: string, key: string, value: string): string {
  const settings = JSON.parse(text) as { env: Record<string, string> };
  settings.env[key] = value;
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function restore(text: string | null, takeover: ClaudeSettingsTakeover) {
  const result = restoreClaudeOfficial({ text, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a restore, got ${result.kind}`);
  return result.text;
}

describe("applyClaudeApiEndpoint", () => {
  it("changes only the owned env keys, the top-level model, and the WebSearch deny entry", () => {
    const { text } = apply(USER_SETTINGS);

    expect(text).toBe(`{
  "permissions": {
    "allow": [
      "Bash(npm run *)"
    ],
    "deny": [
      "Read(./.env)",
      "WebSearch"
    ]
  },
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "notify"
          }
        ]
      }
    ]
  },
  "enabledPlugins": {
    "demo@market": true
  },
  "env": {
    "DISABLE_TELEMETRY": "1",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:6767/api-endpoint-gateway",
    "ANTHROPIC_AUTH_TOKEN": "gw-token",
    "ANTHROPIC_API_KEY": ""
  },
  "theme": "dark",
  "model": "kimi-k2"
}
`);
  });

  it("creates the file content when settings.json does not exist", () => {
    const { text, takeover } = apply(null);

    expect(JSON.parse(text)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: GATEWAY.baseUrl,
        ANTHROPIC_AUTH_TOKEN: "gw-token",
        ANTHROPIC_API_KEY: "",
      },
      permissions: { deny: ["WebSearch"] },
      model: "kimi-k2",
    });
    expect(takeover).toEqual({
      originalFile: { kind: "absent" },
      env: {
        ANTHROPIC_BASE_URL: { original: { present: false }, written: GATEWAY.baseUrl },
        ANTHROPIC_AUTH_TOKEN: { original: { present: false }, written: "gw-token" },
        ANTHROPIC_API_KEY: { original: { present: false }, written: "" },
      },
      model: { original: { present: false }, written: "kimi-k2" },
      envCreated: true,
      webSearchDeny: { added: true, permissionsCreated: true, denyCreated: true },
      modelPicker: { written: null },
      hintEnv: {},
      clouds: {},
    });
  });

  it("records the user's own relay values, including an empty API key", () => {
    const handWritten = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://mine.example",
    "ANTHROPIC_AUTH_TOKEN": "sk-mine",
    "ANTHROPIC_API_KEY": ""
  }
}
`;
    const { takeover } = apply(handWritten);

    expect(takeover.env.ANTHROPIC_BASE_URL?.original).toEqual({
      present: true,
      value: "https://mine.example",
    });
    expect(takeover.env.ANTHROPIC_AUTH_TOKEN?.original).toEqual({
      present: true,
      value: "sk-mine",
    });
    expect(takeover.env.ANTHROPIC_API_KEY?.original).toEqual({ present: true, value: "" });
    expect(takeover.env.ANTHROPIC_MODEL).toBeUndefined();
    expect(takeover.envCreated).toBe(false);
  });

  it("does not own a WebSearch deny rule the user already wrote", () => {
    const denied = `{
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  }
}
`;
    const { text, takeover } = apply(denied);

    expect(JSON.parse(text).permissions).toEqual({ deny: ["WebSearch"] });
    expect(takeover.webSearchDeny).toEqual({
      added: false,
      permissionsCreated: false,
      denyCreated: false,
    });
    expect(JSON.parse(restore(text, takeover)).permissions).toEqual({ deny: ["WebSearch"] });
  });

  it("writes no WebSearch deny rule while some endpoint searches the web by itself", () => {
    const result = applyClaudeApiEndpoint({
      text: USER_SETTINGS,
      wiring: { ...GATEWAY, allowWebSearch: true },
      takeover: null,
    });
    if (result.kind !== "patched") throw new Error("Expected a patch");

    expect(JSON.parse(result.text).permissions).toEqual({
      allow: ["Bash(npm run *)"],
      deny: ["Read(./.env)"],
    });
    expect(result.takeover.webSearchDeny.added).toBe(false);
    expect(restore(result.text, result.takeover)).toBe(USER_SETTINGS);
  });

  it("takes its own WebSearch deny rule out when searching is allowed, and puts it back when not", () => {
    const denied = apply("{}\n");
    expect(JSON.parse(denied.text).permissions).toEqual({ deny: ["WebSearch"] });

    const allowed = applyClaudeApiEndpoint({
      text: denied.text,
      wiring: { ...GATEWAY, allowWebSearch: true },
      takeover: denied.takeover,
    });
    if (allowed.kind !== "patched") throw new Error("Expected a patch");
    // permissions 与 deny 都是 Osuna 建的：规则拿掉后一并收走。
    expect(JSON.parse(allowed.text).permissions).toBeUndefined();
    expect(allowed.takeover.webSearchDeny.added).toBe(false);

    const deniedAgain = apply(allowed.text, allowed.takeover);
    expect(JSON.parse(deniedAgain.text).permissions).toEqual({ deny: ["WebSearch"] });
    expect(deniedAgain.takeover.webSearchDeny).toEqual({
      added: true,
      permissionsCreated: true,
      denyCreated: true,
    });
    expect(restore(deniedAgain.text, deniedAgain.takeover)).toBe("{}\n");
  });

  it("leaves a WebSearch deny rule the user wrote in place while searching is allowed", () => {
    const denied = `{
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  }
}
`;
    const result = applyClaudeApiEndpoint({
      text: denied,
      wiring: { ...GATEWAY, allowWebSearch: true },
      takeover: null,
    });
    if (result.kind !== "patched") throw new Error("Expected a patch");

    expect(JSON.parse(result.text).permissions).toEqual({ deny: ["WebSearch"] });
    expect(result.takeover.webSearchDeny.added).toBe(false);
    expect(restore(result.text, result.takeover)).toBe(denied);
  });

  it("is stable: the same input gives the same output, and re-applying changes nothing", () => {
    const first = apply(USER_SETTINGS);
    const again = apply(USER_SETTINGS);
    expect(again.text).toBe(first.text);

    const reapplied = apply(first.text, first.takeover);
    expect(reapplied.text).toBe(first.text);
    expect(reapplied.takeover).toEqual(first.takeover);
  });

  it("keeps the originals from the first takeover when the gateway moves", () => {
    const handWritten = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://mine.example"
  },
  "model": "opus"
}
`;
    const first = apply(handWritten);
    const second = applyClaudeApiEndpoint({
      text: first.text,
      wiring: {
        baseUrl: "http://127.0.0.1:7000/api-endpoint-gateway",
        token: "t2",
        model: "glm",
        modelPicker: [],
        hintEnv: {},
      },
      takeover: first.takeover,
    });
    if (second.kind !== "patched") throw new Error("expected patch");

    expect(second.takeover.env.ANTHROPIC_BASE_URL).toEqual({
      original: { present: true, value: "https://mine.example" },
      written: "http://127.0.0.1:7000/api-endpoint-gateway",
    });
    expect(second.takeover.model).toEqual({
      original: { present: true, value: "opus" },
      written: "glm",
    });
    expect(restore(second.text, second.takeover)).toBe(handWritten);
  });

  it("removes the model and tier variables that would outrank /model, and restores them", () => {
    const handWritten = `{
  "env": {
    "ANTHROPIC_MODEL": "my-model",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "my-opus",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "my-sonnet",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "my-haiku",
    "ANTHROPIC_DEFAULT_FABLE_MODEL": "my-fable",
    "ANTHROPIC_SMALL_FAST_MODEL": "my-fast",
    "DISABLE_TELEMETRY": "1"
  }
}
`;
    const { text, takeover } = apply(handWritten);

    expect(JSON.parse(text).env).toEqual({
      DISABLE_TELEMETRY: "1",
      ANTHROPIC_BASE_URL: GATEWAY.baseUrl,
      ANTHROPIC_AUTH_TOKEN: "gw-token",
      ANTHROPIC_API_KEY: "",
    });
    expect(takeover.env.ANTHROPIC_SMALL_FAST_MODEL).toEqual({
      original: { present: true, value: "my-fast" },
      written: null,
    });
    // 没写过的就不记：接管前没有的变量不归 Osuna 管。
    expect(apply(USER_SETTINGS).takeover.env.ANTHROPIC_MODEL).toBeUndefined();
    // 值都回来了；删掉再放回的键排到 env 末尾，jsonc 改不回原来的位置。
    expect(JSON.parse(restore(text, takeover))).toEqual(JSON.parse(handWritten));
  });

  it("takes over a file written by the per-endpoint version and restores what was there before", () => {
    // v0.15 写的：直接指向接口，ANTHROPIC_MODEL 与档位变量是 Osuna 写的，原来没有。
    const legacyText = USER_SETTINGS.replace(
      `"Read(./.env)"\n`,
      `"Read(./.env)",\n      "WebSearch"\n`,
    ).replace(
      `"DISABLE_TELEMETRY": "1"\n`,
      `"DISABLE_TELEMETRY": "1",
    "ANTHROPIC_BASE_URL": "https://relay.example/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-relay",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_MODEL": "relay/sonnet",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "relay/opus"\n`,
    );
    const absent = { present: false } as const;
    const legacyTakeover: ClaudeSettingsTakeover = {
      originalFile: { kind: "content" },
      env: {
        ANTHROPIC_BASE_URL: { original: absent, written: "https://relay.example/api" },
        ANTHROPIC_AUTH_TOKEN: { original: absent, written: "sk-relay" },
        ANTHROPIC_API_KEY: { original: absent, written: "" },
        ANTHROPIC_MODEL: { original: absent, written: "relay/sonnet" },
        ANTHROPIC_DEFAULT_OPUS_MODEL: { original: absent, written: "relay/opus" },
      },
      envCreated: false,
      webSearchDeny: { added: true, permissionsCreated: false, denyCreated: false },
    };

    const next = apply(legacyText, legacyTakeover);

    const env = JSON.parse(next.text).env;
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(restore(next.text, next.takeover)).toBe(USER_SETTINGS);
  });

  it("follows the file's own indentation for inserted keys", () => {
    const fourSpaces = `{
    "theme": "dark"
}
`;
    const { text } = apply(fourSpaces);
    expect(text).toContain(`\n    "env": {\n        "ANTHROPIC_BASE_URL"`);
    expect(text.startsWith(`{\n    "theme": "dark",\n`)).toBe(true);
  });

  it("lists every endpoint model in modelPicker and leaves the rest of the file alone", () => {
    const { text, takeover } = applyPicker('{\n  "theme": "dark"\n}\n', PICKER);

    expect(text).toBe(`{
  "theme": "dark",
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:6767/api-endpoint-gateway",
    "ANTHROPIC_AUTH_TOKEN": "gw-token",
    "ANTHROPIC_API_KEY": ""
  },
  "model": "kimi-k2",
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  },
  "modelPicker": {
    "options": [
      {
        "model": "relay/kimi-k2",
        "label": "kimi-k2",
        "description": "Relay"
      },
      {
        "model": "backup/gpt-6",
        "label": "GPT 6",
        "description": "Backup"
      }
    ]
  }
}
`);
    expect(takeover.modelPicker).toEqual({ written: PICKER });
  });

  it("never touches a modelPicker the user wrote, while switched and after Official", () => {
    const handWritten = `{
  "modelPicker": {
    "options": [
      {
        "model": "opus"
      }
    ]
  }
}
`;
    const first = applyPicker(handWritten, PICKER);
    expect(JSON.parse(first.text).modelPicker).toEqual({ options: [{ model: "opus" }] });
    expect(first.takeover.modelPicker).toEqual({ written: null });

    const again = applyPicker(first.text, PICKER.slice(1), first.takeover);
    expect(JSON.parse(again.text).modelPicker).toEqual({ options: [{ model: "opus" }] });
    expect(restore(again.text, again.takeover)).toBe(handWritten);
  });

  it("rewrites its own modelPicker as the models change and drops it when none are left", () => {
    const first = applyPicker(USER_SETTINGS, PICKER);

    const fewer = applyPicker(first.text, PICKER.slice(1), first.takeover);
    expect(JSON.parse(fewer.text).modelPicker).toEqual({ options: PICKER.slice(1) });
    expect(fewer.takeover.modelPicker).toEqual({ written: PICKER.slice(1) });

    const none = applyPicker(fewer.text, [], fewer.takeover);
    expect(JSON.parse(none.text).modelPicker).toBeUndefined();
    expect(none.takeover.modelPicker).toEqual({ written: null });
    expect(restore(none.text, none.takeover)).toBe(USER_SETTINGS);
  });

  it("removes its own modelPicker on Official and returns the file to its exact bytes", () => {
    const { text, takeover } = applyPicker(USER_SETTINGS, PICKER);
    expect(restore(text, takeover)).toBe(USER_SETTINGS);

    const fromEmpty = applyPicker("{}\n", PICKER);
    expect(restore(fromEmpty.text, fromEmpty.takeover)).toBe("{}\n");
  });

  it("writes modelPicker over a record from before it was owned, when the file has none", () => {
    const { text, takeover } = apply(USER_SETTINGS);
    const { modelPicker: _omitted, ...legacy } = takeover;

    const next = applyPicker(text, PICKER, legacy);
    expect(JSON.parse(next.text).modelPicker).toEqual({ options: PICKER });
    expect(restore(next.text, next.takeover)).toBe(USER_SETTINGS);
  });

  it("writes the model hints into env and takes only its own out on Official", () => {
    const { text, takeover } = applyHints(USER_SETTINGS, HINTS);
    expect(JSON.parse(text).env).toEqual({
      DISABLE_TELEMETRY: "1",
      ANTHROPIC_BASE_URL: GATEWAY.baseUrl,
      ANTHROPIC_AUTH_TOKEN: GATEWAY.token,
      ANTHROPIC_API_KEY: "",
      ...HINTS,
    });
    expect(takeover.hintEnv).toEqual(HINTS);
    expect(restore(text, takeover)).toBe(USER_SETTINGS);

    const fromEmpty = applyHints("{}\n", HINTS);
    expect(restore(fromEmpty.text, fromEmpty.takeover)).toBe("{}\n");
  });

  it("never touches a hint the user set, while switched and after Official", () => {
    const own = setEnv(USER_SETTINGS, "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "64000");
    const first = applyHints(own, HINTS);
    expect(JSON.parse(first.text).env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("64000");
    expect(first.takeover.hintEnv).toEqual({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "922000",
      CLAUDE_CODE_MODEL_CAPABILITIES: "kimi-k2=effort,xhigh_effort",
    });

    const again = applyHints(first.text, HINTS, first.takeover);
    expect(JSON.parse(again.text).env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("64000");
    expect(restore(again.text, again.takeover)).toBe(own);
  });

  it("rewrites its own hints as they change and removes one that is no longer known", () => {
    const first = applyHints(USER_SETTINGS, HINTS);
    const next = applyHints(
      first.text,
      { CLAUDE_CODE_MODEL_CAPABILITIES: "kimi-k2=effort" },
      first.takeover,
    );
    const env = JSON.parse(next.text).env;
    expect(env.CLAUDE_CODE_MODEL_CAPABILITIES).toBe("kimi-k2=effort");
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined();
    expect(next.takeover.hintEnv).toEqual({ CLAUDE_CODE_MODEL_CAPABILITIES: "kimi-k2=effort" });
    expect(restore(next.text, next.takeover)).toBe(USER_SETTINGS);
  });

  it("a hint the user changed after Osuna wrote it is theirs from then on", () => {
    const first = applyHints(USER_SETTINGS, HINTS);
    const edited = setEnv(first.text, "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "50000");

    const again = applyHints(edited, HINTS, first.takeover);
    expect(JSON.parse(again.text).env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("50000");
    expect(again.takeover.hintEnv?.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined();

    const restored = JSON.parse(restore(again.text, again.takeover)).env;
    expect(restored).toEqual({ DISABLE_TELEMETRY: "1", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "50000" });
  });

  it("turns the auto mode review off while no reachable model is reviewed, and takes it out once one is", () => {
    const unreviewed = { ...GATEWAY, isAutoModeReviewed: false };
    const first = applyClaudeApiEndpoint({
      text: USER_SETTINGS,
      wiring: unreviewed,
      takeover: null,
    });
    if (first.kind !== "patched") throw new Error("Expected a patch");
    expect(JSON.parse(first.text).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe("0");
    expect(restore(first.text, first.takeover)).toBe(USER_SETTINGS);

    const reviewed = apply(first.text, first.takeover);
    expect(JSON.parse(reviewed.text).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBeUndefined();
    expect(restore(reviewed.text, reviewed.takeover)).toBe(USER_SETTINGS);
  });

  it("leaves the auto mode review the user set alone, while switched and after Official", () => {
    for (const value of ["1", "0"]) {
      const own = setEnv(USER_SETTINGS, "CLAUDE_CODE_AUTO_MODE_SERVER", value);
      const wiring = { ...GATEWAY, isAutoModeReviewed: false };
      const first = applyClaudeApiEndpoint({ text: own, wiring, takeover: null });
      if (first.kind !== "patched") throw new Error("Expected a patch");
      expect(JSON.parse(first.text).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe(value);
      const again = apply(first.text, first.takeover);
      expect(JSON.parse(again.text).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe(value);
      expect(restore(again.text, again.takeover)).toBe(own);
    }
  });

  it.each([
    ["invalid JSONC", `{ "env": { "A": "1" "B": "2" } }`],
    ["a top-level array", `[]`],
    ["an env that is not an object", `{ "env": "oops" }`],
    ["a permissions.deny that is not an array", `{ "permissions": { "deny": "WebSearch" } }`],
  ])("refuses to patch %s", (_label, text) => {
    const result = applyClaudeApiEndpoint({ text, wiring: GATEWAY, takeover: null });
    expect(result.kind).toBe("unparsable");
  });
});

describe("restoreClaudeOfficial", () => {
  it("returns a file the user wrote to its exact bytes", () => {
    const { text, takeover } = apply(USER_SETTINGS);
    expect(restore(text, takeover)).toBe(USER_SETTINGS);
  });

  it("brings back hand-written relay values, including an empty API key", () => {
    const handWritten = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://mine.example",
    "ANTHROPIC_AUTH_TOKEN": "sk-mine",
    "ANTHROPIC_API_KEY": ""
  }
}
`;
    const { text, takeover } = apply(handWritten);
    expect(restore(text, takeover)).toBe(handWritten);
  });

  it("removes everything it created when the file started empty", () => {
    const { text, takeover } = apply("{}\n");
    expect(restore(text, takeover)).toBe("{}\n");
  });

  it("keeps the exact bytes of an empty object the user wrote", () => {
    const { text, takeover } = apply("{\n}");
    expect(restore(text, takeover)).toBe("{\n}");
  });

  it("asks for the file to be deleted when it did not exist before the takeover", () => {
    const { text, takeover } = apply(null);
    expect(restoreClaudeOfficial({ text, takeover })).toEqual({ kind: "delete" });
  });

  it("keeps a file that did not exist before once the user has added their own keys", () => {
    const { text, takeover } = apply(null);
    const withTheme = text.replace("{\n", '{\n  "theme": "dark",\n');
    expect(JSON.parse(restore(withTheme, takeover))).toEqual({ theme: "dark" });
  });

  it("keeps edits the user made to other keys while the endpoint was active", () => {
    const { text, takeover } = apply(USER_SETTINGS);
    const edited = text.replace(`"theme": "dark"`, `"theme": "light"`);
    expect(restore(edited, takeover)).toBe(USER_SETTINGS.replace(`"dark"`, `"light"`));
  });

  it("writes nothing when the file has been deleted", () => {
    const { takeover } = apply(USER_SETTINGS);
    expect(restoreClaudeOfficial({ text: null, takeover })).toEqual({ kind: "missing" });
  });

  it("refuses to restore into a file that no longer parses", () => {
    const { takeover } = apply(USER_SETTINGS);
    expect(restoreClaudeOfficial({ text: "{ nope", takeover }).kind).toBe("unparsable");
  });
});

describe("inspectClaudeSettings", () => {
  function inspect(text: string | null, takeover: ClaudeSettingsTakeover | null) {
    const result = inspectClaudeSettings({ text, takeover });
    if (result.kind !== "parsed") throw new Error(`Expected a parsed file, got ${result.kind}`);
    return result;
  }

  it("finds nothing modified right after the switch", () => {
    const { text, takeover } = apply(USER_SETTINGS);
    expect(inspect(text, takeover).modifiedKeys).toEqual([]);
  });

  it("names the owned keys that no longer hold what was written", () => {
    const { text, takeover } = apply(USER_SETTINGS);
    const edited = text
      .replace(`"${GATEWAY.baseUrl}"`, '"https://other-tool.example"')
      .replace('"model": "kimi-k2"', '"model": "opus"');
    expect(inspect(edited, takeover).modifiedKeys).toEqual(["env.ANTHROPIC_BASE_URL", "model"]);
  });

  it("counts a removed variable that came back as modified", () => {
    const { text, takeover } = apply('{ "env": { "ANTHROPIC_MODEL": "my-model" } }\n');
    expect(inspect(text, takeover).modifiedKeys).toEqual([]);
    const readded = text.replace(
      `"ANTHROPIC_API_KEY": ""`,
      `"ANTHROPIC_API_KEY": "", "ANTHROPIC_MODEL": "x"`,
    );
    expect(inspect(readded, takeover).modifiedKeys).toEqual(["env.ANTHROPIC_MODEL"]);
  });

  it("does not count edits to keys it doesn't own", () => {
    const { text, takeover } = apply(USER_SETTINGS);
    const edited = text
      .replace(`"theme": "dark"`, `"theme": "light"`)
      .replace(`"DISABLE_TELEMETRY": "1"`, `"DISABLE_TELEMETRY": "0"`)
      .replace(`"Read(./.env)",`, "");
    expect(inspect(edited, takeover).modifiedKeys).toEqual([]);
  });

  it("counts a removed WebSearch deny entry only when it added that entry", () => {
    const added = apply(USER_SETTINGS);
    const withoutRule = added.text.replace(`,\n      "WebSearch"`, "");
    expect(inspect(withoutRule, added.takeover).modifiedKeys).toEqual([
      'permissions.deny "WebSearch"',
    ]);

    const userOwned = apply('{ "permissions": { "deny": ["WebSearch"] } }\n');
    const removed = userOwned.text.replace(`"WebSearch"`, `"Read(./x)"`);
    expect(inspect(removed, userOwned.takeover).modifiedKeys).toEqual([]);
  });

  it("counts its own modelPicker as modified once it no longer holds what was written", () => {
    const ours = applyPicker(USER_SETTINGS, PICKER);
    expect(inspect(ours.text, ours.takeover).modifiedKeys).toEqual([]);
    const edited = ours.text.replace(`"label": "GPT 6"`, `"label": "Mine"`);
    expect(inspect(edited, ours.takeover).modifiedKeys).toEqual(["modelPicker"]);

    const userOwned = applyPicker('{ "modelPicker": { "options": [] } }\n', PICKER);
    const changed = userOwned.text.replace(`"options": []`, `"options": [{ "model": "x" }]`);
    expect(inspect(changed, userOwned.takeover).modifiedKeys).toEqual([]);
  });

  it("does not count a hint the user changed: it is theirs, not a conflict", () => {
    const { text, takeover } = applyHints(USER_SETTINGS, HINTS);
    const edited = setEnv(text, "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "50000");
    expect(inspectClaudeSettings({ text: edited, takeover })).toMatchObject({ modifiedKeys: [] });
  });

  it("counts every owned key as modified when the file is gone", () => {
    const { takeover } = apply(USER_SETTINGS);
    expect(inspect(null, takeover).modifiedKeys).toEqual([
      "env.ANTHROPIC_BASE_URL",
      "env.ANTHROPIC_AUTH_TOKEN",
      "env.ANTHROPIC_API_KEY",
      "model",
      'permissions.deny "WebSearch"',
    ]);
  });

  it("reports the base URL the file itself points at", () => {
    const handWritten = '{ "env": { "ANTHROPIC_BASE_URL": "https://mine.example" } }';
    expect(inspect(handWritten, null)).toEqual({
      kind: "parsed",
      modifiedKeys: [],
      baseUrl: "https://mine.example",
      isReadableByClaudeCode: true,
      authToken: "missing",
    });
    expect(inspect(USER_SETTINGS, null).baseUrl).toBeNull();
    expect(inspect('{ "env": { "ANTHROPIC_BASE_URL": "  " } }', null).baseUrl).toBeNull();
    expect(inspect(null, null).baseUrl).toBeNull();
  });

  it("reports a file that does not parse", () => {
    expect(inspectClaudeSettings({ text: "{ nope", takeover: null }).kind).toBe("unparsable");
  });

  it("tells a missing, empty and set token apart, as Claude Code reads them", () => {
    const tokenOf = (text: string) => {
      const result = inspect(text, null);
      return result.kind === "parsed" ? result.authToken : null;
    };
    expect(tokenOf('{ "env": {} }')).toBe("missing");
    expect(tokenOf('{ "env": { "ANTHROPIC_AUTH_TOKEN": "" } }')).toBe("empty");
    expect(tokenOf('{ "env": { "ANTHROPIC_AUTH_TOKEN": "tok" } }')).toBe("set");
  });
});

describe("settings.json read and written as JSONC", () => {
  const BOM = "﻿";

  it("keeps a leading BOM: writes the owned keys after it and restores the exact bytes", () => {
    const withBom = `${BOM}${USER_SETTINGS}`;
    const { text, takeover } = apply(withBom);

    expect(text.startsWith(BOM)).toBe(true);
    expect(text.slice(BOM.length)).toBe(apply(USER_SETTINGS).text);
    expect(restore(text, takeover)).toBe(withBom);
  });

  // 用户自己写的 JSONC：行注释、块注释、尾随逗号，注释紧挨着 Osuna 负责的键。
  const COMMENTED = `{
  // 我的中转站
  "model": "opus", // 固定用 opus
  "env": {
    /* 口令在下面 */
    "ANTHROPIC_BASE_URL": "https://mine.example",
    "ANTHROPIC_AUTH_TOKEN": "sk-mine", // 别提交
  },
  "theme": "dark",
}
`;

  it("edits only the owned values and keeps every comment, trailing comma and line break", () => {
    const { text } = apply(COMMENTED);

    expect(text).toBe(`{
  // 我的中转站
  "model": "kimi-k2", // 固定用 opus
  "env": {
    /* 口令在下面 */
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:6767/api-endpoint-gateway",
    "ANTHROPIC_AUTH_TOKEN": "gw-token", // 别提交
    "ANTHROPIC_API_KEY": "",
  },
  "theme": "dark",
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  },
}
`);
  });

  it("keeps a comment after the last key when that key has no trailing comma", () => {
    const original = `{\n  "theme": "dark" // 暗色\n}\n`;
    const { text, takeover } = apply(original);

    expect(text).toBe(`{
  "theme": "dark", // 暗色
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:6767/api-endpoint-gateway",
    "ANTHROPIC_AUTH_TOKEN": "gw-token",
    "ANTHROPIC_API_KEY": ""
  },
  "model": "kimi-k2",
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  }
}
`);
    expect(restore(text, takeover)).toBe(original);
  });

  it("restores a commented file to its exact bytes, comments included", () => {
    const { text, takeover } = apply(COMMENTED);
    expect(restore(text, takeover)).toBe(COMMENTED);
  });

  it.each([
    ["a line comment", `{\n  // mine\n  "theme": "dark"\n}\n`],
    ["a block comment", `{\n  /* mine */ "theme": "dark"\n}\n`],
    ["a trailing comma", `{\n  "theme": "dark",\n}\n`],
  ])("accepts %s and reports that Claude Code can't read the file", (_label, original) => {
    const { text, takeover } = apply(original);

    expect(inspectClaudeSettings({ text, takeover })).toMatchObject({
      kind: "parsed",
      modifiedKeys: [],
      isReadableByClaudeCode: false,
    });
    expect(restore(text, takeover)).toBe(original);
  });

  it("reads a file with only a BOM in front as one Claude Code can read", () => {
    const { text, takeover } = apply(`${BOM}${USER_SETTINGS}`);
    expect(inspectClaudeSettings({ text, takeover })).toMatchObject({
      modifiedKeys: [],
      isReadableByClaudeCode: true,
    });
  });

  it("counts an owned key changed next to a comment, and the comment stays theirs", () => {
    const { text, takeover } = apply(COMMENTED);
    const edited = text.replace(`"gw-token", // 别提交`, `"sk-other", // 别提交`);
    expect(inspectClaudeSettings({ text: edited, takeover })).toMatchObject({
      modifiedKeys: ["env.ANTHROPIC_AUTH_TOKEN"],
    });
  });

  it("refuses a file that isn't valid JSONC either, and says where", () => {
    const result = applyClaudeApiEndpoint({
      text: `{\n  "theme": "dark"\n  "model": "opus"\n}\n`,
      wiring: GATEWAY,
      takeover: null,
    });
    expect(result).toEqual({
      kind: "unparsable",
      message: "CommaExpected at line 3, column 3",
      reason: { code: "syntax", line: 3, column: 3 },
    });
  });
});

describe("cloud-platform switches in settings.json", () => {
  const WITH_CLOUDS = `{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "CLAUDE_CODE_USE_VERTEX": "0",
    "CLAUDE_CODE_USE_FOUNDRY": true,
    "AWS_REGION": "us-east-1"
  }
}
`;

  function envOf(text: string): Record<string, unknown> {
    return (JSON.parse(text) as { env: Record<string, unknown> }).env;
  }

  it("takes out the switches that are on, leaves the ones that are off and the other cloud variables", () => {
    const { text } = apply(WITH_CLOUDS);
    const env = envOf(text);
    expect(env).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
    expect(env).not.toHaveProperty("CLAUDE_CODE_USE_FOUNDRY");
    expect(env.CLAUDE_CODE_USE_VERTEX).toBe("0");
    expect(env.AWS_REGION).toBe("us-east-1");
  });

  it("reads yes, on and TRUE as on, and an empty value as off", () => {
    const { text } = apply(`{
  "env": {
    "CLAUDE_CODE_USE_MANTLE": " Yes ",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS": "on",
    "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD": "TRUE",
    "CLAUDE_CODE_USE_BEDROCK": ""
  }
}
`);
    expect(envOf(text)).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: "" });
    expect(Object.keys(envOf(text)).filter((key) => key.startsWith("CLAUDE_CODE_USE_"))).toEqual([
      "CLAUDE_CODE_USE_BEDROCK",
    ]);
  });

  it("puts the switches back as they were written on Official", () => {
    const { text, takeover } = apply(WITH_CLOUDS);
    const restored = restoreClaudeOfficial({ text, takeover });
    if (restored.kind !== "patched") throw new Error(restored.kind);
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(WITH_CLOUDS));
  });

  it("keeps a switch the user set again while the switch was on", () => {
    const { text, takeover } = apply(WITH_CLOUDS);
    const edited = text.replace('"env": {', '"env": {\n    "CLAUDE_CODE_USE_BEDROCK": "true",');
    const restored = restoreClaudeOfficial({ text: edited, takeover });
    if (restored.kind !== "patched") throw new Error(restored.kind);
    expect(envOf(restored.text).CLAUDE_CODE_USE_BEDROCK).toBe("true");
    expect(envOf(restored.text).CLAUDE_CODE_USE_FOUNDRY).toBe(true);
  });

  it("takes out a switch the user turned on again since, and keeps the first value it took out", () => {
    const first = apply(WITH_CLOUDS);
    const edited = first.text.replace(
      '"env": {',
      '"env": {\n    "CLAUDE_CODE_USE_MANTLE": "1",\n    "CLAUDE_CODE_USE_BEDROCK": "yes",',
    );
    const second = apply(edited, first.takeover);
    expect(envOf(second.text)).not.toHaveProperty("CLAUDE_CODE_USE_MANTLE");
    expect(envOf(second.text)).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
    const restored = restoreClaudeOfficial({ text: second.text, takeover: second.takeover });
    if (restored.kind !== "patched") throw new Error(restored.kind);
    expect(envOf(restored.text)).toMatchObject({
      CLAUDE_CODE_USE_BEDROCK: "yes",
      CLAUDE_CODE_USE_MANTLE: "1",
      CLAUDE_CODE_USE_FOUNDRY: true,
    });
  });

  it("puts back nothing for a record from before switches were taken out", () => {
    const { text, takeover } = apply(USER_SETTINGS);
    const { clouds: _clouds, ...oldRecord } = takeover;
    expect(restoreClaudeOfficial({ text, takeover: oldRecord })).toEqual({
      kind: "patched",
      text: USER_SETTINGS,
    });
  });
});

describe("default thinking in settings.json", () => {
  function applyThinking(input: {
    text: string | null;
    defaultThinking: string | null;
    ultraCode?: boolean | null;
    model?: string;
    takeover?: ClaudeSettingsTakeover | null;
  }) {
    const wiring = {
      ...GATEWAY,
      model: input.model ?? GATEWAY.model,
      defaultThinking: input.defaultThinking,
      ultraCode: input.ultraCode ?? null,
    };
    const result = applyClaudeApiEndpoint({
      text: input.text,
      wiring,
      takeover: input.takeover ?? null,
    });
    if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
    return result;
  }

  function restoreText(text: string, takeover: ClaudeSettingsTakeover): string {
    const result = restoreClaudeOfficial({ text, takeover });
    if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
    return result.text;
  }

  it("writes high at the top for another vendor's model", () => {
    const { text } = applyThinking({ text: USER_SETTINGS, defaultThinking: "high" });
    const settings = JSON.parse(text);
    expect(settings.effortLevel).toBe("high");
    expect(settings.modelSettings).toBeUndefined();
    expect(settings.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
  });

  it("writes it under modelSettings too for a Claude model, which reads only that", () => {
    const { text } = applyThinking({
      text: USER_SETTINGS,
      defaultThinking: "xhigh",
      model: "claude-opus-5-5[1m]",
    });
    const settings = JSON.parse(text);
    expect(settings.effortLevel).toBe("xhigh");
    expect(settings.modelSettings).toEqual({ "claude-opus-5-5": { effortLevel: "xhigh" } });
  });

  it("writes max into CLAUDE_CODE_EFFORT_LEVEL, which settings.json can't keep", () => {
    const { text } = applyThinking({ text: USER_SETTINGS, defaultThinking: "max" });
    const settings = JSON.parse(text);
    expect(settings.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("max");
    expect(settings.effortLevel).toBeUndefined();
  });

  it("turns Ultra Code on and off on its own, beside any level", () => {
    const on = applyThinking({ text: USER_SETTINGS, defaultThinking: "medium", ultraCode: true });
    expect(JSON.parse(on.text)).toMatchObject({ ultracode: true, effortLevel: "medium" });
    const off = applyThinking({
      text: on.text,
      defaultThinking: "medium",
      ultraCode: false,
      takeover: on.takeover,
    });
    expect(JSON.parse(off.text).ultracode).toBeUndefined();
  });

  it("takes out the user's max variable beside a lower level and keeps their own ultracode; Official puts it all back", () => {
    const before = `{
  "env": {
    "CLAUDE_CODE_EFFORT_LEVEL": "max"
  },
  "ultracode": true,
  "effortLevel": "low"
}
`;
    const patched = applyThinking({ text: before, defaultThinking: "medium" });
    const settings = JSON.parse(patched.text);
    expect(settings.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(settings.ultracode).toBe(true);
    expect(settings.effortLevel).toBe("medium");
    // 拿掉又放回的键排到最后，值与接管前相同。
    expect(JSON.parse(restoreText(patched.text, patched.takeover))).toEqual(JSON.parse(before));
  });

  it("puts every key it wrote back as it was on Official, containers it made included", () => {
    const patched = applyThinking({
      text: USER_SETTINGS,
      defaultThinking: "xhigh",
      ultraCode: true,
      model: "claude-opus-5-5",
    });
    expect(restoreText(patched.text, patched.takeover)).toBe(USER_SETTINGS);
  });

  it("gives back what it no longer writes when the level changes, keeping the first originals", () => {
    const first = applyThinking({ text: USER_SETTINGS, defaultThinking: "max" });
    const second = applyThinking({
      text: first.text,
      defaultThinking: "high",
      model: "claude-sonnet-5",
      takeover: first.takeover,
    });
    const settings = JSON.parse(second.text);
    expect(settings.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(settings.effortLevel).toBe("high");
    expect(settings.modelSettings).toEqual({ "claude-sonnet-5": { effortLevel: "high" } });
    const third = applyThinking({
      text: second.text,
      defaultThinking: null,
      takeover: second.takeover,
    });
    expect(third.text).toBe(apply(USER_SETTINGS).text);
    expect(restoreText(second.text, second.takeover)).toBe(USER_SETTINGS);
  });

  it("leaves the user's own levels alone when no default thinking is set", () => {
    const before = `{
  "effortLevel": "low",
  "modelSettings": {
    "claude-opus-5-5": {
      "effortLevel": "xhigh"
    }
  }
}
`;
    const { text } = applyThinking({ text: before, defaultThinking: null });
    const settings = JSON.parse(text);
    expect(settings.effortLevel).toBe("low");
    expect(settings.modelSettings["claude-opus-5-5"].effortLevel).toBe("xhigh");
  });

  it("does not count a level the CLI saved since as modified: it follows the CLI's own picks", () => {
    const patched = applyThinking({
      text: USER_SETTINGS,
      defaultThinking: "high",
      model: "claude-opus-5-5",
    });
    const edited = JSON.parse(patched.text);
    edited.modelSettings["claude-opus-5-5"].effortLevel = "low";
    const inspection = inspectClaudeSettings({
      text: `${JSON.stringify(edited, null, 2)}\n`,
      takeover: patched.takeover,
    });
    if (inspection.kind !== "parsed") throw new Error("Expected parsed");
    expect(inspection.modifiedKeys).toEqual([]);
  });
});

describe("the CLI's own picks in settings.json", () => {
  function patched(input: { text: string; defaultThinking?: string | null; model?: string }) {
    const result = applyClaudeApiEndpoint({
      text: input.text,
      wiring: {
        ...GATEWAY,
        model: input.model ?? GATEWAY.model,
        defaultThinking: input.defaultThinking ?? null,
      },
      takeover: null,
    });
    if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
    return result;
  }

  function edited(text: string, change: (settings: Record<string, unknown>) => void): string {
    const settings = JSON.parse(text) as Record<string, unknown>;
    change(settings);
    return `${JSON.stringify(settings, null, 2)}\n`;
  }

  function rewrite(input: {
    text: string;
    takeover: ClaudeSettingsTakeover | null;
    rewritesModel?: boolean;
  }) {
    const result = applyClaudeApiEndpoint({
      text: input.text,
      wiring: { ...GATEWAY, model: "glm-4.6" },
      takeover: input.takeover,
      rewritesModel: input.rewritesModel,
    });
    if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
    return result;
  }

  it("reads a model /model saved, and nothing while the file holds what Osuna wrote", () => {
    const first = patched({ text: USER_SETTINGS });
    expect(readClaudeCliPicks({ text: first.text, takeover: first.takeover })?.model).toBeNull();

    const saved = edited(first.text, (settings) => {
      settings.model = "relay/kimi-k2[1m]";
    });
    expect(readClaudeCliPicks({ text: saved, takeover: first.takeover })?.model).toEqual({
      now: "relay/kimi-k2[1m]",
      isKept: false,
    });
  });

  it("leaves a model the CLI saved through a rewrite, and writes the default model back only when told to", () => {
    const first = patched({ text: USER_SETTINGS });
    const saved = edited(first.text, (settings) => {
      settings.model = "gpt-9";
    });

    const kept = rewrite({ text: saved, takeover: first.takeover });
    expect(JSON.parse(kept.text).model).toBe("gpt-9");
    // 记录不变：还是「模型被换掉」。
    expect(readClaudeCliPicks({ text: kept.text, takeover: kept.takeover })?.model?.now).toBe(
      "gpt-9",
    );

    const reapplied = rewrite({ text: kept.text, takeover: kept.takeover, rewritesModel: true });
    expect(JSON.parse(reapplied.text).model).toBe("glm-4.6");
    expect(readClaudeCliPicks({ text: reapplied.text, takeover: reapplied.takeover })?.model).toBe(
      null,
    );
  });

  it("keeps the CLI's model as kept: no longer changed, untouched by a rewrite, put back to the original on switch-off", () => {
    const first = patched({ text: USER_SETTINGS });
    const saved = edited(first.text, (settings) => {
      settings.model = "gpt-9";
    });
    const takeover = keepClaudeCliModel({ text: saved, takeover: first.takeover, held: "kept" });
    expect(readClaudeCliPicks({ text: saved, takeover })?.model).toBeNull();
    const inspection = inspectClaudeSettings({ text: saved, takeover });
    if (inspection.kind !== "parsed") throw new Error("Expected parsed");
    expect(inspection.modifiedKeys).toEqual([]);

    const again = rewrite({ text: saved, takeover });
    expect(JSON.parse(again.text).model).toBe("gpt-9");
    const moved = edited(again.text, (settings) => {
      settings.model = "gpt-10";
    });
    expect(readClaudeCliPicks({ text: moved, takeover: again.takeover })?.model).toEqual({
      now: "gpt-10",
      isKept: true,
    });

    const restored = restoreClaudeOfficial({ text: again.text, takeover: again.takeover });
    if (restored.kind !== "patched") throw new Error("Expected a patch");
    expect(restored.text).toBe(USER_SETTINGS);
  });

  it("reads a level /effort saved as Claude Code reads it: its env, the model's modelSettings, then the top one", () => {
    const first = patched({
      text: USER_SETTINGS,
      defaultThinking: "high",
      model: "claude-opus-5-5",
    });
    const read = (change: (settings: Record<string, unknown>) => void) =>
      readClaudeCliPicks({ text: edited(first.text, change), takeover: first.takeover })?.level;

    expect(
      read((settings) => {
        settings.modelSettings = { "claude-opus-5-5": { effortLevel: "low" } };
      }),
    ).toEqual({ now: "low" });
    // Opus 5.5 不读顶层：只改顶层时它跑的仍是 Osuna 写的那档，不算换了。
    expect(
      read((settings) => {
        settings.effortLevel = "low";
      }),
    ).toBeNull();
    expect(
      read((settings) => {
        settings.env = { ...(settings.env as object), CLAUDE_CODE_EFFORT_LEVEL: "max" };
      }),
    ).toEqual({ now: "max" });

    const other = patched({ text: USER_SETTINGS, defaultThinking: "high" });
    const topOnly = edited(other.text, (settings) => {
      settings.effortLevel = "medium";
    });
    expect(readClaudeCliPicks({ text: topOnly, takeover: other.takeover })?.level).toEqual({
      now: "medium",
    });
  });
});
