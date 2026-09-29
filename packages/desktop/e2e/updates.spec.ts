import { expect, test } from "../../app/e2e/support/fixtures";
import { gotoAppShell, openSettings } from "../../app/e2e/support/helpers/app";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import {
  clickSettingsBackToWorkspace,
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
  readCapturedConfirmDialog,
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
    await expect(callout.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
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

  test("cancelling a download goes back to the found update without an error", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      holdDownload: true,
    });
    await gotoAppShell(page);
    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });

    await clickUpdateCalloutAction(page, "Update");
    const callout = page.getByTestId("update-callout");
    await expect(callout).toContainText("Downloading update");
    await clickUpdateCalloutAction(page, "Cancel");

    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });
    await expect(callout).not.toContainText("Update failed");

    await clickUpdateCalloutAction(page, "Update");
    await expect(callout).toContainText("Downloading update");
  });

  test("a cancel that fails shows the reason, and Retry cancels again", async ({ page }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      holdDownload: true,
      failUpdateAction: "cancel",
    });
    await gotoAppShell(page);
    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });

    await clickUpdateCalloutAction(page, "Update");
    const callout = page.getByTestId("update-callout");
    await expect(callout).toContainText("Downloading update");
    await clickUpdateCalloutAction(page, "Cancel");

    await expect(callout).toContainText("Update failed");
    await expect(callout).toContainText("The updater did not respond.");
    await expect(
      callout.getByRole("button", { name: "Download from Releases", exact: true }),
    ).toHaveCount(0);

    await clickUpdateCalloutAction(page, "Retry");

    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });
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

  test("a failed download shows the reason and the Releases download, and Retry downloads again", async ({
    page,
  }) => {
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
    await expect(
      callout.getByRole("button", { name: "Download from Releases", exact: true }),
    ).toBeVisible();

    await clickUpdateCalloutAction(page, "Retry");

    await expectUpdateCallout(page, { title: "Update downloaded", version: "1.2.3" });
  });

  test("a failed install shows the reason and the Releases download, and Retry installs again", async ({
    page,
  }) => {
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

    await page
      .context()
      .route("https://github.com/**", (route) => route.fulfill({ status: 200, body: "" }));
    const releasesPage = page.waitForEvent("popup");
    await clickUpdateCalloutAction(page, "Download from Releases");
    await (await releasesPage).waitForURL("https://github.com/LFT-OXY/Osuna/releases");

    await clickUpdateCalloutAction(page, "Retry");

    await expect(callout).toContainText("Installing update");
    await expect(callout).not.toContainText("Update failed");
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

  test("an update checked and downloaded in settings is the one the sidebar card shows", async ({
    page,
  }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      holdDownload: true,
      slowInstall: true,
    });
    await gotoAppShell(page);
    await expectUpdateCallout(page, { title: "Update available", version: "1.2.3" });
    await clickUpdateCalloutAction(page, "Later");
    await expectNoUpdateCallout(page);

    await openDesktopAboutSettings(page);
    await clickCheckForUpdates(page);
    await expectAvailableUpdateCheckResult(page, "1.2.3");
    const aboutPane = page.getByTestId("settings-detail-pane");
    await aboutPane.getByRole("button", { name: "Update", exact: true }).click();
    const MB = 1024 * 1024;
    await reportUpdateDownloadProgress(page, {
      percent: 42,
      transferred: 41.4 * MB,
      total: 98.6 * MB,
      bytesPerSecond: 3.2 * MB,
    });
    await expect(
      aboutPane.getByText("Downloading app update... 42%", { exact: true }),
    ).toBeVisible();

    await clickSettingsBackToWorkspace(page);
    await expect(page.getByTestId("update-callout")).toContainText(
      "42% · 41.4 / 98.6 MB · 3.2 MB/s",
    );
    await releaseUpdateDownload(page);
    await expectUpdateCallout(page, { title: "Update downloaded", version: "1.2.3" });

    await openDesktopAboutSettings(page);
    await expect(
      aboutPane.getByText(
        "Installing restarts the app, stops running agents, and closes terminal sessions.",
        { exact: true },
      ),
    ).toBeVisible();
    await aboutPane.getByRole("button", { name: "Install and restart", exact: true }).click();
    await expect(
      aboutPane.getByRole("button", { name: "Installing...", exact: true }),
    ).toBeDisabled();
    expect(await readInvokedDesktopCommands(page)).toContain("install_app_update");
    expect(await readCapturedConfirmDialog(page)).toBeUndefined();
  });

  test("a download started in settings that fails shows the reason and the Releases download there", async ({
    page,
  }) => {
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      updateAvailable: true,
      latestVersion: "1.2.3",
      failUpdateAction: "download",
    });
    await gotoAppShell(page);
    await openDesktopAboutSettings(page);
    await clickCheckForUpdates(page);
    await expectAvailableUpdateCheckResult(page, "1.2.3");

    const aboutPane = page.getByTestId("settings-detail-pane");
    await aboutPane.getByRole("button", { name: "Update", exact: true }).click();

    await expect(
      aboutPane.getByText("The update couldn't be downloaded.", { exact: true }),
    ).toBeVisible();
    await expect(aboutPane.getByText("sha512 checksum mismatch", { exact: true })).toBeVisible();
    await page
      .context()
      .route("https://github.com/**", (route) => route.fulfill({ status: 200, body: "" }));
    const releasesPage = page.waitForEvent("popup");
    await aboutPane.getByRole("button", { name: "Download from Releases", exact: true }).click();
    await (await releasesPage).waitForURL("https://github.com/LFT-OXY/Osuna/releases");
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
