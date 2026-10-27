import type { Locator } from "@playwright/test";
import type { UsageAgentSummary } from "@getpaseo/protocol/usage/types";
import { expect, test as base, type Page } from "../support/fixtures";
import { installAgentUsageSummaryFixture } from "../support/helpers/agent-usage";
import { submitMessageWithButton } from "../support/helpers/composer";
import {
  hoverContextWindowMeter,
  leaveContextWindowMeter,
  type MockAgentSession,
  openAgent,
  qaScreenshot,
  seedAgentWithContextWindow,
  usageCard,
} from "../support/helpers/context-window";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { installLoginUsage } from "../support/helpers/usage-login";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

// 三轮、12 分 34 秒、$1.23：mock 智能体没有真实的用量行，由夹具代答。
const SPENT: UsageAgentSummary = {
  byModel: [],
  totals: { input: 14_300, cachedInput: 0, cacheWrite: 0, output: 4_600, reasoning: 0 },
  estimatedCost: 1.23,
  turns: 3,
  durationMs: 754_000,
  firstAt: "2026-10-12T00:00:00.000Z",
  lastAt: "2026-10-12T01:30:00.000Z",
  complete: true,
};

const test = base.extend<{ agent: MockAgentSession; planUsage: void }>({
  agent: async ({ page: _page }, provide) => {
    const agent = await seedAgentWithContextWindow();
    try {
      await provide(agent);
    } finally {
      await agent.cleanup();
    }
  },
  // 智能体所用账号的套餐用量，来自 daemon 上的真插件。
  planUsage: async ({ page: _page }, provide) => {
    const source = await installLoginUsage({
      status: "available",
      windows: [{ id: "session", label: "Session", usedPct: 31 }],
    });
    try {
      await provide();
    } finally {
      await source.cleanup();
    }
  },
});

function sessionTotalRows(card: Locator): Locator {
  return card.getByTestId("context-window-session-total-row");
}

function runtimeSeconds(row: string | null): number {
  const match = /^Agent runtime(\d+)m(?: (\d+)s)?$/.exec(row ?? "");
  if (!match) throw new Error(`Not an agent runtime row: ${row}`);
  return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

async function hoverMeter(page: Page): Promise<Locator> {
  await page.getByTestId("context-window-meter").hover({ timeout: 30_000 });
  return page.getByTestId("context-window-details");
}

test("the context details add the agent's session total and API endpoint to its context and plan usage", async ({
  page,
  agent,
  planUsage: _planUsage,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await installAgentUsageSummaryFixture(page, SPENT, {
    activeApiEndpoint: { provider: "mock", endpoint: { id: "acme", name: "Acme Gateway" } },
  });
  await openAgent(page, agent);
  const card = await hoverContextWindowMeter(page);

  await test.step("context, session total, API endpoint and plan usage are all in the card", async () => {
    await expect(card.getByText("25% used", { exact: true })).toBeVisible();
    const sessionTotal = card.getByTestId("context-window-session-total");
    await expect(sessionTotal.getByText("Session total", { exact: true })).toBeVisible();
    await expect(sessionTotalRows(card)).toHaveText([
      "Tokens↑14.3K ↓4.6K",
      "Estimated cost$1.23",
      "Turns3",
      "Agent runtime12m 34s",
      "Session span1h 30m",
    ]);
    await expect(card.getByTestId("context-window-api-endpoint")).toHaveText(
      "Using API endpoints. This quota doesn't reflect actual usage.",
    );
    await expect(card.getByText("Plan usage", { exact: true })).toBeVisible();
    await expect(
      usageCard(card, "login-journey:account").getByText("31% used", { exact: true }),
    ).toBeVisible();
    await qaScreenshot(page, "context-window-card-history-api-endpoint");
  });

  await test.step("the session's cost is stated once", async () => {
    await expect(card.getByText(/cost/i)).toHaveText(["Estimated cost"]);
    await expect(card.getByText(/\$\d/)).toHaveText(["$1.23"]);
  });
});

test("the agent runtime ticks while a turn runs and settles when it ends", async ({
  page,
  agent,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.clock.install();
  await installAgentUsageSummaryFixture(page, SPENT);
  await openAgent(page, agent);
  await submitMessageWithButton(page, "withhold synthetic user message until interrupted");
  const stop = page.getByRole("button", { name: /stop|cancel/i }).first();
  await expect(stop).toBeVisible();

  const rows = sessionTotalRows(await hoverMeter(page));
  const turns = rows.filter({ hasText: "Turns" });
  const runtime = rows.filter({ hasText: "Agent runtime" });

  await test.step("the running turn counts as in flight and its stopwatch adds to the runtime", async () => {
    await expect(turns).toHaveText("Turns3 + running");
    const before = runtimeSeconds(await runtime.textContent());
    expect(before).toBeGreaterThanOrEqual(754);
    await page.clock.fastForward(60_000);
    await expect
      .poll(async () => runtimeSeconds(await runtime.textContent()))
      .toBeGreaterThanOrEqual(before + 60);
  });

  // 这里的夹具始终答同一份合计：停表后回到 daemon 给的值。
  // `usage.updated` 到达后的重新取数是 `useAgentUsageEvents` 的事，不在这条用例里。
  await test.step("once the turn ends the stopwatch stops at the daemon's settled total", async () => {
    await leaveContextWindowMeter(page);
    await stop.click();
    await expect(stop).toHaveCount(0, { timeout: 30_000 });
    await hoverMeter(page);
    await expect(turns).toHaveText("Turns3");
    await expect(runtime).toHaveText("Agent runtime12m 34s");
  });
});

test("the context details are in Chinese when the interface is", async ({
  page,
  agent,
  planUsage: _planUsage,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ language: "zh-CN" }));
  });
  await installAgentUsageSummaryFixture(page, SPENT, {
    activeApiEndpoint: { provider: "mock", endpoint: { id: "acme", name: "Acme Gateway" } },
  });
  // 输入框的辅助函数按英文占位符找元素，这里直接等圆环。
  await openAgentRoute(page, agent);
  await hoverMeter(page);
  const card = page.getByRole("dialog", { name: "上下文窗口" });

  await expect(card.getByText("上下文窗口", { exact: true })).toBeVisible();
  await expect(card.getByText("已使用 25%", { exact: true })).toBeVisible();
  await expect(card.getByText("本会话合计", { exact: true })).toBeVisible();
  await expect(sessionTotalRows(card)).toHaveText([
    "Token↑14.3K ↓4.6K",
    "估算成本$1.23",
    "轮次3",
    "Agent 运行12m 34s",
    "会话跨度1h 30m",
  ]);
  await expect(card.getByTestId("context-window-api-endpoint")).toHaveText(
    "已启用第三方接口，此额度不代表实际消耗。",
  );
  await expect(card.getByText("套餐用量", { exact: true })).toBeVisible();
  await expect(
    usageCard(card, "login-journey:account").getByText("已用 31%", { exact: true }),
  ).toBeVisible();
  await qaScreenshot(page, "context-window-card-history-api-endpoint-zh");
});
