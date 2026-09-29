import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  AUTOMATIC_CHECK_INTERVAL_MS,
  createDesktopAppUpdater,
  formatStatusText,
  startAutomaticUpdateChecks,
  type DesktopAppUpdater,
  type DesktopAppUpdaterErrorReport,
} from "./desktop-app-updater";
import {
  buildFakeCheckResult,
  buildFakeInstallResult,
  buildFakeUpdateState,
  createFakeDesktopAppUpdaterPort,
  type FakeDesktopAppUpdaterPort,
} from "./test-utils/fake-desktop-app-updater-port";
import { createFakeIntervalTimer } from "./test-utils/fake-interval-timer";
import type { DesktopAppUpdateCheckResult, DesktopAppUpdatePhase } from "./desktop-updates";

function createUpdater(
  overrides: {
    port?: FakeDesktopAppUpdaterPort;
    now?: () => number;
  } = {},
): {
  updater: DesktopAppUpdater;
  port: FakeDesktopAppUpdaterPort;
  reportedErrors: DesktopAppUpdaterErrorReport[];
} {
  const port = overrides.port ?? createFakeDesktopAppUpdaterPort();
  const reportedErrors: DesktopAppUpdaterErrorReport[] = [];
  const updater = createDesktopAppUpdater({
    port,
    now: overrides.now ?? (() => 1_700_000_000_000),
    reportError: (report) => {
      reportedErrors.push(report);
    },
  });
  return { updater, port, reportedErrors };
}

function checkResultWith(phase: DesktopAppUpdatePhase): DesktopAppUpdateCheckResult {
  return buildFakeCheckResult({ state: buildFakeUpdateState({ phase }) });
}

async function connectWithState(
  phase: DesktopAppUpdatePhase,
): Promise<ReturnType<typeof createUpdater>> {
  const created = createUpdater();
  created.updater.connect();
  created.port.nextCheckResult(checkResultWith(phase));
  await created.updater.checkForUpdates({ releaseChannel: "stable" });
  return created;
}

describe("desktop app updater — check", () => {
  it("forwards manual check intent and the requested release channel to the port", async () => {
    const { updater, port } = createUpdater();

    await updater.checkForUpdates({ releaseChannel: "beta" });

    expect(port.recordedChecks).toEqual([{ releaseChannel: "beta", intent: "manual" }]);
  });

  it("forwards automatic check intent independently from silent UI state", async () => {
    const { updater, port } = createUpdater();

    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    expect(port.recordedChecks).toEqual([{ releaseChannel: "stable", intent: "automatic" }]);
  });

  it("does not add manual last-checked feedback for automatic checks", async () => {
    const { updater, port } = createUpdater({ now: () => 42 });
    port.nextCheckResult(checkResultWith("available"));

    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    expect(updater.getSnapshot()).toMatchObject({ status: "available", lastCheckedAt: null });
  });

  it("moves to 'checking' during a non-silent check", async () => {
    const { updater, port } = createUpdater();
    const deferred = port.deferNextCheck();

    const pending = updater.checkForUpdates({ releaseChannel: "stable" });
    expect(updater.getSnapshot().status).toBe("checking");

    deferred.resolve(buildFakeCheckResult());
    await pending;
  });

  it("stays on the current status during a silent check", async () => {
    const { updater, port } = createUpdater();
    port.nextCheckResult(checkResultWith("available"));
    await updater.checkForUpdates({ releaseChannel: "stable" });

    const deferred = port.deferNextCheck();
    const pending = updater.checkForUpdates({
      releaseChannel: "stable",
      intent: "automatic",
      silent: true,
    });
    expect(updater.getSnapshot().status).toBe("available");

    deferred.resolve(checkResultWith("available"));
    await pending;
  });

  it("reports a found update as 'available' without downloading it", async () => {
    const { updater, port } = createUpdater({ now: () => 42 });
    port.nextCheckResult(
      buildFakeCheckResult({
        state: buildFakeUpdateState({ phase: "available", targetVersion: "1.2.3" }),
      }),
    );

    await updater.checkForUpdates({ releaseChannel: "stable" });

    expect(updater.getSnapshot()).toMatchObject({
      status: "available",
      targetVersion: "1.2.3",
      lastCheckedAt: 42,
    });
    expect(port.downloadCount).toBe(0);
  });

  it("picks up an update another window already downloaded", async () => {
    const { updater, port } = createUpdater();
    port.nextCheckResult(
      buildFakeCheckResult({
        state: buildFakeUpdateState({ phase: "downloaded", installsOnQuit: false }),
      }),
    );

    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    expect(updater.getSnapshot()).toMatchObject({
      status: "downloaded",
      targetVersion: "1.2.3",
      installsOnQuit: false,
    });
  });

  it("reports 'up-to-date' when the check resolves with no update", async () => {
    const { updater, port } = createUpdater();
    port.nextCheckResult(checkResultWith("none"));

    await updater.checkForUpdates({ releaseChannel: "stable" });

    expect(updater.getSnapshot().status).toBe("up-to-date");
  });

  it("reports 'error' when a non-silent check throws", async () => {
    const { updater, port } = createUpdater();
    port.failNextCheck(new Error("network down"));

    await updater.checkForUpdates({ releaseChannel: "stable" });

    expect(updater.getSnapshot()).toMatchObject({
      status: "error",
      errorMessage: "network down",
    });
  });

  it("reports service-returned check errors", async () => {
    const { updater, port } = createUpdater({ now: () => 42 });
    port.nextCheckResult(buildFakeCheckResult({ errorMessage: "network down" }));

    await updater.checkForUpdates({ releaseChannel: "stable" });

    expect(updater.getSnapshot()).toMatchObject({
      status: "error",
      errorMessage: "network down",
      lastCheckedAt: 42,
    });
  });

  it("keeps a downloaded update installable when a manual check fails", async () => {
    const { updater, port } = await connectWithState("downloaded");
    port.failNextCheck(new Error("network down"));

    await updater.checkForUpdates({ releaseChannel: "stable" });

    expect(updater.getSnapshot()).toMatchObject({
      status: "downloaded",
      errorMessage: "network down",
    });
  });

  it("keeps silent check errors quiet", async () => {
    const { updater, port } = createUpdater({ now: () => 42 });
    port.nextCheckResult(checkResultWith("available"));
    await updater.checkForUpdates({ releaseChannel: "stable" });

    port.nextCheckResult(
      buildFakeCheckResult({
        errorMessage: "network down",
        state: buildFakeUpdateState({ phase: "available" }),
      }),
    );
    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    expect(updater.getSnapshot()).toMatchObject({
      status: "available",
      errorMessage: null,
      lastCheckedAt: 42,
    });
  });

  it("does not move to 'error' when a silent check throws", async () => {
    const { updater, port } = createUpdater();
    port.nextCheckResult(checkResultWith("available"));
    await updater.checkForUpdates({ releaseChannel: "stable" });

    port.failNextCheck(new Error("boom"));
    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    expect(updater.getSnapshot().status).toBe("available");
  });

  it("does not let a silent check supersede an in-flight manual check", async () => {
    const { updater, port } = createUpdater();
    const deferred = port.deferNextCheck();

    const manualCheck = updater.checkForUpdates({ releaseChannel: "stable" });
    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    deferred.resolve(checkResultWith("none"));
    await manualCheck;

    expect(port.recordedChecks).toEqual([{ releaseChannel: "stable", intent: "manual" }]);
    expect(updater.getSnapshot().status).toBe("up-to-date");
  });

  it("keeps the newer main-process state when an older check resolves last", async () => {
    const { updater, port } = createUpdater();
    const olderCheck = port.deferNextCheck();
    const olderPending = updater.checkForUpdates({
      releaseChannel: "stable",
      intent: "automatic",
      silent: true,
    });
    const newerCheck = port.deferNextCheck();
    const newerPending = updater.checkForUpdates({
      releaseChannel: "stable",
      intent: "automatic",
      silent: true,
    });
    const olderState = buildFakeUpdateState({ phase: "none" });
    const newerState = buildFakeUpdateState({ phase: "available", targetVersion: "2.0.0" });

    newerCheck.resolve(buildFakeCheckResult({ state: newerState }));
    await newerPending;
    olderCheck.resolve(buildFakeCheckResult({ state: olderState }));
    await olderPending;

    expect(updater.getSnapshot()).toMatchObject({ status: "available", targetVersion: "2.0.0" });
  });

  it("lets a newer silent check win after an older silent check resolves first", async () => {
    const { updater, port } = createUpdater();
    const olderCheck = port.deferNextCheck();
    const olderPending = updater.checkForUpdates({
      releaseChannel: "stable",
      intent: "automatic",
      silent: true,
    });
    const newerCheck = port.deferNextCheck();
    const newerPending = updater.checkForUpdates({
      releaseChannel: "stable",
      intent: "automatic",
      silent: true,
    });

    olderCheck.resolve(checkResultWith("none"));
    await olderPending;
    expect(updater.getSnapshot().status).toBe("idle");

    newerCheck.resolve(
      buildFakeCheckResult({
        state: buildFakeUpdateState({ phase: "available", targetVersion: "2.0.0" }),
      }),
    );
    await newerPending;

    expect(updater.getSnapshot()).toMatchObject({ status: "available", targetVersion: "2.0.0" });
  });
});

describe("desktop app updater — main-process state", () => {
  it("follows every state the main process pushes", async () => {
    const { updater, port } = await connectWithState("available");

    port.pushState(buildFakeUpdateState({ phase: "downloading" }));
    expect(updater.getSnapshot().status).toBe("downloading");

    port.pushState(buildFakeUpdateState({ phase: "downloaded" }));
    expect(updater.getSnapshot().status).toBe("downloaded");
  });

  it("ignores a pushed state older than the one it already has", async () => {
    const { updater, port } = await connectWithState("available");
    const stale = buildFakeUpdateState({ phase: "none" });
    port.pushState(buildFakeUpdateState({ phase: "downloading" }));

    port.pushState(stale);

    expect(updater.getSnapshot().status).toBe("downloading");
  });

  it("stops following pushes once disconnected", async () => {
    const { updater, port } = createUpdater();
    const disconnect = updater.connect();
    disconnect();

    port.pushState(buildFakeUpdateState({ phase: "downloading" }));

    expect(updater.getSnapshot().status).toBe("idle");
  });

  it("shows a download failure with its message", async () => {
    const { updater, port } = await connectWithState("downloading");

    port.pushState(
      buildFakeUpdateState({
        phase: "failed",
        failure: { action: "download", message: "sha512 checksum mismatch" },
      }),
    );

    expect(updater.getSnapshot()).toMatchObject({
      status: "error",
      errorMessage: "sha512 checksum mismatch",
    });
  });
});

describe("desktop app updater — download", () => {
  it("shows 'downloading' as soon as the user asks, before the main process confirms", async () => {
    const { updater, port } = await connectWithState("available");
    const download = port.deferNextDownload();

    const pending = updater.downloadUpdate();
    expect(updater.getSnapshot().status).toBe("downloading");

    download.resolve(buildFakeUpdateState({ phase: "downloaded" }));
    await pending;
    expect(updater.getSnapshot().status).toBe("downloaded");
    expect(port.downloadCount).toBe(1);
  });

  it("reports the error and moves to 'error' when the download command throws", async () => {
    const { updater, port, reportedErrors } = await connectWithState("available");
    const error = new Error("ipc closed");
    port.failNextDownload(error);

    await updater.downloadUpdate();

    expect(updater.getSnapshot()).toMatchObject({ status: "error", errorMessage: "ipc closed" });
    expect(reportedErrors).toEqual([
      {
        error,
        message: "Unable to download the desktop app update.",
        logLabel: "[DesktopUpdater] Failed to download app update",
      },
    ]);
  });
});

describe("desktop app updater — install", () => {
  it("shows 'installing' as soon as the user asks", async () => {
    const { updater, port } = await connectWithState("downloaded");
    const install = port.deferNextInstall();

    const pending = updater.installUpdate();
    expect(updater.getSnapshot().status).toBe("installing");

    port.pushState(buildFakeUpdateState({ phase: "installing" }));
    install.resolve(buildFakeInstallResult({ installed: true }));
    await pending;

    expect(updater.getSnapshot().status).toBe("installing");
    expect(port.installCount).toBe(1);
  });

  it("shows the main-process state when there was nothing to install", async () => {
    const { updater, port } = await connectWithState("available");
    port.nextInstallResult(buildFakeInstallResult({ installed: false }));

    await updater.installUpdate();

    expect(updater.getSnapshot().status).toBe("available");
  });

  it("moves to 'install-failed' with the reason the main process reports", async () => {
    const { updater, port } = await connectWithState("downloaded");
    const install = port.deferNextInstall();

    const pending = updater.installUpdate();
    port.pushState(
      buildFakeUpdateState({
        phase: "failed",
        failure: {
          action: "install",
          reason: "updater-error",
          message: "Code signature did not pass validation",
        },
      }),
    );
    install.resolve(
      buildFakeInstallResult({
        installed: false,
        failure: { reason: "updater-error", message: "Code signature did not pass validation" },
      }),
    );
    await pending;

    expect(updater.getSnapshot()).toMatchObject({
      status: "install-failed",
      targetVersion: "1.2.3",
      errorMessage: "Code signature did not pass validation",
    });
  });

  it("explains a restart handoff timeout in the app language", async () => {
    const { updater, port } = await connectWithState("downloaded");

    port.pushState(
      buildFakeUpdateState({
        phase: "failed",
        failure: { action: "install", reason: "handoff-timeout" },
      }),
    );

    expect(updater.getSnapshot()).toMatchObject({
      status: "install-failed",
      errorMessage: "The updater didn't restart the app in time.",
    });
  });

  it("keeps the install failure visible through a silent recheck", async () => {
    const { updater, port } = await connectWithState("downloaded");
    const failed = {
      phase: "failed",
      failure: {
        action: "install",
        reason: "updater-error",
        message: "Code signature did not pass validation",
      },
    } as const;
    port.pushState(buildFakeUpdateState(failed));

    port.nextCheckResult(buildFakeCheckResult({ state: buildFakeUpdateState(failed) }));
    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    expect(updater.getSnapshot()).toMatchObject({
      status: "install-failed",
      errorMessage: "Code signature did not pass validation",
    });
  });

  it("reports the install error and moves to 'error' when the install throws", async () => {
    const { updater, port, reportedErrors } = await connectWithState("downloaded");
    const error = new Error("install failed");
    port.failNextInstall(error);

    await updater.installUpdate();

    expect(updater.getSnapshot()).toMatchObject({
      status: "error",
      errorMessage: "install failed",
    });
    expect(reportedErrors).toEqual([
      {
        error,
        message: "Unable to install the desktop app update.",
        logLabel: "[DesktopUpdater] Failed to install app update",
      },
    ]);
  });
});

describe("desktop app updater — hidden for this run", () => {
  it("hides the update until something new happens", async () => {
    const { updater, port } = await connectWithState("available");

    updater.hide();
    port.nextCheckResult(checkResultWith("available"));
    await updater.checkForUpdates({ releaseChannel: "stable", intent: "automatic", silent: true });

    expect(updater.getSnapshot()).toMatchObject({ status: "available", isHidden: true });
  });

  it("shows a download hidden mid-way again once it finishes", async () => {
    const { updater, port } = await connectWithState("downloading");
    updater.hide();

    port.pushState(buildFakeUpdateState({ phase: "downloading" }));
    expect(updater.getSnapshot().isHidden).toBe(true);

    port.pushState(buildFakeUpdateState({ phase: "downloaded" }));
    expect(updater.getSnapshot()).toMatchObject({ status: "downloaded", isHidden: false });
  });

  it("keeps a downloaded update hidden once the user chose later", async () => {
    const { updater, port } = await connectWithState("downloaded");

    updater.hide();
    port.pushState(buildFakeUpdateState({ phase: "downloaded" }));

    expect(updater.getSnapshot()).toMatchObject({ status: "downloaded", isHidden: true });
  });
});

describe("desktop app updater — subscribe", () => {
  it("notifies subscribers when the status changes", async () => {
    const { updater, port } = createUpdater();
    port.nextCheckResult(checkResultWith("available"));

    const notifications: string[] = [];
    const unsubscribe = updater.subscribe(() => {
      notifications.push(updater.getSnapshot().status);
    });

    await updater.checkForUpdates({ releaseChannel: "stable" });
    unsubscribe();

    expect(notifications).toEqual(["checking", "available"]);
  });
});

describe("formatStatusText", () => {
  const formatVersion = (version: string | null | undefined) =>
    version ? `v${version.replace(/^v/i, "")}` : "—";
  const formatLastCheckedAt = (timestamp: number) => `time-${timestamp}`;
  const format = (input: {
    status: Parameters<typeof formatStatusText>[0]["status"];
    targetVersion?: string | null;
    lastCheckedAt?: number | null;
  }) =>
    formatStatusText({
      status: input.status,
      targetVersion: input.targetVersion ?? null,
      lastCheckedAt: input.lastCheckedAt ?? null,
      formatVersion,
      formatLastCheckedAt,
    });

  it("shows when an up-to-date check completed", () => {
    expect(format({ status: "up-to-date", lastCheckedAt: 42 })).toBe(
      "Up to date. Last checked at time-42.",
    );
  });

  it("names the found version while an update is available", () => {
    expect(format({ status: "available", targetVersion: "1.2.3" })).toBe(
      "Update available: v1.2.3",
    );
    expect(format({ status: "available", targetVersion: "1.2.3", lastCheckedAt: 42 })).toBe(
      "Update available: v1.2.3. Last checked at time-42.",
    );
  });

  it("says the update is being downloaded", () => {
    expect(format({ status: "downloading", targetVersion: "1.2.3" })).toBe(
      "Downloading app update...",
    );
  });

  it("says a downloaded update is ready to install", () => {
    expect(format({ status: "downloaded", targetVersion: "1.2.3" })).toBe("Update ready: v1.2.3");
    expect(format({ status: "downloaded", targetVersion: "1.2.3", lastCheckedAt: 42 })).toBe(
      "Update ready: v1.2.3. Last checked at time-42.",
    );
  });

  it("falls back to generic messages when no version is reported", () => {
    expect(format({ status: "available" })).toBe("An app update is available.");
    expect(format({ status: "downloaded" })).toBe("An app update is ready to install.");
  });

  it("says the update could not be installed in the 'install-failed' state", () => {
    expect(format({ status: "install-failed" })).toBe("The update couldn't be installed.");
  });

  it("uses the active app language for local status wrappers", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      expect(format({ status: "checking" })).toBe("正在检查 app 更新...");
      expect(format({ status: "available", targetVersion: "1.2.3" })).toBe("有可用更新：v1.2.3");
      expect(format({ status: "downloaded", targetVersion: "1.2.3" })).toBe("更新已就绪：v1.2.3");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

function flushChecks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const AUTOMATIC_STABLE_CHECK = { releaseChannel: "stable", intent: "automatic" } as const;

describe("desktop app updater — automatic checks", () => {
  it("checks once when started and again every automatic interval until stopped", async () => {
    const { updater, port } = createUpdater();
    const timer = createFakeIntervalTimer();

    const stop = startAutomaticUpdateChecks({ updater, releaseChannel: "stable", timer });
    await flushChecks();
    expect(port.recordedChecks).toEqual([AUTOMATIC_STABLE_CHECK]);

    timer.advance(AUTOMATIC_CHECK_INTERVAL_MS);
    await flushChecks();
    expect(port.recordedChecks).toEqual([AUTOMATIC_STABLE_CHECK, AUTOMATIC_STABLE_CHECK]);

    stop();
    timer.advance(AUTOMATIC_CHECK_INTERVAL_MS);
    await flushChecks();
    expect(port.recordedChecks).toEqual([AUTOMATIC_STABLE_CHECK, AUTOMATIC_STABLE_CHECK]);
  });

  it("does not poll faster while an update is found but not downloaded", async () => {
    const { updater, port } = createUpdater();
    const timer = createFakeIntervalTimer();
    port.nextCheckResult(checkResultWith("available"));

    const stop = startAutomaticUpdateChecks({ updater, releaseChannel: "stable", timer });
    await flushChecks();
    timer.advance(AUTOMATIC_CHECK_INTERVAL_MS - 1);
    await flushChecks();

    expect(port.recordedChecks).toEqual([AUTOMATIC_STABLE_CHECK]);
    stop();
  });

  it("checks the new release channel when restarted after a channel change", async () => {
    const { updater, port } = createUpdater();
    const timer = createFakeIntervalTimer();

    const stopStable = startAutomaticUpdateChecks({ updater, releaseChannel: "stable", timer });
    await flushChecks();
    stopStable();
    const stopBeta = startAutomaticUpdateChecks({ updater, releaseChannel: "beta", timer });
    timer.advance(AUTOMATIC_CHECK_INTERVAL_MS);
    await flushChecks();

    expect(port.recordedChecks).toEqual([
      AUTOMATIC_STABLE_CHECK,
      { releaseChannel: "beta", intent: "automatic" },
      { releaseChannel: "beta", intent: "automatic" },
    ]);
    stopBeta();
  });

  it("shows a manual check from one caller to every other caller of the shared updater", async () => {
    const { updater, port } = createUpdater();
    const timer = createFakeIntervalTimer();
    const stop = startAutomaticUpdateChecks({ updater, releaseChannel: "stable", timer });
    await flushChecks();
    const sidebarSnapshots: Array<ReturnType<DesktopAppUpdater["getSnapshot"]>> = [];
    const unsubscribeSidebar = updater.subscribe(() => {
      sidebarSnapshots.push(updater.getSnapshot());
    });

    port.nextCheckResult(
      buildFakeCheckResult({
        state: buildFakeUpdateState({ phase: "available", targetVersion: "1.2.3" }),
      }),
    );
    await updater.checkForUpdates({ releaseChannel: "stable" });

    expect(port.recordedChecks).toEqual([
      AUTOMATIC_STABLE_CHECK,
      { releaseChannel: "stable", intent: "manual" },
    ]);
    expect(sidebarSnapshots.map((snapshot) => snapshot.status)).toEqual(["checking", "available"]);
    expect(sidebarSnapshots.at(-1)?.targetVersion).toBe("1.2.3");
    unsubscribeSidebar();
    stop();
  });
});
