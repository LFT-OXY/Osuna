import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import {
  connectApiEndpointClient,
  resetApiEndpoints,
  seedApiEndpoint,
  sendThroughGateway,
  startFakeRelay,
  type FakeRelay,
} from "../support/helpers/api-endpoints";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsagePage } from "../support/helpers/usage-page";

/*
 * 用量页明细的「请求」标签（任务 10-16-gateway-ledger-usage 工单 05）：真实 daemon 读用量夹具与一份 105 次调用的
 * 会话记录（直连），再经真实中转站问本机的假中转服务（一次成功、一次余额不足失败），列表按筛选、翻页、展开读出来。
 */
const fixtures = createUsageFixtureRoots("paseo-usage-requests-");
const cliHome = fixtures.root;
const PAGING_MODEL = "claude-paging-1";
const PAGING_CALLS = 105;

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

test.beforeAll(async () => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
});

test.afterAll(async () => {
  await resetApiEndpoints(client);
  await client.close();
  await relay.close();
});

/** 一个会话里 105 次只在会话记录里的调用，每次一个回复编号，时间从今天零点后依次排开。 */
function writePagingSession(): void {
  const sessionId = "sess-requests-paging";
  const start = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const lines: unknown[] = [
    {
      type: "user",
      sessionId,
      cwd: "/work/paging",
      promptId: "p1",
      uuid: "u-p1",
      timestamp: new Date(start).toISOString(),
      message: { role: "user", content: "hi" },
    },
  ];
  for (let index = 1; index <= PAGING_CALLS; index += 1) {
    lines.push({
      type: "assistant",
      sessionId,
      cwd: "/work/paging",
      uuid: `a-paging-${index}`,
      timestamp: new Date(start + index * 1000).toISOString(),
      message: {
        id: `msg-paging-${index}`,
        role: "assistant",
        model: PAGING_MODEL,
        stop_reason: index === PAGING_CALLS ? "end_turn" : "tool_use",
        usage: {
          input_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: index,
        },
      },
    });
  }
  writeFileSync(
    path.join(fixtures.claudeProjectDir, `${sessionId}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
}

async function openRequestsTab(page: Page): Promise<void> {
  await openUsagePage(page);
  await page.getByTestId("usage-details-tab-requests").click();
  await expect(page.getByTestId("usage-requests")).toBeVisible();
}

async function pickFilter(page: Page, filter: string, item: string): Promise<void> {
  await page.getByTestId(`usage-requests-filter-${filter}-trigger`).click();
  await page.getByTestId(`usage-requests-filter-${filter}-item-${item}`).click();
}

/** 扫描是周期的：模型菜单里还没有这个模型时关上菜单回 null，有了就选上，回翻页那一行。 */
async function rangeAfterPickingModel(page: Page, model: string): Promise<string | null> {
  await page.getByTestId("usage-requests-filter-model-trigger").click();
  const item = page.getByTestId(`usage-requests-filter-model-item-${model}`);
  if ((await item.count()) === 0) {
    await page.keyboard.press("Escape");
    return null;
  }
  await item.click();
  return page.getByTestId("usage-requests-range").textContent();
}

/** 把发给页面的请求列表回复扣住，直到 release；用来看第一次加载时的骨架。 */
async function holdRequestsList(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message === "string" && message.includes('"usage.requests.list.response"')) {
        void released.then(() => ws.send(message));
        return;
      }
      ws.send(message);
    });
  });
  return release;
}

test.describe("Usage page Requests tab", () => {
  test("filters, pages a hundred at a time, and opens a request to its tries", async ({ page }) => {
    writePagingSession();
    await seedApiEndpoint(client, {
      name: "Relay Requests",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-requests-1"],
    });
    await seedApiEndpoint(client, {
      name: "Relay Broke",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/broke` }],
      models: ["claude-broke-1"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(await sendThroughGateway("claude-requests-1")).toBe(200);
    expect(await sendThroughGateway("claude-broke-1")).toBe(402);

    await openRequestsTab(page);
    const pickPagingModel = () => rangeAfterPickingModel(page, PAGING_MODEL);

    await test.step("the model filter keeps the direct calls of one model, a hundred to a page", async () => {
      await expect(page.getByTestId("usage-requests-filter-model-trigger")).toBeVisible();
      await expect.poll(pickPagingModel, { timeout: 30_000 }).toBe(`1–100 of ${PAGING_CALLS}`);
      await expect(page.getByTestId(/^usage-request-row-/)).toHaveCount(100);
      await page.getByTestId("usage-requests-next").click();
      await expect(page.getByTestId("usage-requests-range")).toHaveText(
        `101–${PAGING_CALLS} of ${PAGING_CALLS}`,
      );
      await expect(page.getByTestId(/^usage-request-row-/)).toHaveCount(5);
      await expect(page.getByTestId("usage-requests-next")).toBeDisabled();
      await page.getByTestId("usage-requests-previous").click();
      await expect(page.getByTestId("usage-requests-range")).toHaveText(`1–100 of ${PAGING_CALLS}`);
      // 直连的调用：接口写「官方」，耗时留空。
      const newest = page.getByTestId(/^usage-request-row-/).first();
      await expect(newest).toContainText(PAGING_MODEL);
      await expect(newest).toContainText("Official");
      await pickFilter(page, "model", "all");
    });

    await test.step("Through the gateway leaves the direct calls out; Failed keeps the one no endpoint answered", async () => {
      await pickFilter(page, "through", "gateway");
      await expect(page.getByTestId("usage-requests-range")).toHaveText("1–2 of 2");
      const answered = page
        .getByTestId(/^usage-request-row-/)
        .filter({ hasText: "Relay Requests" });
      await expect(answered).toContainText("claude-requests-1");
      await expect(answered).toContainText("OK");
      await page.getByTestId("usage-requests-status-failed").click();
      await expect(page.getByTestId("usage-requests-range")).toHaveText("1–1 of 1");
      const failed = page.getByTestId(/^usage-request-row-/);
      await expect(failed).toContainText("Relay Broke");
      await expect(failed).toContainText("Failed (out of credit)");
    });

    await test.step("opening the failed request shows each try, its reason, and what the agent was told", async () => {
      await page.getByTestId(/^usage-request-row-/).click();
      const attempts = page.getByTestId(/^usage-request-attempts-/);
      await expect(attempts).toContainText("Relay Broke · claude-broke-1 · Failed · out of credit");
      await expect(attempts).toContainText("insufficient balance");
      await expect(page.getByTestId(/^usage-request-error-/)).toContainText("insufficient balance");
    });

    await test.step("the endpoint filter narrows to one endpoint", async () => {
      await page.getByTestId("usage-requests-status-all").click();
      await pickFilter(page, "endpoint", "name:Relay Requests");
      await expect(page.getByTestId("usage-requests-range")).toHaveText("1–1 of 1");
      await expect(page.getByTestId(`usage-requests-filter-endpoint-trigger`)).toContainText(
        "Relay Requests",
      );
    });

    await test.step("a search nothing matches says so", async () => {
      await page.getByTestId("usage-requests-search").fill("nothing like this");
      await expect(page.getByTestId("usage-requests-empty")).toHaveText("No requests match");
    });
  });

  test("shows a skeleton while the first page loads", async ({ page }) => {
    const release = await holdRequestsList(page);
    await openRequestsTab(page);
    await expect(page.getByTestId("usage-requests-loading")).toBeVisible();
    await expect(page.getByTestId("usage-requests-table")).toHaveCount(0);
    release();
    await expect(page.getByTestId("usage-requests-loading")).toHaveCount(0, { timeout: 30_000 });
  });
});
