// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/routing.go 的 restAfterMarked 用 QuotaRest、RestCap，
// internal/provider/concurrency.go 的 SetQuotaRest、SetRestCap）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 每家的冷却设置（工单 24，prd 第 37 条）：真实 daemon + 本机假上游，冷却用注入的时钟算，结果是确定的。
 * CLI 用 fetch 扮演，带上中转站口令。A 排第一、B 在后，两家都选了 kimi-k2；B 总是答。
 */

const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const CODEX_TOKEN = "gateway-token-codex-0123456789";
const MINUTE = 60_000;
const NOW = Date.parse("2026-10-21T08:00:00.000Z");

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
  asked: number;
  // 每个请求怎么回；缺省答「ok」。
  respond: (res: ServerResponse) => void;
}

function answer(res: ServerResponse) {
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
}

function failWith(
  res: ServerResponse,
  input: { status: number; message: string; headers?: Record<string, string> },
) {
  res.writeHead(input.status, { "content-type": "application/json", ...input.headers });
  res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: input.message } }));
}

async function startUpstream(): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { url: "", asked: 0, respond: answer };
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      upstream.asked += 1;
      upstream.respond(res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

function storedEndpoint(input: {
  id: string;
  slug: string;
  url: string;
  cooldownSettings?: unknown;
}) {
  return {
    id: input.id,
    slug: input.slug,
    name: input.slug === "relay-a" ? "Relay A" : "Relay B",
    baseUrls: [{ format: "anthropic_messages", url: input.url }],
    models: [{ id: "kimi-k2" }],
    enabled: true,
    ...(input.cooldownSettings !== undefined ? { cooldownSettings: input.cooldownSettings } : {}),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** A 的冷却设置写在文件里（缺省不写）；时钟停在 NOW。 */
async function start(input: { cooldownSettingsA?: unknown } = {}) {
  const upstreamA = await startUpstream();
  const upstreamB = await startUpstream();
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-cooldown-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const files = {
    "endpoints.json": {
      endpoints: [
        storedEndpoint({
          id: "ep_a",
          slug: "relay-a",
          url: upstreamA.url,
          cooldownSettings: input.cooldownSettingsA,
        }),
        storedEndpoint({ id: "ep_b", slug: "relay-b", url: upstreamB.url }),
      ],
      agents: {
        claude: { enabled: true, defaultModelId: "kimi-k2" },
        codex: { enabled: true, defaultModelId: "kimi-k2" },
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
      env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
      homeDir: root,
      gatewayRetryPauseMs: 10,
      cooldownsNow: () => NOW,
    },
  });
  daemons.push(daemon);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.16.0",
  });
  clients.push(client);
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  const gateway = `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
  const ask = async () => {
    const response = await fetch(`${gateway}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CLAUDE_TOKEN}`,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "kimi-k2",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    await response.text();
    return response.headers.get("x-osuna-api-endpoint");
  };
  return { client, upstreamA, upstreamB, ask, endpointsDir };
}

async function endpointOf(client: DaemonClient, id: string) {
  const list = await client.apiEndpointList("claude");
  return list.endpoints.find((endpoint) => endpoint.id === id);
}

async function restOf(client: DaemonClient, id: string): Promise<number | null> {
  const until = (await endpointOf(client, id))?.cooldown?.until;
  return until ? (Date.parse(until) - NOW) / MINUTE : null;
}

function saveA(client: DaemonClient, upstreamUrl: string, extra: Record<string, unknown>) {
  return client.apiEndpointSave({
    provider: "claude",
    endpointId: "ep_a",
    name: "Relay A",
    baseUrls: [{ format: "anthropic_messages", url: upstreamUrl }],
    models: [{ id: "kimi-k2" }],
    ...extra,
  });
}

const QUOTA = { status: 429, message: "You exceeded your current quota" };

describe("an endpoint's own cooldown settings", () => {
  test("set to rest an hour out of quota: the endpoint out of quota sits out an hour", async () => {
    const { client, upstreamA, ask } = await start();
    const saved = await saveA(client, upstreamA.url, {
      cooldownSettings: { quotaRestMinutes: 60 },
    });
    expect(saved.error).toBeNull();
    expect(saved.endpoint?.cooldownSettings).toEqual({ quotaRestMinutes: 60 });
    upstreamA.respond = (res) => failWith(res, QUOTA);

    expect(await ask()).toBe("relay-b");

    expect(await restOf(client, "ep_a")).toBe(60);
    expect(await ask()).toBe("relay-b");
    expect(upstreamA.asked).toBe(1);
  });

  test("set to rest until a time of day: the endpoint out of quota sits out until it next comes round", async () => {
    const { client, upstreamA, ask } = await start();
    const saved = await saveA(client, upstreamA.url, {
      cooldownSettings: { quotaResetAt: " 16:00Z " },
    });
    expect(saved.endpoint?.cooldownSettings).toEqual({ quotaResetAt: "16:00Z" });
    upstreamA.respond = (res) => failWith(res, QUOTA);

    expect(await ask()).toBe("relay-b");

    // 时钟停在 UTC 08:00：到 16:00 是 8 小时。
    expect(await restOf(client, "ep_a")).toBe(8 * 60);
  });

  test("a time of day already past today rests until tomorrow's, on the vendor's clock", async () => {
    const { client, upstreamA, ask } = await start({
      cooldownSettingsA: { quotaResetAt: "08:00+08:00" },
    });
    upstreamA.respond = (res) => failWith(res, QUOTA);

    await ask();

    // UTC 08:00 是北京 16:00，北京今天的 08:00 已过：明天的，24 - 8 = 16 小时。
    expect(await restOf(client, "ep_a")).toBe(16 * 60);
  });

  test("a time the vendor names stands over the endpoint's own rest", async () => {
    const { client, upstreamA, ask } = await start({
      cooldownSettingsA: { quotaRestMinutes: 60 },
    });
    upstreamA.respond = (res) => failWith(res, { ...QUOTA, headers: { "retry-after": "1200" } });

    expect(await ask()).toBe("relay-b");

    expect(await restOf(client, "ep_a")).toBe(20);
  });

  test("no rest after an unknown failure: a failing endpoint is asked again by the next request", async () => {
    const { client, upstreamA, upstreamB, ask } = await start({
      cooldownSettingsA: { noFailRest: true },
    });
    upstreamA.respond = (res) => failWith(res, { status: 503, message: "upstream busy" });

    expect(await ask()).toBe("relay-b");
    expect(await restOf(client, "ep_a")).toBeNull();
    expect(await ask()).toBe("relay-b");

    expect(upstreamA.asked).toBe(2);
    expect(upstreamB.asked).toBe(2);
    upstreamA.respond = answer;
    expect(await ask()).toBe("relay-a");
  });

  test("set to nothing: out of quota a quarter hour, an unknown failure a minute, as before", async () => {
    const { client, upstreamA, ask } = await start();
    expect((await endpointOf(client, "ep_a"))?.cooldownSettings).toBeUndefined();
    upstreamA.respond = (res) => failWith(res, QUOTA);
    await ask();
    expect(await restOf(client, "ep_a")).toBe(15);

    await client.apiEndpointSetEndpointState({ endpointId: "ep_a", clearCooldown: true });
    upstreamA.respond = (res) => failWith(res, { status: 503, message: "upstream busy" });
    expect(await ask()).toBe("relay-b");
    expect(await restOf(client, "ep_a")).toBe(1);
  });
});

describe("saving cooldown settings", () => {
  test("whole minutes from 0 to eight days are kept, an empty set clears them, and a copy carries them", async () => {
    const { client, upstreamA, endpointsDir } = await start();
    const kept = await saveA(client, upstreamA.url, {
      cooldownSettings: { quotaRestMinutes: 11_520, restCapMinutes: 0 },
    });
    expect(kept.error).toBeNull();
    // 0 是用中转站自己的，不存。
    expect(kept.endpoint?.cooldownSettings).toEqual({ quotaRestMinutes: 11_520 });

    const copied = await client.apiEndpointSave({
      provider: "claude",
      copyOf: "ep_a",
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: upstreamA.url }],
      models: [{ id: "kimi-k2" }],
    });
    expect(copied.endpoint?.cooldownSettings).toEqual({ quotaRestMinutes: 11_520 });

    // 省略即保留。
    const untouched = await saveA(client, upstreamA.url, {});
    expect(untouched.endpoint?.cooldownSettings).toEqual({ quotaRestMinutes: 11_520 });

    const cleared = await saveA(client, upstreamA.url, { cooldownSettings: {} });
    expect(cleared.endpoint?.cooldownSettings).toBeUndefined();
    const file = JSON.parse(await readFile(path.join(endpointsDir, "endpoints.json"), "utf8")) as {
      endpoints: { id: string; cooldownSettings?: unknown }[];
    };
    expect(file.endpoints.find((entry) => entry.id === "ep_a")?.cooldownSettings).toBeUndefined();
  });

  test("a time of day and minutes are one setting: the time stands, and one it can't read is refused", async () => {
    const { client, upstreamA } = await start();
    const both = await saveA(client, upstreamA.url, {
      cooldownSettings: { quotaRestMinutes: 60, quotaResetAt: "00:00+08:00" },
    });
    expect(both.endpoint?.cooldownSettings).toEqual({ quotaResetAt: "00:00+08:00" });
    const minutes = await saveA(client, upstreamA.url, {
      cooldownSettings: { quotaRestMinutes: 60 },
    });
    expect(minutes.endpoint?.cooldownSettings).toEqual({ quotaRestMinutes: 60 });

    const refused = await saveA(client, upstreamA.url, {
      cooldownSettings: { quotaResetAt: "8am" },
    });
    expect(refused.endpoint).toBeNull();
    expect(refused.error).toMatchObject({
      code: "invalid_cooldown_settings",
      params: { field: "quotaResetAt" },
    });
  });

  test("no rest after an unknown failure takes the place of a longest rest (magpie RestCapOff)", async () => {
    const { client, upstreamA } = await start();
    const saved = await saveA(client, upstreamA.url, {
      cooldownSettings: { restCapMinutes: 45, noFailRest: true },
    });
    expect(saved.endpoint?.cooldownSettings).toEqual({ noFailRest: true });
  });

  test.each([
    { field: "quotaRestMinutes", value: 11_521 },
    { field: "quotaRestMinutes", value: -1 },
    { field: "restCapMinutes", value: 2.5 },
  ])("$field of $value is refused, naming the field and the most", async ({ field, value }) => {
    const { client, upstreamA } = await start();
    const saved = await saveA(client, upstreamA.url, { cooldownSettings: { [field]: value } });
    expect(saved.endpoint).toBeNull();
    expect(saved.error).toMatchObject({
      code: "invalid_cooldown_settings",
      params: { field, max: "11520" },
    });
    expect((await endpointOf(client, "ep_a"))?.cooldownSettings).toBeUndefined();
  });

  test("a hand-edited time of day it can't read is as if unset: the minutes beside it stand", async () => {
    const { client, upstreamA, ask } = await start({
      cooldownSettingsA: { quotaResetAt: "25:00", quotaRestMinutes: 60 },
    });
    expect((await endpointOf(client, "ep_a"))?.cooldownSettings).toEqual({ quotaRestMinutes: 60 });
    upstreamA.respond = (res) => failWith(res, QUOTA);
    await ask();
    expect(await restOf(client, "ep_a")).toBe(60);
  });

  test("a hand-edited value of the wrong kind leaves the file readable and the gateway's own rests", async () => {
    const { client, upstreamA, ask } = await start({
      cooldownSettingsA: { quotaRestMinutes: "an hour" },
    });
    expect((await endpointOf(client, "ep_a"))?.cooldownSettings).toBeUndefined();
    upstreamA.respond = (res) => failWith(res, QUOTA);
    await ask();
    expect(await restOf(client, "ep_a")).toBe(15);
  });
});
