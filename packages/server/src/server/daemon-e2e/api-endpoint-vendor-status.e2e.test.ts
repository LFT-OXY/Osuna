import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 厂商状态页（工单 25，prd 第 38 条）：真实 daemon + 本机假状态页，时钟注入。
 * 接口存在文件里：一家直连 Anthropic 官方、一家 DeepSeek 官方、一家中转站；都不会被请求（daemon 只放行本机地址）。
 */

const MINUTE = 60_000;
const START = Date.parse("2026-10-21T08:00:00.000Z");

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

function claudePage(api: string): string {
  return JSON.stringify({
    page: { id: "tymt9n04zgry", name: "Claude", url: "https://status.claude.com" },
    components: [
      { id: "web", name: "claude.ai", status: "operational", group: false },
      { id: "api", name: "Claude API (api.anthropic.com)", status: api, group: false },
      { id: "code", name: "Claude Code", status: "operational", group: false },
    ],
    incidents: [
      {
        name: "Elevated errors on Claude API",
        status: "investigating",
        impact: "minor",
        shortlink: "https://stspg.io/x",
        components: [{ id: "api", name: "Claude API (api.anthropic.com)" }],
      },
    ],
  });
}

interface FakeStatusPage {
  url: string;
  asked: number;
  body: string;
}

async function startStatusPage(): Promise<FakeStatusPage> {
  const page: FakeStatusPage = { url: "", asked: 0, body: claudePage("degraded_performance") };
  const server = createServer((req, res) => {
    page.asked += 1;
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(page.body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  page.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/summary.json`;
  return page;
}

function storedEndpoint(input: { id: string; name: string; url: string }) {
  return {
    id: input.id,
    slug: input.id,
    name: input.name,
    baseUrls: [{ format: "anthropic_messages", url: input.url }],
    models: [{ id: "model-a" }],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

async function start() {
  const page = await startStatusPage();
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-vendor-status-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  await writeFile(
    path.join(endpointsDir, "endpoints.json"),
    JSON.stringify({
      endpoints: [
        storedEndpoint({ id: "ep_claude", name: "Claude", url: "https://api.anthropic.com" }),
        storedEndpoint({
          id: "ep_deepseek",
          name: "DeepSeek",
          url: "https://api.deepseek.com/anthropic",
        }),
        storedEndpoint({ id: "ep_relay", name: "Relay", url: "https://relay.example/anthropic" }),
      ],
      agents: {},
    }),
  );
  // 第一次看时为正在读的页等候的计时器：记下等多久，从不到点，答案只能来自假页面。
  const control = { clock: START, autoUpdate: true, waits: [] as number[] };
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
      homeDir: root,
      now: () => new Date(control.clock),
      isModelsDevAutoUpdate: () => control.autoUpdate,
      modelsDevFetch: async () => {
        throw new Error("This suite never downloads models.dev");
      },
      vendorStatusUrls: { anthropic: page.url },
      vendorStatusTimers: {
        schedule(_handler, ms) {
          control.waits.push(ms);
          return () => {};
        },
      },
    },
  });
  daemons.push(daemon);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.17.0",
  });
  clients.push(client);
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return { client, page, control };
}

describe("vendor status pages", () => {
  test("a degraded page is reported for the endpoints on that vendor's API; DeepSeek is only linked; a relay has none", async () => {
    const { client, page, control } = await start();
    const status = await client.apiEndpointVendorStatus();
    // 第一次看等正在读的页最多 4 秒；页面先答了，用不着到点。
    expect(control.waits).toEqual([4_000]);
    expect(status.error).toBeNull();
    expect(status.autoUpdate).toBe(true);
    expect(status.endpointVendors).toEqual({ ep_claude: "anthropic", ep_deepseek: "deepseek" });
    expect(status.vendors).toEqual([
      {
        vendor: "anthropic",
        name: "Anthropic",
        page: "https://status.claude.com",
        isLinkOnly: false,
        level: "degraded",
        parts: [{ name: "Claude API (api.anthropic.com)", status: "degraded_performance" }],
        incidents: [
          { name: "Elevated errors on Claude API", impact: "minor", url: "https://stspg.io/x" },
        ],
        readAt: new Date(START).toISOString(),
        error: null,
      },
      {
        vendor: "deepseek",
        name: "DeepSeek",
        page: "https://status.deepseek.com",
        isLinkOnly: true,
        level: null,
        parts: [],
        incidents: [],
        readAt: null,
        error: null,
      },
    ]);
    expect(page.asked).toBe(1);
  });

  test("the page is not asked again within five minutes, and is asked once they are up", async () => {
    const { client, page, control } = await start();
    await client.apiEndpointVendorStatus();
    control.clock = START + 4 * MINUTE;
    page.body = claudePage("operational");
    const cached = await client.apiEndpointVendorStatus();
    expect(cached.vendors[0]?.level).toBe("degraded");
    expect(page.asked).toBe(1);

    control.clock = START + 5 * MINUTE;
    const reread = await client.apiEndpointVendorStatus();
    expect(reread.vendors[0]?.level).toBe("ok");
    expect(page.asked).toBe(2);
  });

  test("with the price table's auto-update off nothing is asked and the answer says so", async () => {
    const { client, page, control } = await start();
    control.autoUpdate = false;
    const status = await client.apiEndpointVendorStatus({ vendors: ["openai"] });
    expect(status.autoUpdate).toBe(false);
    expect(status.endpointVendors).toEqual({ ep_claude: "anthropic", ep_deepseek: "deepseek" });
    expect(status.vendors.map((vendor) => [vendor.vendor, vendor.level])).toEqual([
      ["anthropic", null],
      ["deepseek", null],
      ["openai", null],
    ]);
    expect(page.asked).toBe(0);
  });
});
