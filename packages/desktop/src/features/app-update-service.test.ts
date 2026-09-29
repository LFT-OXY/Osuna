import { describe, expect, it } from "vitest";

import {
  createAppUpdateService,
  type AppUpdateCheckResult,
  type AppUpdateInstallRequest,
  type AppUpdateRuntime,
  type AppUpdateRuntimeConfiguration,
  type AppUpdateState,
  type RuntimeDownloadProgress,
  type RuntimeUpdateCheckResult,
  type RuntimeUpdateInfo,
} from "./app-update-service";

class FakeAppUpdateRuntime implements AppUpdateRuntime {
  private checks: Array<
    | { isUpdateAvailable: boolean; updateInfo: RuntimeUpdateInfo }
    | null
    | Error
    | { kind: "check-error"; error: Error; emitRuntimeError: boolean }
    | { kind: "deferred"; promise: Promise<RuntimeUpdateCheckResult | null> }
  > = [];
  private gate: ((info: RuntimeUpdateInfo) => boolean | Promise<boolean>) | null = null;
  private configuration: AppUpdateRuntimeConfiguration | null = null;
  private downloadableUpdate: RuntimeUpdateInfo | null = null;
  private downloadedUpdate: RuntimeUpdateInfo | null = null;
  private holdsNextDownload = false;
  private heldDownload: {
    resolve(): void;
    reject(error: Error): void;
  } | null = null;
  checkCount = 0;
  requestedDownloadVersions: string[] = [];
  downloadedVersions: string[] = [];
  installedVersions: string[] = [];
  installModes: Array<{ targetVersion: string; isSilent: boolean; isForceRunAfter: boolean }> = [];
  private holdsQuitHandoff = false;

  configure(input: AppUpdateRuntimeConfiguration): void {
    this.configuration = input;
    this.gate = input.shouldAdmitUpdate;
  }

  nextCheck(result: { isUpdateAvailable: boolean; updateInfo: RuntimeUpdateInfo } | null): void {
    this.checks.push(result);
  }

  failNextCheck(error: Error): void {
    this.checks.push(error);
  }

  failNextCheckAndEmitRuntimeError(error: Error): void {
    this.checks.push({ kind: "check-error", error, emitRuntimeError: true });
  }

  deferNextCheck(): {
    resolve(result: RuntimeUpdateCheckResult | null): void;
    reject(error: Error): void;
  } {
    let resolve!: (result: RuntimeUpdateCheckResult | null) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<RuntimeUpdateCheckResult | null>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.checks.push({ kind: "deferred", promise });
    return { resolve, reject };
  }

  failRuntime(error: Error): void {
    this.configuration?.onError(error);
  }

  prepareUpdate(info: RuntimeUpdateInfo): void {
    this.configuration?.onUpdateAvailable(info);
  }

  finishUpdateDownload(info: RuntimeUpdateInfo): void {
    this.downloadedUpdate = info;
    this.downloadedVersions.push(info.version);
    this.configuration?.onUpdateDownloaded(info);
  }

  // 下一次 downloadUpdate 挂起，直到测试调用 completeDownload / failDownload。
  holdNextDownload(): void {
    this.holdsNextDownload = true;
  }

  completeDownload(): void {
    this.heldDownload?.resolve();
  }

  failDownload(error: Error): void {
    this.heldDownload?.reject(error);
  }

  reportDownloadProgress(progress: RuntimeDownloadProgress): void {
    this.configuration?.onDownloadProgress(progress);
  }

  async checkForUpdates(): Promise<{
    isUpdateAvailable: boolean;
    updateInfo: RuntimeUpdateInfo;
  } | null> {
    this.checkCount += 1;
    const result = this.checks.shift() ?? null;
    if (result instanceof Error) throw result;
    if (result?.kind === "check-error") {
      if (result.emitRuntimeError) {
        this.configuration?.onError(result.error);
      }
      throw result.error;
    }
    if (result?.kind === "deferred") {
      return result.promise;
    }
    if (!result || !this.gate) return result;
    const admitted = await this.gate(result.updateInfo);
    const isUpdateAvailable = result.isUpdateAvailable && admitted;
    if (isUpdateAvailable) {
      this.downloadableUpdate = result.updateInfo;
      this.prepareUpdate(result.updateInfo);
    }
    return { ...result, isUpdateAvailable };
  }

  async downloadUpdate(targetVersion: string): Promise<void> {
    this.requestedDownloadVersions.push(targetVersion);
    const info = this.downloadableUpdate;
    if (!info) throw new Error("Please check update first");
    if (!this.holdsNextDownload) {
      this.finishUpdateDownload(info);
      return;
    }
    this.holdsNextDownload = false;
    await new Promise<void>((resolve, reject) => {
      this.heldDownload = {
        resolve: () => {
          this.heldDownload = null;
          this.finishUpdateDownload(info);
          resolve();
        },
        reject: (error) => {
          this.heldDownload = null;
          this.configuration?.onError(error);
          reject(error);
        },
      };
    });
  }

  holdQuitHandoff(): void {
    this.holdsQuitHandoff = true;
  }

  startQuitForUpdate(): void {
    this.configuration?.onBeforeQuitForUpdate();
  }

  quitAndInstall({ targetVersion, isSilent, isForceRunAfter }: AppUpdateInstallRequest): void {
    if (this.downloadedUpdate) {
      this.installedVersions.push(this.downloadedUpdate.version);
      this.installModes.push({ targetVersion, isSilent, isForceRunAfter });
      if (!this.holdsQuitHandoff) this.startQuitForUpdate();
    }
  }
}

function createService(input?: {
  now?: () => number;
  bucket?: () => Promise<number>;
  installsOnQuit?: boolean;
}) {
  const runtime = new FakeAppUpdateRuntime();
  const installHandoffDeadline = new AbortController();
  const publishedStates: AppUpdateState[] = [];
  const service = createAppUpdateService({
    runtime,
    isPackaged: () => true,
    now: input?.now ?? (() => Date.parse("2026-04-28T12:00:00.000Z")),
    bucket: input?.bucket ?? (async () => 0.99),
    createInstallHandoffDeadline: () => installHandoffDeadline.signal,
    installsOnQuit: input?.installsOnQuit ?? true,
    publishState: (state) => {
      publishedStates.push(state);
    },
  });
  return {
    runtime,
    service,
    publishedStates,
    expireInstallHandoff: () => installHandoffDeadline.abort(),
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function phaseOf(
  phase: AppUpdateState["phase"],
  targetVersion: string | null,
): ReturnType<typeof expect.objectContaining> {
  return expect.objectContaining({ phase, targetVersion });
}

async function checkManually(
  service: ReturnType<typeof createService>["service"],
): Promise<AppUpdateCheckResult> {
  return service.checkForAppUpdate({
    currentVersion: "1.2.3",
    releaseChannel: "stable",
    intent: "manual",
  });
}

async function prepareDownloadedUpdate(
  runtime: FakeAppUpdateRuntime,
  service: ReturnType<typeof createService>["service"],
): Promise<void> {
  runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
  await checkManually(service);
  await service.downloadUpdate();
}

const rolledOutUpdate = {
  version: "1.2.4",
  releaseDate: "2026-04-28T00:00:00.000Z",
  rolloutHours: 24,
};

describe("app update service — check", () => {
  it("does not expose automatic stable updates before the user is admitted to rollout", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });

    const result = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(result).toEqual({
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      body: null,
      date: null,
      errorMessage: null,
      state: phaseOf("none", null),
    });
  });

  it("exposes manual stable updates even before the user is admitted to rollout", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });

    const result = await checkManually(service);

    expect(result).toEqual({
      hasUpdate: true,
      readyToInstall: false,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      body: null,
      date: "2026-04-28T00:00:00.000Z",
      errorMessage: null,
      state: {
        revision: 1,
        phase: "available",
        targetVersion: "1.2.4",
        failure: null,
        progress: null,
        installsOnQuit: true,
      },
    });
  });

  it("finds an update without downloading it", async () => {
    const { runtime, service, publishedStates } = createService({ bucket: async () => 0 });
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });

    await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(runtime.requestedDownloadVersions).toEqual([]);
    expect(publishedStates).toEqual([phaseOf("available", "1.2.4")]);
  });

  it("keeps a manually admitted update after a rollout-gated automatic recheck", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);

    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    const result = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(result).toMatchObject({
      hasUpdate: true,
      readyToInstall: true,
      latestVersion: "1.2.4",
      state: { phase: "downloaded", targetVersion: "1.2.4" },
    });
  });

  it("keeps a manually admitted update available after a rollout-gated automatic recheck", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);

    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    const result = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(result).toMatchObject({
      hasUpdate: true,
      readyToInstall: false,
      latestVersion: "1.2.4",
      state: { phase: "available", targetVersion: "1.2.4" },
    });
  });

  it("clears a cached update when the manifest no longer contains it", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);

    runtime.nextCheck(null);
    const result = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(result.hasUpdate).toBe(false);
    expect(result.state).toEqual(phaseOf("none", null));
  });

  it("waits for an automatic poll before starting a manual rollout-bypassing check", async () => {
    const { runtime, service } = createService();
    const automaticCheck = runtime.deferNextCheck();
    const automaticPending = service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    const manualPending = checkManually(service);

    await Promise.resolve();
    expect(runtime.checkCount).toBe(1);

    automaticCheck.resolve({ isUpdateAvailable: false, updateInfo: rolledOutUpdate });
    await automaticPending;
    const manualResult = await manualPending;

    expect(runtime.checkCount).toBe(2);
    expect(manualResult.hasUpdate).toBe(true);
    expect(manualResult.latestVersion).toBe("1.2.4");
  });

  it("performs a fresh manual check when an update is already cached", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });

    await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    runtime.nextCheck({
      isUpdateAvailable: true,
      updateInfo: { ...rolledOutUpdate, version: "1.2.5" },
    });
    const result = await checkManually(service);

    expect(result).toMatchObject({
      hasUpdate: true,
      readyToInstall: false,
      latestVersion: "1.2.5",
      state: { phase: "available", targetVersion: "1.2.5" },
    });
  });

  it("replaces a downloaded update when a newer release is admitted", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    await prepareDownloadedUpdate(runtime, service);

    const newerUpdate = { ...rolledOutUpdate, version: "1.2.5" };
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: newerUpdate });
    const result = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(result).toMatchObject({
      hasUpdate: true,
      readyToInstall: false,
      latestVersion: "1.2.5",
      state: { phase: "available", targetVersion: "1.2.5" },
    });
  });

  it("trusts the runtime availability decision before comparing versions", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    runtime.nextCheck({ isUpdateAvailable: false, updateInfo: rolledOutUpdate });

    const result = await checkManually(service);

    expect(result).toEqual({
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      body: null,
      date: null,
      errorMessage: null,
      state: phaseOf("none", null),
    });
  });

  it("returns check errors so the renderer can show feedback", async () => {
    const { runtime, service } = createService();
    runtime.failNextCheck(new Error("network down"));

    const result = await checkManually(service);

    expect(result).toEqual({
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      body: null,
      date: null,
      errorMessage: "network down",
      state: phaseOf("none", null),
    });
  });

  it("performs a fresh retry after a failed check emits a runtime error", async () => {
    const { runtime, service } = createService();
    runtime.failNextCheckAndEmitRuntimeError(new Error("network down"));

    const firstResult = await checkManually(service);
    expect(firstResult.errorMessage).toBe("network down");

    runtime.nextCheck(null);
    const retryResult = await checkManually(service);

    expect(runtime.checkCount).toBe(2);
    expect(retryResult).toMatchObject({ hasUpdate: false, errorMessage: null });
  });

  it("does not replay runtime errors emitted by the active check to automatic consumers", async () => {
    const { runtime, service } = createService();
    runtime.failNextCheckAndEmitRuntimeError(new Error("network down"));

    const checkResult = await checkManually(service);
    expect(checkResult.errorMessage).toBe("network down");

    const automaticResult = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(runtime.checkCount).toBe(2);
    expect(automaticResult).toMatchObject({ hasUpdate: false, errorMessage: null });
  });

  it("does not cache runtime errors from overlapping active checks", async () => {
    const { runtime, service } = createService();
    const firstCheck = runtime.deferNextCheck();
    const firstPending = service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });
    const secondCheck = runtime.deferNextCheck();
    const secondPending = service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    firstCheck.resolve(null);
    await firstPending;

    runtime.failRuntime(new Error("network down"));
    secondCheck.reject(new Error("network down"));
    const secondResult = await secondPending;
    expect(secondResult.errorMessage).toBe("network down");

    runtime.nextCheck(null);
    const automaticResult = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(runtime.checkCount).toBe(3);
    expect(automaticResult).toMatchObject({ hasUpdate: false, errorMessage: null });
  });

  it("keeps a downloaded update ready when a manual check re-announces it", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);

    const recheck = runtime.deferNextCheck();
    const pending = checkManually(service);
    runtime.prepareUpdate(rolledOutUpdate);
    recheck.resolve({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    const result = await pending;

    expect(result).toMatchObject({
      hasUpdate: true,
      readyToInstall: true,
      latestVersion: "1.2.4",
      errorMessage: null,
      state: { phase: "downloaded", targetVersion: "1.2.4" },
    });
  });
});

describe("app update service — download", () => {
  it("downloads the found update and broadcasts each phase", async () => {
    const { runtime, service, publishedStates } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();

    const pending = service.downloadUpdate();
    await flushAsyncWork();
    expect(service.getState()).toEqual(phaseOf("downloading", "1.2.4"));

    runtime.completeDownload();
    const state = await pending;

    expect(runtime.requestedDownloadVersions).toEqual(["1.2.4"]);
    expect(state).toEqual(phaseOf("downloaded", "1.2.4"));
    expect(publishedStates).toEqual([
      phaseOf("available", "1.2.4"),
      phaseOf("downloading", "1.2.4"),
      phaseOf("downloaded", "1.2.4"),
    ]);
    expect(publishedStates.map((published) => published.revision)).toEqual([1, 2, 3]);
  });

  it("joins a download that is already running", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();

    const first = service.downloadUpdate();
    const second = service.downloadUpdate();
    await flushAsyncWork();
    runtime.completeDownload();
    const states = await Promise.all([first, second]);

    expect(runtime.requestedDownloadVersions).toEqual(["1.2.4"]);
    expect(states).toEqual([phaseOf("downloaded", "1.2.4"), phaseOf("downloaded", "1.2.4")]);
  });

  it("does not download again once the update is downloaded", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);

    await service.downloadUpdate();

    expect(runtime.requestedDownloadVersions).toEqual(["1.2.4"]);
  });

  it("does not download when no update has been found", async () => {
    const { runtime, service } = createService();

    const state = await service.downloadUpdate();

    expect(runtime.requestedDownloadVersions).toEqual([]);
    expect(state).toEqual(phaseOf("none", null));
  });

  it("reports the current state without querying the feed while downloading", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();
    const pending = service.downloadUpdate();
    await flushAsyncWork();

    const result = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(runtime.checkCount).toBe(1);
    expect(result).toMatchObject({
      hasUpdate: true,
      latestVersion: "1.2.4",
      state: { phase: "downloading", targetVersion: "1.2.4" },
    });
    runtime.completeDownload();
    await pending;
  });

  it("records each download progress event in the state and broadcasts it", async () => {
    const { runtime, service, publishedStates } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();

    const pending = service.downloadUpdate();
    await flushAsyncWork();
    expect(service.getState()).toMatchObject({ phase: "downloading", progress: null });

    const progress = {
      percent: 42,
      transferred: 43_411_046,
      total: 103_389_184,
      bytesPerSecond: 3_355_443,
    };
    runtime.reportDownloadProgress(progress);

    expect(publishedStates.at(-1)).toMatchObject({ phase: "downloading", progress });

    runtime.completeDownload();
    const state = await pending;
    expect(state).toMatchObject({ phase: "downloaded", progress: null });
  });

  it("starts a retried download without the previous attempt's progress", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();
    const first = service.downloadUpdate();
    await flushAsyncWork();
    runtime.reportDownloadProgress({
      percent: 80,
      transferred: 80,
      total: 100,
      bytesPerSecond: 10,
    });
    runtime.failDownload(new Error("socket hang up"));
    expect(await first).toMatchObject({ phase: "failed", progress: null });

    runtime.holdNextDownload();
    const retry = service.downloadUpdate();
    await flushAsyncWork();

    expect(service.getState()).toMatchObject({ phase: "downloading", progress: null });
    runtime.completeDownload();
    await retry;
  });

  it("ignores progress events that arrive outside a download", async () => {
    const { runtime, service, publishedStates } = createService();
    await prepareDownloadedUpdate(runtime, service);
    const publishedCount = publishedStates.length;

    runtime.reportDownloadProgress({
      percent: 100,
      transferred: 100,
      total: 100,
      bytesPerSecond: 10,
    });

    expect(publishedStates).toHaveLength(publishedCount);
    expect(service.getState()).toMatchObject({ phase: "downloaded", progress: null });
  });

  it("moves to failed with the download error", async () => {
    const { runtime, service, publishedStates } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();

    const pending = service.downloadUpdate();
    await flushAsyncWork();
    runtime.failDownload(new Error("sha512 checksum mismatch"));
    const state = await pending;

    expect(state).toMatchObject({
      phase: "failed",
      targetVersion: "1.2.4",
      failure: { action: "download", message: "sha512 checksum mismatch" },
    });
    expect(publishedStates.at(-1)).toEqual(state);
  });

  it("keeps a download failure through an automatic recheck of the same release", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();
    const pending = service.downloadUpdate();
    await flushAsyncWork();
    runtime.failDownload(new Error("sha512 checksum mismatch"));
    await pending;

    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    const result = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });

    expect(result.state).toMatchObject({
      phase: "failed",
      failure: { action: "download", message: "sha512 checksum mismatch" },
    });
  });

  it("clears a download failure on a manual check or a newer release", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);
    runtime.holdNextDownload();
    const pending = service.downloadUpdate();
    await flushAsyncWork();
    runtime.failDownload(new Error("sha512 checksum mismatch"));
    await pending;

    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    const manualResult = await checkManually(service);
    expect(manualResult.state).toMatchObject({ phase: "available", failure: null });

    runtime.holdNextDownload();
    const retry = service.downloadUpdate();
    await flushAsyncWork();
    runtime.failDownload(new Error("sha512 checksum mismatch"));
    await retry;

    runtime.nextCheck({
      isUpdateAvailable: true,
      updateInfo: { ...rolledOutUpdate, version: "1.2.5" },
    });
    const newerResult = await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });
    expect(newerResult.state).toMatchObject({
      phase: "available",
      targetVersion: "1.2.5",
      failure: null,
    });
  });
});

describe("app update service — install", () => {
  it("refuses to install an update that has not been downloaded, without downloading it", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);

    const result = await service.installUpdate({ currentVersion: "1.2.3" });

    expect(result).toEqual({
      installed: false,
      version: "1.2.3",
      message: "The update has not been downloaded yet.",
      failure: null,
    });
    expect(runtime.requestedDownloadVersions).toEqual([]);
    expect(runtime.installedVersions).toEqual([]);
    expect(service.getState()).toEqual(phaseOf("available", "1.2.4"));
  });

  it("installs the downloaded update without rechecking the feed", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);

    const result = await service.installUpdate({ currentVersion: "1.2.3" });

    expect(result.installed).toBe(true);
    expect(runtime.checkCount).toBe(1);
    expect(runtime.installModes).toEqual([
      { targetVersion: "1.2.4", isSilent: false, isForceRunAfter: true },
    ]);
  });

  it("broadcasts installing while the updater hands off", async () => {
    const { runtime, service, publishedStates } = createService();
    await prepareDownloadedUpdate(runtime, service);
    runtime.holdQuitHandoff();

    const pending = service.installUpdate({ currentVersion: "1.2.3" });
    await flushAsyncWork();

    expect(publishedStates.at(-1)).toEqual(phaseOf("installing", "1.2.4"));
    runtime.startQuitForUpdate();
    await pending;
    expect(service.getState()).toEqual(phaseOf("installing", "1.2.4"));
  });

  it("does not report the update as installed before the updater starts quitting", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);
    runtime.holdQuitHandoff();

    let settled = false;
    const pending = service.installUpdate({ currentVersion: "1.2.3" }).finally(() => {
      settled = true;
    });
    await flushAsyncWork();

    expect(runtime.installedVersions).toEqual(["1.2.4"]);
    expect(settled).toBe(false);

    runtime.startQuitForUpdate();
    await pending;
  });

  it("reports the app as restarting once the updater starts quitting", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);
    runtime.holdQuitHandoff();

    const pending = service.installUpdate({ currentVersion: "1.2.3" });
    await flushAsyncWork();
    runtime.startQuitForUpdate();

    await expect(pending).resolves.toEqual({
      installed: true,
      version: "1.2.4",
      message: "Update downloaded. The app will restart shortly.",
      failure: null,
    });
  });

  it("returns the updater error as the failure reason when it fails before quitting", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);
    runtime.holdQuitHandoff();

    const pending = service.installUpdate({ currentVersion: "1.2.3" });
    await flushAsyncWork();
    runtime.failRuntime(new Error("Code signature did not pass validation"));

    await expect(pending).resolves.toEqual({
      installed: false,
      version: "1.2.3",
      message: "Update failed: Code signature did not pass validation",
      failure: { reason: "updater-error", message: "Code signature did not pass validation" },
    });
    expect(service.getState()).toMatchObject({
      phase: "failed",
      targetVersion: "1.2.4",
      failure: {
        action: "install",
        reason: "updater-error",
        message: "Code signature did not pass validation",
      },
    });
  });

  it("fails the install when the updater never starts quitting before the deadline", async () => {
    const { runtime, service, expireInstallHandoff } = createService();
    await prepareDownloadedUpdate(runtime, service);
    runtime.holdQuitHandoff();

    const pending = service.installUpdate({ currentVersion: "1.2.3" });
    await flushAsyncWork();
    expireInstallHandoff();

    await expect(pending).resolves.toEqual({
      installed: false,
      version: "1.2.3",
      message: "Update failed: Timed out waiting for the updater to restart the app.",
      failure: { reason: "handoff-timeout" },
    });
    expect(service.getState()).toMatchObject({
      phase: "failed",
      failure: { action: "install", reason: "handoff-timeout" },
    });
  });

  it("fails the install when preparing to quit throws", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);

    const result = await service.installUpdate({ currentVersion: "1.2.3" }, async () => {
      throw new Error("daemon did not stop");
    });

    expect(result).toMatchObject({
      installed: false,
      failure: { reason: "updater-error", message: "daemon did not stop" },
    });
    expect(runtime.installedVersions).toEqual([]);
    expect(service.getState()).toMatchObject({ phase: "failed" });
  });

  it("settles every concurrent install request once the updater starts quitting", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);
    runtime.holdQuitHandoff();

    const first = service.installUpdate({ currentVersion: "1.2.3" });
    const second = service.installUpdate({ currentVersion: "1.2.3" });
    await flushAsyncWork();
    runtime.startQuitForUpdate();

    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.installed)).toEqual([true, true]);
  });
});

describe("app update service — install on quit", () => {
  it("installs the downloaded update silently when quitting", async () => {
    const { runtime, service } = createService();
    await prepareDownloadedUpdate(runtime, service);
    runtime.holdQuitHandoff();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });

    const installed = await service.installUpdateOnQuit({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      signal: new AbortController().signal,
    });

    expect(installed).toBe(true);
    expect(runtime.installModes).toEqual([
      { targetVersion: "1.2.4", isSilent: true, isForceRunAfter: false },
    ]);
  });

  it("installs nothing on quit when the user never downloaded an update", async () => {
    const { runtime, service } = createService();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    await checkManually(service);

    const installed = await service.installUpdateOnQuit({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      signal: new AbortController().signal,
    });

    expect(installed).toBe(false);
    expect(runtime.checkCount).toBe(1);
    expect(runtime.requestedDownloadVersions).toEqual([]);
    expect(runtime.installedVersions).toEqual([]);
  });

  it("does not install on quit where the platform skips it", async () => {
    const { runtime, service } = createService({ installsOnQuit: false });
    await prepareDownloadedUpdate(runtime, service);
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });

    const installed = await service.installUpdateOnQuit({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      signal: new AbortController().signal,
    });

    expect(installed).toBe(false);
    expect(runtime.installedVersions).toEqual([]);
    expect(service.getState().installsOnQuit).toBe(false);
  });

  it("does not download a newer release while quitting with an older download", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    await prepareDownloadedUpdate(runtime, service);

    runtime.nextCheck({
      isUpdateAvailable: true,
      updateInfo: { ...rolledOutUpdate, version: "1.2.5" },
    });
    const installed = await service.installUpdateOnQuit({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      signal: new AbortController().signal,
    });

    expect(installed).toBe(false);
    expect(runtime.requestedDownloadVersions).toEqual(["1.2.4"]);
    expect(runtime.installedVersions).toEqual([]);
  });

  it("does not install an older download while its replacement is still rolling out", async () => {
    const now = Date.parse("2026-04-28T12:00:00.000Z");
    const { runtime, service } = createService({ now: () => now, bucket: async () => 0.4 });
    const olderUpdate = {
      ...rolledOutUpdate,
      releaseDate: "2026-04-27T00:00:00.000Z",
    };
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: olderUpdate });
    await service.checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "automatic",
    });
    await service.downloadUpdate();

    runtime.nextCheck({
      isUpdateAvailable: true,
      updateInfo: {
        ...rolledOutUpdate,
        version: "1.2.5",
        releaseDate: "2026-04-28T12:00:00.000Z",
      },
    });
    const installed = await service.installUpdateOnQuit({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      signal: new AbortController().signal,
    });

    expect(installed).toBe(false);
    expect(runtime.installedVersions).toEqual([]);
  });

  it("does not install after quit-time revalidation expires", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    await prepareDownloadedUpdate(runtime, service);

    const deadline = new AbortController();
    deadline.abort();
    runtime.nextCheck({ isUpdateAvailable: true, updateInfo: rolledOutUpdate });
    const installed = await service.installUpdateOnQuit({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      signal: deadline.signal,
    });

    expect(installed).toBe(false);
    expect(runtime.installedVersions).toEqual([]);
  });

  it("does not install an unvalidated download when the quit-time check fails", async () => {
    const { runtime, service } = createService({ bucket: async () => 0 });
    await prepareDownloadedUpdate(runtime, service);

    runtime.failNextCheck(new Error("offline"));
    const installed = await service.installUpdateOnQuit({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      signal: new AbortController().signal,
    });

    expect(installed).toBe(false);
    expect(runtime.installedVersions).toEqual([]);
  });
});
