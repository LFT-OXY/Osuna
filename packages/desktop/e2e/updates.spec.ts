import { expect, test } from "../../app/e2e/support/fixtures";
import { gotoAppShell, openSettings } from "../../app/e2e/support/helpers/app";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import {
  openHostSection,
  openSettingsHost,
  seedSavedSettingsHosts,
} from "../../app/e2e/support/helpers/settings";
import {
  loadRealDaemonState,
  installDesktopRuntime,
  openDesktopAboutSettings,
  openDesktopSettings,
  expectUpdateCallout,
  expectNoUpdateCallout,
  clickUpdateCalloutAction,
  releaseUpdateDownload,
  reportUpdateDownloadProgress,
  readInvokedDesktopCommands,
  clickCheckForUpdates,
  expectAvailableUpdateCheckResult,
  expectInstallInProgress,
  interceptDaemonManagementConfirmDialog,
  interceptDaemonStopConfirmDialog,
  toggleDaemonManagement,
  expectDaemonManagementConfirmDialog,
  expectDaemonManagementEnabled,
  expectDaemonManagementDisabled,
  expectDaemonStatusPid,
  expectDaemonStatusLogPath,
  expectDaemonStatusVersion,
} from "./support/runtime";

// These renderer cases use the Desktop bridge fixture. Actual Electron ownership
// and native confirmation journeys live in daemon-lifecycle.e2e.mjs.
test.describe("Desktop updates", () => {
  test("a desktop-managed daemon explains why its update action is disabled", async ({
    page,
    desktopManagedOutdatedDaemon,
  }) => {
    await seedSavedSettingsHosts(page, [desktopManagedOutdatedDaemon]);
    await page.reload();
    await openSettings(page);
    await openSettingsHost(page, desktopManagedOutdatedDaemon.serverId);
    await openHostSection(page, desktopManagedOutdatedDaemon.serverId, "host");

    const updateCard = page.getByTestId("host-page-update-card");
    await expect(updateCard).toBeVisible();
    await expect(updateCard).toContainText(
      "This daemon is managed by Osuna Desktop. Update Osuna Desktop on the host.",
    );
    await expect(page.getByTestId("host-page-update-button")).toBeDisabled();
  });

  test("a found update downloads and installs only when the user asks", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      holdDownload: true,
      slowInstall: true,
    });
    await gotoAppShell(page);

    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });
    const callout = page.getByTestId("update-callout");
    await expect(callout.getByRole("link", { name: "View changes" })).toBeVisible();
    await expect(callout.getByRole("button", { name: "Later", exact: true })).toBeVisible();
    expect(await readInvokedDesktopCommands(page)).not.toContain("download_app_update");

    await clickUpdateCalloutAction(page, "Update");
    await expect(callout).toContainText("Downloading update");
    await expect(callout).toContainText("Downloading...");
    await expect(page.getByTestId("update-callout-actions")).toHaveCount(0);
    const MB = 1024 * 1024;
    await reportUpdateDownloadProgress(page, {
      percent: 42,
      transferred: 41.4 * MB,
      total: 98.6 * MB,
      bytesPerSecond: 3.2 * MB,
    });
    await expect(page.getByTestId("update-callout-progress")).toBeVisible();
    await expect(callout).toContainText("42% · 41.4 / 98.6 MB · 3.2 MB/s");
    await releaseUpdateDownload(page);

    await expectUpdateCallout(page, { title: "Update downloaded", version: "1.2.3" });
    await expect(callout).toContainText(
      "Installing restarts the app, stops running agents, and closes terminal sessions.",
    );
    await expect(callout).toContainText(
      "It will also be installed automatically when you quit the app.",
    );
    await clickUpdateCalloutAction(page, "Install");
    await expect(callout).toContainText("Installing update");
    await expect(callout).toContainText("Preparing to restart...");
    await expectInstallInProgress(page);
    await expect(page.getByTestId("update-callout-dismiss")).toHaveCount(0);
  });

  test("Later and the close button hide the update only for this run", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
    });
    await gotoAppShell(page);
    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });

    await clickUpdateCalloutAction(page, "Later");
    await expectNoUpdateCallout(page);

    await page.reload();
    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });

    await page.getByTestId("update-callout-dismiss").click();
    await expectNoUpdateCallout(page);
  });

  test("a download hidden mid-way shows up again once it finishes", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      holdDownload: true,
    });
    await gotoAppShell(page);
    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });

    await clickUpdateCalloutAction(page, "Update");
    await expect(page.getByTestId("update-callout")).toContainText("Downloading update");
    await page.getByTestId("update-callout-dismiss").click();
    await expectNoUpdateCallout(page);
    await releaseUpdateDownload(page);

    await expectUpdateCallout(page, { title: "Update downloaded", version: "1.2.3" });
  });

  test("where the platform skips install on quit, the card does not promise it", async ({
    page,
  }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      installsOnQuit: false,
    });
    await gotoAppShell(page);
    await clickUpdateCalloutAction(page, "Update");

    await expectUpdateCallout(page, { title: "Update downloaded", version: "1.2.3" });
    await expect(page.getByTestId("update-callout")).not.toContainText("when you quit the app");
  });

  test("a failed download shows the reason and a retry", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      failUpdateAction: "download",
    });
    await gotoAppShell(page);

    await clickUpdateCalloutAction(page, "Update");

    const callout = page.getByTestId("update-callout");
    await expect(callout).toContainText("Update failed");
    await expect(callout).toContainText("sha512 checksum mismatch");
    await expect(callout.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  });

  test("a failed install shows the reason and the Releases download", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      failUpdateAction: "install",
    });
    await gotoAppShell(page);
    await clickUpdateCalloutAction(page, "Update");
    await expectUpdateCallout(page, { title: "Update downloaded", version: "1.2.3" });

    await clickUpdateCalloutAction(page, "Install");

    const callout = page.getByTestId("update-callout");
    await expect(callout).toContainText("Update failed");
    await expect(callout).toContainText("Code signature did not pass validation");
    await expect(
      callout.getByRole("button", { name: "Download from Releases", exact: true }),
    ).toBeVisible();
    await expect(callout.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  });

  test("manual check in settings reports the found update", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
    });
    await gotoAppShell(page);
    await openDesktopAboutSettings(page);

    await clickCheckForUpdates(page);

    await expectAvailableUpdateCheckResult(page, "1.2.3");
    expect(await readInvokedDesktopCommands(page)).not.toContain("download_app_update");
  });
});

test.describe("Desktop daemon management", () => {
  test("cancelling the management confirmation preserves the enabled daemon", async ({ page }) => {
    const serverId = getServerId();
    await installDesktopRuntime(page, {
      serverId,
      manageBuiltInDaemon: true,
      ownedByDesktop: true,
      confirmShouldAccept: false,
    });
    await gotoAppShell(page);
    await openDesktopSettings(page, serverId);

    const dialogArgs = await interceptDaemonManagementConfirmDialog(page);
    expectDaemonManagementConfirmDialog(dialogArgs);

    await expectDaemonManagementEnabled(page);
  });

  test("confirming the dialog disables built-in daemon management", async ({ page }) => {
    const serverId = getServerId();
    await installDesktopRuntime(page, {
      serverId,
      manageBuiltInDaemon: true,
      ownedByDesktop: true,
      confirmShouldAccept: true,
    });
    await gotoAppShell(page);
    await openDesktopSettings(page, serverId);

    await toggleDaemonManagement(page, "disable");

    await expectDaemonManagementDisabled(page);
  });

  test("daemon status panel renders version, PID, and log path from the real daemon", async ({
    page,
  }) => {
    const serverId = getServerId();
    const realState = await loadRealDaemonState();
    await installDesktopRuntime(page, {
      serverId,
      manageBuiltInDaemon: false,
      daemonPid: realState.pid,
      daemonVersion: realState.version,
      daemonLogPath: realState.logPath,
    });
    await gotoAppShell(page);
    await openDesktopSettings(page, serverId);

    await expectDaemonStatusVersion(page, realState.version);
    await expectDaemonStatusPid(page, realState.pid);
    await expectDaemonStatusLogPath(page, realState.logPath);
  });

  for (const confirmShouldAccept of [false, true]) {
    test(`${confirmShouldAccept ? "confirming" : "cancelling"} Stop identifies the owned daemon`, async ({
      page,
    }) => {
      const serverId = getServerId();
      const realState = await loadRealDaemonState();
      const daemonHome = process.env.E2E_PASEO_HOME!;
      await installDesktopRuntime(page, {
        serverId,
        daemonPid: realState.pid,
        daemonHome,
        ownedByDesktop: true,
        confirmShouldAccept,
      });
      await gotoAppShell(page);
      await openDesktopSettings(page, serverId);

      const dialog = await interceptDaemonStopConfirmDialog(page);
      expect(dialog).toEqual({
        title: "Stop local daemon?",
        message: [
          "This daemon was launched by this Desktop session.",
          `Home: ${daemonHome}`,
          `Supervisor PID: ${realState.pid}`,
          "Running agent work will be interrupted.",
        ].join("\n"),
      });
      await expectDaemonStatusPid(page, confirmShouldAccept ? null : realState.pid);
    });
  }
});
