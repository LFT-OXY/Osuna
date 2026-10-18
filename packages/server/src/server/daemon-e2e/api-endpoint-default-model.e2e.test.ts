// 挑法的用例照 magpie（https://github.com/yetone/magpie，internal/agent/connect_pick_test.go 的 TestConnectKeepsTheModel）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CodexSignIn } from "../api-endpoints/codex-sign-in.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 打开「使用第三方接口」时默认模型怎么挑（ADR 0012、PRD 第 28、29 条）：返回的挑法与写进 CLI 配置的模型一致；
 * 默认模型可以指定某一家（接口标识/模型名），中转站先发给那家、那家冷却时换同名的别家。
 * 默认思考档位（PRD 第 31 条）写进 CLI 配置、关掉时还原，换默认模型后不收的档位改到最近一档，Osuna 新对话也从它起步。
 * 登录方式只经可替换的适配器得到，不起真的 Codex；CLI 配置目录都在临时目录里。
 */

interface FakeUpstream {
  url: string;
  models: string[];
  respond: (res: ServerResponse) => void;
}

const servers: Server[] = [];
const tempRoots: string[] = [];

/** config.toml 的顶层键。 */
function parseToml(text: string): Record<string, unknown> {
  const value: unknown = getStaticTOMLValue(parseTOML(text));
  if (typeof value !== "object" || value === null) throw new Error("Expected a TOML table");
  return Object.fromEntries(Object.entries(value));
}

/** 快照里 Claude Code 一个接口模型的思考档位、新对话的起步档位，以及每个会话锁在的档位。 */
async function modelThinking(client: DaemonClient, modelId: string) {
  const snapshot = await client.getProvidersSnapshot();
  const entry = snapshot.entries.find((candidate) => candidate.provider === "claude");
  const models = entry?.apiEndpointModelGroups?.flatMap((group) => group.models) ?? [];
  const model = models.find((candidate) => candidate.id === modelId);
  return {
    options: model?.thinkingOptions?.map((option) => option.id),
    start: model?.defaultThinkingOptionId,
    locked: entry?.lockedThinkingOptionId,
  };
}

interface ListedIssue {
  code: string;
  params?: Record<string, string>;
}

/** 文件最后写入的时刻（纳秒），看一次读状态有没有重写它。 */
async function modifiedAt(file: string): Promise<bigint> {
  return (await stat(file, { bigint: true })).mtimeNs;
}

function issueCodes(issues: ListedIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function modelReplaced(issues: ListedIssue[]): ListedIssue | undefined {
  return issues.find((issue) => issue.code === "model_replaced");
}

async function startUpstream(text: string): Promise<FakeUpstream> {
  const upstream: FakeUpstream = {
    url: "",
    models: [],
    respond: (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    },
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { model?: string };
      upstream.models.push(body.model ?? "");
      upstream.respond(res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

describe.skipIf(process.platform === "win32")("picking the default model on switch-on", () => {
  let root: string;
  let settingsPath: string;
  let configPath: string;
  let signIn: CodexSignIn;
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-default-model-"));
    tempRoots.push(root);
    const claudeDir = path.join(root, "claude");
    const codexHome = path.join(root, "codex");
    settingsPath = path.join(claudeDir, "settings.json");
    configPath = path.join(codexHome, "config.toml");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    signIn = "api_key";
    // models.dev 的缓存（不联网）：Claude Code 自己的模型新的在前，magpie 的 claudeOwn。
    const endpointsDir = path.join(root, ".paseo", "api-endpoints");
    await mkdir(endpointsDir, { recursive: true });
    await writeFile(
      path.join(endpointsDir, "models-dev.json"),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        etag: null,
        // glm-5.3 到 max 却没有 xhigh（magpie d1c485f7 说的那种），默认思考档位的用例用它。
        models: { "glm-5.3": { efforts: ["low", "high", "max"] } },
        claude: ["claude-opus-4-6", "claude-sonnet-4-5"],
      }),
    );
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome },
        homeDir: root,
        readCodexSignIn: async () => signIn,
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function saveEndpoint(input: { name: string; url?: string; models: string[] }) {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: input.name,
      baseUrls: [
        { format: "anthropic_messages", url: input.url ?? "https://relay.example" },
        { format: "openai_responses", url: `${input.url ?? "https://relay.example"}/v1` },
      ],
      apiKey: `sk-${input.name}`,
      models: input.models.map((id) => ({ id })),
    });
    expect(saved.error).toBeNull();
    const id = saved.endpoint?.id;
    if (!id) throw new Error("Expected a saved endpoint");
    expect(
      (await client.apiEndpointSetEndpointState({ endpointId: id, enabled: true })).error,
    ).toBe(null);
  }

  /** 两家：Relay A 选了 first 与 glm-4.6，Relay B 选了 claude-opus-4-6 与 glm-4.6。 */
  async function twoEndpoints(): Promise<void> {
    await saveEndpoint({ name: "Relay A", models: ["first", "glm-4.6"] });
    await saveEndpoint({ name: "Relay B", models: ["claude-opus-4-6", "glm-4.6"] });
  }

  async function turnOn(provider: string, defaultModelId?: string) {
    const result = await client.apiEndpointSetAgentSettings({
      provider,
      enabled: true,
      ...(defaultModelId ? { defaultModelId } : {}),
    });
    expect(result.error).toBeNull();
    return result;
  }

  async function turnOff(provider: string): Promise<void> {
    expect((await client.apiEndpointSetAgentSettings({ provider, enabled: false })).error).toBe(
      null,
    );
  }

  async function claudeModel(): Promise<unknown> {
    return (JSON.parse(await readFile(settingsPath, "utf8")) as { model?: unknown }).model;
  }

  async function codexModel(): Promise<unknown> {
    return parseToml(await readFile(configPath, "utf8")).model;
  }

  test("same: Claude Code goes on with the model it is on", async () => {
    await twoEndpoints();
    await writeFile(settingsPath, `{ "model": "glm-4.6" }\n`);

    const result = await turnOn("claude");

    expect(result.connection).toEqual({
      how: "same",
      model: "glm-4.6",
      previousModel: "glm-4.6",
    });
    expect(result.agent?.defaultModelId).toBe("glm-4.6");
    expect(await claudeModel()).toBe("glm-4.6");
  });

  test("alike: Claude Code on the opus alias goes to the Claude Opus an endpoint offers", async () => {
    await twoEndpoints();
    await writeFile(settingsPath, `{ "model": "opus" }\n`);

    const result = await turnOn("claude");

    expect(result.connection).toMatchObject({ how: "alike", model: "claude-opus-4-6" });
    expect(await claudeModel()).toBe("claude-opus-4-6");
  });

  test("first: no endpoint offers the model Claude Code is on", async () => {
    await twoEndpoints();
    await writeFile(settingsPath, `{ "model": "gpt-9" }\n`);

    const result = await turnOn("claude");

    expect(result.connection).toEqual({ how: "first", model: "first", previousModel: "gpt-9" });
    expect(await claudeModel()).toBe("first");
  });

  test("again: switched off and on, the default model of the switch-off comes back", async () => {
    await twoEndpoints();
    await writeFile(settingsPath, `{ "model": "glm-4.6" }\n`);
    await turnOn("claude");
    await turnOn("claude", "relay-b/glm-4.6");
    expect(await claudeModel()).toBe("relay-b/glm-4.6");
    await turnOff("claude");
    expect(await claudeModel()).toBe("glm-4.6");

    const result = await turnOn("claude");

    expect(result.connection).toMatchObject({ how: "again", model: "relay-b/glm-4.6" });
    expect(await claudeModel()).toBe("relay-b/glm-4.6");

    // 关掉后 CLI 的模型被改过：不再放回。
    await turnOff("claude");
    await writeFile(settingsPath, `{ "model": "opus" }\n`);
    expect((await turnOn("claude")).connection).toMatchObject({
      how: "alike",
      model: "claude-opus-4-6",
    });
  });

  test("kept: a switch already on, or a CLI still pointed at the gateway, stays on its model", async () => {
    await twoEndpoints();
    await writeFile(settingsPath, `{ "model": "glm-4.6" }\n`);
    await turnOn("claude", "relay-b/glm-4.6");

    const reapplied = await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.connection).toMatchObject({ how: "kept", model: "relay-b/glm-4.6" });

    // 「保留当前设置」后 settings.json 还指向中转站、写着 relay-b/glm-4.6。
    expect((await client.apiEndpointKeepCurrentSettings({ provider: "claude" })).error).toBeNull();
    const result = await turnOn("claude");

    expect(result.connection).toMatchObject({ how: "kept", model: "relay-b/glm-4.6" });
    expect(await claudeModel()).toBe("relay-b/glm-4.6");
  });

  test("with no endpoint offering a model the switch is refused, as before", async () => {
    const result = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });

    expect(result.error?.code).toBe("no_usable_model");
    expect(result.connection ?? null).toBeNull();
  });

  test("joined: Codex signed in with ChatGPT keeps its own model, written as it was, switched off and on again too", async () => {
    await twoEndpoints();
    signIn = "chatgpt";
    await writeFile(configPath, `model = "gpt-5.5"\n`);
    await turnOn("codex");
    await turnOn("codex", "relay-b/glm-4.6");
    await turnOff("codex");
    expect(await codexModel()).toBe("gpt-5.5");

    const result = await turnOn("codex");

    expect(result.connection).toMatchObject({ how: "joined", previousModel: "gpt-5.5" });
    expect(await codexModel()).toBe("gpt-5.5");
  });

  test("Codex signed in with ChatGPT on a provider of the user's own: the pick is the name written into config.toml", async () => {
    await twoEndpoints();
    signIn = "chatgpt";
    await writeFile(
      configPath,
      `model_provider = "mine"\nmodel = "glm-4.6"\n\n[model_providers.mine]\nname = "Mine"\nbase_url = "https://mine.example/v1"\n`,
    );

    const result = await turnOn("codex");

    expect(result.connection).toEqual({
      how: "same",
      model: "relay-a/glm-4.6",
      previousModel: "glm-4.6",
    });
    expect(await codexModel()).toBe("relay-a/glm-4.6");
  });

  test("default: Claude Code with no model set goes on with the newest of its own an endpoint offers", async () => {
    await twoEndpoints();
    await writeFile(settingsPath, `{}\n`);

    const result = await turnOn("claude");

    expect(result.connection).toEqual({
      how: "default",
      model: "claude-opus-4-6",
      previousModel: null,
    });
    expect(await claudeModel()).toBe("claude-opus-4-6");
  });

  test("default: Codex with no model set goes on with the first of its own model list an endpoint offers", async () => {
    await twoEndpoints();
    await writeFile(configPath, `approval_policy = "never"\n`);
    await writeFile(
      path.join(path.dirname(configPath), "models_cache.json"),
      JSON.stringify({
        etag: '"list-1"',
        models: [
          { slug: "gpt-5.5", priority: 2 },
          { slug: "glm-4.6", priority: 1 },
        ],
      }),
    );

    const result = await turnOn("codex");

    expect(result.connection).toMatchObject({ how: "default", model: "glm-4.6" });
    expect(await codexModel()).toBe("glm-4.6");
  });

  test("Codex on an API key: one endpoint's default model is written and is in Codex's model list", async () => {
    await twoEndpoints();
    await writeFile(configPath, `model = "gpt-9"\n`);

    const result = await turnOn("codex", "relay-b/glm-4.6");

    expect(result.connection ?? null).toBeNull();
    expect(await codexModel()).toBe("relay-b/glm-4.6");
    const catalogFile = parseToml(await readFile(configPath, "utf8")).model_catalog_json;
    if (typeof catalogFile !== "string") throw new Error("Expected model_catalog_json");
    const catalog = JSON.parse(await readFile(catalogFile, "utf8")) as {
      models: Array<{ slug: string }>;
    };
    expect(catalog.models.map((model) => model.slug)).toContain("relay-b/glm-4.6");
  });

  test("one endpoint's default model goes to that endpoint first, and to another offering it while it cools down", async () => {
    const upstreamA = await startUpstream("from A");
    const upstreamB = await startUpstream("from B");
    await saveEndpoint({ name: "Relay A", url: upstreamA.url, models: ["kimi-k2"] });
    await saveEndpoint({ name: "Relay B", url: upstreamB.url, models: ["kimi-k2"] });
    await turnOn("claude", "relay-b/kimi-k2");
    const model = await claudeModel();
    expect(model).toBe("relay-b/kimi-k2");
    const tokens = JSON.parse(
      await readFile(path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json"), "utf8"),
    ) as { tokens: Record<string, string> };
    const ask = () =>
      fetch(`http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.tokens.claude}`,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

    const first = await ask();
    expect(first.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await first.text()).toContain("from B");

    upstreamB.respond = (res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "busy" } }));
    };
    const failedOver = await ask();
    expect(failedOver.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await failedOver.text()).toContain("from A");

    const whileCooling = await ask();
    expect(whileCooling.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    await whileCooling.text();
    expect(upstreamB.models).toEqual(["kimi-k2", "kimi-k2"]);
    expect(upstreamA.models).toEqual(["kimi-k2", "kimi-k2"]);
  });
  describe("following the CLI's own picks", () => {
    // 照 magpie 的 Follow 与 Drift 的 replaced：CLI 自己存下的选择跟着走，换成哪家都没有的模型才提示。

    /** 像 CLI 那样改 settings.json 的顶层键，其余照旧。 */
    async function setClaudeKeys(values: Record<string, unknown>): Promise<void> {
      const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
      await writeFile(settingsPath, `${JSON.stringify({ ...settings, ...values }, null, 2)}\n`);
    }

    async function setCodexTopKey(key: string, value: string): Promise<void> {
      const text = await readFile(configPath, "utf8");
      const line = new RegExp(`^${key} = .*$`, "m");
      const next = line.test(text)
        ? text.replace(line, `${key} = "${value}"`)
        : `${key} = "${value}"\n${text}`;
      await writeFile(configPath, next);
    }

    async function listed(provider: string) {
      const list = await client.apiEndpointList(provider);
      expect(list.error).toBeNull();
      const issues = list.agentIssues?.[provider] ?? [];
      return {
        agent: list.agents?.[provider],
        issueCodes: issueCodes(issues),
        replaced: modelReplaced(issues),
        health: list.health,
      };
    }

    // 加一家接口：CLI 配置跟着重写（模型列表变了）。
    async function addRelayC(): Promise<void> {
      await saveEndpoint({ name: "Relay C", models: ["kimi-k2"] });
    }

    test.each([
      { saved: "claude-opus-4-6", defaultModelId: "claude-opus-4-6" },
      { saved: "relay-b/glm-4.6", defaultModelId: "relay-b/glm-4.6" },
      { saved: "glm-4.6[1m]", defaultModelId: "glm-4.6" },
    ])(
      "Claude Code: /model saving $saved, which an endpoint serves, becomes the default model and stays through a rewrite",
      async ({ saved, defaultModelId }) => {
        await twoEndpoints();
        await turnOn("claude", "first");

        await setClaudeKeys({ model: saved });

        const now = await listed("claude");
        expect(now.agent?.defaultModelId).toBe(defaultModelId);
        expect(now.issueCodes).not.toContain("model_replaced");
        expect(now.health).toEqual([]);

        await addRelayC();
        expect(await claudeModel()).toBe(saved);
        expect((await listed("claude")).health).toEqual([]);
      },
    );

    test("Claude Code: a model no endpoint serves is reported as replaced; re-apply writes the default model back, keep current settings stops the warning with the switch on", async () => {
      await twoEndpoints();
      await turnOn("claude", "first");

      await setClaudeKeys({ model: "gpt-9" });
      const replaced = await listed("claude");
      expect(replaced.replaced?.params).toMatchObject({ model: "gpt-9", file: settingsPath });
      expect(replaced.agent?.defaultModelId).toBe("first");
      // 之后的重写不改回 CLI 存下的模型。
      await addRelayC();
      expect(await claudeModel()).toBe("gpt-9");

      const reapplied = await client.apiEndpointSetAgentSettings({
        provider: "claude",
        enabled: true,
        reapply: true,
      });
      expect(reapplied.error).toBeNull();
      expect(await claudeModel()).toBe("first");
      expect((await listed("claude")).issueCodes).not.toContain("model_replaced");

      await setClaudeKeys({ model: "gpt-9" });
      const kept = await client.apiEndpointKeepCurrentSettings({
        provider: "claude",
        code: "model_replaced",
      });
      expect(kept.error).toBeNull();
      expect(kept.agent?.enabled).toBe(true);
      const after = await listed("claude");
      expect(after.issueCodes).not.toContain("model_replaced");
      expect(after.health).toEqual([]);
      expect(after.agent?.enabled).toBe(true);
      await saveEndpoint({ name: "Relay D", models: ["kimi-k3"] });
      expect(await claudeModel()).toBe("gpt-9");
    });

    test("Codex on an API key: /model saving an endpoint's model becomes the default model; one no endpoint serves is reported", async () => {
      await twoEndpoints();
      await writeFile(configPath, `model = "gpt-9"\n`);
      await turnOn("codex", "first");

      await setCodexTopKey("model", "relay-b/glm-4.6");
      const followed = await listed("codex");
      expect(followed.agent?.defaultModelId).toBe("relay-b/glm-4.6");
      expect(followed.issueCodes).not.toContain("model_replaced");
      await addRelayC();
      expect(await codexModel()).toBe("relay-b/glm-4.6");
      expect((await listed("codex")).health).toEqual([]);

      await setCodexTopKey("model", "gpt-9");
      const replaced = await listed("codex");
      expect(replaced.replaced?.params).toMatchObject({ model: "gpt-9", file: configPath });
      expect(replaced.agent?.defaultModelId).toBe("relay-b/glm-4.6");
    });

    test("Codex signed in with ChatGPT: an endpoint's model picked in /model becomes the default model; one of ChatGPT's own is no warning and stays", async () => {
      await twoEndpoints();
      signIn = "chatgpt";
      await writeFile(
        configPath,
        `model_provider = "mine"\nmodel = "glm-4.6"\n\n[model_providers.mine]\nname = "Mine"\nbase_url = "https://mine.example/v1"\n`,
      );
      await turnOn("codex");
      expect(await codexModel()).toBe("relay-a/glm-4.6");

      await setCodexTopKey("model", "relay-b/glm-4.6");
      expect((await listed("codex")).agent?.defaultModelId).toBe("relay-b/glm-4.6");

      await setCodexTopKey("model", "gpt-5.5");
      const beside = await listed("codex");
      expect(beside.issueCodes).not.toContain("model_replaced");
      expect(beside.health).toEqual([]);
      expect(beside.agent?.defaultModelId).toBe("relay-b/glm-4.6");
      await addRelayC();
      expect(await codexModel()).toBe("gpt-5.5");
    });

    test("Codex signed in with ChatGPT on its own provider: an endpoint's model picked in /model becomes the default model, though Osuna wrote no model", async () => {
      await twoEndpoints();
      signIn = "chatgpt";
      await writeFile(configPath, `model = "gpt-5.5"\n`);
      expect((await turnOn("codex")).connection).toMatchObject({ how: "joined" });

      await setCodexTopKey("model", "relay-a/glm-4.6");
      const followed = await listed("codex");
      expect(followed.agent?.defaultModelId).toBe("relay-a/glm-4.6");
      expect(followed.issueCodes).not.toContain("model_replaced");

      await setCodexTopKey("model", "gpt-5.5");
      const beside = await listed("codex");
      expect(beside.issueCodes).not.toContain("model_replaced");
      expect(beside.agent?.defaultModelId).toBe("relay-a/glm-4.6");
      expect(await codexModel()).toBe("gpt-5.5");
    });

    test("reading the state again leaves the takeover record alone when nothing changed", async () => {
      await twoEndpoints();
      signIn = "chatgpt";
      // ChatGPT 登录、模型归 Codex：每次读状态都看到它自己的模型。
      await writeFile(configPath, `model = "gpt-5.5"\n`);
      await turnOn("codex");
      await listed("codex");
      const record = path.join(daemon.paseoHome, "api-endpoints", "takeover-codex.json");
      const before = await modifiedAt(record);

      await listed("codex");
      await listed("codex");

      expect(await modifiedAt(record)).toBe(before);
    });

    test("a model followed while settings.json can't be written is followed on the next read", async () => {
      await twoEndpoints();
      await turnOn("claude", "first");
      await setClaudeKeys({ model: "relay-b/glm-4.6" });

      const claudeDir = path.dirname(settingsPath);
      await chmod(claudeDir, 0o500);
      try {
        await client.apiEndpointList("claude");
      } finally {
        await chmod(claudeDir, 0o700);
      }

      expect((await listed("claude")).agent?.defaultModelId).toBe("relay-b/glm-4.6");
      expect(await claudeModel()).toBe("relay-b/glm-4.6");
    });

    test("Keep current settings refuses a prompt it doesn't know and leaves the switch on", async () => {
      await twoEndpoints();
      await turnOn("claude", "first");

      const kept = await client.apiEndpointKeepCurrentSettings({
        provider: "claude",
        code: "other",
      });

      expect(kept.error?.code).toBe("invalid_input");
      expect((await listed("claude")).agent?.enabled).toBe(true);
    });

    test("thinking set in the CLI follows even when Osuna's default thinking is unset, and so does Ultra Code", async () => {
      await saveEndpoint({ name: "Relay C", models: ["glm-5.3", "kimi-k2"] });
      await turnOn("claude", "glm-5.3");
      expect((await listed("claude")).agent?.defaultThinkingOptionId ?? null).toBeNull();

      await setClaudeKeys({ effortLevel: "medium", ultracode: true });
      const followed = await listed("claude");
      expect(followed.agent).toMatchObject({
        defaultThinkingOptionId: "medium",
        usesUltraCode: true,
      });

      await setClaudeKeys({ ultracode: false });
      expect((await listed("claude")).agent?.usesUltraCode).toBe(false);

      await writeFile(configPath, `model_reasoning_effort = "low"\n`);
      await turnOn("codex", "glm-5.3");
      expect((await listed("codex")).agent?.defaultThinkingOptionId).toBe("low");
    });

    test("thinking: a level the CLI saved (effortLevel, modelSettings, model_reasoning_effort) becomes the default thinking and stays through a rewrite", async () => {
      await saveEndpoint({ name: "Relay C", models: ["glm-5.3", "kimi-k2"] });
      await twoEndpoints();
      await turnOn("claude", "glm-5.3");
      await client.apiEndpointSetAgentSettings({
        provider: "claude",
        enabled: true,
        defaultThinkingOptionId: "high",
      });

      // 别家模型读顶层 effortLevel。
      await setClaudeKeys({ effortLevel: "low" });
      expect((await listed("claude")).agent?.defaultThinkingOptionId).toBe("low");
      await saveEndpoint({ name: "Relay D", models: ["kimi-k3"] });
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
        effortLevel: "low",
      });

      // Claude 模型：/effort 只写 modelSettings。
      await turnOn("claude", "claude-opus-4-6");
      await setClaudeKeys({ modelSettings: { "claude-opus-4-6": { effortLevel: "medium" } } });
      expect((await listed("claude")).agent?.defaultThinkingOptionId).toBe("medium");
      await saveEndpoint({ name: "Relay E", models: ["kimi-k4"] });
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
        modelSettings: { "claude-opus-4-6": { effortLevel: "medium" } },
      });

      // Codex 的 model_reasoning_effort。
      await turnOn("codex", "glm-5.3");
      await client.apiEndpointSetAgentSettings({
        provider: "codex",
        enabled: true,
        defaultThinkingOptionId: "high",
      });
      await setCodexTopKey("model_reasoning_effort", "low");
      expect((await listed("codex")).agent?.defaultThinkingOptionId).toBe("low");
      await saveEndpoint({ name: "Relay F", models: ["kimi-k5"] });
      expect(parseToml(await readFile(configPath, "utf8")).model_reasoning_effort).toBe("low");
    });
  });

  describe("default thinking", () => {
    // Relay C：glm-5.3（Codex 里 low、high、max）与查不到资料的 kimi-k2（Codex 里四档）。
    async function relayC(): Promise<void> {
      await saveEndpoint({ name: "Relay C", models: ["glm-5.3", "kimi-k2"] });
    }

    const glmThinking = () => modelThinking(client, "relay-c/glm-5.3");

    function setThinking(provider: string, defaultThinkingOptionId: string | null) {
      return client.apiEndpointSetAgentSettings({
        provider,
        enabled: true,
        defaultThinkingOptionId,
      });
    }

    function setUltraCode(usesUltraCode: boolean) {
      return client.apiEndpointSetAgentSettings({
        provider: "claude",
        enabled: true,
        usesUltraCode,
      });
    }

    async function claudeSettings(): Promise<Record<string, unknown>> {
      return JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    }

    test("Claude Code: high at the top, max in CLAUDE_CODE_EFFORT_LEVEL, Ultra Code as ultracode beside the level; switching off restores the file", async () => {
      await relayC();
      await twoEndpoints();
      const before = `{
  "theme": "dark"
}
`;
      await writeFile(settingsPath, before);
      await turnOn("claude", "glm-5.3");

      expect(await setThinking("claude", "high")).toMatchObject({
        error: null,
        agent: { defaultThinkingOptionId: "high" },
      });
      expect(await claudeSettings()).toMatchObject({ effortLevel: "high" });
      expect((await claudeSettings()).modelSettings).toBeUndefined();

      // Claude 模型另写 modelSettings：Opus 5.5 起只读这里。
      await turnOn("claude", "claude-opus-4-6");
      expect(await claudeSettings()).toMatchObject({
        effortLevel: "high",
        modelSettings: { "claude-opus-4-6": { effortLevel: "high" } },
      });

      await setThinking("claude", "max");
      const atMax = await claudeSettings();
      expect(atMax.env).toMatchObject({ CLAUDE_CODE_EFFORT_LEVEL: "max" });
      expect(atMax.effortLevel).toBeUndefined();
      expect(atMax.modelSettings).toBeUndefined();

      await turnOn("claude", "kimi-k2");
      await setThinking("claude", "medium");
      expect(await setUltraCode(true)).toMatchObject({
        error: null,
        agent: { defaultThinkingOptionId: "medium", usesUltraCode: true },
      });
      const ultra = await claudeSettings();
      expect(ultra).toMatchObject({ ultracode: true, effortLevel: "medium" });
      expect((ultra.env as Record<string, unknown>).CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();

      await setUltraCode(false);
      expect((await claudeSettings()).ultracode).toBeUndefined();

      await setUltraCode(true);
      await turnOff("claude");
      expect(await readFile(settingsPath, "utf8")).toBe(before);
    });

    test("Ultra Code only where the model takes xhigh; a level the new model doesn't take stays as set, as magpie", async () => {
      await relayC();
      await twoEndpoints();
      await turnOn("claude", "claude-opus-4-6");

      expect((await setUltraCode(true)).error?.code).toBe("invalid_input");
      expect((await setThinking("claude", "xhigh")).error?.code).toBe("invalid_input");

      // 别家模型五档都给，有 Ultra Code。
      await turnOn("claude", "glm-5.3");
      expect(await setThinking("claude", "xhigh")).toMatchObject({ error: null });

      // Opus 4.6 没有 xhigh：设置不改，Claude Code 自己按 high 跑；不会改成 max 锁住所有会话。
      const moved = await turnOn("claude", "claude-opus-4-6");
      const stored = JSON.parse(
        await readFile(path.join(daemon.paseoHome, "api-endpoints", "endpoints.json"), "utf8"),
      ) as { agents: { claude: { defaultThinkingOptionId?: string } } };
      expect(stored.agents.claude.defaultThinkingOptionId).toBe("xhigh");
      const settings = await claudeSettings();
      expect(settings.effortLevel).toBe("xhigh");
      expect(settings.env).not.toHaveProperty("CLAUDE_CODE_EFFORT_LEVEL");
      // 显示照 magpie 的 claudeClamp：Opus 4.6 跑在 high。
      expect(moved.agent?.defaultThinkingOptionId).toBe("high");
      expect((await client.apiEndpointList("claude")).agents?.claude?.defaultThinkingOptionId).toBe(
        "high",
      );
    });

    test("Ultra Code reads as off on a default model without xhigh, and as on again on one with it", async () => {
      await relayC();
      await twoEndpoints();
      await turnOn("claude", "glm-5.3");
      expect(await setUltraCode(true)).toMatchObject({ agent: { usesUltraCode: true } });

      const moved = await turnOn("claude", "claude-opus-4-6");
      expect(moved.agent?.usesUltraCode).toBe(false);
      expect((await client.apiEndpointList("claude")).agents?.claude?.usesUltraCode).toBe(false);

      const back = await turnOn("claude", "glm-5.3");
      expect(back.agent?.usesUltraCode).toBe(true);
      expect((await claudeSettings()).ultracode).toBe(true);
    });

    test("Codex: any level Codex takes goes into model_reasoning_effort; a new model moves it to its nearest; switching off puts the user's own back", async () => {
      await relayC();
      const before = `model_reasoning_effort = "low"\n`;
      await writeFile(configPath, before);
      await turnOn("codex", "glm-5.3");

      expect(await setThinking("codex", "xhigh")).toMatchObject({
        error: null,
        agent: { defaultThinkingOptionId: "xhigh" },
      });
      expect(await setThinking("codex", "max")).toMatchObject({ error: null });
      expect(parseToml(await readFile(configPath, "utf8")).model_reasoning_effort).toBe("max");

      // kimi-k2 没有资料，Codex 里四档：max 改到最近的 xhigh。
      const moved = await turnOn("codex", "kimi-k2");
      expect(moved.agent?.defaultThinkingOptionId).toBe("xhigh");
      expect(parseToml(await readFile(configPath, "utf8")).model_reasoning_effort).toBe("xhigh");

      await turnOff("codex");
      expect(parseToml(await readFile(configPath, "utf8")).model_reasoning_effort).toBe("low");
    });

    test("Osuna's new chats start at the default thinking, and every Claude session is said to be locked at max", async () => {
      await relayC();
      await turnOn("claude", "glm-5.3");
      await setThinking("claude", "high");

      await expect.poll(glmThinking, { timeout: 10_000 }).toEqual({
        options: ["low", "medium", "high", "xhigh", "max", "ultracode"],
        start: "high",
        locked: undefined,
      });

      await setThinking("claude", "max");
      await expect
        .poll(glmThinking, { timeout: 10_000 })
        .toMatchObject({ start: "max", locked: "max" });

      await setUltraCode(true);
      await expect.poll(glmThinking, { timeout: 10_000 }).toMatchObject({ start: "ultracode" });
    });
  });
});
