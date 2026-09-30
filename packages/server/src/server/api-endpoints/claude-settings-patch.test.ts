import { describe, expect, it } from "vitest";
import {
  applyClaudeApiEndpoint,
  buildClaudeEndpointEnv,
  restoreClaudeOfficial,
  type ClaudeSettingsTakeover,
} from "./claude-settings-patch.js";

const RELAY_ENV = buildClaudeEndpointEnv({
  baseUrl: "https://relay.example/api",
  apiKey: "sk-relay",
  defaultModelId: "relay/sonnet",
});

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
  const result = applyClaudeApiEndpoint({ text, env: RELAY_ENV, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

function restore(text: string | null, takeover: ClaudeSettingsTakeover) {
  const result = restoreClaudeOfficial({ text, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a restore, got ${result.kind}`);
  return result.text;
}

describe("buildClaudeEndpointEnv", () => {
  it("writes the token, blanks the API key, and sets the default model", () => {
    expect(RELAY_ENV).toEqual({
      ANTHROPIC_BASE_URL: "https://relay.example/api",
      ANTHROPIC_AUTH_TOKEN: "sk-relay",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "relay/sonnet",
    });
  });
});

describe("applyClaudeApiEndpoint", () => {
  it("changes only the owned env keys and the WebSearch deny entry", () => {
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
    "ANTHROPIC_BASE_URL": "https://relay.example/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-relay",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_MODEL": "relay/sonnet"
  },
  "theme": "dark"
}
`);
  });

  it("creates the file content when settings.json does not exist", () => {
    const { text, takeover } = apply(null);

    expect(JSON.parse(text)).toEqual({
      env: RELAY_ENV,
      permissions: { deny: ["WebSearch"] },
    });
    expect(takeover).toEqual({
      originalFile: { kind: "absent" },
      env: {
        ANTHROPIC_BASE_URL: { original: { present: false }, written: "https://relay.example/api" },
        ANTHROPIC_AUTH_TOKEN: { original: { present: false }, written: "sk-relay" },
        ANTHROPIC_API_KEY: { original: { present: false }, written: "" },
        ANTHROPIC_MODEL: { original: { present: false }, written: "relay/sonnet" },
      },
      envCreated: true,
      webSearchDeny: { added: true, permissionsCreated: true, denyCreated: true },
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
    expect(takeover.env.ANTHROPIC_MODEL?.original).toEqual({ present: false });
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

  it("keeps the originals from the first takeover when switching endpoints", () => {
    const handWritten = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://mine.example"
  }
}
`;
    const first = apply(handWritten);
    const second = applyClaudeApiEndpoint({
      text: first.text,
      env: buildClaudeEndpointEnv({
        baseUrl: "https://other.example",
        apiKey: "sk-other",
        defaultModelId: "other/model",
      }),
      takeover: first.takeover,
    });
    if (second.kind !== "patched") throw new Error("expected patch");

    expect(second.takeover.env.ANTHROPIC_BASE_URL).toEqual({
      original: { present: true, value: "https://mine.example" },
      written: "https://other.example",
    });
    expect(restore(second.text, second.takeover)).toBe(handWritten);
  });

  it("restores a key the new endpoint no longer owns", () => {
    const first = apply(USER_SETTINGS);
    const { ANTHROPIC_MODEL: _dropped, ...withoutModel } = RELAY_ENV;
    const second = applyClaudeApiEndpoint({
      text: first.text,
      env: withoutModel,
      takeover: first.takeover,
    });
    if (second.kind !== "patched") throw new Error("expected patch");

    expect(JSON.parse(second.text).env.ANTHROPIC_MODEL).toBeUndefined();
    expect(Object.keys(second.takeover.env)).not.toContain("ANTHROPIC_MODEL");
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

  it.each([
    ["invalid JSON", `{ "env": { "A": "1", } }`],
    ["a top-level array", `[]`],
    ["an env that is not an object", `{ "env": "oops" }`],
    ["a permissions.deny that is not an array", `{ "permissions": { "deny": "WebSearch" } }`],
  ])("refuses to patch %s", (_label, text) => {
    const result = applyClaudeApiEndpoint({ text, env: RELAY_ENV, takeover: null });
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
