import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { installProviderUsageFixture } from "../support/helpers/provider-usage";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

async function openMockAgent(page: Page, viewport = MOBILE_VIEWPORT) {
  await page.setViewportSize(viewport);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "provider-usage-tooltip-",
    title: "Provider usage tooltip e2e",
    initialPrompt: "emit 1 coalesced agent stream update for provider usage tooltip.",
  });
  await openAgentRoute(page, session);
  await expectComposerVisible(page);
  await expect(page.getByTestId("context-window-meter")).toBeVisible({ timeout: 30_000 });
  return session;
}

// 手机端没有输入框窄栏，套餐用量留在上下文弹层末尾；桌面端由窄栏承担，弹层不再重复。
test.describe("provider usage tooltip", () => {
  test("leaves plan usage to the context strip on a desktop", async ({ page }) => {
    test.setTimeout(180_000);
    const usageFixture = await installProviderUsageFixture(page, [
      {
        fetchedAt: "2026-06-19T00:00:00.000Z",
        providers: [
          {
            providerId: "mock",
            displayName: "Mock provider",
            status: "available",
            planLabel: "Test plan",
            windows: [{ id: "session", label: "Session", usedPct: 42 }],
          },
        ],
      },
    ]);
    const session = await openMockAgent(page, DESKTOP_VIEWPORT);
    try {
      await expect(page.getByTestId("composer-plan-usage")).toBeVisible({ timeout: 10_000 });
      expect(usageFixture.requestCount()).toBe(1);

      await page.getByTestId("context-window-meter").hover();
      const popover = page.getByTestId("context-window-popover");
      await expect(popover.getByText("Context window", { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(popover.getByText("used", { exact: true })).toBeVisible();
      await expect(popover).not.toContainText("Mock provider");
      await expect(popover).not.toContainText("Test plan");
      // 估算成本只留在本会话合计里，上下文部分不再有。
      await expect(popover.getByTestId("context-window-context")).not.toContainText(
        "Estimated cost",
      );
      // 弹层不含套餐用量，打开它也不再取数。
      expect(usageFixture.requestCount()).toBe(1);
    } finally {
      await session.cleanup();
    }
  });

  test("fetches usage when the context tooltip opens and renders the active provider", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const usageFixture = await installProviderUsageFixture(page, [
      {
        fetchedAt: "2026-06-19T00:00:00.000Z",
        providers: [
          {
            providerId: "mock",
            displayName: "Mock provider",
            status: "available",
            planLabel: "Test plan",
            windows: [
              {
                id: "session",
                label: "Session",
                usedPct: 42,
                remainingPct: 58,
                resetsAt: "2026-06-19T05:00:00.000Z",
              },
            ],
          },
        ],
      },
    ]);
    const session = await openMockAgent(page);
    try {
      expect(usageFixture.requestCount()).toBe(0);

      await page.getByTestId("context-window-meter").hover();
      await usageFixture.waitForRequestCount(1);

      const popover = page.getByTestId("context-window-popover");
      await expect(popover.getByText("Mock provider", { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(popover.getByText("Context window", { exact: true })).toBeVisible();
      await expect(popover.getByText("Test plan")).toBeVisible();
      await expect(popover.getByTestId("provider-usage-window-session")).toContainText("Session");
      await expect(popover.getByTestId("provider-usage-window-session")).toContainText("42%");
    } finally {
      await session.cleanup();
    }
  });

  test("refreshes usage again each time the tooltip is shown", async ({ page }) => {
    test.setTimeout(180_000);
    const usageFixture = await installProviderUsageFixture(page, [
      {
        fetchedAt: "2026-06-19T00:00:00.000Z",
        providers: [
          {
            providerId: "mock",
            displayName: "Mock provider",
            status: "available",
            planLabel: "Test plan",
            windows: [{ id: "session", label: "Session", usedPct: 41 }],
          },
        ],
      },
      {
        fetchedAt: "2026-06-19T00:01:00.000Z",
        providers: [
          {
            providerId: "mock",
            displayName: "Mock provider",
            status: "available",
            planLabel: "Test plan",
            windows: [{ id: "session", label: "Session", usedPct: 64 }],
          },
        ],
      },
    ]);
    const session = await openMockAgent(page);
    try {
      const meter = page.getByTestId("context-window-meter");

      const planUsage = page
        .getByTestId("context-window-popover")
        .getByTestId("provider-usage-window-session");

      await meter.hover();
      await usageFixture.waitForRequestCount(1);
      await expect(planUsage).toContainText("41%", { timeout: 10_000 });

      await page.mouse.move(0, 0);
      await expect(page.getByText("Mock provider", { exact: true })).toHaveCount(0);

      await meter.hover();
      await usageFixture.waitForRequestCount(2);
      expect(usageFixture.requestCount()).toBe(2);
      await expect(planUsage).toContainText("64%");
    } finally {
      await session.cleanup();
    }
  });
});
