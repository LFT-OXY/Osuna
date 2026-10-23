import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import {
  connectApiEndpointClient,
  GOOD_REPLY_TOKENS,
  resetApiEndpoints,
  seedApiEndpoint,
  sendThroughGateway,
  startFakeRelay,
  type FakeRelay,
} from "../support/helpers/api-endpoints";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsagePage, waitForUsageTotal } from "../support/helpers/usage-page";

/*
 * 用量页按接口分（任务 10-16-gateway-ledger-usage 工单 01）：真实 daemon 读用量夹具的会话记录，
 * 再像 Claude Code 那样经真实中转站问本机的假中转服务一次，中转站把这次记进账。
 */
const fixtures = createUsageFixtureRoots("paseo-usage-endpoints-");
const cliHome = fixtures.root;

// 打开 Claude Code 的总开关会改写 CLI 自己的配置：全都指到夹具的临时目录，绝不碰开发者的。
test.use({
  e2eDaemonEnvironment: {
    ...fixtures.environment,
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_PROCESS_TABLE_PATH: path.join(cliHome, "process-table.txt"),
    PASEO_E2E_SYSTEM_PROXY_PATH: path.join(cliHome, "system-proxy.json"),
    PASEO_E2E_FAKE_SITES_PATH: path.join(cliHome, "fake-sites.json"),
    HOME: path.join(cliHome, "home"),
    XDG_CONFIG_HOME: path.join(cliHome, "home", ".config"),
    XDG_DATA_HOME: path.join(cliHome, "home", ".local", "share"),
  },
});

/** 夹具会话记录的 token 总数（usage-page.spec.ts 同一份），加上经中转站的那一次。 */
const FIXTURE_TOKENS = 180_248;
const ALL_TOKENS = (FIXTURE_TOKENS + GOOD_REPLY_TOKENS).toLocaleString("en");

let relay: FakeRelay;
let client: Awaited<ReturnType<typeof connectApiEndpointClient>>;

test.beforeAll(async () => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
});

test.afterAll(async () => {
  await resetApiEndpoints(client);
  await client.close();
  await relay.close();
});

/** 从 server_info 去掉 gatewayLedger，模拟没有中转站账本的旧 daemon。 */
async function hideGatewayLedger(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string" || !message.includes('"server_info"')) {
        ws.send(message);
        return;
      }
      const envelope = JSON.parse(message) as {
        message?: { payload?: { status?: unknown; features?: Record<string, unknown> } };
      };
      const payload = envelope.message?.payload;
      if (payload?.status === "server_info" && payload.features) {
        delete payload.features.gatewayLedger;
      }
      ws.send(JSON.stringify(envelope));
    });
  });
}

test.describe("Usage page by endpoint", () => {
  test("the Endpoints split shows Official and the endpoint, and a card narrows the page to it", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Relay Alpha",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(await sendThroughGateway("claude-sonnet-4-5")).toBe(200);

    await openUsagePage(page);
    await waitForUsageTotal(page, ALL_TOKENS);

    await test.step("the split shows Official and the endpoint with tokens, cost and share", async () => {
      await page.getByTestId("usage-breakdown-endpoints").click();
      const official = page.getByTestId("usage-endpoint-card-official");
      await expect(official).toContainText("Official");
      await expect(official).toContainText("180.2K · $");
      const endpoint = page.getByTestId(`usage-endpoint-card-${endpointId}`);
      await expect(endpoint).toContainText("Relay Alpha");
      await expect(endpoint).toContainText(`${GOOD_REPLY_TOKENS} · $`);
      await expect(endpoint).toContainText("0.08%");
    });

    await test.step("a card narrows the page to that endpoint, and again widens it back", async () => {
      const endpoint = page.getByTestId(`usage-endpoint-card-${endpointId}`);
      await endpoint.click();
      await waitForUsageTotal(page, String(GOOD_REPLY_TOKENS));
      // 别家的卡片还在，好换过去。
      await expect(page.getByTestId("usage-endpoint-card-official")).toBeVisible();
      await page.getByTestId("usage-endpoint-card-official").click();
      await waitForUsageTotal(page, FIXTURE_TOKENS.toLocaleString("en"));
      await page.getByTestId("usage-endpoint-card-official").click();
      await waitForUsageTotal(page, ALL_TOKENS);
    });

    await test.step("back on Sources the source cards return", async () => {
      await page.getByTestId("usage-breakdown-sources").click();
      await expect(page.getByTestId("usage-source-card-claude")).toBeVisible();
      await expect(page.getByTestId("usage-endpoint-cards")).toHaveCount(0);
    });
  });

  test("a daemon without the gateway ledger shows no Endpoints split", async ({ page }) => {
    await hideGatewayLedger(page);
    await openUsagePage(page);
    await expect(page.getByTestId("usage-source-card-claude")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("usage-breakdown")).toHaveCount(0);
  });
});
