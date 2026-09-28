import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { test, expect, type Page } from "../support/fixtures";
import { expectComposerModel, seedModelProvider } from "../support/helpers/agent-profiles";
import { expectComposerVisible } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoWorkspace } from "../support/helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openGlobalNewWorkspaceComposer } from "../support/helpers/new-workspace";
import {
  chooseProvider,
  expectProviderStatus,
  expectMoreAgentsCountMatchesRows,
  expectToolbarOrder,
  moreAgentsRow,
  moveProviderHighlight,
  openProviderMenu,
  providerButton,
  providerMenuOption,
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
  command: ["/missing-paseo-provider-menu"],
};
const DISABLED = {
  id: "provider-menu-disabled",
  label: "Disabled agents",
  models: [{ id: "disabled-one", label: "Disabled one", description: "Turned off" }],
  enabled: false,
};

async function rememberAlphaModel(page: Page) {
  await page.addInitScript(
    ({ provider, model }) => {
      localStorage.setItem(
        "@paseo:create-agent-preferences",
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
