import type { DaemonClient } from "@osuna/client/internal/daemon-client";
import { test, expect, type Page } from "../support/fixtures";
import {
  applyProfileFromPicker,
  closeModelPicker,
  expectComposerModel,
  expectModelRowSelected,
  expectNoModelRowsFor,
  expectProfileVisibleForProvider,
  openModelPicker,
  seedAgentProfiles,
  seedModelProvider,
} from "../support/helpers/agent-profiles";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { waitForDraftComposer } from "../support/helpers/command-center-agent-controls";
import { expectComposerVisible } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoWorkspace } from "../support/helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openGlobalNewWorkspaceComposer } from "../support/helpers/new-workspace";
import {
  chooseProvider,
  closeSheetModelBrowser,
  expectProviderStatus,
  expectMoreAgentsCountMatchesRows,
  expectProviderRowAboveModelRow,
  expectToolbarOrder,
  moreAgentsRow,
  moveProviderHighlight,
  openAgentControlsSheet,
  openProviderMenu,
  providerButton,
  providerMenuOption,
  sheetMoreAgentsRow,
  sheetProviderOption,
  sheetProviderRow,
} from "../support/helpers/provider-selector";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

const ALPHA = {
  id: "provider-menu-alpha",
  label: "Alpha agents",
  models: [
    { id: "alpha-one", label: "Alpha one", description: "Alpha default" },
    { id: "alpha-two", label: "Alpha two", description: "Alpha remembered" },
  ],
};
const BETA = {
  id: "provider-menu-beta",
  label: "Beta agents",
  models: [
    { id: "beta-one", label: "Beta one", description: "Beta default" },
    { id: "beta-two", label: "Beta two", description: "Beta alternative" },
  ],
};
const OFFLINE = {
  id: "provider-menu-offline",
  label: "Offline agents",
  models: [{ id: "offline-one", label: "Offline one", description: "Never reachable" }],
  command: ["/missing-osuna-provider-menu"],
};
const DISABLED = {
  id: "provider-menu-disabled",
  label: "Disabled agents",
  models: [{ id: "disabled-one", label: "Disabled one", description: "Turned off" }],
  enabled: false,
};

const MOBILE_VIEWPORT = { width: 390, height: 844 };
// 窗口够宽不算紧凑，但加上固定的侧边栏后 Composer 窄于 500，controls 改用弹窗。
const NARROW_COMPOSER_VIEWPORT = { width: 760, height: 900 };

const BETA_PROFILE = {
  id: "agent_profile_e2e_provider_menu_beta",
  name: "Beta work",
  provider: BETA.id,
  model: "beta-two",
};

async function rememberAlphaModel(page: Page) {
  await page.addInitScript(
    ({ provider, model }) => {
      localStorage.setItem(
        "@osuna:create-agent-preferences",
        JSON.stringify({ provider, providerPreferences: { [provider]: { model } } }),
      );
    },
    { provider: ALPHA.id, model: "alpha-two" },
  );
}

test.describe("Composer provider button", () => {
  test("switches providers in a draft, folding unavailable ones and restoring each provider's model", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const workspace = await seedWorkspace({ repoPrefix: "provider-menu-" });
    const seeds = await Promise.all(
      [ALPHA, BETA, OFFLINE, DISABLED].map((provider) => seedModelProvider(provider)),
    );
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "provider-menu" });
    try {
      const cwd = workspace.repoPath;
      await expectProviderStatus({ client, cwd, provider: ALPHA.id, status: "ready" });
      await expectProviderStatus({ client, cwd, provider: BETA.id, status: "ready" });
      await expectProviderStatus({ client, cwd, provider: OFFLINE.id, status: "unavailable" });

      await rememberAlphaModel(page);
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);

      await test.step("the provider button sits left of model and mode", async () => {
        await expectComposerModel(page, "Alpha two");
        await expectToolbarOrder(page, [
          providerButton(page, ALPHA.label),
          page.getByRole("button", { name: "Select model (Alpha two)", exact: true }),
          page.getByTestId("mode-control").filter({ visible: true }),
        ]);
      });

      await test.step("ready providers are flat, unavailable ones fold into More agents", async () => {
        await openProviderMenu(page);
        await expect(providerMenuOption(page, ALPHA.id)).toBeVisible();
        await expect(providerMenuOption(page, BETA.id)).toBeVisible();
        await expect(moreAgentsRow(page)).toContainText(/^More agents \(\d+\)$/);
        await expect(providerMenuOption(page, OFFLINE.id)).toHaveCount(0);
        await expect(providerMenuOption(page, DISABLED.id)).toHaveCount(0);

        await moreAgentsRow(page).click();
        await expect(providerMenuOption(page, OFFLINE.id)).toBeVisible();
        await expect(providerMenuOption(page, DISABLED.id)).toHaveCount(0);
        // 测试 daemon 里还有别的不可用内置 provider，N 不固定，按展开后的行数核对。
        await expectMoreAgentsCountMatchesRows(page);
      });

      await test.step("a provider never chosen before starts on its default model", async () => {
        await chooseProvider(page, BETA.id);
        await expect(providerButton(page, BETA.label)).toBeVisible();
        await expectComposerModel(page, "Beta one");
      });

      await test.step("switching back restores the model last chosen for that provider", async () => {
        await openProviderMenu(page);
        await chooseProvider(page, ALPHA.id);
        await expect(providerButton(page, ALPHA.label)).toBeVisible();
        await expectComposerModel(page, "Alpha two");
      });

      await test.step("an unavailable provider is still selectable from More agents", async () => {
        await openProviderMenu(page);
        await moreAgentsRow(page).click();
        await chooseProvider(page, OFFLINE.id);
        await expect(providerButton(page, OFFLINE.label)).toBeVisible();
      });

      await test.step("the provider menu works from the keyboard", async () => {
        await providerButton(page, OFFLINE.label).focus();
        await page.keyboard.press("Enter");
        // 当前 provider 在折叠区里，菜单打开时已展开，打勾的那行看得见。
        await expect(providerMenuOption(page, OFFLINE.id)).toBeVisible({ timeout: 30_000 });
        await moveProviderHighlight(page, { from: OFFLINE.id, to: ALPHA.id });
        await page.keyboard.press("Enter");
        await expect(providerMenuOption(page, OFFLINE.id)).toHaveCount(0, { timeout: 30_000 });
        await expect(providerButton(page, ALPHA.label)).toBeVisible();
      });
    } finally {
      await client.close();
      for (const seed of seeds) await seed.restore();
      await workspace.cleanup();
    }
  });

  test("a profile for another provider switches the provider button with it", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "provider-menu-profile-" });
    const seeds = await Promise.all([ALPHA, BETA].map((provider) => seedModelProvider(provider)));
    const profiles = await seedAgentProfiles([BETA_PROFILE]);
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "provider-profile" });
    try {
      const cwd = workspace.repoPath;
      await expectProviderStatus({ client, cwd, provider: ALPHA.id, status: "ready" });
      await expectProviderStatus({ client, cwd, provider: BETA.id, status: "ready" });

      await rememberAlphaModel(page);
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);
      await expect(providerButton(page, ALPHA.label)).toBeVisible({ timeout: 30_000 });
      await expectComposerModel(page, "Alpha two");

      await test.step("the model menu lists only Alpha's models but every profile", async () => {
        await openModelPicker(page);
        await expectModelRowSelected(page, { provider: ALPHA.id, modelId: "alpha-two" });
        await expectNoModelRowsFor(page, BETA);
        await expectProfileVisibleForProvider(page, {
          name: BETA_PROFILE.name,
          summary: `${BETA.label} · Beta two`,
        });
      });

      await test.step("applying the Beta profile moves the provider button to Beta", async () => {
        await applyProfileFromPicker(page, BETA_PROFILE.name);
        await expect(providerButton(page, BETA.label)).toBeVisible({ timeout: 30_000 });
        await expectComposerModel(page, "Beta two");
      });

      await test.step("the model menu now lists Beta's models", async () => {
        await openModelPicker(page);
        await expectModelRowSelected(page, { provider: BETA.id, modelId: "beta-two" });
        await expectNoModelRowsFor(page, ALPHA);
        await closeModelPicker(page);
      });
    } finally {
      await client.close();
      await profiles.restore();
      for (const seed of seeds) await seed.restore();
      await workspace.cleanup();
    }
  });

  test("shows a running agent's provider without letting it change", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "provider-menu-running-",
      title: "Provider button running agent",
    });
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      const button = page.getByTestId("agent-provider-selector").filter({ visible: true });
      await expect(button).toBeVisible({ timeout: 30_000 });
      await expect(button).toBeDisabled();
      await button.click({ force: true });
      await expect(page.getByTestId("combobox-desktop-container")).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Agent controls sheet provider row", () => {
  test("switches providers from the sheet and lists only that provider's models", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const workspace = await seedWorkspace({ repoPrefix: "provider-sheet-" });
    const seeds = await Promise.all(
      [ALPHA, BETA, OFFLINE, DISABLED].map((provider) => seedModelProvider(provider)),
    );
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "provider-sheet" });
    try {
      const cwd = workspace.repoPath;
      await expectProviderStatus({ client, cwd, provider: ALPHA.id, status: "ready" });
      await expectProviderStatus({ client, cwd, provider: BETA.id, status: "ready" });
      await expectProviderStatus({ client, cwd, provider: OFFLINE.id, status: "unavailable" });

      await rememberAlphaModel(page);
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);
      await page.setViewportSize(MOBILE_VIEWPORT);
      await expectComposerModel(page, "Alpha two");

      await test.step("the provider row sits above the model row", async () => {
        await openAgentControlsSheet(page);
        await expect(sheetProviderRow(page)).toContainText(ALPHA.label);
        await expect(sheetProviderRow(page)).toHaveAccessibleName(
          `Select agent provider (${ALPHA.label})`,
        );
        await expectProviderRowAboveModelRow(page);
      });

      await test.step("the provider list groups like the toolbar menu", async () => {
        await sheetProviderRow(page).click();
        await expect(sheetProviderOption(page, ALPHA.id)).toBeVisible({ timeout: 30_000 });
        await expect(sheetProviderOption(page, BETA.id)).toBeVisible();
        await expect(sheetProviderOption(page, OFFLINE.id)).toHaveCount(0);
        await expect(sheetProviderOption(page, DISABLED.id)).toHaveCount(0);
        await sheetMoreAgentsRow(page).click();
        await expect(sheetProviderOption(page, OFFLINE.id)).toBeVisible();
        await expect(sheetProviderOption(page, DISABLED.id)).toHaveCount(0);
      });

      await test.step("choosing a provider returns to the sheet on its default model", async () => {
        await sheetProviderOption(page, BETA.id).click();
        await expect(sheetProviderOption(page, ALPHA.id)).toHaveCount(0, { timeout: 30_000 });
        await expect(sheetProviderRow(page)).toContainText(BETA.label);
        await expect(page.getByTestId("agent-controls-model")).toContainText("Beta one");
      });

      await test.step("the model row lists and searches only that provider's models", async () => {
        await page.getByTestId("agent-controls-model").click();
        // 手机 sheet 的 testID 只挂在标题栏上，模型行在内容区 viewport 里。
        const browser = page.getByTestId("agent-controls-model-browser-viewport");
        await expect(browser).toBeVisible({ timeout: 30_000 });
        await expect(browser.getByTestId(`model-row-${BETA.id}-beta-one`)).toBeVisible();
        await expect(browser.getByTestId(`model-row-${BETA.id}-beta-two`)).toBeVisible();
        await expect(browser.getByTestId(`model-row-${ALPHA.id}-alpha-one`)).toHaveCount(0);

        await page.getByTestId("model-search-input").filter({ visible: true }).fill("one");
        await expect(browser.getByTestId(`model-row-${BETA.id}-beta-one`)).toBeVisible();
        await expect(browser.getByTestId(`model-row-${BETA.id}-beta-two`)).toHaveCount(0);
        await expect(browser.getByTestId(`model-row-${ALPHA.id}-alpha-one`)).toHaveCount(0);
        await closeSheetModelBrowser(page);
      });

      await test.step("switching back restores the model last chosen for that provider", async () => {
        await sheetProviderRow(page).click();
        await sheetProviderOption(page, ALPHA.id).click();
        await expect(sheetProviderOption(page, BETA.id)).toHaveCount(0, { timeout: 30_000 });
        await expect(sheetProviderRow(page)).toContainText(ALPHA.label);
        await expect(page.getByTestId("agent-controls-model")).toContainText("Alpha two");
      });
    } finally {
      await client.close();
      for (const seed of seeds) await seed.restore();
      await workspace.cleanup();
    }
  });

  test("shows a running agent's provider row as read-only", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "provider-sheet-running-",
      title: "Provider row running agent",
    });
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await openAgentControlsSheet(page);
      const row = sheetProviderRow(page);
      await expect(row).toBeDisabled();
      await row.click({ force: true });
      await expect(page.locator('[data-testid^="agent-provider-option-"]')).toHaveCount(0);
      await expect(page.getByTestId("agent-controls-settings-list")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("a narrow composer's dialog opens on the agent's own models", async ({ page }) => {
    await page.setViewportSize(NARROW_COMPOSER_VIEWPORT);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "provider-sheet-dialog-",
      title: "Provider row narrow composer",
    });
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await openAgentControlsSheet(page);
      const viewport = page.getByTestId("agent-controls-model-viewport");
      await expect(viewport).toBeVisible();
      await expect(viewport.locator('[data-testid^="model-row-"]').first()).toBeVisible();
      await expect(viewport.locator('[data-testid^="model-provider-"]')).toHaveCount(0);
      await expect(sheetProviderRow(page)).toBeDisabled();
    } finally {
      await workspace.cleanup();
    }
  });

  test("a narrow draft composer's dialog follows a provider switch", async ({ page }) => {
    test.setTimeout(150_000);
    const workspace = await seedWorkspace({ repoPrefix: "provider-sheet-dialog-draft-" });
    const seeds = await Promise.all([ALPHA, BETA].map((provider) => seedModelProvider(provider)));
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "provider-dialog" });
    try {
      const cwd = workspace.repoPath;
      await expectProviderStatus({ client, cwd, provider: ALPHA.id, status: "ready" });
      await expectProviderStatus({ client, cwd, provider: BETA.id, status: "ready" });

      await rememberAlphaModel(page);
      await page.setViewportSize(NARROW_COMPOSER_VIEWPORT);
      // 工作区里的 New agent 标签页按容器宽度切紧凑布局，全局 New workspace 不会。
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await runWorkspaceActionFromCommandCenter(page, "New agent");
      await waitForDraftComposer(page);
      await expectComposerModel(page, "Alpha two");

      await openAgentControlsSheet(page);
      const viewport = page.getByTestId("agent-controls-model-viewport");
      await expect(viewport.getByTestId(`model-row-${ALPHA.id}-alpha-two`)).toBeVisible({
        timeout: 30_000,
      });

      // 弹窗里模型列表和「提供方」行同屏，换了提供方列表要跟着换。
      await sheetProviderRow(page).click();
      await chooseProvider(page, BETA.id);
      await expect(sheetProviderRow(page)).toContainText(BETA.label);
      await expect(viewport.getByTestId(`model-row-${BETA.id}-beta-one`)).toBeVisible({
        timeout: 30_000,
      });
      await expect(viewport.getByTestId(`model-row-${ALPHA.id}-alpha-two`)).toHaveCount(0);
    } finally {
      await client.close();
      for (const seed of seeds) await seed.restore();
      await workspace.cleanup();
    }
  });
});
