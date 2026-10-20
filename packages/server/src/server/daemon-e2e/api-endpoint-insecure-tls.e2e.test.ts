import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { ManualTimers } from "../test-utils/manual-timers.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

/*
 * 不校验证书（接口管理好用性工单 23，照 magpie insecure_tls.go、netproxy/unchecked.go）：本机起一个自签证书的 HTTPS 假上游，
 * 只听 127.0.0.1。证书在用例里现生成，不入库。不开时每条路径都因证书失败；开了的那家成功；指向同一台服务、没开的另一家仍失败。
 */

const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const KEY = "sk-own-secret";

interface Upstream {
  origin: string;
  paths: string[];
}

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

/** 127.0.0.1 的自签证书，一天有效。 */
async function selfSignedCertificate(root: string): Promise<{ key: Buffer; cert: Buffer }> {
  const keyPath = path.join(root, "key.pem");
  const certPath = path.join(root, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  return { key: await readFile(keyPath), cert: await readFile(certPath) };
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const ANTHROPIC_REPLY = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "own-model",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

function answerChat(res: ServerResponse, body: Record<string, unknown>): void {
  if (body.stream !== true) {
    sendJson(res, {
      id: "chatcmpl-1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunks = [
    { id: "chatcmpl-1", choices: [{ index: 0, delta: { role: "assistant", content: "ok" } }] },
    {
      id: "chatcmpl-1",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end("data: [DONE]\n\n");
}

function answer(req: IncomingMessage, res: ServerResponse, raw: string): void {
  const url = req.url ?? "";
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  if (url.startsWith("/v1/models")) {
    sendJson(res, { data: [{ id: "own-model" }, { id: "chat-model" }] });
  } else if (url.startsWith("/v1/messages/count_tokens")) {
    sendJson(res, { input_tokens: 3 });
  } else if (url.startsWith("/v1/messages")) {
    sendJson(res, ANTHROPIC_REPLY);
  } else if (url.startsWith("/v1/chat/completions")) {
    answerChat(res, body);
  } else if (url.startsWith("/v1/responses")) {
    sendJson(res, { object: "response", status: "completed", output: [] });
  } else {
    res.writeHead(404).end("Not Found");
  }
}

async function startUpstream(root: string): Promise<Upstream> {
  const upstream: Upstream = { origin: "", paths: [] };
  const server = createServer(await selfSignedCertificate(root), (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      upstream.paths.push(req.url ?? "");
      answer(req, res, Buffer.concat(chunks).toString("utf8"));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

/**
 * 三家都指向同一台假上游：own（Anthropic 与 Chat 地址）、chat（只有 Chat 地址，Claude Code 的请求翻译过去）按 insecureTls 定，
 * other 从不打开。
 */
async function start(input: { insecureTls: boolean }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-insecure-tls-"));
  tempRoots.push(root);
  const upstream = await startUpstream(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const unchecked = input.insecureTls ? { insecureTls: true } : {};
  const endpoint = (fields: {
    id: string;
    name: string;
    baseUrls: { format: string; url: string }[];
    models: string[];
  }) => ({
    ...fields,
    slug: fields.id,
    models: fields.models.map((id) => ({ id })),
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  const files = {
    "endpoints.json": {
      endpoints: [
        {
          ...endpoint({
            id: "own",
            name: "Own",
            baseUrls: [
              { format: "anthropic_messages", url: upstream.origin },
              { format: "openai_chat", url: `${upstream.origin}/v1` },
            ],
            models: ["own-model"],
          }),
          ...unchecked,
        },
        {
          ...endpoint({
            id: "chat",
            name: "Chat",
            baseUrls: [{ format: "openai_chat", url: `${upstream.origin}/v1` }],
            models: ["chat-model"],
          }),
          ...unchecked,
        },
        endpoint({
          id: "other",
          name: "Other",
          baseUrls: [{ format: "anthropic_messages", url: upstream.origin }],
          models: ["other-model"],
        }),
      ],
      agents: {
        claude: { enabled: true, defaultModelId: "own-model" },
        codex: { enabled: false, defaultModelId: "" },
      },
    },
    "keys.json": { keys: { own: KEY, chat: KEY, other: KEY } },
    "gateway-tokens.json": { tokens: { claude: CLAUDE_TOKEN } },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
  }
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
      homeDir: root,
      gatewayRetryPauseMs: 10,
      modelTestTimers: new ManualTimers(),
      readCodexCliVersion: async () => null,
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
  return { upstream, client, gateway };
}

function claudeAsk(input: { gateway: string; model: string; suffix?: string }) {
  return fetch(`${input.gateway}/v1/messages${input.suffix ?? ""}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CLAUDE_TOKEN}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "user-agent": "claude-cli/2.1.302 (external, cli)",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

type Started = Awaited<ReturnType<typeof start>>;

/** 一家走过所有 daemon 发起的路径，各自成没成。 */
async function pathsOf(started: Started, endpointId: string) {
  const { client, upstream } = started;
  const fetched = await client.apiEndpointFetchModels({
    provider: "claude",
    endpointId,
    baseUrl: upstream.origin,
    format: "anthropic_messages",
  });
  const tested = await client.apiEndpointTestConnection({
    provider: "claude",
    endpointId,
    baseUrl: upstream.origin,
    format: "anthropic_messages",
    modelId: "own-model",
  });
  const detected = await client.apiEndpointDetectFormats({
    endpointId,
    baseUrl: upstream.origin,
    modelId: "own-model",
  });
  const modelTests = await client.apiEndpointTestModels({ endpointId });
  const anthropicDetected = detected.results.find(
    (result) => result.format === "anthropic_messages",
  );
  return {
    fetchModels: fetched.error === null,
    testConnection: tested.result?.ok === true,
    detect: anthropicDetected?.status === "ok",
    testModels: modelTests.results.length > 0 && modelTests.results.every((result) => result.ok),
  };
}

const ALL_FAIL = { fetchModels: false, testConnection: false, detect: false, testModels: false };
const ALL_PASS = { fetchModels: true, testConnection: true, detect: true, testModels: true };

describe("skip the certificate check", () => {
  test("off: every path to a self-signed upstream fails on its certificate", async () => {
    const started = await start({ insecureTls: false });
    expect(await pathsOf(started, "own")).toEqual(ALL_FAIL);
    expect(started.upstream.paths).toEqual([]);
    const asked = await claudeAsk({ gateway: started.gateway, model: "own-model" });
    expect(asked.status).toBeGreaterThanOrEqual(500);
    // count_tokens 问不到上游时中转站自己估，回的不是错；只看上游一个请求都没收到。
    await claudeAsk({ gateway: started.gateway, model: "own-model", suffix: "/count_tokens" });
    const translated = await claudeAsk({ gateway: started.gateway, model: "chat-model" });
    expect(translated.status).toBeGreaterThanOrEqual(500);
    expect(started.upstream.paths).toEqual([]);
  });

  test("on: every path of that endpoint answers; another endpoint at the same server still fails", async () => {
    const started = await start({ insecureTls: true });
    expect(await pathsOf(started, "own")).toEqual(ALL_PASS);

    const asked = await claudeAsk({ gateway: started.gateway, model: "own-model" });
    expect(asked.status).toBe(200);
    const counted = await claudeAsk({
      gateway: started.gateway,
      model: "own-model",
      suffix: "/count_tokens",
    });
    expect(counted.status).toBe(200);
    expect(await counted.json()).toEqual({ input_tokens: 3 });
    expect(started.upstream.paths).toContain("/v1/messages/count_tokens");
    const translated = await claudeAsk({ gateway: started.gateway, model: "chat-model" });
    expect(translated.status).toBe(200);
    expect(started.upstream.paths).toContain("/v1/chat/completions");

    started.upstream.paths.length = 0;
    expect(await pathsOf(started, "other")).toEqual(ALL_FAIL);
    const otherAsked = await claudeAsk({ gateway: started.gateway, model: "other-model" });
    expect(otherAsked.status).toBeGreaterThanOrEqual(500);
    expect(started.upstream.paths).toEqual([]);
  });

  test("the add dialog's unsaved setting is used before save, and the list is fetched on save", async () => {
    const started = await start({ insecureTls: false });
    const { client, upstream } = started;
    const form = { provider: "claude", baseUrl: upstream.origin, apiKey: KEY };
    const checked = await client.apiEndpointFetchModels({ ...form, format: "anthropic_messages" });
    expect(checked.error).not.toBeNull();
    const unchecked = await client.apiEndpointFetchModels({
      ...form,
      format: "anthropic_messages",
      insecureTls: true,
    });
    expect(unchecked.error).toBeNull();
    expect(unchecked.models.map((model) => model.id)).toEqual(["own-model", "chat-model"]);
    const tested = await client.apiEndpointTestConnection({
      ...form,
      format: "anthropic_messages",
      modelId: "own-model",
      insecureTls: true,
    });
    expect(tested.result?.ok).toBe(true);
    const detected = await client.apiEndpointDetectFormats({
      baseUrl: upstream.origin,
      apiKey: KEY,
      modelId: "own-model",
      insecureTls: true,
    });
    expect(detected.results.find((result) => result.format === "anthropic_messages")?.status).toBe(
      "ok",
    );

    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Self-signed",
      baseUrls: [{ format: "anthropic_messages", url: upstream.origin }],
      apiKey: KEY,
      models: [],
      insecureTls: true,
    });
    expect(saved.error).toBeNull();
    expect(saved.endpoint?.insecureTls).toBe(true);
    // 保存后当场拉的清单也不校验证书。
    expect(saved.endpoint?.catalog?.models.map((model) => model.id)).toEqual([
      "own-model",
      "chat-model",
    ]);
    // 编辑时关掉：之后照常校验。
    const turnedOff = await client.apiEndpointSave({
      provider: "claude",
      endpointId: saved.endpoint?.id ?? "",
      name: "Self-signed",
      baseUrls: [{ format: "anthropic_messages", url: upstream.origin }],
      models: [],
      insecureTls: false,
    });
    expect(turnedOff.endpoint?.insecureTls).toBeUndefined();
  });

  test("a template endpoint can't turn it on, and is told why", async () => {
    const started = await start({ insecureTls: false });
    const saved = await started.client.apiEndpointSave({
      provider: "claude",
      name: "DeepSeek",
      templateId: "deepseek",
      baseUrls: [{ format: "anthropic_messages", url: started.upstream.origin }],
      apiKey: KEY,
      models: [],
      insecureTls: true,
    });
    expect(saved.endpoint).toBeNull();
    expect(saved.error?.code).toBe("insecure_tls_template");
    expect(saved.error?.params).toEqual({ template: "deepseek" });
    expect(started.upstream.paths).toEqual([]);
  });
});
