import { randomUUID } from "node:crypto";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { expectComposerVisible } from "../support/helpers/composer";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsageHostFilter, openUsagePageFromShell } from "../support/helpers/usage-page";
import {
  installUsageReportsFixture,
  type UsageReportsFixture,
} from "../support/helpers/usage-reports";

// The card moved to the usage page, so the page has to render: point the daemon
// at the usage fixtures rather than at whatever logs the machine happens to have.
const fixtures = createUsageFixtureRoots("paseo-plan-usage-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

type AvailableReport = Extract<UsageReportEntry["report"], { status: "available" }>;
// 可用的报告省掉 `status`；出错与不可用的照原样给。
type ReportInput =
  | Omit<AvailableReport, "status">
  | Exclude<UsageReportEntry["report"], AvailableReport>;

// 一个账号的报告；卡片里每个账号一张上游的额度卡片。
function report(
  input: { sourceId: string; sourceLabel: string; account?: string },
  usage: ReportInput,
): UsageReportEntry {
  return {
    id: `${input.sourceId}:account`,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    account: { label: input.account },
    fetchedAt: new Date().toISOString(),
    report: reportBody(usage),
  };
}

function agentRequestCount(usage: UsageReportsFixture): number {
  return usage.listRequests().filter((request) => request.agentId !== undefined).length;
}

function reportBody(usage: ReportInput): UsageReportEntry["report"] {
  if ("status" in usage) return usage;
  return { status: "available", ...usage };
}

test.describe("plan usage on the usage page", () => {
  test("renders every account returned by the daemon usage RPC", async ({ page }) => {
    test.setTimeout(120_000);
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [
        [
          report(
            { sourceId: "claude", sourceLabel: "Claude" },
            { planLabel: "Max 20x", windows: [{ id: "session", label: "Session", usedPct: 7 }] },
          ),
          report(
            { sourceId: "codex", sourceLabel: "Codex" },
            { planLabel: "Pro 20x", windows: [{ id: "weekly", label: "Weekly", usedPct: 29 }] },
          ),
          report(
            { sourceId: "glm", sourceLabel: "GLM coding plan", account: "dev@example.com" },
            {
              planLabel: "GLM coding plan",
              windows: [
                { id: "biweekly", label: "Biweekly", usedPct: 23 },
                { id: "daily", label: "Daily", remainingPct: 30 },
              ],
              balances: [
                { id: "credits", label: "Credits", remaining: 1234, unit: "credits" },
                { id: "extra", label: "Extra usage", used: 5, limit: 20, unit: "usd" },
              ],
              details: [{ id: "valid", label: "Valid until", value: "2026-12-31" }],
            },
          ),
        ],
      ],
    });

    await gotoAppShell(page);
    await openUsagePageFromShell(page);
    await usageFixture.waitForListRequests(1);

    const card = page.getByTestId("usage-plan-usage-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText("Claude", { exact: true })).toBeVisible();
    await expect(card.getByText("Codex", { exact: true })).toBeVisible();
    await expect(card.getByText("GLM coding plan", { exact: true }).first()).toBeVisible();
    await expect(card.getByText("Biweekly", { exact: true })).toBeVisible();
    await expect(card.getByText("Daily", { exact: true })).toBeVisible();
    await expect(card.getByText("70%")).toBeVisible();
    await expect(card.getByText("Credits", { exact: true })).toBeVisible();
    await expect(card.getByText("1,234 left", { exact: true })).toBeVisible();
    await expect(card.getByText("Extra usage", { exact: true })).toBeVisible();
    await expect(card.getByText("$5.00 / $20.00", { exact: true })).toBeVisible();
    await expect(card.getByText("Valid until", { exact: true })).toBeVisible();
    await expect(card.getByText("2026-12-31", { exact: true })).toBeVisible();
    // 每个账号一张卡片，卡片底部写着是哪个账号。
    await expect(card.locator('[data-testid^="usage-report-"]')).toHaveCount(3);
    await expect(card.getByText("dev@example.com", { exact: true })).toBeVisible();
    // 侧栏和这张卡片各取一次主机的列表，都不绕过 daemon 的缓存，也都不按 Agent 问。
    const beyondTheHostList = usageFixture
      .listRequests()
      .filter((request) => request.forceRefresh || request.agentId || request.reportIds);
    expect(beyondTheHostList).toEqual([]);
  });

  test("a vendor that reports problems is said on its subscription's card, with a link to its status page", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [
        [
          report(
            { sourceId: "claude", sourceLabel: "Claude" },
            { planLabel: "Max 20x", windows: [{ id: "session", label: "Session", usedPct: 7 }] },
          ),
          report(
            { sourceId: "codex", sourceLabel: "Codex" },
            { planLabel: "Pro 20x", windows: [{ id: "weekly", label: "Weekly", usedPct: 29 }] },
          ),
        ],
      ],
      vendorStatus: {
        autoUpdate: true,
        vendors: [
          {
            vendor: "anthropic",
            name: "Anthropic",
            page: "https://status.claude.com",
            isLinkOnly: false,
            level: "partial",
            parts: [{ name: "Claude Code", status: "partial_outage" }],
            incidents: [{ name: "Elevated errors on Claude Code", impact: "major", url: null }],
            readAt: "2026-10-21T08:00:00.000Z",
            error: null,
          },
          {
            vendor: "openai",
            name: "OpenAI",
            page: "https://status.openai.com",
            isLinkOnly: false,
            level: "ok",
            parts: [],
            incidents: [],
            readAt: "2026-10-21T08:00:00.000Z",
            error: null,
          },
        ],
        endpointVendors: {},
        error: null,
      },
    });
    await gotoAppShell(page);
    await openUsagePageFromShell(page);
    const card = page.getByTestId("usage-plan-usage-card");
    await expect(card.getByText("Claude", { exact: true })).toBeVisible({ timeout: 10_000 });

    // 只问这两个订阅对上的厂商；Anthropic 报中断，OpenAI 正常不提示。
    await expect
      .poll(() => usageFixture.vendorStatusRequests().at(-1))
      .toEqual(["anthropic", "openai"]);
    const notices = card.getByTestId("usage-plan-vendor-status");
    await expect(notices).toHaveCount(1);
    await expect(notices.getByTestId("usage-plan-vendor-status-text")).toHaveText(
      "Anthropic reports problems",
    );
    await expect(notices).toContainText("Claude Code: partial outage");
    await expect(notices).toContainText("Elevated errors on Claude Code");
    await expect(notices.getByTestId("usage-plan-vendor-status-link")).toHaveText("Status page ↗");
  });

  test("refresh invalidates and refetches usage", async ({ page }) => {
    test.setTimeout(120_000);
    function glm(usedPct: number): UsageReportEntry {
      return report(
        { sourceId: "glm", sourceLabel: "GLM coding plan" },
        { planLabel: "GLM coding plan", windows: [{ id: "biweekly", label: "Biweekly", usedPct }] },
      );
    }
    // 侧栏和这张卡片各取一次主机的列表；只有卡片头部的刷新绕过 daemon 的缓存。
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [(request) => [glm(request.forceRefresh ? 64 : 23)]],
    });
    function forcedRefreshes(): number {
      return usageFixture.listRequests().filter((request) => request.forceRefresh).length;
    }

    await gotoAppShell(page);
    await openUsagePageFromShell(page);

    // The overview's own refresh control carries the same label, so both the
    // assertion and the click stay inside the plan usage card.
    const card = page.getByTestId("usage-plan-usage-card");
    await expect(card.getByText("23%", { exact: true })).toBeVisible({ timeout: 10_000 });

    expect(forcedRefreshes()).toBe(0);
    await card.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(forcedRefreshes).toBe(1);

    await expect(card.getByText("64%", { exact: true })).toBeVisible();
    expect(forcedRefreshes()).toBe(1);
  });

  test("one provider error does not collapse the usage list", async ({ page }) => {
    test.setTimeout(120_000);
    await installUsageReportsFixture(page, {
      lists: [
        [
          report(
            { sourceId: "claude", sourceLabel: "Claude" },
            { status: "error", error: "Claude auth expired" },
          ),
          report(
            { sourceId: "codex", sourceLabel: "Codex" },
            { planLabel: "Pro 20x", windows: [{ id: "weekly", label: "Weekly", usedPct: 71 }] },
          ),
        ],
      ],
    });

    await gotoAppShell(page);
    await openUsagePageFromShell(page);

    const card = page.getByTestId("usage-plan-usage-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText("Error", { exact: true })).toBeVisible();
    await expect(card.getByText("Claude auth expired", { exact: true })).toBeVisible();
    await expect(card.getByText("Codex", { exact: true })).toBeVisible();
    await expect(card.getByText("71%")).toBeVisible();
  });

  // 窄栏只显示可用的套餐用量；出错说明在桌面端只出现在这里（Q18）。
  test("a provider that fails to report stays off the composer strip and shows its error here", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [
        [
          report(
            { sourceId: "mock", sourceLabel: "Mock provider" },
            { status: "error", error: "Mock provider auth expired" },
          ),
        ],
      ],
    });
    const session = await seedMockAgentWorkspace({
      repoPrefix: "usage-plan-usage-error-",
      title: "Plan usage error e2e",
      initialPrompt: "emit 1 coalesced agent stream update for the plan usage error.",
    });
    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      await expect(page.getByTestId("composer-context-strip-branch-switcher")).toBeVisible({
        timeout: 30_000,
      });
      // 窄栏问到了这个 Agent 的账号，它报错，所以窄栏不显示；出错的说明看 Usage 页的卡片。
      // 侧栏也会取一次主机的列表，所以等的是窄栏按 Agent 问的那一次；夹具收到就当场应答。
      await expect.poll(() => agentRequestCount(usageFixture)).toBe(1);
      await expect(page.getByTestId("composer-plan-usage")).toHaveCount(0);

      await openUsagePageFromShell(page);
      const card = page.getByTestId("usage-plan-usage-card");
      await expect(card.getByText("Mock provider auth expired", { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(card.getByText("Error", { exact: true })).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("groups accounts by host, each under its name, when the page counts more than one", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const secondaryServerId = `srv_plan_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const secondaryDaemon = await startIsolatedHostDaemon(secondaryServerId);
    function claude(account: string, usedPct: number): UsageReportEntry {
      return report(
        { sourceId: "claude", sourceLabel: "Claude", account },
        { planLabel: "Max 20x", windows: [{ id: "session", label: "Session", usedPct }] },
      );
    }
    try {
      await installUsageReportsFixture(page, { lists: [[claude("primary@example.com", 7)]] });
      await installUsageReportsFixture(page, {
        lists: [[claude("secondary@example.com", 61)]],
        port: secondaryDaemon.port,
      });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: "Secondary box",
        port: secondaryDaemon.port,
        primaryLabel: "Primary box",
      });
      await openUsagePageFromShell(page);

      const card = page.getByTestId("usage-plan-usage-card");
      await test.step("every counted host has its own group, named", async () => {
        await expect(card.getByText("primary@example.com", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await expect(card.getByText("secondary@example.com", { exact: true })).toBeVisible();
        await expect(card.getByText("Primary box", { exact: true })).toBeVisible();
        await expect(card.getByText("Secondary box", { exact: true })).toBeVisible();
        await expect(card.locator('[data-testid^="usage-report-"]')).toHaveCount(2);
      });

      await test.step("picking one host leaves that host's group alone", async () => {
        await openUsageHostFilter(page);
        await page.getByTestId(`usage-host-filter-item-${secondaryDaemon.serverId}`).click();
        await expect(card.getByText("61%", { exact: true })).toBeVisible();
        await expect(card.getByText("primary@example.com", { exact: true })).toHaveCount(0);
        await expect(card.getByText("Primary box", { exact: true })).toHaveCount(0);
        // 页面仍计入两台主机，所以留下的这一组照旧报出它是哪台。
        await expect(card.getByText("Secondary box", { exact: true })).toBeVisible();
        await expect(card.locator('[data-testid^="usage-report-"]')).toHaveCount(1);
      });
    } finally {
      await secondaryDaemon.close().catch(() => undefined);
    }
  });
});
