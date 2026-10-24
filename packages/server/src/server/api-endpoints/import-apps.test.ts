// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/provider/importapps.go 各个 reader 与 importapps_test.go 的做法。
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isPlatform } from "../../test-utils/platform.js";
import {
  readImportSources,
  withoutSqliteExperimentalWarning,
  type ImportReadContext,
} from "./import-apps.js";

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
  test("CC Switch without a database reads config.json; Gemini comes in, sign-ins can't be imported", async () => {
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
          providers: {
            g: {
              name: "Gemini",
              settingsConfig: { env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3-pro" } },
            },
            relay: {
              name: "Gemini relay",
              settingsConfig: {
                env: {
                  GOOGLE_GEMINI_BASE_URL: "https://g.example.com/gemini/",
                  GEMINI_API_KEY: "g",
                },
              },
            },
            versioned: {
              name: "Versioned relay",
              settingsConfig: {
                env: {
                  GOOGLE_GEMINI_BASE_URL: "https://v.example.com/v1beta",
                  GOOGLE_API_KEY: "v",
                },
              },
            },
            own: { name: "Gemini CLI", settingsConfig: { env: {} } },
          },
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
      // 没给地址的是 Google 自己：Google Gemini 模板的 Chat 兼容地址。
      {
        ref: "gemini/g",
        found: {
          templateId: "google",
          key: "k",
          models: ["gemini-3-pro"],
          baseUrls: [
            {
              format: "openai_chat",
              url: "https://generativelanguage.googleapis.com/v1beta/openai",
            },
          ],
        },
        skip: null,
      },
      { ref: "gemini/own", skip: "sign_in" },
      // 说 Gemini 格式的中转服务：地址进 Gemini 地址，补上 Gemini CLI 自己会加的 /v1beta。
      {
        ref: "gemini/relay",
        found: {
          templateId: null,
          key: "g",
          baseUrls: [{ format: "gemini", url: "https://g.example.com/gemini/v1beta" }],
        },
        skip: null,
      },
      {
        ref: "gemini/versioned",
        found: { baseUrls: [{ format: "gemini", url: "https://v.example.com/v1beta" }] },
        skip: null,
      },
    ]);
  });

  test("Codex: Osuna's own table and a relay pointing at the gateway are not imported, headers come along", async () => {
    const { context } = await contextIn();
    await put(
      context.paths.codexConfig,
      [
        'model_provider = "relay"',
        'model = "relay-top"',
        'model_catalog_json = "catalog.json"',
        "[profiles.fast]",
        'model = "relay-fast"',
        'model_catalog_json = "~/osuna/codex-models.json"',
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
    await put(
      path.join(path.dirname(context.paths.codexConfig), "catalog.json"),
      JSON.stringify({
        models: [
          { slug: "listed-a", visibility: "list" },
          { slug: "hidden-b", visibility: "hide" },
          { slug: "relay-top" },
        ],
      }),
    );
    await put(context.osunaCodexCatalog, JSON.stringify({ models: [{ slug: "osuna-own" }] }));
    const source = sourceOf(readImportSources({ context, includeOpenCode: false }), "codex");
    expect(source.entries).toMatchObject([
      { ref: "loop", skip: "points_at_osuna" },
      { ref: "osuna_api_endpoint", skip: "points_at_osuna" },
      {
        ref: "relay",
        found: {
          baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
          headers: { "X-Org": "team" },
          // 顶层与 profile 的 model，加上 model_catalog_json 里没藏起来的；Osuna 自己写的目录不算。
          models: ["relay-top", "listed-a", "relay-fast"],
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
    expect(sourceOf(sources, "claude-code").error).toMatchObject({ code: "not_json" });
    expect(sourceOf(sources, "alma").error).toMatchObject({ code: "not_database" });
    expect(sourceOf(sources, "codex").entries).toHaveLength(1);
    expect(sourceOf(sources, "cc-switch")).toMatchObject({
      found: false,
      error: null,
      entries: [],
    });
  });

  test("at a template's host but not its exact address: the template is kept, the address as given", async () => {
    const { context } = await contextIn();
    await put(
      path.join(context.paths.ccSwitchDir, "config.json"),
      JSON.stringify({
        claude: {
          providers: {
            plan: {
              name: "Kimi plan",
              settingsConfig: {
                env: {
                  ANTHROPIC_BASE_URL: "https://api.moonshot.ai/some-plan/anthropic",
                  ANTHROPIC_AUTH_TOKEN: "sk-plan",
                },
              },
            },
          },
        },
      }),
    );
    const source = sourceOf(readImportSources({ context, includeOpenCode: false }), "cc-switch");
    expect(source.entries).toMatchObject([
      {
        name: "Kimi plan",
        found: {
          templateId: "moonshot",
          region: null,
          baseUrls: [
            { format: "anthropic_messages", url: "https://api.moonshot.ai/some-plan/anthropic" },
          ],
        },
      },
    ]);
  });

  test("at a host of one of a template's regions: the template and that region are kept, the address as given", async () => {
    const { context } = await contextIn();
    await put(
      context.paths.codexConfig,
      [
        "[model_providers.mimo]",
        'name = "MiMo"',
        'base_url = "https://token-plan-sgp.xiaomimimo.com/custom/v1"',
        'experimental_bearer_token = "sk-mimo"',
        "",
      ].join("\n"),
    );
    const source = sourceOf(readImportSources({ context, includeOpenCode: false }), "codex");
    expect(source.entries).toMatchObject([
      {
        found: {
          templateId: "xiaomi",
          region: "plan-sgp",
          baseUrls: [
            { format: "openai_responses", url: "https://token-plan-sgp.xiaomimimo.com/custom/v1" },
          ],
        },
      },
    ]);
  });

  // Windows 不按 chmod 的权限位拒绝打开文件，造不出「没权限打开」。
  test.skipIf(isPlatform("win32"))(
    "a database Osuna has no permission to open is unreadable, not 'not a database'",
    async () => {
      const { context } = await contextIn();
      await mkdir(path.dirname(context.paths.almaDatabase), { recursive: true });
      const db = new DatabaseSync(context.paths.almaDatabase);
      db.exec("CREATE TABLE providers (id TEXT)");
      db.close();
      await chmod(context.paths.almaDatabase, 0o000);
      try {
        const source = sourceOf(readImportSources({ context, includeOpenCode: false }), "alma");
        expect(source.error).toMatchObject({
          code: "unreadable",
          params: { errno: "SQLITE_CANTOPEN" },
        });
      } finally {
        await chmod(context.paths.almaDatabase, 0o600);
      }
    },
  );
});

describe("withoutSqliteExperimentalWarning", () => {
  test("drops only node:sqlite's ExperimentalWarning and puts emitWarning back", () => {
    const original = process.emitWarning;
    const seen = vi.fn();
    process.emitWarning = seen;
    try {
      withoutSqliteExperimentalWarning(() => {
        process.emitWarning(
          "SQLite is an experimental feature and might change at any time",
          "ExperimentalWarning",
        );
        process.emitWarning("SQLite is an experimental feature", { type: "ExperimentalWarning" });
        process.emitWarning("Something else is experimental", "ExperimentalWarning");
        process.emitWarning("SQLite went away", "DeprecationWarning");
      });
      expect(seen.mock.calls.map((call) => call[0])).toEqual([
        "Something else is experimental",
        "SQLite went away",
      ]);
      expect(process.emitWarning).toBe(seen);
    } finally {
      process.emitWarning = original;
    }
  });
});
