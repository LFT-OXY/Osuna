import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { hideGatewayLedger, openUsagePage, waitForUsageTotal } from "../support/helpers/usage-page";

/*
 * 用量页的人民币与「万 / 亿」（任务 10-16-gateway-ledger-usage 工单 10）。测试 daemon 的价格表自动更新是关的，
 * 绝不去问汇率网站：汇率预先写进 daemon 的汇率缓存，daemon 照缓存回。
 */
const fixtures = createUsageFixtureRoots("paseo-usage-currency-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

const FIXTURE_TOKENS = "180,248";
const FIXTURE_TOKENS_WAN_YI = "18 万";
const YUAN = /^¥\d+\.\d{2}$/;

/** daemon 第一次被问汇率时才读缓存；每条用例开页面前写好，内容相同。 */
async function seedExchangeRate(): Promise<void> {
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("E2E_PASEO_HOME is not set (expected from the Playwright worker).");
  await mkdir(path.join(home, "usage"), { recursive: true });
  await writeFile(
    path.join(home, "usage", "exchange-rate.json"),
    JSON.stringify({ cnyPerUsd: 7.12, fetchedAt: new Date().toISOString() }),
  );
}

async function useLanguage(page: Page, language: "en" | "zh-CN"): Promise<void> {
  // 只在第一次打开时写：刷新后读回的是页面自己存的设置。
  await page.addInitScript((value) => {
    if (localStorage.getItem("@paseo:app-settings") !== null) return;
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ language: value }));
  }, language);
}

async function openOptions(page: Page): Promise<void> {
  await page.getByTestId("usage-options-trigger").click();
  await expect(page.getByTestId("usage-options-menu")).toBeVisible({ timeout: 10_000 });
}

/**
 * The mock provider writes no CLI log, so the daemon has no turn rows for it. The page's
 * turn list is answered with one priced turn ($0.50) per turn id the timeline carried,
 * which is all the footer needs to show a cost.
 */
async function answerTurnsWithOnePricedTurn(page: Page): Promise<void> {
  const turnIds = new Set<string>();
  const messageIds = new Set<string>();
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") {
        ws.send(message);
        return;
      }
      for (const match of message.matchAll(/"turnId":"([^"]+)"/g)) turnIds.add(match[1]);
      for (const match of message.matchAll(/"messageId":"([^"]+)"/g)) messageIds.add(match[1]);
      if (!message.includes('"usage.agent.turns.list.response"')) {
        ws.send(message);
        return;
      }
      const envelope = JSON.parse(message) as {
        message: { payload: { turns: unknown[]; complete: boolean } };
      };
      const at = new Date().toISOString();
      envelope.message.payload.complete = true;
      envelope.message.payload.turns = [...turnIds].map((turnId) => ({
        cli: "claude",
        backend: null,
        sessionId: "mock-session",
        turnKey: turnId,
        turnId,
        userMessageIds: [...messageIds],
        startedAt: at,
        endedAt: at,
        durationMs: 1000,
        byModel: [],
        totals: { input: 1000, cachedInput: 0, cacheWrite: 0, output: 500, reasoning: 0 },
        estimatedCost: 0.5,
        priced: true,
      }));
      ws.send(JSON.stringify(envelope));
    });
  });
}

test.describe("Usage page currency and 万 / 亿", () => {
  test("choosing CNY shows every estimated cost in yuan with the rate under it", async ({
    page,
  }) => {
    await seedExchangeRate();
    await useLanguage(page, "en");
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);
    await expect(page.getByTestId("usage-total-cost")).toHaveText(/^\$\d+\.\d{2}$/);

    await openOptions(page);
    const cny = page.getByTestId("usage-options-currency-cny");
    await expect(cny).toContainText("Shows estimated costs in yuan");
    await expect(page.getByTestId("usage-options-chinese-units")).toHaveCount(0);
    await cny.click();
    await expect(cny).toContainText(/1 USD = 7\.12 CNY · fetched \d/);
    await expect(cny).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("usage-total-cost")).toHaveText(YUAN);
    await page.getByTestId("usage-source-card-all").click();
    await expect(page.getByTestId("usage-model-breakdown")).toContainText("¥");
    await expect(page.getByTestId("usage-model-breakdown")).not.toContainText("$");

    await expect(page.getByTestId("usage-details-daily")).toContainText("¥");
    await expect(page.getByTestId("usage-details-daily")).not.toContainText("$");
    await page.getByTestId(`usage-details-day-${fixtures.day}`).click();
    await expect(page.getByTestId(`usage-sessions-${fixtures.day}`)).toContainText("¥");
    await expect(page.getByTestId(`usage-sessions-${fixtures.day}`)).not.toContainText("$");

    await page.getByTestId("usage-details-tab-requests").click();
    await expect(page.getByTestId("usage-requests-table")).toContainText("¥", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("usage-requests-table")).not.toContainText("$");

    // 每台设备记住：刷新后还是人民币。
    await page.reload();
    await waitForUsageTotal(page, FIXTURE_TOKENS);
    await expect(page.getByTestId("usage-total-cost")).toHaveText(YUAN);
  });

  test("a Chinese UI offers 万 / 亿 for token counts and leaves amounts alone", async ({
    page,
  }) => {
    await seedExchangeRate();
    await useLanguage(page, "zh-CN");
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    await openOptions(page);
    const units = page.getByTestId("usage-options-chinese-units");
    await expect(units).toContainText("用「万 / 亿」显示大数");
    const unitsSwitch = page.getByTestId("usage-options-chinese-units-switch");
    await expect(unitsSwitch).toHaveAttribute("aria-checked", "false");
    await units.click();
    await expect(unitsSwitch).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("usage-options-currency-cny").click();
    await expect(page.getByTestId("usage-options-currency-cny")).toContainText(
      /1 美元 = 7\.12 元 · .+ 取得/,
    );
    await page.keyboard.press("Escape");

    await waitForUsageTotal(page, FIXTURE_TOKENS_WAN_YI);
    await expect(page.getByTestId("usage-total-cost")).toHaveText(YUAN);
    await expect(page.getByTestId("usage-stats-card")).toContainText("万");
  });

  test("a turn's cost reads in yuan once CNY is chosen", async ({ page }) => {
    test.setTimeout(120_000);
    await seedExchangeRate();
    await page.addInitScript(() => {
      localStorage.setItem(
        "@paseo:app-settings",
        JSON.stringify({ language: "en", usage: { displayAs: "used", currency: "cny" } }),
      );
    });
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "usage-currency-turn-",
      title: "Turn cost in yuan",
    });
    try {
      await agent.client.sendAgentMessage(agent.agentId, "Say hello");
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await answerTurnsWithOnePricedTurn(page);
      await openAgentRoute(page, agent);
      // $0.50 at 7.12.
      await expect(page.getByTestId("turn-usage-segment").first()).toContainText("¥3.56", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("turn-usage-segment").first()).not.toContainText("$");
    } finally {
      await agent.cleanup();
    }
  });

  test("a daemon without the gateway ledger offers no currency", async ({ page }) => {
    await hideGatewayLedger(page);
    await useLanguage(page, "en");
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);
    // 英文界面也没有「万 / 亿」：菜单里没东西，整个按钮不出现。
    await expect(page.getByTestId("usage-options-trigger")).toHaveCount(0);
  });

  test("a Chinese UI on such a daemon still offers 万 / 亿 but no currency", async ({ page }) => {
    await hideGatewayLedger(page);
    await useLanguage(page, "zh-CN");
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);
    await openOptions(page);
    await expect(page.getByTestId("usage-options-chinese-units")).toBeVisible();
    await expect(page.getByTestId("usage-options-currency-cny")).toHaveCount(0);
  });
});
