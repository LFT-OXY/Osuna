import { describe, expect, it } from "vitest";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { ProviderOverridesSchema } from "../agent/provider-launch-config.js";
import {
  applyCodexApiEndpoint,
  CODEX_API_ENDPOINT_PROVIDER_ID,
  inspectCodexConfig,
  readCodexReasoningEffort,
  removeCodexProviderTable,
  restoreCodexOfficial,
  type CodexConfigTakeover,
  type CodexGatewayWiring,
} from "./codex-config-patch.js";

const ID = CODEX_API_ENDPOINT_PROVIDER_ID;

const CATALOG = "/home/me/.paseo/api-endpoints/codex-models.json";

const GATEWAY: CodexGatewayWiring = {
  baseUrl: "http://127.0.0.1:6767/api-endpoint-gateway/v1",
  token: "gw-token",
  model: "relay/gpt",
  catalogPath: CATALOG,
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
name = "Osuna"
base_url = "http://127.0.0.1:6767/api-endpoint-gateway/v1"
wire_api = "responses"
experimental_bearer_token = "gw-token"
`;

const CATALOG_LINE = `model_catalog_json = ${JSON.stringify(CATALOG)}`;

interface ApplyInput {
  text: string | null;
  takeover: CodexConfigTakeover | null;
  wiring?: Partial<CodexGatewayWiring>;
}

function applyWith(input: ApplyInput) {
  const result = applyCodexApiEndpoint({
    text: input.text,
    wiring: { ...GATEWAY, ...input.wiring },
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
${CATALOG_LINE}

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
${CATALOG_LINE}

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
${CATALOG_LINE}
# tables only
[features]
web_search = true

${RELAY_BLOCK}`);
  });

  it("creates the content when the file is absent", () => {
    const { text, takeover } = apply(null);

    expect(text).toBe(`model_provider = "${ID}"
model = "relay/gpt"
${CATALOG_LINE}

${RELAY_BLOCK}`);
    expect(takeover).toEqual({
      keys: {
        model_provider: { original: { present: false }, written: ID },
        model: { original: { present: false }, written: "relay/gpt" },
        model_catalog_json: { original: { present: false }, written: CATALOG },
      },
      table: { baseUrl: GATEWAY.baseUrl, bearerToken: "gw-token" },
      fileCreated: true,
    });
  });

  it("keeps CRLF line endings", () => {
    const { text } = apply(`model = "a"\r\n\r\n[features]\r\nx = true\r\n`);

    expect(text).toBe(
      `model = "relay/gpt"\r\nmodel_provider = "${ID}"\r\n${CATALOG_LINE}\r\n\r\n[features]\r\nx = true\r\n\r\n${RELAY_BLOCK.replaceAll("\n", "\r\n")}`,
    );
  });

  it("keeps a leading BOM in place", () => {
    const { text, takeover } = apply(`\uFEFF[features]\nweb_search = true\n`);

    expect(text.startsWith(`\uFEFFmodel_provider = "${ID}"\n`)).toBe(true);
    expect(restore(text, takeover)).toBe(`\uFEFF[features]\nweb_search = true\n`);
  });

  it("records the original values as written, quotes included", () => {
    const { takeover } = apply(USER_CONFIG);

    expect(takeover.keys).toEqual({
      model_provider: { original: { present: true, raw: '"mine"' }, written: ID },
      model: { original: { present: true, raw: "'gpt-5.1-codex'" }, written: "relay/gpt" },
      model_catalog_json: { original: { present: false }, written: CATALOG },
    });
    expect(takeover.fileCreated).toBe(false);
  });

  it("is stable: applying again yields the same bytes and keeps the first originals", () => {
    const first = apply(USER_CONFIG);
    const second = applyWith({ text: first.text, takeover: first.takeover });

    expect(second.text).toBe(first.text);
    expect(second.takeover).toEqual(first.takeover);
  });

  it("moving the gateway rewrites the table and keeps the first originals", () => {
    const first = apply(USER_CONFIG);
    const second = applyWith({
      text: first.text,
      takeover: first.takeover,
      wiring: {
        baseUrl: "http://127.0.0.1:7000/api-endpoint-gateway/v1",
        token: "t2",
        model: "glm",
      },
    });

    expect(toValue(second.text)).toMatchObject({
      model: "glm",
      model_provider: ID,
      model_catalog_json: CATALOG,
      model_providers: {
        mine: { name: "Mine", base_url: "https://mine.example/v1" },
        [ID]: {
          base_url: "http://127.0.0.1:7000/api-endpoint-gateway/v1",
          experimental_bearer_token: "t2",
        },
      },
    });
    expect(second.takeover.keys.model?.original).toEqual({ present: true, raw: "'gpt-5.1-codex'" });
    expect(second.takeover.table).toEqual({
      baseUrl: "http://127.0.0.1:7000/api-endpoint-gateway/v1",
      bearerToken: "t2",
    });
    expect(restore(second.text, second.takeover)).toBe(USER_CONFIG);
  });

  it("replaces the auth.command table written by the per-endpoint version", () => {
    const legacy = `${USER_CONFIG}
[model_providers.${ID}]
name = "Relay"
base_url = "https://relay.example/v1"
wire_api = "responses"

[model_providers.${ID}.auth]
command = "/bin/cat"
args = ["/home/me/.paseo/api-endpoints/codex-api-key"]
timeout_ms = 5000
`;
    const { text, takeover } = apply(legacy);

    expect(text.endsWith(`\n${RELAY_BLOCK}`)).toBe(true);
    expect(text).not.toContain("auth");
    expect(restore(text, takeover)).toBe(USER_CONFIG);
  });

  it("escapes values that TOML strings cannot hold verbatim", () => {
    const { text } = applyWith({
      text: null,
      takeover: null,
      wiring: { model: 'Quote " back\\slash \u007f', catalogPath: "C:\\Users\\me\\models.json" },
    });

    expect(toValue(text)).toMatchObject({
      model: 'Quote " back\\slash \u007f',
      model_catalog_json: "C:\\Users\\me\\models.json",
    });
  });

  it("refuses a file that does not parse", () => {
    const result = applyCodexApiEndpoint({
      text: `model = "a"\nmodel = "b"\n`,
      wiring: GATEWAY,
      takeover: null,
    });

    expect(result.kind).toBe("unparsable");
  });

  it("refuses a layout it cannot extend without redefining a table", () => {
    // 内联表不能再用 [model_providers.x] 追加子表；硬写会得到一份 Codex 读不了的文件。
    const result = applyCodexApiEndpoint({
      text: `model_providers = { mine = { name = "Mine" } }\n`,
      wiring: GATEWAY,
      takeover: null,
    });

    expect(result.kind).toBe("unparsable");
  });

  it("refuses model_provider written as something other than a string", () => {
    const result = applyCodexApiEndpoint({
      text: `[model_provider]\nx = 1\n`,
      wiring: GATEWAY,
      takeover: null,
    });

    expect(result.kind).toBe("unparsable");
  });
});

describe("restoreCodexOfficial", () => {
  it("returns the file to its exact bytes, dedicated table included", () => {
    const { text, takeover } = apply(USER_CONFIG);

    expect(restore(text, takeover)).toBe(USER_CONFIG);
  });

  it("removes keys that were absent before", () => {
    const original = `approval_policy = "never"

[features]
web_search = true
`;
    const { text, takeover } = apply(original);

    expect(restore(text, takeover)).toBe(original);
  });

  it("removes keys inserted at the very top and on a last line without a newline", () => {
    const top = `# tables only\n[features]\nweb_search = true\n`;
    const topApplied = apply(top);
    expect(restore(topApplied.text, topApplied.takeover)).toBe(top);

    // 没有结尾换行的单行文件：键插在它后面，恢复时连同前面补的换行一起拿走。
    const bare = `model = "a"`;
    const bareApplied = apply(bare);
    expect(restore(bareApplied.text, bareApplied.takeover)).toBe(`${bare}\n`);
  });

  it("keeps edits the user made to other keys while it was on", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const edited = text.replace(`trust_level = "trusted"`, `trust_level = "untrusted"`);

    expect(restore(edited, takeover)).toBe(
      USER_CONFIG.replace(`trust_level = "trusted"`, `trust_level = "untrusted"`),
    );
  });

  it("puts back an original key the user deleted in the meantime", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const withoutModel = text.replace(`model = "relay/gpt"   # the one I like\n`, "");

    expect(toValue(restore(withoutModel, takeover))).toMatchObject({ model: "gpt-5.1-codex" });
  });

  it("asks for the file to be deleted when it did not exist and nothing else was added", () => {
    const { text, takeover } = apply(null);
    expect(restoreCodexOfficial({ text, takeover })).toEqual({ kind: "delete" });

    const withUserKey = `approval_policy = "never"\n${text}`;
    expect(restore(withUserKey, takeover)).toBe(`approval_policy = "never"\n`);
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

describe("removeCodexProviderTable", () => {
  it("removes a table left behind by the per-endpoint version and the blank line before it", () => {
    expect(removeTable(`${USER_CONFIG}\n${RELAY_BLOCK}`)).toBe(USER_CONFIG);
  });

  it("leaves a file without the table untouched", () => {
    expect(removeTable(USER_CONFIG)).toBe(USER_CONFIG);
  });

  it("empties a file that held only the table", () => {
    expect(removeTable(RELAY_BLOCK)).toBe("");
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
        name: "Osuna",
        base_url: "http://127.0.0.1:6767/api-endpoint-gateway/v1",
        wire_api: "responses",
        experimental_bearer_token: "gw-token",
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

describe("inspectCodexConfig", () => {
  function inspect(text: string | null, takeover: CodexConfigTakeover | null) {
    const result = inspectCodexConfig({ text, takeover });
    if (result.kind !== "parsed") throw new Error(`Expected a parsed file, got ${result.kind}`);
    return result;
  }

  it("finds nothing modified right after the switch", () => {
    const { text, takeover } = apply(USER_CONFIG);
    expect(inspect(text, takeover).modifiedKeys).toEqual([]);
  });

  it("names the owned keys and the dedicated table when they no longer hold what was written", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const edited = text
      .replace(`model = "relay/gpt"`, `model = "gpt-5"`)
      .replace(`experimental_bearer_token = "gw-token"`, `experimental_bearer_token = "x"`);
    expect(inspect(edited, takeover).modifiedKeys).toEqual(["model", `model_providers.${ID}`]);

    const tableEdits: Array<[string, string]> = [
      [`wire_api = "responses"`, `wire_api = "chat"`],
      [`base_url = "http://127.0.0.1:6767`, `base_url = "http://127.0.0.1:1`],
      [`name = "Osuna"`, `name = "Renamed"`],
    ];
    for (const [written, replacement] of tableEdits) {
      const tampered = text.replace(written, replacement);
      expect(inspect(tampered, takeover).modifiedKeys).toEqual([`model_providers.${ID}`]);
    }

    const withoutProvider = text.replace(`model_provider = "${ID}"\n`, "");
    expect(inspect(withoutProvider, takeover).modifiedKeys).toEqual(["model_provider"]);

    const withoutCatalog = text.replace(`${CATALOG_LINE}\n`, "");
    expect(inspect(withoutCatalog, takeover).modifiedKeys).toEqual(["model_catalog_json"]);
  });

  it("does not count edits to keys it doesn't own", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const edited = text
      .replace(`approval_policy = "on-request"`, `approval_policy = "never"`)
      .replace(`base_url = "https://mine.example/v1"`, `base_url = "https://mine2.example/v1"`);
    expect(inspect(edited, takeover).modifiedKeys).toEqual([]);
  });

  it("counts everything it owns as modified when the file is gone", () => {
    const { takeover } = apply(USER_CONFIG);
    expect(inspect(null, takeover).modifiedKeys).toEqual([
      "model_provider",
      "model",
      "model_catalog_json",
      `model_providers.${ID}`,
    ]);
  });

  it("names the selected legacy profile that overrides the owned top-level keys", () => {
    const config = `profile = "work"
model = "gpt-5"

[profiles.work]
model_provider = "azure"
model = "gpt-5-azure"
approval_policy = "never"

[profiles.home]
model = "o3"
`;
    expect(inspect(config, null).profileOverride).toEqual({
      profile: "work",
      keys: ["model_provider", "model"],
    });
    expect(
      inspect(config.replace(`profile = "work"`, `profile = "none"`), null).profileOverride,
    ).toBeNull();
    expect(
      inspect(config.replace(`profile = "work"`, `profile = "home"`), null).profileOverride,
    ).toEqual({ profile: "home", keys: ["model"] });
    expect(inspect(USER_CONFIG, null).profileOverride).toBeNull();
  });

  it("reports where the effective provider points", () => {
    expect(inspect(USER_CONFIG, null).baseUrl).toBe("https://mine.example/v1");
    expect(inspect(`openai_base_url = "https://proxy.example/v1"\n`, null).baseUrl).toBe(
      "https://proxy.example/v1",
    );
    expect(inspect(`model = "gpt-5"\n`, null).baseUrl).toBeNull();
    expect(inspect(`model_provider = "ollama"\n`, null).baseUrl).toBeNull();
    expect(inspect(null, null).baseUrl).toBeNull();
    const viaProfile = `${USER_CONFIG.replace("# my codex config", 'profile = "p"')}
[profiles.p]
model_provider = "other"

[model_providers.other]
name = "Other"
base_url = "https://other.example/v1"
`;
    expect(inspect(viaProfile, null).baseUrl).toBe("https://other.example/v1");
  });

  it("reports a file that does not parse", () => {
    expect(inspectCodexConfig({ text: "model = ", takeover: null }).kind).toBe("unparsable");
  });
});

describe("readCodexReasoningEffort", () => {
  it("reads the top-level effort, not a profile's", () => {
    const text =
      'model_reasoning_effort = "none"\n\n[profiles.deep]\nmodel_reasoning_effort = "xhigh"\n';
    expect(readCodexReasoningEffort(text)).toBe("none");
  });

  it("is null when the file is missing, says nothing, or cannot be read", () => {
    expect(readCodexReasoningEffort(null)).toBeNull();
    expect(readCodexReasoningEffort('model = "gpt-5.5"\n')).toBeNull();
    expect(readCodexReasoningEffort("model_reasoning_effort = 3\n")).toBeNull();
    expect(readCodexReasoningEffort("model_reasoning_effort = \n")).toBeNull();
  });
});
