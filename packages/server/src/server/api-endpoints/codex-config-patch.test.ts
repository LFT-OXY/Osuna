import { describe, expect, it } from "vitest";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { ProviderOverridesSchema } from "../agent/provider-launch-config.js";
import {
  applyCodexApiEndpoint,
  CODEX_API_ENDPOINT_PROVIDER_ID,
  removeCodexProviderTable,
  replaceCodexProviderTable,
  restoreCodexOfficial,
  type CodexConfigTakeover,
  type CodexProviderTable,
} from "./codex-config-patch.js";

const ID = CODEX_API_ENDPOINT_PROVIDER_ID;

const RELAY_TABLE: CodexProviderTable = {
  name: "Relay",
  baseUrl: "https://relay.example/v1",
  auth: {
    command: "/bin/cat",
    args: ["/home/me/.paseo/api-endpoints/codex-api-key"],
    timeoutMs: 5000,
  },
};

// 用户手写的 config.toml：注释、行尾注释、引号风格、带空格的项目路径、自己的中转站，全都不能动。
const USER_CONFIG = `# my codex config
model = 'gpt-5.1-codex'   # the one I like
model_provider = "mine"
approval_policy = "on-request"

# projects
[projects."/Users/me/My Code"]
trust_level = "trusted"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"
`;

const RELAY_BLOCK = `[model_providers.${ID}]
name = "Relay"
base_url = "https://relay.example/v1"
wire_api = "responses"

[model_providers.${ID}.auth]
command = "/bin/cat"
args = ["/home/me/.paseo/api-endpoints/codex-api-key"]
timeout_ms = 5000
`;

interface ApplyInput {
  text: string | null;
  takeover: CodexConfigTakeover | null;
  model?: string;
  table?: CodexProviderTable;
}

function applyWith(input: ApplyInput) {
  const result = applyCodexApiEndpoint({
    text: input.text,
    model: input.model ?? "relay/gpt",
    table: input.table ?? RELAY_TABLE,
    takeover: input.takeover,
  });
  if (result.kind !== "patched") throw new Error(`Expected a patch, got ${result.kind}`);
  return result;
}

/** 首次接管、默认的接口。 */
function apply(text: string | null) {
  return applyWith({ text, takeover: null });
}

function restore(text: string | null, takeover: CodexConfigTakeover) {
  const result = restoreCodexOfficial({ text, takeover });
  if (result.kind !== "patched") throw new Error(`Expected a restore, got ${result.kind}`);
  return result.text;
}

function removeTable(text: string) {
  const result = removeCodexProviderTable({ text });
  if (result.kind !== "patched") throw new Error(`Expected a removal, got ${result.kind}`);
  return result.text;
}

function toValue(text: string): Record<string, unknown> {
  const value: unknown = getStaticTOMLValue(parseTOML(text, { tomlVersion: "1.0" }));
  if (!isRecord(value)) throw new Error("Expected a TOML table");
  return value;
}

describe("applyCodexApiEndpoint", () => {
  it("replaces the top-level values in place and appends the dedicated table", () => {
    const { text } = apply(USER_CONFIG);

    expect(text).toBe(`# my codex config
model = "relay/gpt"   # the one I like
model_provider = "${ID}"
approval_policy = "on-request"

# projects
[projects."/Users/me/My Code"]
trust_level = "trusted"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"

${RELAY_BLOCK}`);
  });

  it("inserts missing top-level keys after the last top-level key", () => {
    const { text } = apply(`approval_policy = "never"

[features]
web_search = true
`);

    expect(text).toBe(`approval_policy = "never"
model_provider = "${ID}"
model = "relay/gpt"

[features]
web_search = true

${RELAY_BLOCK}`);
  });

  it("inserts at the top when the file has only tables and comments", () => {
    const { text } = apply(`# tables only
[features]
web_search = true
`);

    expect(text).toBe(`model_provider = "${ID}"
model = "relay/gpt"
# tables only
[features]
web_search = true

${RELAY_BLOCK}`);
  });

  it("creates the content when the file is absent", () => {
    const { text, takeover } = apply(null);

    expect(text).toBe(`model_provider = "${ID}"
model = "relay/gpt"

${RELAY_BLOCK}`);
    expect(takeover.keys).toEqual({
      model_provider: { original: { present: false }, written: ID },
      model: { original: { present: false }, written: "relay/gpt" },
    });
  });

  it("keeps CRLF line endings", () => {
    const { text } = apply(`model = "a"\r\n\r\n[features]\r\nx = true\r\n`);

    expect(text).toBe(
      `model = "relay/gpt"\r\nmodel_provider = "${ID}"\r\n\r\n[features]\r\nx = true\r\n\r\n${RELAY_BLOCK.replaceAll("\n", "\r\n")}`,
    );
  });

  it("keeps a leading BOM in place", () => {
    const { text, takeover } = apply(`\uFEFF[features]\nweb_search = true\n`);

    expect(text.startsWith(`\uFEFFmodel_provider = "${ID}"\n`)).toBe(true);
    expect(removeTable(restore(text, takeover))).toBe(`\uFEFF[features]\nweb_search = true\n`);
  });

  it("records the original values as written, quotes included", () => {
    const { takeover } = apply(USER_CONFIG);

    expect(takeover.keys).toEqual({
      model_provider: { original: { present: true, raw: '"mine"' }, written: ID },
      model: { original: { present: true, raw: "'gpt-5.1-codex'" }, written: "relay/gpt" },
    });
  });

  it("is stable: applying again yields the same bytes and keeps the first originals", () => {
    const first = apply(USER_CONFIG);
    const second = applyWith({ text: first.text, takeover: first.takeover });

    expect(second.text).toBe(first.text);
    expect(second.takeover).toEqual(first.takeover);
  });

  it("switching to another endpoint rewrites the table and keeps the first originals", () => {
    const first = apply(USER_CONFIG);
    const other: CodexProviderTable = {
      ...RELAY_TABLE,
      name: "Other",
      baseUrl: "https://other/v1",
    };
    const second = applyWith({
      text: first.text,
      takeover: first.takeover,
      model: "other/model",
      table: other,
    });

    expect(toValue(second.text)).toMatchObject({
      model: "other/model",
      model_provider: ID,
      model_providers: {
        mine: { name: "Mine", base_url: "https://mine.example/v1" },
        [ID]: { name: "Other", base_url: "https://other/v1" },
      },
    });
    expect(second.takeover.keys.model?.original).toEqual({ present: true, raw: "'gpt-5.1-codex'" });
    const otherBlock = RELAY_BLOCK.replace('"Relay"', '"Other"').replace(
      "https://relay.example/v1",
      "https://other/v1",
    );
    expect(restore(second.text, second.takeover)).toBe(`${USER_CONFIG}\n${otherBlock}`);
  });

  it("escapes values that TOML strings cannot hold verbatim", () => {
    const { text } = applyWith({
      text: null,
      takeover: null,
      table: {
        name: 'Quote " back\\slash \u007f',
        baseUrl: "https://relay.example/v1",
        auth: {
          command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          args: ["-Command", "[Console]::Out.Write('C:\\Users\\O''Brien\\key')"],
          timeoutMs: 15000,
        },
      },
    });

    expect(toValue(text)).toMatchObject({
      model_providers: {
        [ID]: {
          name: 'Quote " back\\slash \u007f',
          auth: {
            command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            args: ["-Command", "[Console]::Out.Write('C:\\Users\\O''Brien\\key')"],
            timeout_ms: 15000,
          },
        },
      },
    });
  });

  it("refuses a file that does not parse", () => {
    const result = applyCodexApiEndpoint({
      text: `model = "a"\nmodel = "b"\n`,
      model: "relay/gpt",
      table: RELAY_TABLE,
      takeover: null,
    });

    expect(result.kind).toBe("unparsable");
  });

  it("refuses a layout it cannot extend without redefining a table", () => {
    // 内联表不能再用 [model_providers.x] 追加子表；硬写会得到一份 Codex 读不了的文件。
    const result = applyCodexApiEndpoint({
      text: `model_providers = { mine = { name = "Mine" } }\n`,
      model: "relay/gpt",
      table: RELAY_TABLE,
      takeover: null,
    });

    expect(result.kind).toBe("unparsable");
  });

  it("refuses model_provider written as something other than a string", () => {
    const result = applyCodexApiEndpoint({
      text: `[model_provider]\nx = 1\n`,
      model: "relay/gpt",
      table: RELAY_TABLE,
      takeover: null,
    });

    expect(result.kind).toBe("unparsable");
  });
});

describe("restoreCodexOfficial", () => {
  it("restores the top-level keys byte for byte and keeps the dedicated table", () => {
    const { text, takeover } = apply(USER_CONFIG);

    expect(restore(text, takeover)).toBe(`${USER_CONFIG}\n${RELAY_BLOCK}`);
  });

  it("removes keys that were absent before", () => {
    const original = `approval_policy = "never"

[features]
web_search = true
`;
    const { text, takeover } = apply(original);

    expect(restore(text, takeover)).toBe(`${original}\n${RELAY_BLOCK}`);
  });

  it("removes keys inserted at the very top and on a last line without a newline", () => {
    const top = `# tables only\n[features]\nweb_search = true\n`;
    const topApplied = apply(top);
    expect(restore(topApplied.text, topApplied.takeover)).toBe(`${top}\n${RELAY_BLOCK}`);

    // 没有结尾换行的单行文件：键插在它后面，恢复时连同前面补的换行一起拿走。
    const bare = `model = "a"`;
    const bareApplied = apply(bare);
    expect(removeTable(restore(bareApplied.text, bareApplied.takeover))).toBe(`${bare}\n`);
  });

  it("puts back an original key the user deleted in the meantime", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const withoutModel = text.replace(`model = "relay/gpt"   # the one I like\n`, "");

    expect(toValue(restore(withoutModel, takeover))).toMatchObject({ model: "gpt-5.1-codex" });
  });

  it("reports a missing file instead of writing one", () => {
    const { takeover } = apply(USER_CONFIG);

    expect(restoreCodexOfficial({ text: null, takeover })).toEqual({ kind: "missing" });
  });

  it("refuses a file that does not parse", () => {
    const { takeover } = apply(USER_CONFIG);

    expect(restoreCodexOfficial({ text: "model = ", takeover }).kind).toBe("unparsable");
  });
});

describe("replaceCodexProviderTable", () => {
  it("rewrites only the dedicated table while Official", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const official = restore(text, takeover);
    const rotated: CodexProviderTable = { ...RELAY_TABLE, baseUrl: "https://moved.example/v1" };

    const result = replaceCodexProviderTable({ text: official, table: rotated });

    expect(result).toEqual({
      kind: "patched",
      text: `${USER_CONFIG}\n${RELAY_BLOCK.replace("https://relay.example/v1", "https://moved.example/v1")}`,
    });
  });

  it("reports a missing file instead of writing one", () => {
    expect(replaceCodexProviderTable({ text: null, table: RELAY_TABLE })).toEqual({
      kind: "missing",
    });
  });
});

describe("removeCodexProviderTable", () => {
  it("removes the dedicated table and the blank line added before it", () => {
    const { text, takeover } = apply(USER_CONFIG);

    expect(removeTable(restore(text, takeover))).toBe(USER_CONFIG);
  });

  it("leaves a file without the table untouched", () => {
    expect(removeTable(USER_CONFIG)).toBe(USER_CONFIG);
  });

  it("empties a file that held only what the daemon wrote", () => {
    const { text, takeover } = apply(null);

    expect(removeTable(restore(text, takeover))).toBe("");
  });
});

describe("the dedicated provider id", () => {
  it("can never be a custom provider id, so request-level injection never merges into it", () => {
    const parsed = ProviderOverridesSchema.safeParse({
      [ID]: { extends: "codex", label: "Clash" },
    });

    expect(parsed.success).toBe(false);
  });

  it("is not one of Codex's reserved ids", () => {
    expect(["openai", "ollama", "lmstudio", "amazon-bedrock"]).not.toContain(ID);
  });

  it("coexists with a custom Codex provider injected per request", () => {
    const { text } = apply(USER_CONFIG);
    // 自定义 Codex 提供方在 thread/start 里注入的 config；Codex 按表逐层深合并到 config.toml 上。
    const injected = {
      model_provider: "my-relay",
      model_providers: {
        "my-relay": {
          name: "My relay",
          base_url: "https://my-relay.example/v1",
          wire_api: "responses",
        },
      },
    };

    const merged = deepMerge(toValue(text), injected);

    expect(merged.model_provider).toBe("my-relay");
    expect(merged.model_providers).toEqual({
      mine: { name: "Mine", base_url: "https://mine.example/v1" },
      "my-relay": {
        name: "My relay",
        base_url: "https://my-relay.example/v1",
        wire_api: "responses",
      },
      [ID]: {
        name: "Relay",
        base_url: "https://relay.example/v1",
        wire_api: "responses",
        auth: {
          command: "/bin/cat",
          args: ["/home/me/.paseo/api-endpoints/codex-api-key"],
          timeout_ms: 5000,
        },
      },
    });
  });
});

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];
    result[key] = isRecord(existing) && isRecord(value) ? deepMerge(existing, value) : value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
