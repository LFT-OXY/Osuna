import { describe, expect, it } from "vitest";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { ProviderOverridesSchema } from "../agent/provider-launch-config.js";
import {
  applyCodexApiEndpoint,
  CODEX_API_ENDPOINT_PROVIDER_ID,
  inspectCodexConfig,
  readCodexReasoningEffort,
  refreshCodexProviderTable,
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
  chatgptBaseUrl: null,
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

/** 切回官方后留着的样子：Osuna 的服务商表照追加时的写法留在末尾。 */
function withKeptTable(text: string, block = RELAY_BLOCK) {
  return `${text}${text.endsWith("\n") ? "\n" : "\n\n"}${block}`;
}

function refreshTable(text: string | null, table = { baseUrl: MOVED_URL, bearerToken: "t2" }) {
  return refreshCodexProviderTable({ text, table });
}

const MOVED_URL = "http://127.0.0.1:7000/api-endpoint-gateway/v1";
const MOVED_BLOCK = RELAY_BLOCK.replace("127.0.0.1:6767", "127.0.0.1:7000").replace(
  '"gw-token"',
  '"t2"',
);

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
    expect(restore(text, takeover)).toBe(withKeptTable(`\uFEFF[features]\nweb_search = true\n`));
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
    expect(restore(second.text, second.takeover)).toBe(withKeptTable(USER_CONFIG, MOVED_BLOCK));
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
    expect(restore(text, takeover)).toBe(withKeptTable(USER_CONFIG));
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

const CHATGPT_URL = "http://127.0.0.1:6767/api-endpoint-gateway/backend-api/codex";

/** 用 ChatGPT 登录的 Codex（ADR 0010）：内置 openai 服务商经 openai_base_url 指到中转站的 ChatGPT 后端地址。 */
function inspect(text: string | null, takeover: CodexConfigTakeover | null) {
  const result = inspectCodexConfig({ text, takeover });
  if (result.kind !== "parsed") throw new Error(`Expected a parsed file, got ${result.kind}`);
  return result;
}

function applyChatGpt(text: string | null, takeover: CodexConfigTakeover | null = null) {
  return applyWith({ text, takeover, wiring: { chatgptBaseUrl: CHATGPT_URL } });
}

describe("applyCodexApiEndpoint under a ChatGPT sign-in", () => {
  it("writes openai_base_url, keeps Codex's own model, drops the provider and keeps the table", () => {
    const { text } = applyChatGpt(USER_CONFIG);

    expect(text).toBe(`# my codex config
model = 'gpt-5.1-codex'   # the one I like
approval_policy = "on-request"
openai_base_url = "${CHATGPT_URL}"

# projects
[projects."/Users/me/My Code"]
trust_level = "trusted"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"

${RELAY_BLOCK}`);
  });

  it("leaves model alone when Codex has none of its own, as magpie's Join does", () => {
    const { text, takeover } = applyChatGpt(`approval_policy = "never"\n`);

    expect(text).toBe(`approval_policy = "never"
openai_base_url = "${CHATGPT_URL}"

${RELAY_BLOCK}`);
    expect(takeover.keys.model).toBeUndefined();
    expect(restore(text, takeover)).toBe(withKeptTable(`approval_policy = "never"\n`));
  });

  it("keeps a model Codex picked itself while on, through Official", () => {
    const { text, takeover } = applyChatGpt(`approval_policy = "never"\n`);
    const picked = text.replace(`openai_base_url`, `model = "gpt-5.5"\nopenai_base_url`);

    expect(inspect(picked, takeover).modifiedKeys).toEqual([]);
    expect(toValue(restore(picked, takeover))).toMatchObject({ model: "gpt-5.5" });
  });

  it("takes Osuna's own model_provider and model_catalog_json out and Official puts every key back", () => {
    const provider = apply(USER_CONFIG);
    const chatgpt = applyChatGpt(provider.text, provider.takeover);

    expect(toValue(chatgpt.text)).toMatchObject({ model: "gpt-5.1-codex" });
    expect(chatgpt.text).not.toContain("model_provider =");
    expect(chatgpt.text).not.toContain("model_catalog_json");
    // 拿掉又放回的键回到最后一个顶层键后面：值一样，位置不保证。
    expect(toValue(restore(chatgpt.text, chatgpt.takeover))).toEqual(
      toValue(withKeptTable(USER_CONFIG)),
    );
  });

  it("gives the file back byte for byte when Codex was on its built-in provider", () => {
    const config = USER_CONFIG.replace(`model_provider = "mine"\n`, "");
    const provider = apply(config);
    const chatgpt = applyChatGpt(provider.text, provider.takeover);

    expect(restore(applyChatGpt(config).text, applyChatGpt(config).takeover)).toBe(
      withKeptTable(config),
    );
    expect(restore(chatgpt.text, chatgpt.takeover)).toBe(withKeptTable(config));
  });

  it("replaces an openai_base_url the user wrote and puts it back on Official", () => {
    const config = `openai_base_url = 'https://proxy.example/v1'  # mine\n${USER_CONFIG}`;
    const { text, takeover } = applyChatGpt(config);

    expect(text.split("\n")[0]).toBe(`openai_base_url = "${CHATGPT_URL}"  # mine`);
    expect(takeover.keys.openai_base_url?.original).toEqual({
      present: true,
      raw: "'https://proxy.example/v1'",
    });
    expect(restore(text, takeover).split("\n")[0]).toBe(
      "openai_base_url = 'https://proxy.example/v1'  # mine",
    );
  });

  it("rewires by the new sign-in: the keys of the old wiring go back to what they were", () => {
    const chatgpt = applyChatGpt(USER_CONFIG);
    const provider = applyWith({ text: chatgpt.text, takeover: chatgpt.takeover });

    expect(toValue(provider.text)).toEqual(toValue(apply(USER_CONFIG).text));
    expect(provider.takeover.keys.openai_base_url).toBeUndefined();
    expect(toValue(restore(provider.text, provider.takeover))).toEqual(
      toValue(withKeptTable(USER_CONFIG)),
    );

    const again = applyChatGpt(provider.text, provider.takeover);
    expect(toValue(again.text)).toEqual(toValue(chatgpt.text));
    expect(toValue(restore(again.text, again.takeover))).toEqual(
      toValue(withKeptTable(USER_CONFIG)),
    );
  });

  it("is stable: applying again yields the same bytes", () => {
    const first = applyChatGpt(USER_CONFIG);
    expect(applyChatGpt(first.text, first.takeover)).toEqual(first);
  });
});

describe("restoreCodexOfficial", () => {
  it("returns the owned top-level keys to their exact bytes and keeps Osuna's provider table", () => {
    const { text, takeover } = apply(USER_CONFIG);

    expect(restore(text, takeover)).toBe(withKeptTable(USER_CONFIG));
  });

  it("removes keys that were absent before", () => {
    const original = `approval_policy = "never"

[features]
web_search = true
`;
    const { text, takeover } = apply(original);

    expect(restore(text, takeover)).toBe(withKeptTable(original));
  });

  it("removes keys inserted at the very top and on a last line without a newline", () => {
    const top = `# tables only\n[features]\nweb_search = true\n`;
    const topApplied = apply(top);
    expect(restore(topApplied.text, topApplied.takeover)).toBe(withKeptTable(top));

    // 没有结尾换行的单行文件：键插在它后面，恢复时连同前面补的换行一起拿走。
    const bare = `model = "a"`;
    const bareApplied = apply(bare);
    expect(restore(bareApplied.text, bareApplied.takeover)).toBe(withKeptTable(bare));
  });

  it("keeps edits the user made to other keys while it was on", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const edited = text.replace(`trust_level = "trusted"`, `trust_level = "untrusted"`);

    expect(restore(edited, takeover)).toBe(
      withKeptTable(USER_CONFIG.replace(`trust_level = "trusted"`, `trust_level = "untrusted"`)),
    );
  });

  it("puts back an original key the user deleted in the meantime", () => {
    const { text, takeover } = apply(USER_CONFIG);
    const withoutModel = text.replace(`model = "relay/gpt"   # the one I like\n`, "");

    expect(toValue(restore(withoutModel, takeover))).toMatchObject({ model: "gpt-5.1-codex" });
  });

  it("keeps a file it created, holding the table; deletes it only when nothing at all is left", () => {
    const { text, takeover } = apply(null);
    expect(restore(text, takeover)).toBe(RELAY_BLOCK);

    const withoutTable = text.slice(0, text.indexOf(`[model_providers.${ID}]`));
    expect(restoreCodexOfficial({ text: withoutTable, takeover })).toEqual({ kind: "delete" });
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

describe("refreshCodexProviderTable", () => {
  it("points a kept table at the gateway's new address and token, nothing else moved", () => {
    expect(refreshTable(withKeptTable(USER_CONFIG))).toEqual({
      kind: "patched",
      text: withKeptTable(USER_CONFIG, MOVED_BLOCK),
    });
  });

  it("leaves a table that already points there byte for byte", () => {
    const kept = withKeptTable(USER_CONFIG, MOVED_BLOCK);

    expect(refreshTable(kept)).toEqual({ kind: "patched", text: kept });
  });

  it("turns the auth.command table an older version left on Official into the gateway's", () => {
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

    expect(refreshTable(legacy)).toEqual({
      kind: "patched",
      text: withKeptTable(USER_CONFIG, MOVED_BLOCK),
    });
  });

  it("never writes a table that is not there, or a file that is missing", () => {
    expect(refreshTable(USER_CONFIG)).toEqual({ kind: "absent" });
    expect(refreshTable(null)).toEqual({ kind: "absent" });
  });

  it("refuses a file that does not parse", () => {
    expect(refreshTable("model = ").kind).toBe("unparsable");
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

  it("under a ChatGPT sign-in names openai_base_url and a model_provider put back by someone else", () => {
    const { text, takeover } = applyChatGpt(USER_CONFIG);
    expect(inspect(text, takeover).modifiedKeys).toEqual([]);

    const moved = text.replace(CHATGPT_URL, "https://proxy.example/v1");
    expect(inspect(moved, takeover).modifiedKeys).toEqual(["openai_base_url"]);

    const provider = text.replace(`approval_policy`, `model_provider = "mine"\napproval_policy`);
    expect(inspect(provider, takeover).modifiedKeys).toEqual(["model_provider"]);
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
