/*
 * 桌面版（dev Electron）上的 Diff 面板固定场景测量，口径与 diff-performance.spec.ts 的
 * "fixed scenario" 用例相同。用法见 baseline.md 的「怎么复测」。
 *
 *   node --import tsx .atw/tasks/10-19-diff-view-large-changesets/research/electron-diff-perf.ts \
 *     --cdp http://127.0.0.1:<DevTools 端口> --port 6769 --out /tmp/electron-baseline.json
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import {
  pageNow,
  runDiffPerfScenario,
  startCpuProfile,
  startLongTaskObserver,
  stopCpuProfile,
  summarizeCpuProfile,
  summarizeLongTasks,
  waitForLongTaskQuiet,
} from "../../../../packages/app/e2e/support/helpers/diff-perf-measure";
import { connectSeedClient } from "../../../../packages/app/e2e/support/helpers/seed-client";

function visible(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      cdp: { type: "string" },
      port: { type: "string", default: "6769" },
      "agent-ms": { type: "string", default: "60000" },
      out: { type: "string" },
    },
  });
  if (!values.cdp) throw new Error("--cdp is required");
  const agentMs = Number(values["agent-ms"]);
  const repoPath = await mkdtemp(path.join(tmpdir(), "diff-perf-electron-"));
  const client = await connectSeedClient({ port: Number(values.port) });
  const browser = await chromium.connectOverCDP(values.cdp);

  try {
    await runDiffPerfScenario(["create", repoPath]);
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repoPath },
    });
    if (!created.workspace) throw new Error(created.error ?? "createWorkspace failed");
    const workspaceId = created.workspace.id;

    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith("http://localhost:80"));
    if (!page) throw new Error("Electron app page not found");
    // CDP 接入瞬间页面会整块重挂载，先等它稳定。
    await page.waitForTimeout(1_500);

    const row = page
      .locator(`[data-testid^="sidebar-workspace-row"][data-testid$=":${workspaceId}"]`)
      .first();
    await row.waitFor({ state: "visible", timeout: 30_000 });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await visible(page, "workspace-tabs-row").waitFor({ timeout: 30_000 });
    const explorerToggle = page.getByTestId("workspace-explorer-toggle").first();
    await explorerToggle.waitFor({ timeout: 30_000 });
    if ((await page.getByTestId("workspace-explorer-sidebar").filter({ visible: true }).count()) === 0) {
      await explorerToggle.click();
    }
    const explorer = visible(page, "workspace-explorer-sidebar");
    await explorer.waitFor({ timeout: 30_000 });

    await startLongTaskObserver(page);
    const cdp = await page.context().newCDPSession(page);
    await startCpuProfile(cdp);
    const openStartedAt = await pageNow(page);
    const openedAt = performance.now();
    await explorer.getByTestId("workspace-tab-changes_tree").click({ position: { x: 12, y: 13 } });
    const firstTreeFile = page
      .locator('[data-testid^="diff-tree-file-"][data-testid$="-toggle"]')
      .filter({ visible: true })
      .first();
    await firstTreeFile.waitFor({ timeout: 120_000 });
    const treeMs = performance.now() - openedAt;
    await firstTreeFile.click();
    await page.getByTestId("git-diff-canvas").first().waitFor({ timeout: 120_000 });
    const openMs = performance.now() - openedAt;
    const openEndedAt = await pageNow(page);
    const openProfile = summarizeCpuProfile(await stopCpuProfile(cdp));

    await startCpuProfile(cdp);
    const agentStartedAt = await pageNow(page);
    await runDiffPerfScenario(["agent", repoPath, String(agentMs)]);
    const agentEndedAt = await pageNow(page);
    await waitForLongTaskQuiet({ page, quietMs: 12_000, timeoutMs: 120_000 });
    const settledAt = await pageNow(page);
    const agentProfile = summarizeCpuProfile(await stopCpuProfile(cdp));
    await cdp.detach();

    const report = {
      scenario: "fixed-diff-panel-scenario",
      runtime: "dev-electron",
      viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      open: {
        treeMs: Math.round(treeMs),
        openMs: Math.round(openMs),
        longTasks: await summarizeLongTasks({ page, start: openStartedAt, end: openEndedAt }),
        profile: openProfile,
      },
      agent: {
        agentMs,
        agentWindowMs: Math.round(agentEndedAt - agentStartedAt),
        settleMs: Math.round(settledAt - agentEndedAt),
        longTasks: await summarizeLongTasks({ page, start: agentStartedAt, end: settledAt }),
        profile: agentProfile,
      },
    };
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (values.out) await writeFile(values.out, text);
    process.stdout.write(text);
  } finally {
    await browser.close().catch(() => undefined);
    await client.close().catch(() => undefined);
    await rm(repoPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
