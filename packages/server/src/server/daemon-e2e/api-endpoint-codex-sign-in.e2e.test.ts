import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CodexSignIn } from "../api-endpoints/codex-sign-in.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * Codex 的接法跟着它的登录方式走（ADR 0010）。登录方式只经可替换的适配器得到：
 * 这里的 daemon 都用固定答案，绝不起真的 Codex，也不读 auth.json。
 */

// 用户手写的 config.toml：没选过模型，用的是内置 openai 服务商。
const USER_CONFIG = `# my codex config
approval_policy = "never"

[projects."/Users/me/My Code"]
trust_level = "trusted"
`;

const AUTH_JSON = `{"OPENAI_API_KEY":null,"tokens":{"refresh_token":"rt-single-use"}}`;

const tempRoots: string[] = [];

describe.skipIf(process.platform === "win32")("Codex wiring follows how Codex is signed in", () => {
  let root: string;
  let codexHome: string;
  let configPath: string;
  let authPath: string;
  let signIn: CodexSignIn;
  let signInChecks: number;
  let askedHomes: string[];
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-codex-sign-in-"));
    tempRoots.push(root);
    codexHome = path.join(root, "codex-home");
    configPath = path.join(codexHome, "config.toml");
    authPath = path.join(codexHome, "auth.json");
    await mkdir(codexHome, { recursive: true });
    await writeFile(configPath, USER_CONFIG);
    await writeFile(authPath, AUTH_JSON);
    signIn = "chatgpt";
    signInChecks = 0;
    askedHomes = [];
    await start();
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function start(): Promise<void> {
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      apiEndpoints: {
        env: { CODEX_HOME: codexHome },
        homeDir: root,
        readCodexSignIn: async ({ codexHome: home }) => {
          signInChecks += 1;
          askedHomes.push(home);
          return signIn;
        },
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.16.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  }

  async function restart(): Promise<void> {
    await client.close();
    await daemon.close();
    await start();
  }

  async function createEndpoint(): Promise<void> {
    const saved = await client.apiEndpointSave({
      provider: "codex",
      name: "Relay",
      baseUrls: [{ format: "openai_responses", url: "https://relay.example/v1" }],
      apiKey: "sk-relay-secret",
      models: [{ id: "gpt-x" }],
    });
    expect(saved.error).toBeNull();
  }

  async function setCodex(enabled: boolean): Promise<void> {
    expect((await client.apiEndpointSetAgentSettings({ provider: "codex", enabled })).error).toBe(
      null,
    );
  }

  async function token(): Promise<string> {
    const text = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json"),
      "utf8",
    );
    const codex = (JSON.parse(text) as { tokens: Record<string, string> }).tokens.codex;
    if (!codex) throw new Error("Expected a Codex token");
    return codex;
  }

  async function table(): Promise<string> {
    return `[model_providers.osuna_api_endpoint]
name = "Osuna"
base_url = "http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1"
wire_api = "responses"
experimental_bearer_token = "${await token()}"
`;
  }

  function chatgptUrl(): string {
    return `http://127.0.0.1:${daemon.port}/api-endpoint-gateway/backend-api/codex`;
  }

  function catalogPath(): string {
    return path.join(daemon.paseoHome, "api-endpoints", "codex-models.json");
  }

  async function chatgptConfig(): Promise<string> {
    return `# my codex config
approval_policy = "never"
openai_base_url = "${chatgptUrl()}"

[projects."/Users/me/My Code"]
trust_level = "trusted"

${await table()}`;
  }

  async function providerConfig(): Promise<string> {
    return `# my codex config
approval_policy = "never"
model_provider = "osuna_api_endpoint"
model = "gpt-x"
model_catalog_json = ${JSON.stringify(catalogPath())}

[projects."/Users/me/My Code"]
trust_level = "trusted"

${await table()}`;
  }

  async function keptConfig(base = USER_CONFIG): Promise<string> {
    return `${base}\n${await table()}`;
  }

  const config = () => readFile(configPath, "utf8");

  test("signed in with ChatGPT: only openai_base_url and Osuna's table; Official puts it back", async () => {
    await createEndpoint();
    await setCodex(true);

    expect(await config()).toBe(await chatgptConfig());
    expect(signInChecks).toBeGreaterThan(0);
    // 问的是正被改写的这份 config.toml 所在的 Codex home，不是 Codex 提供方自己的环境。
    expect(new Set(askedHomes)).toEqual(new Set([codexHome]));

    await setCodex(false);
    expect(await config()).toBe(await keptConfig());
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);
  });

  test("Codex's cached model list is marked stale when the switch turns on and when the endpoint models change", async () => {
    // 照 magpie codexStaleCache：只改 fetched_at，其余照 Codex 写的留着；只动这个临时 CODEX_HOME。
    const cachePath = path.join(codexHome, "models_cache.json");
    const fresh = (etag: string) =>
      writeFile(
        cachePath,
        JSON.stringify({
          fetched_at: "2026-10-18T08:00:00Z",
          etag,
          client_version: "0.163.0",
          models: [{ slug: "gpt-5.5" }],
        }),
      );
    const cache = async () =>
      JSON.parse(await readFile(cachePath, "utf8")) as { fetched_at: string; etag: string };
    await fresh('W/"list-1"');
    const saved = await client.apiEndpointSave({
      provider: "codex",
      name: "Relay",
      baseUrls: [{ format: "openai_responses", url: "https://relay.example/v1" }],
      apiKey: "sk-relay-secret",
      models: [{ id: "gpt-x" }],
    });
    expect(saved.error).toBeNull();
    expect((await cache()).fetched_at).toBe("2026-10-18T08:00:00Z");

    await setCodex(true);
    expect(await cache()).toEqual({
      fetched_at: "1970-01-01T00:00:00Z",
      etag: 'W/"list-1"',
      client_version: "0.163.0",
      models: [{ slug: "gpt-5.5" }],
    });

    // Codex 重拉过（带着旧的标记）；接口的已选模型变了，又标成过期。
    await fresh('W/"list-1+osuna-000000000000"');
    const changed = await client.apiEndpointSave({
      provider: "codex",
      endpointId: saved.endpoint!.id,
      name: "Relay",
      baseUrls: [{ format: "openai_responses", url: "https://relay.example/v1" }],
      models: [{ id: "gpt-x" }, { id: "gpt-y" }],
    });
    expect(changed.error).toBeNull();
    expect((await cache()).fetched_at).toBe("1970-01-01T00:00:00Z");
  });

  test("an API key sign-in leaves Codex's cached model list alone", async () => {
    signIn = "api_key";
    const cachePath = path.join(codexHome, "models_cache.json");
    const text = JSON.stringify({ fetched_at: "2026-10-18T08:00:00Z", etag: '"list-1"' });
    await writeFile(cachePath, text);
    await createEndpoint();
    await setCodex(true);
    expect(await readFile(cachePath, "utf8")).toBe(text);
  });

  test.each(["api_key", "signed_out"] as const)(
    "signed in with %s: Osuna's provider table, model_provider and model_catalog_json as before",
    async (kind) => {
      signIn = kind;
      await createEndpoint();
      await setCodex(true);

      expect(await config()).toBe(await providerConfig());

      await setCodex(false);
      expect(await config()).toBe(await keptConfig());
    },
  );

  test("reading the status rewires Codex after it signs in or out of ChatGPT", async () => {
    await createEndpoint();
    await setCodex(true);
    expect(await config()).toBe(await chatgptConfig());

    signIn = "api_key";
    await client.apiEndpointList("codex");
    expect(await config()).toBe(await providerConfig());

    signIn = "chatgpt";
    await client.apiEndpointList("codex");
    expect(await config()).toBe(await chatgptConfig());

    await setCodex(false);
    expect(await config()).toBe(await keptConfig());
  });

  test("a daemon start rewires Codex for a sign-in that changed while it was down", async () => {
    signIn = "signed_out";
    await createEndpoint();
    await setCodex(true);
    expect(await config()).toBe(await providerConfig());

    signIn = "chatgpt";
    await restart();
    await expect.poll(config).toBe(await chatgptConfig());
  });

  test("an openai_base_url the user wrote is replaced while on and comes back on Official", async () => {
    const own = `openai_base_url = "https://proxy.example/v1"\n${USER_CONFIG}`;
    await writeFile(configPath, own);
    await createEndpoint();
    await setCodex(true);

    expect(await config()).toBe(`openai_base_url = "${chatgptUrl()}"
# my codex config
approval_policy = "never"

[projects."/Users/me/My Code"]
trust_level = "trusted"

${await table()}`);

    await setCodex(false);
    expect(await config()).toBe(await keptConfig(own));
  });

  test("on a provider of the user's own: it is taken out and the model magpie's connect picks is written", async () => {
    const own = `model = "gpt-x"
model_provider = "mine"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"
`;
    await writeFile(configPath, own);
    await createEndpoint();
    await setCodex(true);

    expect(await config()).toBe(`model = "relay/gpt-x"
openai_base_url = "${chatgptUrl()}"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"

${await table()}`);

    await setCodex(false);
    expect(await config()).toBe(await keptConfig(own));
  });

  test("openai_base_url changed by another program is told as no longer through the gateway", async () => {
    await createEndpoint();
    await setCodex(true);
    await writeFile(
      configPath,
      (await config()).replace(chatgptUrl(), "https://proxy.example/backend-api/codex"),
    );

    const listed = await client.apiEndpointList("codex");
    expect(listed.agentIssues?.codex).toEqual([
      expect.objectContaining({
        code: "not_through_gateway",
        params: expect.objectContaining({ keys: "openai_base_url" }),
      }),
    ]);
    // 被改过就不替用户改回：照旧等「重新应用」。
    expect(await config()).toContain("https://proxy.example/backend-api/codex");
  });

  // CC Switch 写的「OpenAI 镜像」服务商表：记在它名下的对话不跟 openai_base_url 走（magpie #1796）。
  const MIRROR_CONFIG = `${USER_CONFIG}
[model_providers.custom]
name = "OpenAI"
requires_openai_auth = true
wire_api = "responses"
`;

  test("CC Switch's OpenAI mirror points at the gateway's ChatGPT backend while on, and is itself again on Official", async () => {
    await writeFile(configPath, MIRROR_CONFIG);
    await createEndpoint();
    await setCodex(true);

    expect(await config()).toBe(`# my codex config
approval_policy = "never"
openai_base_url = "${chatgptUrl()}"

[projects."/Users/me/My Code"]
trust_level = "trusted"

[model_providers.custom]
name = "OpenAI"
requires_openai_auth = true
wire_api = "responses"
base_url = "${chatgptUrl()}"

${await table()}`);
    expect((await client.apiEndpointList("codex")).agentIssues?.codex).toEqual([]);

    await setCodex(false);
    expect(await config()).toBe(await keptConfig(MIRROR_CONFIG));
  });

  test("a mirror a profile names after it was pointed at the gateway still gets base_url taken off on Official", async () => {
    await writeFile(configPath, MIRROR_CONFIG);
    await createEndpoint();
    await setCodex(true);
    const profile = `\n[profiles.p]\nmodel_provider = "custom"\n`;
    await writeFile(configPath, (await config()) + profile);

    await restart();
    const reapplied = await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.error).toBeNull();
    // profile 点名的表不再改写（照 magpie），但仍记着、不算被外部改过。
    expect((await client.apiEndpointList("codex")).agentIssues?.codex).toEqual([]);

    await setCodex(false);
    expect(await config()).toBe(
      `${MIRROR_CONFIG}\n[profiles.p]\nmodel_provider = "custom"\n\n${await table()}`,
    );
  });

  test("an API key sign-in leaves CC Switch's OpenAI mirror alone", async () => {
    signIn = "api_key";
    await writeFile(configPath, MIRROR_CONFIG);
    await createEndpoint();
    await setCodex(true);

    expect(await config()).toContain(
      `wire_api = "responses"\n\n[model_providers.osuna_api_endpoint]`,
    );
  });

  test("a mirror's address changed by another program is told as no longer through the gateway", async () => {
    await writeFile(configPath, MIRROR_CONFIG);
    await createEndpoint();
    await setCodex(true);
    await writeFile(
      configPath,
      (await config()).replace(
        `\nbase_url = "${chatgptUrl()}"`,
        `\nbase_url = "https://cc.example/v1"`,
      ),
    );

    const listed = await client.apiEndpointList("codex");
    expect(listed.agentIssues?.codex).toEqual([
      expect.objectContaining({
        code: "not_through_gateway",
        params: expect.objectContaining({ keys: "model_providers.custom.base_url" }),
      }),
    ]);

    // 切回官方时，被改过的镜像表照现在的样子留着。
    await setCodex(false);
    expect(await config()).toContain(`base_url = "https://cc.example/v1"`);
  });
});
