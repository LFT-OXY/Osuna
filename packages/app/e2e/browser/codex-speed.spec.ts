import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

// This fixture catalog advertises Ultrafast on Sol; another model offers Fast only.
// The real daemon discovers both through the same Codex model/list boundary.
test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        codex: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/catalog-codex.mjs")],
        },
        claude: { enabled: false },
        copilot: { enabled: false },
        opencode: { enabled: false },
        pi: { enabled: false },
        omp: { enabled: false },
      },
    },
  },
});

// Osuna：Fast 与 Ultrafast 沿用快速模式的样式——实心闪电、Codex 的品牌色（#3941ff），不取上游的黄色；
// Normal 是浅色主题的 foregroundMuted（#71717b）。
const ACTIVE_SPEED_ICON = { stroke: "rgb(57, 65, 255)", fill: "rgb(57, 65, 255)" };
const NORMAL_SPEED_ICON = { stroke: "rgb(113, 113, 123)", fill: "none" };

async function openSpeedSelector(page: Page): Promise<void> {
  const speed = page.getByRole("button", { name: /^(Select speed|Speed: .+)$/ });
  const features = page.getByRole("button", { name: "Open agent features", exact: true });
  const modelSettings = page.getByRole("button", { name: /^Select model \(/ });
  await expect(speed.or(features).or(modelSettings).filter({ visible: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  if (!(await speed.isVisible())) {
    if (await features.isVisible()) await features.click();
    else await modelSettings.click();
  }
  await expect(speed).toBeVisible({ timeout: 30_000 });
  await speed.click();
  await expect(page.getByText("Normal", { exact: true }).last()).toBeVisible();
  // Osuna：选项不超过 6 个的菜单不带搜索框。
  await expect(page.getByPlaceholder("Search...")).toHaveCount(0);
}

async function selectSpeed(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).last().click();
  const toolbarTrigger = page.getByRole("button", { name: `Speed: ${label}`, exact: true });
  const sheetTrigger = page.getByRole("button", { name: "Select speed", exact: true });
  await expect(toolbarTrigger.or(sheetTrigger)).toBeVisible();
  if (await toolbarTrigger.isVisible()) await expect(toolbarTrigger).toHaveText("");
  else await expect(sheetTrigger).toContainText(label);
}

async function expectSpeedIcon(page: Page, icon: { stroke: string; fill: string }): Promise<void> {
  const trigger = page
    .getByRole("button", { name: /^(Speed: .+|Select speed)$/ })
    .filter({ visible: true });
  const bolt = trigger.locator("svg").first();
  await expect(bolt).toHaveCSS("stroke", icon.stroke);
  await expect(bolt).toHaveCSS("fill", icon.fill);
}

async function expectSpeedChoices(page: Page, choices: string[]): Promise<void> {
  for (const choice of ["Normal", "Fast", "Ultrafast"]) {
    const option = page.getByText(choice, { exact: true }).last();
    if (choices.includes(choice)) {
      await expect(option).toBeVisible();
      await expect(option).toBeInViewport({ ratio: 1 });
    } else await expect(option).not.toBeVisible();
  }
}

async function switchAgentModel(agentId: string, modelId: string): Promise<void> {
  const client = await connectDaemonClient<
    Pick<DaemonClient, "setAgentModel" | "close" | "connect">
  >({
    clientIdPrefix: "codex-speed-model",
  });
  try {
    await client.setAgentModel(agentId, modelId);
  } finally {
    await client.close();
  }
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 850 },
  { name: "compact", width: 390, height: 844 },
]) {
  test(`Codex catalog drives speed choices on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    const workspace = await seedWorkspace({ repoPrefix: "codex-speed-" });
    try {
      const agent = await workspace.client.createAgent({
        provider: "codex",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Speed settings",
        model: "gpt-6.1-sol",
        modeId: "full-access",
        initialPrompt: "Get ready to work on this project.",
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      if (viewport.name === "desktop") {
        const trigger = page.getByRole("button", { name: "Speed: Normal", exact: true });
        await expect(trigger).toBeVisible({ timeout: 30_000 });
        await expect(trigger).toHaveText("");
        await page.screenshot({ path: testInfo.outputPath("desktop-normal-trigger.png") });
      }
      await openSpeedSelector(page);
      await selectSpeed(page, "Fast");
      await expectSpeedIcon(page, ACTIVE_SPEED_ICON);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-fast-selected.png`) });
      await openSpeedSelector(page);
      await expectSpeedChoices(page, ["Normal", "Fast", "Ultrafast"]);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-speed-options.png`) });
      await selectSpeed(page, "Ultrafast");
      await expectSpeedIcon(page, ACTIVE_SPEED_ICON);
      await openSpeedSelector(page);
      await expectSpeedChoices(page, ["Normal", "Fast", "Ultrafast"]);
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}-ultrafast-selected.png`),
      });
      await selectSpeed(page, "Normal");
      await expectSpeedIcon(page, NORMAL_SPEED_ICON);
      if (viewport.name === "desktop") {
        await switchAgentModel(agent.id, "gpt-6-sol");
        await openSpeedSelector(page);
        await expectSpeedChoices(page, ["Normal", "Fast"]);
        await page.screenshot({ path: testInfo.outputPath("desktop-fast-only.png") });
      }
    } finally {
      await workspace.cleanup();
    }
  });
}
