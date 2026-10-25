import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import {
  expectReadCliSignIns,
  readCliSignInsOnDaemon,
  readCliSignInsSwitch,
  rewriteServerInfo,
  setReadCliSignInsOnDaemon,
} from "../support/helpers/host-privacy";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsHostSection } from "../support/helpers/settings";
import { seedSidebarFooterPreferences } from "../support/helpers/sidebar-nav-settings";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsagePageFromShell } from "../support/helpers/usage-page";
import { installDaemonConfigFailureFixture } from "../support/helpers/usage-pricing";
import { installUsageReportsFixture } from "../support/helpers/usage-reports";
import {
  claudeAndCodexReports,
  closeUsage,
  expectNoUsageItem,
  expectPinnedUsage,
  openUsageFromIcon,
  openUsageFromItem,
  togglePin,
  usageModal,
} from "../support/helpers/usage-sidebar-item";

// 用量页会扫会话记录：指向夹具，不读本机真实的 CLI 目录。
test.use({ e2eDaemonEnvironment: createUsageFixtureRoots("paseo-host-privacy-").environment });

const HINT =
  "Lets Osuna read the logins each CLI keeps for itself (login files, the Keychain) to show plan usage. Off, Osuna doesn't read them and plan usage doesn't show; the CLIs keep using their own logins, and API endpoints aren't affected. Code in plugins other than plan usage isn't covered by this switch.";

async function openHostOverview(page: import("@playwright/test").Page) {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHostSection(page, getServerId(), "host");
}

async function topOf(locator: import("@playwright/test").Locator): Promise<number> {
  return locator.evaluate((node) => node.getBoundingClientRect().top);
}

function privacySection(page: import("@playwright/test").Page) {
  return page.getByTestId("host-privacy-section").filter({ visible: true });
}

test.describe("Host settings Privacy section", () => {
  test.beforeEach(async () => {
    await setReadCliSignInsOnDaemon(true);
  });
  test.afterEach(async () => {
    await setReadCliSignInsOnDaemon(true);
  });

  test("sits after Appearance and its switch turns Read CLI sign-ins off and on", async ({
    page,
  }) => {
    await openHostOverview(page);
    const section = privacySection(page);
    await expect(section).toContainText("Privacy");
    await expect(section).toContainText("Read CLI sign-ins");
    await expect(section).toContainText(HINT);
    const appearanceTop = await topOf(page.getByTestId("host-appearance-preview"));
    const privacyTop = await topOf(section);
    const restartTop = await topOf(page.getByTestId("host-page-restart-card"));
    expect(appearanceTop).toBeLessThan(privacyTop);
    expect(privacyTop).toBeLessThan(restartTop);
    await expectReadCliSignIns(page, { checked: true, disabled: false });

    await readCliSignInsSwitch(page).click();
    await expectReadCliSignIns(page, { checked: false, disabled: false });
    await expect.poll(readCliSignInsOnDaemon).toBe(false);

    await page.reload();
    await openSettingsHostSection(page, getServerId(), "host");
    await expectReadCliSignIns(page, { checked: false, disabled: false });

    await readCliSignInsSwitch(page).click();
    await expectReadCliSignIns(page, { checked: true, disabled: false });
    await expect.poll(readCliSignInsOnDaemon).toBe(true);
  });

  test("a refused change puts the switch back and keeps the reason under the row until a retry", async ({
    page,
  }) => {
    await installDaemonConfigFailureFixture(page, "daemon is busy", { times: 1 });
    await openHostOverview(page);
    await readCliSignInsSwitch(page).click();
    const error = page
      .getByTestId("host-privacy-read-cli-sign-ins-error")
      .filter({ visible: true });
    await expect(error).toHaveText("Couldn't change Read CLI sign-ins: daemon is busy");
    await expectReadCliSignIns(page, { checked: true, disabled: false });
    expect(await readCliSignInsOnDaemon()).toBe(true);

    await readCliSignInsSwitch(page).click();
    await expectReadCliSignIns(page, { checked: false, disabled: false });
    await expect(error).toHaveCount(0);
    await expect.poll(readCliSignInsOnDaemon).toBe(false);
  });

  test("a device with view-only access sees the switch but can't change it", async ({ page }) => {
    await rewriteServerInfo(page, (payload) => {
      payload.permissions = ["daemon.read", "workspace.read"];
    });
    await setReadCliSignInsOnDaemon(false);
    await openHostOverview(page);
    await expect(privacySection(page)).toContainText("Read CLI sign-ins");
    await expectReadCliSignIns(page, { checked: false, disabled: true });
    await readCliSignInsSwitch(page).click({ force: true });
    await expectReadCliSignIns(page, { checked: false, disabled: true });
    expect(await readCliSignInsOnDaemon()).toBe(false);
  });

  test("a host that doesn't know the switch shows no Privacy section", async ({ page }) => {
    await rewriteServerInfo(page, (payload) => {
      delete payload.features?.readCliSignIns;
    });
    await openHostOverview(page);
    await expect(page.getByTestId("host-appearance-preview")).toBeVisible();
    await expect(page.getByTestId("host-privacy-section")).toHaveCount(0);
  });
});

test.describe("Plan usage while Read CLI sign-ins is off", () => {
  const OFF_LINE = "“Read CLI sign-ins” is off, so plan usage doesn't show";

  test.beforeEach(async ({ page }) => {
    await setReadCliSignInsOnDaemon(true);
    // 侧栏摘要和钉住窗口都要「在侧栏显示」开着。
    await seedSidebarFooterPreferences(page, [{ key: "usage", visible: true }]);
  });
  test.afterEach(async () => {
    await setReadCliSignInsOnDaemon(true);
  });

  /** 列表照主机的开关回答：关着时是带 cliSignInsOff 的空列表。 */
  async function installSwitchAwareReports(page: import("@playwright/test").Page) {
    const state = { off: false };
    await installUsageReportsFixture(page, {
      lists: [() => (state.off ? { cliSignInsOff: true } : claudeAndCodexReports())],
    });
    return state;
  }

  async function expectOnPrivacySection(page: import("@playwright/test").Page) {
    await expect(page).toHaveURL(new RegExp(`/settings/hosts/${getServerId()}/host$`));
    await expect(privacySection(page)).toBeInViewport();
  }

  test("the Usage modal explains the empty list, Open settings lands on Privacy, and pins come back when it's on again", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const reports = await installSwitchAwareReports(page);
    await gotoAppShell(page);

    await test.step("a pin set while on", async () => {
      await openUsageFromItem(page);
      await togglePin(usageModal(page), "Claude", "Weekly");
      await expectPinnedUsage(page, ["31% 5h", "7% 5h", "12% wk"]);
      await closeUsage(page);
    });

    await test.step("off: no sidebar summary, the modal says why", async () => {
      reports.off = true;
      await setReadCliSignInsOnDaemon(false);
      await gotoAppShell(page);
      await expectNoUsageItem(page);
      await openUsageFromIcon(page);
      await expect(usageModal(page).getByTestId("usage-cli-sign-ins-off")).toHaveText(OFF_LINE);
      await expect(usageModal(page).getByText("Claude", { exact: true })).toHaveCount(0);
    });

    await test.step("Open settings closes the modal and lands on Privacy", async () => {
      await usageModal(page).getByRole("button", { name: "Open settings", exact: true }).click();
      await expect(page.locator('[data-testid="usage-modal-body"]:visible')).toHaveCount(0);
      await expectOnPrivacySection(page);
    });

    await test.step("on again: the summary shows the same pins", async () => {
      reports.off = false;
      await readCliSignInsSwitch(page).click();
      await expect.poll(readCliSignInsOnDaemon).toBe(true);
      await page.goBack();
      await expectPinnedUsage(page, ["31% 5h", "7% 5h", "12% wk"]);
    });
  });

  test("the Usage page's plan usage says why it's empty and Open settings lands on Privacy", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const reports = await installSwitchAwareReports(page);
    reports.off = true;
    await gotoAppShell(page);
    await openUsagePageFromShell(page);
    const card = page.getByTestId("usage-plan-usage-card");
    await expect(card.getByTestId("usage-cli-sign-ins-off")).toHaveText(OFF_LINE);
    await card.getByRole("button", { name: "Open settings", exact: true }).click();
    await expectOnPrivacySection(page);
  });
});
