// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/disabled_test.go 与 internal/provider/disabled_test.go 的做法）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FakeHostProcesses } from "../test-utils/fake-host-processes.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 已禁用的模型（工单 16，prd 第 31 条）：真实 daemon + 本机假上游。CLI 用 fetch 扮演，带上中转站口令。
 * 进程表经假的「进程与命令」，什么都不真的读。
 */

const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const CODEX_TOKEN = "gateway-token-codex-0123456789";

const servers: Server[] = [];
const tempRoots: string[] = [];
const daemons: TestPaseoDaemon[] = [];
const clients: DaemonClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface FakeUpstream {
  url: string;
  models: string[];
}

/** 什么都答「ok」的上游，记下每个请求问的模型。 */
async function startUpstream(): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { url: "", models: [] };
  const server = createServer((req, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
        model?: string;
      };
      upstream.models.push(body.model ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

function endpoint(input: { id: string; slug: string; url: string; models: string[] }) {
  return {
    id: input.id,
    slug: input.slug,
    name: input.slug.toUpperCase(),
    baseUrls: [
      { format: "anthropic_messages", url: input.url },
      { format: "openai_responses", url: `${input.url}/v1` },
    ],
    models: input.models.map((id) => ({ id })),
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

/**
 * 两家接口都开着：A 有 kimi-k2、gemini-3-preview、gpt-5.5，B 有 kimi-k2、glm-5-preview。
 * Claude Code 与 Codex 的总开关都开着。
 */
async function start(input: { claudeDefaultModel?: string; processes?: FakeHostProcesses } = {}) {
  const upstream = await startUpstream();
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-disabled-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  const claudeDir = path.join(root, "claude");
  const codexHome = path.join(root, "codex");
  await mkdir(endpointsDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(claudeDir, "settings.json"), "{}\n");
  const files = {
    "endpoints.json": {
      endpoints: [
        endpoint({
          id: "ep_a",
          slug: "relay-a",
          url: upstream.url,
          models: ["kimi-k2", "gemini-3-preview", "gpt-5.5"],
        }),
        endpoint({
          id: "ep_b",
          slug: "relay-b",
          url: upstream.url,
          models: ["kimi-k2", "glm-5-preview"],
        }),
      ],
      agents: {
        claude: { enabled: true, defaultModelId: input.claudeDefaultModel ?? "kimi-k2" },
        codex: { enabled: true, defaultModelId: "gpt-5.5" },
      },
    },
    "keys.json": { keys: { ep_a: "sk-a", ep_b: "sk-b" } },
    "gateway-tokens.json": { tokens: { claude: CLAUDE_TOKEN, codex: CODEX_TOKEN } },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
  }
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome },
      homeDir: root,
      ...(input.processes ? { hostProcesses: input.processes } : {}),
    },
  });
  daemons.push(daemon);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.12.1",
  });
  clients.push(client);
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  const gateway = `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
  return { daemon, client, upstream, gateway, claudeDir, endpointsDir };
}

function asClaude(gateway: string, pathname: string, model: string): Promise<Response> {
  return fetch(`${gateway}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CLAUDE_TOKEN}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

function asCodex(gateway: string, model: string): Promise<Response> {
  return fetch(`${gateway}/v1/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${CODEX_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: "hi", stream: false }),
  });
}

function modelIdsOf(rows: { models: { id: string }[] }[]): string[][] {
  return rows.map((row) => row.models.map((model) => model.id));
}

function refusal(model: string, pattern: string): string {
  return `model ${model} is disabled in Osuna (it matches "${pattern}" in Settings › API endpoints › Disabled models); enable it there. Only requests through Osuna are refused`;
}

describe("disabled models", () => {
  test("the list is saved as typed, without empties or repeats, and comes back with the endpoint list", async () => {
    const { client } = await start();
    expect((await client.apiEndpointList("claude")).disabledModels).toEqual([]);

    const saved = await client.apiEndpointSetDisabledModels({
      models: [" *-preview ", "", "*-PREVIEW", "relay-b/kimi-k2"],
    });

    expect(saved.error).toBeNull();
    expect((await client.apiEndpointList("codex")).disabledModels).toEqual([
      "*-preview",
      "relay-b/kimi-k2",
    ]);
    await client.apiEndpointSetDisabledModels({ models: [] });
    expect((await client.apiEndpointList("claude")).disabledModels).toEqual([]);
  });

  test("with *-preview disabled no endpoint serves a preview model: the gateway's list and Codex's catalog go without them", async () => {
    const { client, gateway, daemon } = await start();

    await client.apiEndpointSetDisabledModels({ models: ["*-preview"] });

    const listed = (await (
      await fetch(`${gateway}/v1/models`, { headers: { authorization: `Bearer ${CLAUDE_TOKEN}` } })
    ).json()) as { data: { id: string }[] };
    expect(listed.data.map((model) => model.id)).toEqual(["kimi-k2", "gpt-5.5"]);
    const catalog = JSON.parse(
      await readFile(path.join(daemon.paseoHome, "api-endpoints", "codex-models.json"), "utf8"),
    ) as { models: { slug: string }[] };
    expect(catalog.models.map((model) => model.slug)).not.toContain("relay-a/gemini-3-preview");
    expect(catalog.models.map((model) => model.slug)).not.toContain("relay-b/glm-5-preview");
    expect(catalog.models.map((model) => model.slug)).toContain("relay-a/kimi-k2");
    // 存下的已选模型不改：解禁后原样回来。
    expect(modelIdsOf((await client.apiEndpointList("claude")).endpoints)).toEqual([
      ["kimi-k2", "gemini-3-preview", "gpt-5.5"],
      ["kimi-k2", "glm-5-preview"],
    ]);
  });

  test("a hard request for a disabled model is a 403 in the request's own format, naming the entry and where to change it, and reaches no endpoint", async () => {
    const { client, gateway, upstream } = await start();
    await client.apiEndpointSetDisabledModels({ models: ["*-preview"] });

    const messages = await asClaude(gateway, "/v1/messages", "gemini-3-preview");
    expect(messages.status).toBe(403);
    expect(await messages.json()).toEqual({
      type: "error",
      error: { type: "permission_error", message: refusal("gemini-3-preview", "*-preview") },
    });

    const counted = await asClaude(gateway, "/v1/messages/count_tokens", "relay-b/glm-5-preview");
    expect(counted.status).toBe(403);
    expect(await counted.json()).toEqual({
      type: "error",
      error: {
        type: "permission_error",
        message: refusal("relay-b/glm-5-preview", "*-preview"),
      },
    });

    const responses = await asCodex(gateway, "relay-a~gemini-3-preview");
    expect(responses.status).toBe(403);
    expect(await responses.json()).toEqual({
      error: {
        message: refusal("relay-a~gemini-3-preview", "*-preview"),
        type: "permission_error",
        code: null,
        param: null,
      },
    });
    expect(upstream.models).toEqual([]);

    // 别的模型照常。
    expect((await asClaude(gateway, "/v1/messages", "kimi-k2")).status).toBe(200);
    expect(upstream.models).toEqual(["kimi-k2"]);
  });

  test("an entry naming one endpoint's model leaves the others serving it; with none left the request is refused by that entry", async () => {
    const { client, gateway, upstream } = await start();
    await client.apiEndpointSetDisabledModels({ models: ["relay-a/kimi-k2"] });

    const served = await asClaude(gateway, "/v1/messages", "kimi-k2");
    expect(served.status).toBe(200);
    expect(served.headers.get("x-osuna-api-endpoint")).toBe("relay-b");

    await client.apiEndpointSetDisabledModels({ models: ["relay-a/kimi-k2", "relay-b/kimi-k2"] });
    const refused = await asClaude(gateway, "/v1/messages", "kimi-k2");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      refusal("kimi-k2", "relay-a/kimi-k2"),
    );
    expect(upstream.models).toEqual(["kimi-k2"]);
  });

  test("a test skips disabled models: one named is not asked and says why, and the model picked for a format is one left", async () => {
    const { client, upstream } = await start();
    await client.apiEndpointSetDisabledModels({ models: ["kimi-*"] });

    const named = await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId: "ep_b",
      baseUrl: "http://127.0.0.1:9",
      modelId: "kimi-k2",
    });
    expect(named.result).toEqual({
      ok: false,
      status: null,
      durationMs: 0,
      error: {
        code: "model_disabled",
        params: { model: "kimi-k2", pattern: "kimi-*" },
        message: refusal("kimi-k2", "kimi-*"),
      },
    });
    expect(upstream.models).toEqual([]);

    const picked = await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId: "ep_b",
      baseUrl: upstream.url,
      format: "anthropic_messages",
    });
    expect(picked.result?.ok).toBe(true);
    expect(upstream.models).toEqual(["glm-5-preview"]);
  });

  test("a default model that gets disabled moves to the first one left, and who to reopen is told as after any rewrite", async () => {
    const processes = new FakeHostProcesses();
    const { client, claudeDir } = await start({
      claudeDefaultModel: "gemini-3-preview",
      processes,
    });
    processes.processes = [
      {
        pid: 10,
        parentPid: 1,
        startedAt: new Date(Date.now() - 3_600_000),
        commandLine: "/Users/me/.local/bin/claude",
      },
    ];

    await client.apiEndpointSetDisabledModels({ models: ["*-preview"] });

    const list = await client.apiEndpointList("claude");
    expect(list.agents?.claude.defaultModelId).toBe("kimi-k2");
    const settings = JSON.parse(await readFile(path.join(claudeDir, "settings.json"), "utf8")) as {
      model: string;
    };
    expect(settings.model).toBe("kimi-k2");
    expect(list.reopenHints?.claude).toContainEqual(
      expect.objectContaining({ kind: "cli", count: 1 }),
    );
  });
});
