import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUpdateCommands } from "../features/auto-updater";
import type { AppReleaseChannelSwitch, AppUpdateState } from "../features/app-update-service";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { createDaemonCommandHandlers } from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  osunaHome: "",
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  spawnProcess: vi.fn(),
  migrateLegacyHomeIfDefault: vi.fn(),
  startDaemonInstance: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mocks.osunaHome),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: true,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mocks.logInfo,
    error: mocks.logError,
    transports: {
      file: {
        getFile: mocks.getElectronLogFile,
      },
    },
  },
}));

vi.mock("@osuna/server", () => ({
  resolveOsunaHome: vi.fn(() => mocks.osunaHome),
  spawnProcess: mocks.spawnProcess,
  migrateLegacyHomeIfDefault: mocks.migrateLegacyHomeIfDefault,
  startDaemonInstance: mocks.startDaemonInstance,
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: async () => mocks.settings,
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: path.join(mocks.osunaHome, "daemon.js"),
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

const NO_UPDATE_STATE: AppUpdateState = {
  revision: 0,
  phase: "none",
  targetVersion: null,
  failure: null,
  progress: null,
  installsOnQuit: true,
};

type RecordedCheck = Parameters<AppUpdateCommands["checkForAppUpdate"]>[0];

interface FakeAppUpdates extends AppUpdateCommands {
  checks: RecordedCheck[];
  channelSwitches: AppReleaseChannelSwitch[];
}

function createFakeAppUpdates(): FakeAppUpdates {
  const checks: RecordedCheck[] = [];
  const channelSwitches: AppReleaseChannelSwitch[] = [];
  return {
    checks,
    channelSwitches,
    checkForAppUpdate: async (input) => {
      checks.push(input);
      return {
        hasUpdate: false,
        readyToInstall: false,
        currentVersion: input.currentVersion,
        latestVersion: input.currentVersion,
        body: null,
        date: null,
        errorMessage: null,
        state: NO_UPDATE_STATE,
      };
    },
    downloadAppUpdate: async () => NO_UPDATE_STATE,
    cancelAppUpdateDownload: async () => NO_UPDATE_STATE,
    installAppUpdate: async ({ currentVersion }) => ({
      installed: false,
      version: currentVersion,
      message: "The update has not been downloaded yet.",
      failure: null,
    }),
    switchAppUpdateReleaseChannel: async (input) => {
      channelSwitches.push(input);
      return NO_UPDATE_STATE;
    },
  };
}

describe("daemon-manager commands", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "osuna daemon manager "));
    mocks.osunaHome = path.join(fixtureRoot, "home");
    mocks.appLogPath = path.join(fixtureRoot, "main.log");
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.spawnProcess.mockReset();
    mocks.migrateLegacyHomeIfDefault.mockReset();
    mocks.startDaemonInstance.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("returns the Electron main-process log tail from electron-log", () => {
    writeFileSync(
      mocks.appLogPath,
      Array.from({ length: 105 }, (_value, index) => `main log line ${index + 1}`).join("\n"),
    );
    const handlers = createDaemonCommandHandlers({ appUpdates: createFakeAppUpdates() });

    expect(handlers.desktop_app_logs()).toEqual({
      logPath: mocks.appLogPath,
      contents: Array.from({ length: 100 }, (_value, index) => `main log line ${index + 6}`).join(
        "\n",
      ),
    });
  });

  it("checks for app updates on the saved release channel", async () => {
    mocks.settings = { ...DEFAULT_DESKTOP_SETTINGS, releaseChannel: "beta" };
    const appUpdates = createFakeAppUpdates();

    await createDaemonCommandHandlers({ appUpdates }).check_app_update({ intent: "manual" });

    expect(appUpdates.checks).toEqual([
      { currentVersion: "1.2.3", releaseChannel: "beta", intent: "manual" },
    ]);
  });

  it("switches the updater to the release channel the settings were saved with", async () => {
    mocks.settings = { ...DEFAULT_DESKTOP_SETTINGS, releaseChannel: "beta" };
    const appUpdates = createFakeAppUpdates();

    await createDaemonCommandHandlers({ appUpdates }).patch_desktop_settings({
      releaseChannel: "beta",
    });

    expect(appUpdates.channelSwitches).toEqual([
      { currentVersion: "1.2.3", releaseChannel: "beta" },
    ]);
  });

  // COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
  it("reports a legacy home that cannot be moved instead of starting the daemon", async () => {
    const refusal = "Could not move the legacy data directory.\n  mv old new && ln -s new old";
    mocks.migrateLegacyHomeIfDefault.mockRejectedValue(new Error(refusal));
    const handlers = createDaemonCommandHandlers({ appUpdates: createFakeAppUpdates() });

    await expect(handlers.start_desktop_daemon()).rejects.toThrow(refusal);

    expect(mocks.migrateLegacyHomeIfDefault).toHaveBeenCalledWith({
      explicitHome: process.env.OSUNA_HOME,
    });
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.startDaemonInstance).not.toHaveBeenCalled();
  });

  it("exposes updater diagnostics through the desktop command boundary", () => {
    const diagnostics = createDaemonCommandHandlers({
      appUpdates: createFakeAppUpdates(),
    }).desktop_update_diagnostics();

    expect(diagnostics).toMatchObject({
      platform: process.platform,
      currentVersion: "1.2.3",
    });
  });
});
