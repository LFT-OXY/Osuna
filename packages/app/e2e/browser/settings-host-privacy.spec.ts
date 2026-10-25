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
import { installDaemonConfigFailureFixture } from "../support/helpers/usage-pricing";

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
