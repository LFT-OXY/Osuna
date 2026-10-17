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
});
