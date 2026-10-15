import { describe, expect, it } from "vitest";
import {
  applyClaudeApiEndpoint,
  inspectClaudeSettings,
  restoreClaudeOfficial,
  type ClaudeSettingsTakeover,
} from "./claude-settings-patch.js";

const GATEWAY = {
  baseUrl: "http://127.0.0.1:6767/api-endpoint-gateway",
  token: "gw-token",
  model: "kimi-k2",
  modelPicker: [],
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

  it.each([
    ["invalid JSON", `{ "env": { "A": "1", } }`],
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
    });
    expect(inspect(USER_SETTINGS, null).baseUrl).toBeNull();
    expect(inspect('{ "env": { "ANTHROPIC_BASE_URL": "  " } }', null).baseUrl).toBeNull();
    expect(inspect(null, null).baseUrl).toBeNull();
  });

  it("reports a file that does not parse", () => {
    expect(inspectClaudeSettings({ text: "{ nope", takeover: null }).kind).toBe("unparsable");
  });
});
