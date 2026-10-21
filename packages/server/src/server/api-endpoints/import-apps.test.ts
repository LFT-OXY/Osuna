import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readImportSources, type ImportReadContext } from "./import-apps.js";

/*
 * 来源的读法（照 magpie importapps.go 的各个 reader）：临时目录里的假配置，绝不读真实的家目录。
 * 状态判定、key 不出 daemon、只读与导入的三种操作见 daemon-e2e/api-endpoint-import.e2e.test.ts。
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function contextIn(): Promise<{ root: string; context: ImportReadContext }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-import-apps-"));
  roots.push(root);
  const context: ImportReadContext = {
    paths: {
      ccSwitchDir: path.join(root, "cc-switch"),
      claudeSettings: path.join(root, "claude", "settings.json"),
      codexConfig: path.join(root, "codex", "config.toml"),
      almaDatabase: path.join(root, "alma", "chat_threads.db"),
      openCodeAuth: path.join(root, "opencode", "auth.json"),
    },
    homeDir: root,
    isGatewayUrl: (url) => url.port === "6767",
    claudeOriginalEnv: () => null,
    osunaCodexCatalog: path.join(root, "osuna", "codex-models.json"),
  };
  return { root, context };
}

async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

function sourceOf(sources: ReturnType<typeof readImportSources>, id: string) {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`No ${id}`);
  return source;
}

describe("readImportSources", () => {
  test("CC Switch without a database reads config.json; Gemini and sign-ins can't be imported", async () => {
    const { root, context } = await contextIn();
    await put(
      path.join(root, "cc-switch", "config.json"),
      JSON.stringify({
        claude: {
          providers: {
            kimi: {
              name: "default",
              settingsConfig: {
                env: {
                  ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
                  ANTHROPIC_AUTH_TOKEN: "sk-kimi-1234",
                },
              },
            },
            own: { name: "Claude Official", settingsConfig: { env: {} } },
          },
        },
        gemini: {
          providers: { g: { name: "Gemini", settingsConfig: { env: { GEMINI_API_KEY: "k" } } } },
        },
      }),
    );
    const source = sourceOf(readImportSources({ context, includeOpenCode: false }), "cc-switch");
    expect(source.path).toBe(path.join(root, "cc-switch", "config.json"));
    expect(source.entries).toMatchObject([
      {
        ref: "claude/kimi",
        from: "Claude Code",
        // 地址正是 Moonshot 模板的：用那个模板，名称 default 换成模板的名字。
        name: "Kimi",
        found: { templateId: "moonshot", key: "sk-kimi-1234" },
        skip: null,
      },
      { ref: "claude/own", skip: "sign_in" },
      { ref: "gemini/g", skip: "gemini_unsupported" },
    ]);
  });

  test("Codex: Osuna's own table and a relay pointing at the gateway are not imported, headers come along", async () => {
    const { context } = await contextIn();
    await put(
      context.paths.codexConfig,
      [
        'model_provider = "osuna_api_endpoint"',
        "[model_providers.osuna_api_endpoint]",
        'base_url = "http://127.0.0.1:6767/api-endpoint-gateway/v1"',
        "[model_providers.loop]",
        'base_url = "http://localhost:6767/v1"',
        'experimental_bearer_token = "x"',
        "[model_providers.relay]",
        'name = "Relay"',
        'base_url = "https://relay.example/v1"',
        'experimental_bearer_token = "sk-relay-0000"',
        'wire_api = "chat"',
        "[model_providers.relay.http_headers]",
        'X-Org = "team" # 注释',
        "",
      ].join("\n"),
    );
    const source = sourceOf(readImportSources({ context, includeOpenCode: false }), "codex");
    expect(source.entries).toMatchObject([
      { ref: "loop", skip: "points_at_osuna" },
      { ref: "osuna_api_endpoint", skip: "points_at_osuna" },
      {
        ref: "relay",
        found: {
          baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
          headers: { "X-Org": "team" },
        },
      },
    ]);
  });

  test("a source that can't be read says so, and the others are still read", async () => {
    const { context } = await contextIn();
    await put(context.paths.claudeSettings, "{ not json");
    await put(context.paths.almaDatabase, "not a database");
    await put(
      context.paths.codexConfig,
      '[model_providers.r]\nbase_url = "https://r.example/v1"\nexperimental_bearer_token = "k"\n',
    );
    const sources = readImportSources({ context, includeOpenCode: false });
    expect(sourceOf(sources, "claude-code").error).toMatchObject({ code: "unparsable" });
    expect(sourceOf(sources, "alma").error).toMatchObject({ code: "unparsable" });
    expect(sourceOf(sources, "codex").entries).toHaveLength(1);
    expect(sourceOf(sources, "cc-switch")).toMatchObject({
      found: false,
      error: null,
      entries: [],
    });
  });
});
