import type { ProviderUsage } from "@getpaseo/protocol/messages";
import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { gotoAppShell } from "../support/helpers/app";
import { clickNewChat } from "../support/helpers/launcher";
import { installProviderUsageFixture } from "../support/helpers/provider-usage";
import { selectComposerProvider } from "../support/helpers/provider-selector";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { checkOutNewBranch } from "../support/helpers/workspace";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// 时长按「还有多久」显示，所以重置时间相对此刻给出，并多留半小时，免得跨过整点。
function fromNow(ms: number): string {
  return new Date(Date.now() + ms + 30 * 60_000).toISOString();
}

function mockPlanUsage(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    providerId: "mock",
    displayName: "Mock provider",
    status: "available",
    planLabel: "Max 20x",
    windows: [
      {
        id: "five_hour",
        label: "Session",
        usedPct: 82,
        resetsAt: fromNow(3 * HOUR_MS),
        runsOutAt: fromNow(HOUR_MS),
        shortfallPct: 18,
        tone: "warning",
      },
      { id: "weekly", label: "Weekly", usedPct: 45, resetsAt: fromNow(4 * DAY_MS), tone: "ok" },
      {
        id: "weekly_model_fable",
        label: "Weekly · Fable",
        usedPct: 0,
        resetsAt: fromNow(4 * DAY_MS),
        tone: "ok",
      },
    ],
    balances: [{ id: "extra", label: "Extra usage", unit: "usd", used: 3, limit: 50 }],
    ...overrides,
  };
}

async function openMockAgentOnDesktop(page: Page, options: { branch?: string } = {}) {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "composer-plan-usage-strip-",
    title: "Composer plan usage strip e2e",
    initialPrompt: "emit 1 coalesced agent stream update for the plan usage strip.",
  });
  if (options.branch) checkOutNewBranch(session.cwd, options.branch);
  await openAgentRoute(page, session);
  await expectComposerVisible(page);
  await expect(page.getByTestId("composer-context-strip")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("composer-context-strip-branch-switcher")).toBeVisible({
    timeout: 30_000,
  });
  return session;
}

function codexPlanUsage(): ProviderUsage {
  return {
    providerId: "codex",
    displayName: "Codex",
    status: "available",
    planLabel: "Pro",
    windows: [
      { id: "session", label: "Session", usedPct: 12, resetsAt: fromNow(3 * HOUR_MS), tone: "ok" },
      { id: "weekly", label: "Weekly", usedPct: 40, resetsAt: fromNow(4 * DAY_MS), tone: "ok" },
      {
        id: "code_review",
        label: "Code review",
        usedPct: 5,
        resetsAt: fromNow(4 * DAY_MS),
        tone: "ok",
      },
    ],
  };
}

// 新打开的工作区先显示新建标签页，Composer 和窄栏随新建 Agent 的草稿标签页出现。
async function openDraftTabOnDesktop(page: Page) {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const workspace = await seedWorkspace({ repoPrefix: "composer-plan-usage-draft-" });
  await gotoAppShell(page);
  await waitForSidebarHydration(page);
  await switchWorkspaceViaSidebar({
    page,
    serverId: getServerId(),
    workspaceId: workspace.workspaceId,
  });
  await clickNewChat(page);
  await expectComposerVisible(page);
  await expect(page.getByTestId("composer-context-strip")).toBeVisible({ timeout: 30_000 });
  return workspace;
}

// 桌面端本机默认不显示主机徽标；e2e 的主机不算本机，这里手动隐藏，窄栏宽度与桌面端一致。
// 在 fixture 写入主机注册表之后运行。
async function hideHostBadges(page: Page) {
  await page.addInitScript(() => {
    const key = "@paseo:daemon-registry";
    const hosts = JSON.parse(localStorage.getItem(key) ?? "[]") as Record<string, unknown>[];
    for (const host of hosts) {
      host.appearance = { color: "none", badgeDisplay: "hidden" };
    }
    localStorage.setItem(key, JSON.stringify(hosts));
  });
}

const EVERY_SEGMENT = [
  "composer-plan-usage-plan",
  "composer-plan-usage-window-five_hour",
  "composer-plan-usage-window-weekly",
  "composer-plan-usage-window-weekly_model_fable",
];

async function readSegmentIds(page: Page): Promise<string[]> {
  return page
    .getByTestId("composer-plan-usage")
    .locator('[data-testid^="composer-plan-usage-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid") ?? ""));
}

test.describe("plan usage in the composer context strip", () => {
  test("shows the current provider's plan and every window, fetched once on mount", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const usageFixture = await installProviderUsageFixture(page, [
      {
        fetchedAt: new Date().toISOString(),
        providers: [
          mockPlanUsage(),
          {
            providerId: "codex",
            displayName: "Codex",
            status: "available",
            planLabel: "Pro",
            windows: [{ id: "session", label: "Session", usedPct: 12 }],
          },
        ],
      },
    ]);
    const session = await openMockAgentOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge).toBeVisible({ timeout: 10_000 });

      expect(await readSegmentIds(page)).toEqual([
        "composer-plan-usage-plan",
        "composer-plan-usage-window-five_hour",
        "composer-plan-usage-window-weekly",
        "composer-plan-usage-window-weekly_model_fable",
      ]);
      await expect(gauge.getByTestId("composer-plan-usage-plan")).toHaveText("Max 20x");
      await expect(gauge.getByTestId("composer-plan-usage-window-five_hour")).toHaveText(
        "5h82%out in 1h",
      );
      await expect(gauge.getByTestId("composer-plan-usage-window-weekly")).toHaveText("Week45%4d");
      await expect(gauge.getByTestId("composer-plan-usage-window-weekly_model_fable")).toHaveText(
        "Fable0%4d",
      );
      // 按无障碍树里的 role 和名字找，名字没进无障碍树就找不到。
      await expect(
        page.getByRole("group", { name: "Weekly: 45% used, resets 4d", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("group", { name: "Plan usage", exact: true })).toBeVisible();
      // 余额不进窄栏，其他提供方也不进。
      await expect(gauge).not.toContainText("Extra usage");
      await expect(gauge).not.toContainText("Pro");

      expect(usageFixture.requestCount()).toBe(1);
    } finally {
      await session.cleanup();
    }
  });

  test("shows the full plan usage card on hover and refreshes each time it opens", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fetchedAt = new Date().toISOString();
    const usageFixture = await installProviderUsageFixture(page, [
      { fetchedAt, providers: [mockPlanUsage({ fetchedAt })] },
      {
        fetchedAt,
        providers: [
          mockPlanUsage({
            fetchedAt,
            windows: [
              { id: "five_hour", label: "Session", usedPct: 12, resetsAt: fromNow(3 * HOUR_MS) },
              {
                id: "weekly",
                label: "Weekly",
                usedPct: 46,
                resetsAt: fromNow(4 * DAY_MS),
                tone: "ok",
              },
            ],
          }),
        ],
      },
    ]);
    const session = await openMockAgentOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge).toBeVisible({ timeout: 10_000 });
      expect(usageFixture.requestCount()).toBe(1);

      const card = page.getByTestId("composer-plan-usage-card");
      await gauge.hover();
      await usageFixture.waitForRequestCount(2);
      await expect(card).toBeVisible({ timeout: 10_000 });
      // 第二次应答只剩两个窗口：卡片显示的是打开时刷新回来的数据。
      await expect(card.getByTestId("provider-usage-window-five_hour")).toHaveText(
        "Session12%resets 3h",
      );
      await expect(card.getByTestId("provider-usage-window-weekly")).toHaveText(
        "Weekly46%resets 4d",
      );
      await expect(card.getByTestId("provider-usage-window-weekly_model_fable")).toHaveCount(0);
      await expect(card.getByText("Max 20x", { exact: true })).toBeVisible();
      await expect(card.getByText("Updated just now", { exact: true })).toBeVisible();
      await expect(card.getByText("Extra usage", { exact: true })).toBeVisible();
      await expect(card.getByText("$3.00 / $50.00", { exact: true })).toBeVisible();

      await page.mouse.move(0, 0);
      await expect(card).toHaveCount(0);

      await gauge.hover();
      await usageFixture.waitForRequestCount(3);
      await expect(card).toBeVisible();
      expect(usageFixture.requestCount()).toBe(3);
    } finally {
      await session.cleanup();
    }
  });

  test("stays quiet when every attempt to fetch fails", async ({ page }) => {
    test.setTimeout(180_000);
    const usageFixture = await installProviderUsageFixture(page, [
      { rpcError: "Provider usage is unavailable" },
    ]);
    const session = await openMockAgentOnDesktop(page);
    try {
      // 首次取数加上 React Query 默认的 3 次重试。
      await usageFixture.waitForRequestCount(4);
      // 圆环弹层和窄栏读同一份取数状态：弹层显示出错文案时，窄栏也已按出错状态渲染。
      await page.getByTestId("context-window-meter").hover();
      // 悬停会让窄栏的查询带着默认重试再取一轮（约 7 秒退避）才回到出错状态。
      await expect(page.getByText("Provider usage is unavailable")).toBeVisible({
        timeout: 20_000,
      });
      const strip = page.getByTestId("composer-context-strip");
      await expect(strip.getByTestId("composer-plan-usage")).toHaveCount(0);
      await expect(strip).not.toContainText("Provider usage is unavailable");
      await expect(page.getByTestId("composer-context-strip-branch-switcher")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("refreshes every five minutes and goes quiet once the provider has no plan usage", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.clock.install();
    const usageFixture = await installProviderUsageFixture(page, [
      { fetchedAt: new Date().toISOString(), providers: [mockPlanUsage()] },
      {
        fetchedAt: new Date().toISOString(),
        providers: [mockPlanUsage({ providerId: "claude", displayName: "Claude" })],
      },
    ]);
    const session = await openMockAgentOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge).toBeVisible({ timeout: 10_000 });
      expect(usageFixture.requestCount()).toBe(1);

      await page.clock.fastForward(5 * 60_000);
      await usageFixture.waitForRequestCount(2);
      await expect(gauge).toHaveCount(0);
      await expect(page.getByTestId("composer-context-strip-branch-switcher")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("stays quiet and never asks a host without plan usage", async ({ page }) => {
    test.setTimeout(180_000);
    const usageFixture = await installProviderUsageFixture(
      page,
      [{ fetchedAt: new Date().toISOString(), providers: [mockPlanUsage()] }],
      { supported: false },
    );
    const session = await openMockAgentOnDesktop(page);
    try {
      // 弹层提示更新主机，说明主机特性已经读到；窄栏与它读的是同一个特性标志。
      await page.getByTestId("context-window-meter").hover();
      await expect(page.getByText("Update the host to see provider usage")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("composer-plan-usage")).toHaveCount(0);
      expect(usageFixture.requestCount()).toBe(0);
    } finally {
      await session.cleanup();
    }
  });

  test("gives way as the composer narrows, keeping the branch readable", async ({ page }) => {
    test.setTimeout(180_000);
    await hideHostBadges(page);
    await installProviderUsageFixture(page, [
      { fetchedAt: new Date().toISOString(), providers: [mockPlanUsage()] },
    ]);
    const branch = "feature/plan-usage-strip-keeps-a-readable-branch-name";
    const session = await openMockAgentOnDesktop(page, { branch });
    try {
      const strip = page.getByTestId("composer-context-strip");
      const branchSwitcher = page.getByTestId("composer-context-strip-branch-switcher");
      await expect(branchSwitcher).toContainText(branch, { timeout: 30_000 });
      await expect.poll(() => readSegmentIds(page), { timeout: 10_000 }).toEqual(EVERY_SEGMENT);

      // 输入框约 420px 宽：后面的窗口段和套餐名段都让位，第一个窗口段留下，分支名仍有约 80px。
      await page.setViewportSize({ width: 772, height: DESKTOP_VIEWPORT.height });
      await expect
        .poll(() => readSegmentIds(page))
        .toEqual(["composer-plan-usage-window-five_hour"]);
      await expect(page.getByTestId("composer-plan-usage-window-five_hour")).toHaveText(
        "5h82%out in 1h",
      );
      const narrowBranch = await branchSwitcher.boundingBox();
      expect(narrowBranch?.width ?? 0).toBeGreaterThanOrEqual(80);
      // 分支名截断（以省略号结尾），而不是被整个挤掉。
      const isBranchTruncated = await branchSwitcher
        .getByText(branch, { exact: true })
        .evaluate((label) => label.scrollWidth > label.clientWidth);
      expect(isBranchTruncated).toBe(true);
      expect((await strip.boundingBox())?.height).toBe(28);

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await expect.poll(() => readSegmentIds(page)).toEqual(EVERY_SEGMENT);
      expect((await strip.boundingBox())?.height).toBe(28);
    } finally {
      await session.cleanup();
    }
  });

  test("keeps every segment while the agent panel is hidden and shown again", async ({ page }) => {
    test.setTimeout(180_000);
    await hideHostBadges(page);
    await installProviderUsageFixture(page, [
      { fetchedAt: new Date().toISOString(), providers: [mockPlanUsage()] },
    ]);
    const session = await openMockAgentOnDesktop(page);
    try {
      const created = await session.client.createTerminal(
        session.cwd,
        "plan-usage-other",
        undefined,
        {
          workspaceId: session.workspaceId,
        },
      );
      const terminalId = created.terminal?.id;
      if (!terminalId) throw new Error(`Failed to create terminal: ${created.error}`);
      await expect.poll(() => readSegmentIds(page), { timeout: 10_000 }).toEqual(EVERY_SEGMENT);

      // 保留面板隐藏再显示，包括回来后的头几帧，仪表一段都不能少。Chromium 里隐藏期间
      // onLayout 不会报 0 宽（2026-10-01 实测），这里守的是整个隐藏、显示过程不重排。
      await page.getByTestId("composer-context-strip").evaluate((strip) => {
        const count = () => strip.querySelectorAll('[data-testid^="composer-plan-usage-"]').length;
        const record = window as unknown as { __fewestPlanUsageSegments: number };
        record.__fewestPlanUsageSegments = count();
        new MutationObserver(() => {
          record.__fewestPlanUsageSegments = Math.min(record.__fewestPlanUsageSegments, count());
        }).observe(strip, { childList: true, subtree: true });
      });
      await page.getByTestId(`workspace-tab-terminal_${terminalId}`).first().click();
      await expect(page.getByTestId("composer-context-strip")).toBeHidden();
      await page.getByTestId(`workspace-tab-agent_${session.agentId}`).first().click();
      await expect(page.getByTestId("composer-context-strip")).toBeVisible();

      expect(await readSegmentIds(page)).toEqual(EVERY_SEGMENT);
      const fewest = await page.evaluate(
        () =>
          (window as unknown as { __fewestPlanUsageSegments: number }).__fewestPlanUsageSegments,
      );
      expect(fewest).toBe(EVERY_SEGMENT.length);
    } finally {
      await session.cleanup();
    }
  });

  test("follows the provider selected in a new agent draft", async ({ page }) => {
    test.setTimeout(180_000);
    await hideHostBadges(page);
    await installProviderUsageFixture(page, [
      {
        fetchedAt: new Date().toISOString(),
        providers: [
          mockPlanUsage({ providerId: "claude", displayName: "Claude" }),
          codexPlanUsage(),
        ],
      },
    ]);
    const workspace = await openDraftTabOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");

      await selectComposerProvider(page, "claude");
      await expect.poll(() => readSegmentIds(page), { timeout: 10_000 }).toEqual(EVERY_SEGMENT);
      await expect(gauge.getByTestId("composer-plan-usage-plan")).toHaveText("Max 20x");

      await selectComposerProvider(page, "codex");
      await expect
        .poll(() => readSegmentIds(page), { timeout: 10_000 })
        .toEqual([
          "composer-plan-usage-plan",
          "composer-plan-usage-window-session",
          "composer-plan-usage-window-weekly",
          "composer-plan-usage-window-code_review",
        ]);
      await expect(gauge.getByTestId("composer-plan-usage-plan")).toHaveText("Pro");
      await expect(gauge.getByTestId("composer-plan-usage-window-session")).toHaveText("5h12%3h");
      await expect(gauge.getByTestId("composer-plan-usage-window-code_review")).toHaveText(
        "Review5%4d",
      );

      // mock 在套餐用量结果里没有条目。
      await selectComposerProvider(page, "mock");
      await expect(gauge).toHaveCount(0);
      await expect(page.getByTestId("composer-context-strip-branch-switcher")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
