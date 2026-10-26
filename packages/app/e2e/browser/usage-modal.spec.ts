import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { getServerId } from "../support/helpers/server-id";
import { openUsagePageFromShell } from "../support/helpers/usage-page";
import { seedSidebarFooterPreferences } from "../support/helpers/sidebar-nav-settings";
import {
  installUsageReportsFixture,
  type UsageListRequest,
  type UsageReportsFixture,
} from "../support/helpers/usage-reports";
import {
  installLoginUsage,
  expectLoginUsageFreshness,
  installCodexWindowUsage,
  installResetUsage,
  expectCodexReportedWindows,
  refreshLoginUsage,
  hoverUsageWindow,
} from "../support/helpers/usage-login";
import {
  claudeAndCodexReports,
  expectPinnedUsage,
  openCompactSidebar,
  openUsageFromIcon,
  openUsageFromItem,
  pinRow,
  openUsageOptions,
  closeUsageOptions,
  expectUsageOptionsFitContent,
  showUsageAs,
  refreshAllUsage,
  togglePin,
  usageItem,
  usageModal,
  closeUsage,
} from "../support/helpers/usage-sidebar-item";

const emptyHome = path.join(tmpdir(), `paseo-usage-empty-${randomUUID()}`);
test.use({
  e2eDaemonEnvironment: {
    HOME: emptyHome,
    USERPROFILE: emptyHome,
    CODEX_HOME: emptyHome,
    CLAUDE_CONFIG_DIR: emptyHome,
    XDG_DATA_HOME: emptyHome,
    PI_CODING_AGENT_DIR: emptyHome,
    COPILOT_TOKEN: "",
    GITHUB_TOKEN: "",
    GITHUB_PAT: "",
    CURSOR_ACCESS_TOKEN: "",
    CURSOR_TOKEN: "",
    GROK_API_KEY: "",
    GROK_TOKEN: "",
    KIMI_TOKEN: "",
    KIMI_API_KEY: "",
    KIMI_CODE_HOME: emptyHome,
    MINIMAX_API_KEY: "",
    ZAI_API_KEY: "",
    GLM_API_KEY: "",
  },
});

// These tests read the sidebar summary and pin windows, which both need the Usage item on.
test.beforeEach(async ({ page }) => {
  await seedSidebarFooterPreferences(page, [{ key: "usage", visible: true }]);
});

function forcedRefreshes(usage: UsageReportsFixture): UsageListRequest[] {
  return usage.listRequests().filter((request) => request.forceRefresh);
}

// Two hours reads "2h ago" for an hour, so the assertion cannot race the clock.
function twoHoursAgo(): string {
  return new Date(Date.now() - 2 * 60 * 60_000).toISOString();
}

/** Set PASEO_QA_SCREENSHOT_DIR to keep a QA screenshot. */
async function qaScreenshot(page: Page, name: string) {
  const directory = process.env.PASEO_QA_SCREENSHOT_DIR;
  if (!directory) return;
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: ".__expo_fast_refresh { display: none !important; }" });
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
}

function hostFilter(page: Page) {
  return page.locator('[data-testid="usage-host-filter-trigger"]:visible');
}

function weeklyReport(sourceId: string, usedPct: number): UsageReportEntry {
  return {
    id: `${sourceId}:a`,
    account: {},
    fetchedAt: twoHoursAgo(),
    sourceId,
    sourceLabel: `${sourceId} plan`,
    report: { status: "available", windows: [{ id: "weekly", label: "Weekly", usedPct }] },
  };
}

function installReversedUsageRefresh(page: Page) {
  const initial = [weeklyReport("opencode", 31), weeklyReport("openai", 12)];
  const refreshed = [weeklyReport("openai", 22), weeklyReport("opencode", 41)];
  return installUsageReportsFixture(page, {
    lists: [(request) => (request.forceRefresh ? refreshed : initial)],
  });
}

async function openUsageSummaryAtWidth(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await gotoAppShell(page);
  if (width === 390) await openCompactSidebar(page);
  await expectPinnedUsage(page, ["31% Weekly", "12% Weekly"]);
  await openUsageFromItem(page);
}

async function expectUsageProviderOrder(page: Page, summary: string[]) {
  const group = page.getByTestId(`usage-host-${getServerId()}`);
  await expect(group.getByText(/^(opencode|openai) plan$/)).toHaveText([
    "opencode plan",
    "openai plan",
  ]);
  await expectPinnedUsage(page, summary);
}

async function refreshUsageAndWaitForReports(page: Page, usage: UsageReportsFixture) {
  const requestCount = usage.listRequests().length;
  await refreshAllUsage(page);
  await usage.waitForListRequests(requestCount + 1);
  const group = page.getByTestId(`usage-host-${getServerId()}`);
  await expect(group.getByText("41%", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh all", exact: true })).toBeEnabled();
}

test.describe("usage modal", () => {
  test("opens from the sidebar on the host's reports, with no host filter for one host", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();
    const usage = await installUsageReportsFixture(page, {
      lists: [
        [
          {
            id: "alpha:a",
            account: {},
            fetchedAt: twoHoursAgo(),
            sourceId: "alpha",
            sourceLabel: "Alpha plan",
            report: {
              status: "available",
              windows: [{ id: "weekly", label: "Weekly", usedPct: 31 }],
            },
          },
          {
            id: "beta:b",
            account: {},
            fetchedAt: "2026-01-01T00:00:00.000Z",
            sourceId: "beta",
            sourceLabel: "Beta plan",
            report: {
              status: "unavailable",
              problem: { kind: "no_quota", detail: "No active coding plan" },
            },
          },
        ],
      ],
    });

    await gotoAppShell(page);
    await openUsageFromItem(page);
    await usage.waitForListRequests(1);

    const group = page.getByTestId(`usage-host-${serverId}`);
    await expect(group.getByText("Alpha plan", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(hostFilter(page)).toHaveCount(0);
    await qaScreenshot(page, "usage-modal-one-host");
    await expect(group.getByText("31%")).toBeVisible();
    await expect(group.getByText("Beta plan", { exact: true })).toBeVisible();
    await expect(group.getByText("Unavailable", { exact: true })).toBeVisible();

    await group.getByTestId("usage-refresh").first().hover();
    await expect(page.getByTestId("usage-freshness-tooltip")).toHaveText("Updated 2h ago");
    await expect(group.getByTestId("usage-freshness")).toHaveCount(0);
  });

  for (const width of [1440, 390]) {
    test(`keeps sidebar and modal provider order across a reversed refresh at width ${width}`, async ({
      page,
    }) => {
      const usage = await installReversedUsageRefresh(page);
      await openUsageSummaryAtWidth(page, width);
      await expectUsageProviderOrder(page, ["31% Weekly", "12% Weekly"]);
      await qaScreenshot(page, `usage-order-${width}-before-refresh`);

      await refreshUsageAndWaitForReports(page, usage);
      await expectUsageProviderOrder(page, ["41% Weekly", "22% Weekly"]);
      await qaScreenshot(page, `usage-order-${width}-after-refresh`);
    });
  }

  test("refreshes one report from its card", async ({ page }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();
    const beta: UsageReportEntry = {
      id: "beta:b",
      account: {},
      fetchedAt: twoHoursAgo(),
      sourceId: "beta",
      sourceLabel: "Beta plan",
      report: {
        status: "available",
        windows: [{ id: "weekly", label: "Weekly", usedPct: 12 }],
      },
    };
    const alpha = (usedPct: number, fetchedAt: string): UsageReportEntry => ({
      id: "alpha:a",
      account: {},
      fetchedAt,
      sourceId: "alpha",
      sourceLabel: "Alpha plan",
      report: {
        status: "available",
        windows: [{ id: "weekly", label: "Weekly", usedPct }],
      },
    });
    // The sidebar summary and the modal each load reports; only a card's Refresh forces one.
    const usage = await installUsageReportsFixture(page, {
      lists: [
        (request) =>
          request.forceRefresh
            ? [alpha(58, new Date().toISOString())]
            : [alpha(31, twoHoursAgo()), beta],
      ],
    });

    await gotoAppShell(page);
    await openUsageFromItem(page);
    const group = page.getByTestId(`usage-host-${serverId}`);
    await expect(group.getByText("31%")).toBeVisible({ timeout: 10_000 });

    const alphaRefresh = group.getByTestId("usage-refresh").first();
    await alphaRefresh.click();
    await expect
      .poll(() => forcedRefreshes(usage))
      .toEqual([{ forceRefresh: true, reportIds: ["alpha:a"] }]);
    await expect(group.getByText("58%")).toBeVisible();
    await expect(group.getByText("12%")).toBeVisible();

    await group.getByTestId("usage-refresh").nth(1).hover();
    await expect(page.getByTestId("usage-freshness-tooltip")).toHaveText("Updated 2h ago");
    await alphaRefresh.hover();
    await expect(page.getByTestId("usage-freshness-tooltip")).toHaveText("Updated just now");
  });

  test("shows the host once it connects after a cold load on a phone", async ({ page }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();
    const usage = await installUsageReportsFixture(page, {
      lists: [
        [
          {
            id: "alpha:a",
            account: {},
            fetchedAt: twoHoursAgo(),
            sourceId: "alpha",
            sourceLabel: "Alpha plan",
            report: { status: "available", windows: [] },
          },
        ],
      ],
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAppShell(page);
    await openCompactSidebar(page);
    await openUsageFromIcon(page);
    await usage.waitForListRequests(1);

    const group = page.getByTestId(`usage-host-${serverId}`);
    await expect(group.getByText("Alpha plan", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(group.getByTestId("usage-freshness")).toHaveText("Updated 2h ago");
  });

  test("tells the user to update a host without usage support", async ({ page }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();
    const usage = await installUsageReportsFixture(page, { usageSupported: false });

    await gotoAppShell(page);
    // Without reports the footer has no Usage item; its Usage icon opens Usage.
    await openUsageFromIcon(page);

    await expect(
      page.getByTestId(`usage-host-${serverId}`).getByText(/^Update .+ to see plan usage$/),
    ).toBeVisible({ timeout: 10_000 });
    await qaScreenshot(page, "phase7-usage-update-host");
    await expect(page.getByTestId("usage-options-menu")).toHaveCount(0);
    await expect(page.getByTestId("usage-refresh-all")).toHaveCount(0);
    expect(usage.listRequests()).toHaveLength(0);
  });

  test("a host picked in the Usage modal is the sidebar's host too, after a reload", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const primaryServerId = getServerId();
    const secondary = await startIsolatedHostDaemon(
      `srv_usage_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    );
    try {
      await installUsageReportsFixture(page, { lists: [[weeklyReport("alpha", 31)]] });
      await installUsageReportsFixture(page, {
        port: secondary.port,
        lists: [[weeklyReport("beta", 12)]],
      });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondary.serverId,
        label: "Secondary box",
        port: secondary.port,
      });

      // Nothing picked and no workspace open: the first host.
      await expectPinnedUsage(page, ["31% Weekly"]);
      await openUsageFromItem(page);
      await expect(page.getByTestId(`usage-host-${primaryServerId}`)).toBeVisible();

      await hostFilter(page).click();
      await page.getByTestId(`usage-host-filter-item-${secondary.serverId}`).click();
      await expect(
        page.getByTestId(`usage-host-${secondary.serverId}`).getByText("12%"),
      ).toBeVisible({ timeout: 30_000 });
      await expect(hostFilter(page)).toContainText("Secondary box");
      await qaScreenshot(page, "usage-modal-picked-host");
      await expectPinnedUsage(page, ["12% Weekly"]);

      // The e2e seed resets the host list on every load, so reopening re-adds the second host.
      await addConnectedHostAndReload(page, {
        serverId: secondary.serverId,
        label: "Secondary box",
        port: secondary.port,
      });
      await expectPinnedUsage(page, ["12% Weekly"]);
      await openUsageFromItem(page);
      await expect(
        page.getByTestId(`usage-host-${secondary.serverId}`).getByText("12%"),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await secondary.close().catch(() => undefined);
    }
  });
});

const loginWindows: UsageReportEntry["report"] = {
  status: "available",
  windows: [
    { id: "five_hour", label: "Session", shortLabel: "5h", summary: true, usedPct: 31 },
    { id: "weekly", label: "Weekly", shortLabel: "wk", summary: true, usedPct: 54 },
  ],
};

test("expired login refreshes to windows with visible pin toggles", async ({ page }) => {
  const fixture = await installLoginUsage({
    status: "unavailable",
    problem: {
      kind: "expired",
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      refreshedBy: "claude",
    },
  });
  try {
    await gotoAppShell(page);
    await openUsageFromIcon(page);
    await expect(
      page.getByText("Claude: Login expired 1h ago. Run claude to refresh it.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
    await qaScreenshot(page, "usage-expired-login");
    await fixture.setReport(loginWindows);
    await refreshLoginUsage(page);
    await expect(
      page.getByText("Claude: Login expired 1h ago. Run claude to refresh it.", { exact: true }),
    ).toHaveCount(0);
    await expectPinnedUsage(page, ["31% 5h", "54% wk"]);
    const row = page.getByRole("checkbox", { name: /^Pin Claude Weekly, / });
    await expect(row).toBeChecked();
    await expect(row.getByTestId("usage-pin-glyph-pinned")).toHaveCSS("opacity", "1");
    await hoverUsageWindow(page, "Weekly");
    await expect(page.getByText("Unpin", { exact: true })).toBeVisible();
    await expect(row.getByTestId("usage-pin-glyph-pinned")).toHaveCSS("opacity", "1");
    await expect(row.getByTestId("usage-pin-glyph-pinned").locator("svg")).not.toHaveAttribute(
      "fill",
      "none",
    );
    await qaScreenshot(page, "usage-pin-hover");
    await togglePin(page.getByTestId("usage-report-login-journey:account"), "Claude", "Weekly");
    await expect(row.getByTestId("usage-pin-glyph-unpinned")).toHaveCSS("opacity", "1");
    await expect(row.getByTestId("usage-pin-glyph-unpinned").locator("svg")).toHaveAttribute(
      "fill",
      "none",
    );
    await hoverUsageWindow(page, "Weekly");
    await expect(page.getByText("Pin", { exact: true })).toBeVisible();
    await expectPinnedUsage(page, ["31% 5h"]);
    await qaScreenshot(page, "usage-pin-unselected");
    await togglePin(page.getByTestId("usage-report-login-journey:account"), "Claude", "Weekly");
    await expect(row.getByTestId("usage-pin-glyph-pinned")).toHaveCSS("opacity", "1");
    await expectPinnedUsage(page, ["31% 5h", "54% wk"]);
  } finally {
    await fixture.cleanup();
  }
});

test("compact usage rows always show the pin glyph", async ({ page }) => {
  const fixture = await installLoginUsage(loginWindows);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAppShell(page);
    await openCompactSidebar(page);
    await openUsageFromIcon(page);
    const card = page.getByTestId("usage-report-login-journey:account");
    await expect(card.getByTestId("usage-pin-glyph-pinned")).toHaveCount(2);
    await expect(card.getByTestId("usage-pin-glyph-pinned").nth(0)).toHaveCSS("opacity", "1");
    await expect(card.getByTestId("usage-pin-glyph-pinned").nth(1)).toHaveCSS("opacity", "1");
    await qaScreenshot(page, "usage-pin-compact");
  } finally {
    await fixture.cleanup();
  }
});

for (const shape of ["seven-day-only", "Spark"] as const) {
  test(`Codex ${shape} windows use provider durations on the card and sidebar`, async ({
    page,
  }) => {
    const reset = Math.floor(Date.now() / 1000) + 5 * 86400;
    const source = await installCodexWindowUsage({
      rate_limit: {
        primary_window: { used_percent: 11, limit_window_seconds: 604800, reset_at: reset },
        secondary_window: null,
      },
      additional_rate_limits:
        shape === "Spark"
          ? [
              {
                limit_name: "GPT-5.3-Codex-Spark",
                metered_feature: "codex_bengalfox",
                rate_limit: {
                  primary_window: {
                    used_percent: 0,
                    limit_window_seconds: 18000,
                    reset_at: Math.floor(Date.now() / 1000) + 3600,
                  },
                  secondary_window: {
                    used_percent: 0,
                    limit_window_seconds: 604800,
                    reset_at: reset,
                  },
                },
              },
            ]
          : [],
    });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoAppShell(page);
      await expect(usageItem(page)).toBeVisible();
      await openUsageFromItem(page);
      await qaScreenshot(page, `codex-${shape}-card-and-summary`);
      await expectCodexReportedWindows(page, shape);
      await qaScreenshot(page, `codex-${shape}-pins`);
    } finally {
      await source.cleanup();
    }
  });
}

// Osuna 工单 11：ChatGPT 账号持有的重置次数，走真实的 Codex 来源（假的 wham 回复）。
// 小屏要先打开侧边栏才有用量入口，进了用量页侧边栏会收起，所以两种视口各给一条走法。
const RESETS_LAYOUTS = [
  {
    size: "1280",
    viewport: { width: 1280, height: 800 },
    revealSidebar: async (_page: Page) => {},
    openUsagePage: openUsagePageFromShell,
  },
  {
    size: "390",
    viewport: { width: 390, height: 844 },
    revealSidebar: openCompactSidebar,
    openUsagePage: async (page: Page) => {
      await page.locator('[data-testid="sidebar-usage-stats"]:visible').first().click();
      await expect(page).toHaveURL(/\/usage$/);
    },
  },
];

for (const theme of ["light", "dark"] as const) {
  for (const layout of RESETS_LAYOUTS) {
    test(`Codex resets show on the plan usage card and the usage page at ${layout.size} ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.addInitScript((value) => {
        const key = "@paseo:app-settings";
        const current = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(key, JSON.stringify({ ...current, theme: value }));
      }, theme);
      const soonest = new Date(Date.now() + 3 * 86400_000).toISOString();
      const source = await installCodexWindowUsage(
        {
          plan_type: "plus",
          rate_limit: {
            primary_window: { used_percent: 82, limit_window_seconds: 18000 },
            secondary_window: { used_percent: 47, limit_window_seconds: 604800 },
          },
          rate_limit_reset_credits: { available_count: 2 },
        },
        {
          available_count: 2,
          credits: [
            { id: "lasting", status: "available", expires_at: null },
            { id: "soonest", status: "available", expires_at: soonest },
          ],
        },
      );
      try {
        await page.setViewportSize(layout.viewport);
        await gotoAppShell(page);
        await layout.revealSidebar(page);
        await expect(usageItem(page)).toBeVisible({ timeout: 30_000 });
        await openUsageFromItem(page);
        const resets = usageModal(page).getByTestId("usage-resets");
        await expect(resets.getByTestId("usage-resets-summary")).toHaveText(
          /^2 resets left · Soonest expires .+/,
        );
        await expect(resets.getByTestId("usage-resets-card")).toHaveCount(0);
        await qaScreenshot(page, `usage-modal-codex-resets-${layout.size}-${theme}`);
        await resets.getByRole("button", { name: "Show when each reset expires" }).click();
        await expect(resets.getByTestId("usage-resets-card")).toHaveText([
          /^Reset 1 expires .+/,
          "Reset 2 never expires",
        ]);
        await qaScreenshot(page, `usage-modal-codex-resets-expanded-${layout.size}-${theme}`);
        await resets.getByRole("button", { name: "Hide when each reset expires" }).click();
        await expect(resets.getByTestId("usage-resets-card")).toHaveCount(0);

        await closeUsage(page);
        await expect(usageModal(page)).toHaveCount(0);
        await layout.openUsagePage(page);
        const onPage = page.getByTestId("usage-resets").first();
        await expect(onPage.getByTestId("usage-resets-summary")).toHaveText(
          /^2 resets left · Soonest expires .+/,
          { timeout: 30_000 },
        );
        await onPage.scrollIntoViewIfNeeded();
        await qaScreenshot(page, `usage-page-codex-resets-${layout.size}-${theme}`);
      } finally {
        await source.cleanup();
      }
    });
  }
}

// Osuna 工单 12：卡片上用掉一次重置。假的套餐用量来源能用掉重置，结果与之后的读数由测试决定。
function resetReport(input: { usedPct: number; count: number }) {
  return {
    status: "available" as const,
    planLabel: "plus",
    windows: [
      {
        id: "five_hour",
        label: "5-hour",
        usedPct: input.usedPct,
        remainingPct: 100 - input.usedPct,
      },
    ],
    resets: {
      count: input.count,
      until: new Date(Date.now() + 3 * 86400_000).toISOString(),
    },
  };
}

for (const layout of RESETS_LAYOUTS) {
  test(`using a reset asks first, says what failed, and shows what it did at ${layout.size}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const source = await installResetUsage(resetReport({ usedPct: 82, count: 2 }), {
      error: "Codex refused the reset (HTTP 403)",
    });
    try {
      await page.setViewportSize(layout.viewport);
      await gotoAppShell(page);
      await layout.revealSidebar(page);
      await expect(usageItem(page)).toBeVisible({ timeout: 30_000 });
      await openUsageFromItem(page);
      const resets = usageModal(page).getByTestId("usage-resets");
      const use = resets.getByRole("button", { name: "Use a reset", exact: true });
      await expect(use).toBeVisible();
      await qaScreenshot(page, `usage-modal-reset-use-button-${layout.size}-light`);

      // 先问：写明是哪个账号、不能撤回、用掉最早过期的那张；取消就什么都不发
      await use.click();
      // 手机上是底部弹层，测试 ID 不在装正文的那一层，按文字找
      await expect(page.getByText("Use a Codex reset?")).toBeVisible();
      await expect(
        page.getByText(
          "Codex has 2 resets. Using one starts its windows again at once, as if none of them had been used. It can't be undone.",
        ),
      ).toBeVisible();
      await expect(
        page.getByText(/^The one used is the one that runs out first, .+\.$/),
      ).toBeVisible();
      const confirm = page.getByTestId("usage-resets-use-confirm");
      await expect(confirm).toBeInViewport({ ratio: 1 });
      await qaScreenshot(page, `usage-modal-reset-confirm-${layout.size}-light`);
      await page.getByTestId("usage-resets-use-cancel").click();
      await expect(confirm).toHaveCount(0);
      expect(await source.consumed()).toBe(0);

      // 失败：原因留在框里，再按一次就重试
      await use.click();
      await page.getByTestId("usage-resets-use-confirm").click();
      await expect(page.getByTestId("usage-resets-use-error")).toHaveText(
        "Couldn't use a reset: Codex refused the reset (HTTP 403)",
      );
      expect(await source.consumed()).toBe(1);
      await qaScreenshot(page, `usage-modal-reset-failed-${layout.size}-light`);

      await source.setAnswer({
        code: "reset",
        windows: 2,
        after: resetReport({ usedPct: 0, count: 1 }),
        delayMs: 2_000,
      });
      await page.getByTestId("usage-resets-use-confirm").click();
      // 进行中：按钮转圈且按不动
      await expect(page.getByTestId("usage-resets-use-confirm")).toBeDisabled();
      await qaScreenshot(page, `usage-modal-reset-consuming-${layout.size}-light`);
      await expect(confirm).toHaveCount(0);
      expect(await source.consumed()).toBe(2);
      await expect(resets.getByTestId("usage-resets-result")).toContainText(
        "2 windows started again",
      );
      // 卡片随即换成用掉之后的读数
      await expect(resets.getByTestId("usage-resets-summary")).toHaveText(
        /^1 reset left · Soonest expires .+/,
      );
      await qaScreenshot(page, `usage-modal-reset-done-${layout.size}-light`);
      await resets.getByTestId("usage-resets-result-dismiss").click();
      await expect(resets.getByTestId("usage-resets-result")).toHaveCount(0);
    } finally {
      await source.cleanup();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const [size, viewport] of Object.entries({
    desktop: { width: 1440, height: 900 },
    compact: { width: 390, height: 844 },
  })) {
    test(`Usage Settings cog ${size} ${theme}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.addInitScript((value) => {
        const key = "@paseo:app-settings";
        const current = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(key, JSON.stringify({ ...current, theme: value }));
      }, theme);
      const usage = await installUsageReportsFixture(page, {
        lists: [() => claudeAndCodexReports()],
      });
      await page.setViewportSize(viewport);
      await gotoAppShell(page);
      if (size === "compact") await openCompactSidebar(page);
      await openUsageFromIcon(page);
      const screen = page.getByTestId(`usage-host-${getServerId()}`);
      await expect(screen.getByText("Claude", { exact: true })).toBeVisible({ timeout: 30_000 });
      const settings = page.getByTestId("usage-options-menu");
      // Osuna：订阅额度的界面都叫「套餐用量」，这个齿轮的名字是 usage.planUsage.options。
      await expect(settings).toHaveAccessibleName("Plan usage options");
      await expect(page.getByTestId("usage-display-used")).toHaveCount(0);
      await captureSettingsState(page, testInfo, `${size}-${theme}-cog`);

      await openUsageOptions(page);
      await expectUsageOptionsFitContent(page);
      await expect(page.getByText("Pinned windows show in the sidebar footer")).toBeVisible();
      await expect(page.getByTestId("usage-display-used")).toHaveAttribute("aria-selected", "true");
      await captureSettingsState(page, testInfo, `${size}-${theme}-settings`);
      await showUsageAs(page, "remaining");
      await expect(screen.getByText("69% left")).toBeVisible();
      await showUsageAs(page, "used");
      await expect(pinRow(screen, "Claude", "Session")).toHaveAccessibleName(
        /^Pin Claude Session, 31% · resets /,
      );
      await openUsageOptions(page);
      await closeUsageOptions(page);
      await refreshAllUsage(page);
      await expect.poll(() => forcedRefreshes(usage)).toEqual([{ forceRefresh: true }]);
    });
  }
}

async function captureSettingsState(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
) {
  await qaScreenshot(page, name);
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

test("an account with all logins failing shows each harness and remedy, then only usage when one succeeds", async ({
  page,
}) => {
  const fixture = await installLoginUsage([
    { harness: "Codex", report: { status: "error", error: "Usage API returned 500. Try again." } },
    {
      harness: "OpenCode",
      report: {
        status: "unavailable",
        problem: { kind: "rejected", status: 401, refreshedBy: "opencode" },
      },
    },
    {
      harness: "Pi",
      report: { status: "unavailable", problem: { kind: "no_quota", detail: "No active plan" } },
    },
    {
      harness: "OMP",
      report: {
        status: "unavailable",
        problem: { kind: "rejected", status: 403, refreshedBy: "omp" },
      },
    },
  ]);
  try {
    await gotoAppShell(page);
    await openUsageFromIcon(page);
    await expectLoginErrors(page, [
      "Codex: Usage API returned 500. Try again.",
      "OpenCode: Login rejected (HTTP 401). Run opencode to refresh it.",
      "Pi: No active plan",
      "OMP: Login rejected (HTTP 403). Run omp to refresh it.",
    ]);
    await fixture.setReport([
      {
        harness: "Codex",
        report: { status: "error", error: "Usage API returned 500. Try again." },
      },
      {
        harness: "OpenCode",
        report: { status: "available", windows: [{ id: "weekly", label: "Weekly", usedPct: 42 }] },
      },
    ]);
    await refreshLoginUsage(page);
    await expectLoginUsageOnly(page, "42%");
  } finally {
    await fixture.cleanup();
  }
});

async function expectLoginErrors(page: Page, lines: string[]) {
  const card = page.getByTestId("usage-report-login-journey:account");
  await expect(card.getByTestId("usage-login-error")).toHaveText(lines.join("\n"));
}

async function expectLoginUsageOnly(page: Page, percentage: string) {
  const card = page.getByTestId("usage-report-login-journey:account");
  await expect(card.getByText(new RegExp(`^${percentage}(?:$| ·)`))).toBeVisible();
  await expect(card.getByTestId("usage-login-error")).toHaveCount(0);
}

for (const compact of [false, true]) {
  test(`failed polls retain usage and successful freshness (${compact ? "footer" : "tooltip"})`, async ({
    page,
  }) => {
    const fixture = await installLoginUsage({ status: "error", error: "Initial failure" });
    try {
      await page.setViewportSize(
        compact ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      await gotoAppShell(page);
      if (compact) await openCompactSidebar(page);
      await openUsageFromIcon(page);
      await expectLoginErrors(page, ["Claude: Initial failure"]);
      await expectLoginUsageFreshness(page, "No successful update", compact);

      await fixture.setReport({
        status: "available",
        windows: [{ id: "weekly", label: "Weekly", usedPct: 42, resetsAt: "2000-01-01T00:00:00Z" }],
      });
      // Move only the browser clock; real daemon fetches continue using the host clock.
      await page.clock.setFixedTime(new Date(Date.now() + 3_900_000));
      await refreshLoginUsage(page);
      await expectLoginUsageOnly(page, "42%");
      await expectLoginUsageFreshness(page, "Updated 1h ago", compact);

      await fixture.setReport({ status: "error", error: "Rate limited" });
      await refreshLoginUsage(page);
      await expectRetainedLoginUsage(page, "Claude: Rate limited");
      await expectLoginUsageFreshness(page, "Last updated 1h ago", compact);
      await refreshLoginUsage(page);
      await expectRetainedLoginUsage(page, "Claude: Rate limited");
      await expectLoginUsageFreshness(page, "Last updated 1h ago", compact);

      await fixture.setReport({
        status: "unavailable",
        problem: { kind: "no_quota", detail: "No active quota" },
      });
      await refreshLoginUsage(page);
      await expectRetainedLoginUsage(page, "Claude: No active quota");
      await expectLoginUsageFreshness(page, "Last updated 1h ago", compact);

      await fixture.setReport({
        status: "available",
        windows: [{ id: "weekly", label: "Weekly", usedPct: 43 }],
      });
      await page.clock.setFixedTime(new Date(Date.now() + 150_000));
      await refreshLoginUsage(page);
      await expectLoginUsageOnly(page, "43%");
      await expect(page.getByText("42%", { exact: true })).toHaveCount(0);
      await expectLoginUsageFreshness(page, "Updated 2m ago", compact);
    } finally {
      await fixture.cleanup();
    }
  });
}

async function expectRetainedLoginUsage(page: Page, message: string) {
  const card = page.getByTestId("usage-report-login-journey:account");
  await expect(card.getByText(/^42%(?:$| ·)/)).toBeVisible();
  await expect(card.getByTestId("usage-login-error")).toHaveText(message);
  await expect(card.getByText("Reset time passed", { exact: false })).toBeVisible();
}
