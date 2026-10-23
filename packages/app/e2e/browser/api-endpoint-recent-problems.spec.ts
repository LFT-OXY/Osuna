import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import {
  connectApiEndpointClient,
  openApiEndpointsPage,
  resetApiEndpoints,
  seedApiEndpoint,
  sendThroughGateway,
  startFakeRelay,
  type FakeRelay,
} from "../support/helpers/api-endpoints";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";

/*
 * 接口详情页的「最近异常」（任务 10-16-gateway-ledger-usage 工单 08）：真实 daemon 经真实中转站问本机的假中转服务，
 * 余额不足的那次落进逐条记录，详情页读出来；开着页面再出事时随 usage.updated 重读；读不到时分区里留原因与「重试」；
 * 「在请求列表里看全部」进用量页按这家筛好的请求列表。
 */
const fixtures = createUsageFixtureRoots("paseo-recent-problems-");
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

let relay: FakeRelay;
let client: Awaited<ReturnType<typeof connectApiEndpointClient>>;

test.beforeEach(async () => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
  await resetApiEndpoints(client);
});

test.afterEach(async () => {
  await resetApiEndpoints(client);
  await client.close();
  await relay.close();
});

async function seedBrokeEndpoint(name: string, model: string): Promise<string> {
  const endpointId = await seedApiEndpoint(client, {
    name,
    baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/broke` }],
    models: [model],
  });
  await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
  return endpointId;
}

async function openEndpointDetail(page: Page, endpointId: string): Promise<void> {
  await openApiEndpointsPage(page);
  await page.getByTestId(`api-endpoint-row-${endpointId}`).filter({ visible: true }).click();
  await expect(page.getByTestId("api-endpoint-recent-problems")).toBeVisible();
}

/** 把前 `times` 次「最近异常」请求就地回成 daemon 的 rpc_error，之后的照常交给 daemon。 */
async function failRecentProblems(page: Page, reason: string, times: number): Promise<void> {
  let remaining = times;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString("utf8");
      const envelope: unknown = JSON.parse(raw);
      const sessionMessage =
        envelope && typeof envelope === "object" && "message" in envelope ? envelope.message : null;
      if (
        remaining > 0 &&
        sessionMessage &&
        typeof sessionMessage === "object" &&
        "type" in sessionMessage &&
        sessionMessage.type === "provider.api_endpoint.recent_problems.request" &&
        "requestId" in sessionMessage
      ) {
        remaining -= 1;
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: sessionMessage.requestId,
                requestType: "provider.api_endpoint.recent_problems.request",
                error: reason,
                code: "usage_request_failed",
              },
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
}

test.describe("API endpoint Recent problems", () => {
  test("starts empty, shows a problem as it happens, and opens the Requests list filtered to the endpoint", async ({
    page,
  }) => {
    const endpointId = await seedBrokeEndpoint("Relay Problems", "claude-problems-1");
    await openEndpointDetail(page, endpointId);
    const section = page.getByTestId("api-endpoint-recent-problems");

    await test.step("an endpoint nothing went wrong on says so", async () => {
      await expect(section.getByTestId("api-endpoint-recent-problems-empty")).toHaveText(
        "No recent problems",
      );
    });

    await test.step("a request it fails shows up while the page is open: class, cooldown, what the agent got, time and model", async () => {
      expect(await sendThroughGateway("claude-problems-1")).toBe(402);
      const problem = section.getByTestId("api-endpoint-recent-problem");
      await expect(problem).toHaveCount(1, { timeout: 30_000 });
      await expect(problem).toContainText("out of credit");
      await expect(problem).toContainText("cooling down until");
      await expect(problem).toContainText("the agent got an error");
      await expect(problem).toContainText("claude-problems-1");
    });

    await test.step("View all opens the Requests tab with the endpoint chosen", async () => {
      const viewAll = section.getByTestId("api-endpoint-recent-problems-view-all");
      await expect(viewAll).toHaveText("View all in the Requests list");
      await viewAll.click();
      await expect(page.getByTestId("usage-requests")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("usage-requests-filter-endpoint-trigger")).toContainText(
        "Relay Problems",
      );
      const rows = page.getByTestId(/^usage-request-row-/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("claude-problems-1");
    });
  });

  test("a failed read keeps its reason in the section with Retry, which reads again", async ({
    page,
  }) => {
    const endpointId = await seedBrokeEndpoint("Relay Unreadable", "claude-unreadable-1");
    expect(await sendThroughGateway("claude-unreadable-1")).toBe(402);
    await failRecentProblems(page, "usage service unavailable", 1);
    await openEndpointDetail(page, endpointId);
    const section = page.getByTestId("api-endpoint-recent-problems");

    const error = section.getByTestId("api-endpoint-recent-problems-error");
    await expect(error).toContainText("Couldn't load recent problems");
    await expect(error).toContainText("usage service unavailable");
    // 日志用的 requestType= / code= 不给人看。
    await expect(error).not.toContainText("requestType=");
    await expect(section.getByTestId("api-endpoint-recent-problems-view-all")).toBeVisible();

    await section.getByTestId("api-endpoint-recent-problems-retry").click();
    await expect(error).toHaveCount(0);
    await expect(section.getByTestId("api-endpoint-recent-problem")).toHaveCount(1);
  });
});
