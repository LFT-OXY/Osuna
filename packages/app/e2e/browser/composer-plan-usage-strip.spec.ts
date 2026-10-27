import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { gotoAppShell } from "../support/helpers/app";
import { gate } from "../support/helpers/context-window";
import { clickNewChat } from "../support/helpers/launcher";
import { selectComposerProvider } from "../support/helpers/provider-selector";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  installUsageReportsFixture,
  type UsageListRequest,
  type UsageReportsFixture,
} from "../support/helpers/usage-reports";
import {
  closeUsage,
  openUsageFromIcon,
  showUsageAs,
  usageModal,
} from "../support/helpers/usage-sidebar-item";
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

type AvailableReport = Extract<UsageReportEntry["report"], { status: "available" }>;

// 一个账号的报告。`id` 是「来源:账号」，同一个来源可以有几个账号。
function planReport(
  input: { sourceId: string; sourceLabel: string; account?: string },
  report: Partial<AvailableReport> = {},
): UsageReportEntry {
  return {
    id: `${input.sourceId}:${input.account ?? "account"}`,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    account: { label: input.account },
    fetchedAt: new Date().toISOString(),
    report: {
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
      ...report,
    },
  };
}

function mockPlanUsage(report: Partial<AvailableReport> = {}): UsageReportEntry {
  return planReport({ sourceId: "mock", sourceLabel: "Mock provider" }, report);
}

function claudePlanUsage(account?: string): UsageReportEntry {
  return planReport({ sourceId: "claude", sourceLabel: "Claude", account });
}

// daemon 按 Agent 问时只报它所用的账号，问主机时报全部账号。
function answerByScope(scopes: { agent: UsageReportEntry[]; host: UsageReportEntry[] }) {
  return (request: UsageListRequest) => (request.agentId ? scopes.agent : scopes.host);
}

// 按 Agent 的请求依次拿 `agent` 里的应答，最后一个重复；问主机时总是 `host`。
function answerAgentInTurn(scopes: { agent: UsageReportEntry[][]; host: UsageReportEntry[] }) {
  let asked = 0;
  return (request: UsageListRequest) => {
    if (!request.agentId) return scopes.host;
    const answer = scopes.agent[Math.min(asked, scopes.agent.length - 1)];
    asked += 1;
    return answer ?? [];
  };
}

// 侧栏一打开应用就取一次主机的列表（上游的套餐用量摘要），与窄栏无关；窄栏问的是 Agent 的账号。
function agentRequests(usage: UsageReportsFixture): UsageListRequest[] {
  return usage.listRequests().filter((request) => request.agentId !== undefined);
}

function hostRequests(usage: UsageReportsFixture): UsageListRequest[] {
  return usage.listRequests().filter((request) => request.agentId === undefined);
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

function codexPlanUsage(): UsageReportEntry {
  return planReport(
    { sourceId: "codex", sourceLabel: "Codex" },
    {
      planLabel: "Pro",
      windows: [
        {
          id: "session",
          label: "Session",
          usedPct: 12,
          resetsAt: fromNow(3 * HOUR_MS),
          tone: "ok",
        },
        { id: "weekly", label: "Weekly", usedPct: 40, resetsAt: fromNow(4 * DAY_MS), tone: "ok" },
        {
          id: "code_review",
          label: "Code review",
          usedPct: 5,
          resetsAt: fromNow(4 * DAY_MS),
          tone: "ok",
        },
      ],
      balances: [],
    },
  );
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
  test("shows the plan and every window of the agent's account, fetched once on mount", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [
        answerByScope({ agent: [mockPlanUsage()], host: [codexPlanUsage(), mockPlanUsage()] }),
      ],
    });
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
      // 余额不进窄栏，其他账号也不进。
      await expect(gauge).not.toContainText("Extra usage");
      await expect(gauge).not.toContainText("Pro");

      // 窄栏只问了一次，问的是这个 Agent 的账号。
      expect(agentRequests(usageFixture)).toEqual([
        { forceRefresh: false, reportIds: undefined, agentId: session.agentId },
      ]);
    } finally {
      await session.cleanup();
    }
  });

  test("shows the full plan usage card on hover and refreshes each time it opens", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const refreshed = mockPlanUsage({
      windows: [
        { id: "five_hour", label: "Session", usedPct: 12, resetsAt: fromNow(3 * HOUR_MS) },
        { id: "weekly", label: "Weekly", usedPct: 46, resetsAt: fromNow(4 * DAY_MS), tone: "ok" },
      ],
    });
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [answerAgentInTurn({ agent: [[mockPlanUsage()], [refreshed]], host: [] })],
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge).toBeVisible({ timeout: 10_000 });
      expect(agentRequests(usageFixture)).toHaveLength(1);

      const card = page.getByTestId("composer-plan-usage-card");
      await gauge.hover();
      await expect.poll(() => agentRequests(usageFixture).length).toBe(2);
      await expect(card).toBeVisible({ timeout: 10_000 });
      // 第二次应答只剩两个窗口：卡片显示的是打开时刷新回来的数据。卡片是上游的额度卡片。
      // 整段连着读：两行窗口挨着、顺序不变，后面直接是余额，中间没有 Weekly · Fable。
      const report = card.getByTestId("usage-report-mock:account");
      await expect(report).toContainText(
        "Session12% used · resets 3hWeekly46% used · resets 4dExtra usage$3.00 / $50.00",
      );
      // 悬停卡片不接受点按，所以没有刷新按钮，窗口行也不能固定。
      await expect(report.getByRole("button")).toHaveCount(0);
      await expect(report.getByRole("checkbox")).toHaveCount(0);
      await expect(card.getByText("Max 20x", { exact: true })).toBeVisible();
      await expect(card.getByText("Updated just now", { exact: true })).toBeVisible();
      await expect(card.getByText("Extra usage", { exact: true })).toBeVisible();
      await expect(card.getByText("$3.00 / $50.00", { exact: true })).toBeVisible();

      await page.mouse.move(0, 0);
      await expect(card).toHaveCount(0);

      await gauge.hover();
      await expect.poll(() => agentRequests(usageFixture).length).toBe(3);
      await expect(card).toBeVisible();
      // 悬停刷新的是窄栏正在显示的那份，不带强制刷新；daemon 的缓存挡着来源的接口。
      expect(agentRequests(usageFixture).map((request) => request.forceRefresh)).toEqual([
        false,
        false,
        false,
      ]);
    } finally {
      await session.cleanup();
    }
  });

  test("stays quiet when every attempt to fetch fails", async ({ page }) => {
    test.setTimeout(180_000);
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [{ error: "Plan usage is unavailable" }],
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      // 问 Agent 的账号失败一次，不重试，窄栏转而看主机的列表；那份列表首次取数加上
      // React Query 默认的 3 次重试，也都失败。
      await usageFixture.waitForListRequests(5);
      expect(agentRequests(usageFixture).map((request) => request.agentId)).toEqual([
        session.agentId,
      ]);
      expect(hostRequests(usageFixture)).toHaveLength(4);
      const strip = page.getByTestId("composer-context-strip");
      await expect(strip).toBeVisible({ timeout: 10_000 });
      await expect(strip.getByTestId("composer-plan-usage")).toHaveCount(0);
      await expect(strip).not.toContainText("Plan usage is unavailable");
      await expect(page.getByTestId("composer-context-strip-branch-switcher")).toBeVisible();

      // 同一份主机列表确实落在出错状态：套餐用量弹窗读的是它，报出了 daemon 的原话。
      await openUsageFromIcon(page);
      await expect(
        page.getByTestId("usage-modal").getByText("Plan usage is unavailable", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await session.cleanup();
    }
  });

  test("refreshes every five minutes and goes quiet once the provider has no plan usage", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.clock.install();
    // 五分钟后 daemon 不再报这个 Agent 的账号，主机的列表里也没有它的提供方。
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [answerAgentInTurn({ agent: [[mockPlanUsage()], []], host: [claudePlanUsage()] })],
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge).toBeVisible({ timeout: 10_000 });
      expect(agentRequests(usageFixture)).toHaveLength(1);

      await page.clock.fastForward(5 * 60_000);
      await expect.poll(() => agentRequests(usageFixture).length).toBe(2);
      await expect(gauge).toHaveCount(0);
      await expect(page.getByTestId("composer-context-strip-branch-switcher")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("stays quiet and never asks a host without plan usage", async ({ page }) => {
    test.setTimeout(180_000);
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [[mockPlanUsage()]],
      usageSupported: false,
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      // 上游 v0.11.0-beta.4 起圆环弹层不再带这份按提供方的套餐卡片；窄栏读到主机特性后
      // 保持安静、不发请求。
      await expect(page.getByTestId("composer-context-strip")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("composer-plan-usage")).toHaveCount(0);
      expect(usageFixture.listRequests()).toHaveLength(0);
    } finally {
      await session.cleanup();
    }
  });

  test("gives way as the composer narrows, keeping the branch readable", async ({ page }) => {
    test.setTimeout(180_000);
    await hideHostBadges(page);
    await installUsageReportsFixture(page, { lists: [[mockPlanUsage()]] });
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
    await installUsageReportsFixture(page, { lists: [[mockPlanUsage()]] });
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
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [[claudePlanUsage(), codexPlanUsage()]],
    });
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
      // 草稿没有 Agent 可问，从头到尾只取主机的列表。
      expect(agentRequests(usageFixture)).toEqual([]);
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows the account the agent runs under, not the host's first for its provider", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // 主机上有两个 Claude 账号；daemon 说这个 Agent 用的是第二个。
    const personal = claudePlanUsage("personal@example.com");
    const work = planReport(
      { sourceId: "claude", sourceLabel: "Claude", account: "work@example.com" },
      { planLabel: "Team" },
    );
    await installUsageReportsFixture(page, {
      lists: [answerByScope({ agent: [work], host: [personal, work] })],
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge.getByTestId("composer-plan-usage-plan")).toHaveText("Team", {
        timeout: 10_000,
      });
      await gauge.hover();
      const card = page.getByTestId("composer-plan-usage-card");
      await expect(card.getByTestId("usage-report-claude:work@example.com")).toBeVisible();
      await expect(card.getByText("work@example.com", { exact: true })).toBeVisible();
      await expect(card.getByText("personal@example.com", { exact: true })).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });

  test("waits for the daemon's answer rather than showing the host's first account meanwhile", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const personal = planReport(
      { sourceId: "mock", sourceLabel: "Mock provider", account: "personal@example.com" },
      { planLabel: "Personal" },
    );
    const work = planReport(
      { sourceId: "mock", sourceLabel: "Mock provider", account: "work@example.com" },
      { planLabel: "Team" },
    );
    const agentAnswer = gate();
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [
        (request: UsageListRequest) => {
          if (request.agentId) return { stream: [agentAnswer.promise, work] };
          return [personal, work];
        },
      ],
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      await expect.poll(() => agentRequests(usageFixture).length).toBe(1);
      // 主机的列表已经在缓存里（弹窗读的是同一份，显示得出来），里面第一个就是这个提供方的账号；
      // 窄栏仍然不显示，等 daemon 说这个 Agent 用的是哪个。
      await openUsageFromIcon(page);
      await expect(
        usageModal(page).getByText("personal@example.com", { exact: true }),
      ).toBeVisible();
      await closeUsage(page);
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge).toHaveCount(0);

      agentAnswer.open();
      await expect(gauge.getByTestId("composer-plan-usage-plan")).toHaveText("Team", {
        timeout: 10_000,
      });
    } finally {
      await session.cleanup();
    }
  });

  test("still shows plan usage on a released host that only answers the legacy list", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // 已发布的旧主机只有 `providerUsageList`：上游的客户端把旧列表换算成报告（COMPAT），
    // 按 Agent 问时不发请求、直接答没有，窄栏于是按提供方看主机的列表。应用里没有另写回退。
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [[mockPlanUsage()]],
      providerUsageListOnly: true,
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      await expect.poll(() => readSegmentIds(page), { timeout: 10_000 }).toEqual(EVERY_SEGMENT);
      // 这种主机下夹具记的是旧消息：数据确实是经它来的。
      expect(usageFixture.listRequests().length).toBeGreaterThan(0);
    } finally {
      await session.cleanup();
    }
  });

  test("falls back to the provider's account on the host when the daemon names none for the agent", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const usageFixture = await installUsageReportsFixture(page, {
      lists: [answerByScope({ agent: [], host: [codexPlanUsage(), mockPlanUsage()] })],
    });
    const session = await openMockAgentOnDesktop(page);
    try {
      await expect.poll(() => readSegmentIds(page), { timeout: 10_000 }).toEqual(EVERY_SEGMENT);
      expect(agentRequests(usageFixture).map((request) => request.agentId)).toEqual([
        session.agentId,
      ]);
    } finally {
      await session.cleanup();
    }
  });

  test("reads percentages as remaining once plan usage is set to show what is left", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await installUsageReportsFixture(page, { lists: [[mockPlanUsage()]] });
    const session = await openMockAgentOnDesktop(page);
    try {
      const gauge = page.getByTestId("composer-plan-usage");
      await expect(gauge.getByTestId("composer-plan-usage-window-weekly")).toHaveText("Week45%4d", {
        timeout: 10_000,
      });

      await openUsageFromIcon(page);
      await showUsageAs(page, "remaining");
      await closeUsage(page);

      await expect(gauge.getByTestId("composer-plan-usage-window-weekly")).toHaveText("Week55%4d");
      await expect(gauge.getByTestId("composer-plan-usage-window-five_hour")).toHaveText(
        "5h18%out in 1h",
      );
      await expect(
        page.getByRole("group", { name: "Weekly: 55% left, resets 4d", exact: true }),
      ).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });
});
