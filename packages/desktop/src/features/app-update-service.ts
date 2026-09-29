import {
  rolloutManifestSchema,
  shouldAdmitAppUpdate,
  type AppReleaseChannel,
  type AppUpdateCheckIntent,
} from "./app-update-rollout.js";

export type AppUpdateInstallFailure =
  | { reason: "handoff-timeout" }
  | { reason: "updater-error"; message: string };

export type AppUpdatePhase =
  | "none"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "failed";

export type AppUpdateFailure =
  | { action: "download"; message: string }
  | ({ action: "install" } & AppUpdateInstallFailure);

// 主进程是更新阶段的唯一事实来源；revision 单调递增，渲染进程据此丢弃过期快照。
export interface AppUpdateState {
  revision: number;
  phase: AppUpdatePhase;
  targetVersion: string | null;
  failure: AppUpdateFailure | null;
  installsOnQuit: boolean;
}

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string;
  latestVersion: string;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
  state: AppUpdateState;
}

// failure 为 null 的未安装结果是正常情况（无更新、稍后安装等），不是安装失败。
export type AppUpdateInstallResult =
  | { installed: true; version: string; message: string; failure: null }
  | {
      installed: false;
      version: string;
      message: string;
      failure: AppUpdateInstallFailure | null;
    };

export interface RuntimeUpdateInfo {
  version: string;
  releaseNotes?: unknown;
  releaseDate?: unknown;
  rolloutHours?: unknown;
}

export interface RuntimeUpdateCheckResult {
  isUpdateAvailable: boolean;
  updateInfo: RuntimeUpdateInfo;
}

export interface AppUpdateRuntimeConfiguration {
  releaseChannel: AppReleaseChannel;
  shouldAdmitUpdate(info: RuntimeUpdateInfo): boolean | Promise<boolean>;
  onUpdateAvailable(info: RuntimeUpdateInfo): void;
  onUpdateDownloaded(info: RuntimeUpdateInfo): void;
  onBeforeQuitForUpdate(): void;
  onError(error: unknown): void;
}

export interface AppUpdateInstallRequest {
  targetVersion: string;
  isSilent: boolean;
  isForceRunAfter: boolean;
}

export interface AppUpdateRuntime {
  configure(input: AppUpdateRuntimeConfiguration): void;
  checkForUpdates(): Promise<RuntimeUpdateCheckResult | null>;
  downloadUpdate(targetVersion: string): Promise<unknown>;
  quitAndInstall(input: AppUpdateInstallRequest): void;
}

export interface AppUpdateService {
  checkForAppUpdate(input: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    intent: AppUpdateCheckIntent;
  }): Promise<AppUpdateCheckResult>;
  downloadUpdate(): Promise<AppUpdateState>;
  installUpdate(
    input: { currentVersion: string },
    onBeforeQuit?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult>;
  installUpdateOnQuit(input: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    signal: AbortSignal;
  }): Promise<boolean>;
  getState(): AppUpdateState;
}

export interface AppUpdateServiceDeps {
  runtime: AppUpdateRuntime;
  isPackaged(): boolean;
  now(): number;
  bucket(): Promise<number>;
  createInstallHandoffDeadline(): AbortSignal;
  // 当前平台是否会在退出 App 时安装已下载的更新（Linux AppImage 不会）。
  installsOnQuit: boolean;
  publishState?(state: AppUpdateState): void;
  reportCheckError?(error: unknown): void;
  reportRuntimeError?(error: unknown): void;
  reportDownloadError?(message: string): void;
  reportInstallError?(message: string): void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

type InstallHandoffOutcome =
  | { started: true }
  | { started: false; failure: AppUpdateInstallFailure };

function describeInstallFailure(failure: AppUpdateInstallFailure): string {
  return failure.reason === "handoff-timeout"
    ? "Timed out waiting for the updater to restart the app."
    : failure.message;
}

function buildNotInstalledResult(currentVersion: string, message: string): AppUpdateInstallResult {
  return { installed: false, version: currentVersion, message, failure: null };
}

function buildFailedInstallResult(
  currentVersion: string,
  failure: AppUpdateInstallFailure,
): AppUpdateInstallResult {
  return {
    installed: false,
    version: currentVersion,
    message: `Update failed: ${describeInstallFailure(failure)}`,
    failure,
  };
}

function updaterErrorFailure(message: string): AppUpdateInstallFailure {
  return { reason: "updater-error", message };
}

function isSameFailure(a: AppUpdateFailure | null, b: AppUpdateFailure | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createAppUpdateService(deps: AppUpdateServiceDeps): AppUpdateService {
  let cachedUpdateInfo: RuntimeUpdateInfo | null = null;
  let downloadedUpdateVersion: string | null = null;
  let downloadingVersion: string | null = null;
  let activeDownload: Promise<void> | null = null;
  let isInstalling = false;
  let lastFailure: { version: string; detail: AppUpdateFailure } | null = null;
  let configuredReleaseChannel: AppReleaseChannel | null = null;
  let checkQueue: Promise<void> = Promise.resolve();
  let state: AppUpdateState = {
    revision: 0,
    phase: "none",
    targetVersion: null,
    failure: null,
    installsOnQuit: deps.installsOnQuit,
  };
  const installHandoffWaiters = new Set<(outcome: InstallHandoffOutcome) => void>();

  function settleInstallHandoffs(outcome: InstallHandoffOutcome): void {
    for (const settle of installHandoffWaiters) settle(outcome);
  }

  function isReadyToInstallVersion(version: string): boolean {
    return downloadedUpdateVersion === version;
  }

  function derivePhase(version: string): AppUpdatePhase {
    if (isInstalling) return "installing";
    if (downloadingVersion === version) return "downloading";
    if (lastFailure?.version === version) return "failed";
    if (isReadyToInstallVersion(version)) return "downloaded";
    return "available";
  }

  // 状态有变化才递增 revision 并广播，重复调用是安全的。
  function publishState(): AppUpdateState {
    const targetVersion = cachedUpdateInfo?.version ?? null;
    const phase = targetVersion ? derivePhase(targetVersion) : "none";
    const nextFailure = phase === "failed" && lastFailure ? lastFailure.detail : null;
    if (
      phase === state.phase &&
      targetVersion === state.targetVersion &&
      isSameFailure(nextFailure, state.failure)
    ) {
      return state;
    }
    state = {
      revision: state.revision + 1,
      phase,
      targetVersion,
      failure: nextFailure,
      installsOnQuit: deps.installsOnQuit,
    };
    deps.publishState?.(state);
    return state;
  }

  function buildCheckResult(input: {
    currentVersion: string;
    hasUpdate: boolean;
    info?: RuntimeUpdateInfo | null;
    errorMessage?: string | null;
  }): AppUpdateCheckResult {
    const { currentVersion, hasUpdate, info, errorMessage = null } = input;
    const readyToInstall = hasUpdate && info != null && isReadyToInstallVersion(info.version);

    return {
      hasUpdate,
      readyToInstall,
      currentVersion,
      latestVersion: info?.version ?? currentVersion,
      body: typeof info?.releaseNotes === "string" ? info.releaseNotes : null,
      date: typeof info?.releaseDate === "string" ? info.releaseDate : null,
      errorMessage,
      state: publishState(),
    };
  }

  // 只有目标版本已下载完才返回它，安装和退出时安装都以此为准。
  function getDownloadedTargetVersion(): string | null {
    const version = cachedUpdateInfo?.version ?? null;
    return version !== null && isReadyToInstallVersion(version) ? version : null;
  }

  function clearUpdateState(): void {
    cachedUpdateInfo = null;
    downloadedUpdateVersion = null;
    lastFailure = null;
  }

  function buildNoUpdateResult(currentVersion: string): AppUpdateCheckResult {
    clearUpdateState();
    return buildCheckResult({ currentVersion, hasUpdate: false });
  }

  function buildPreviouslyAdmittedUpdateResult(
    currentVersion: string,
    checkedInfo: RuntimeUpdateInfo,
  ): AppUpdateCheckResult | null {
    const info = cachedUpdateInfo;
    if (!info || info.version === currentVersion || info.version !== checkedInfo.version) {
      return null;
    }

    return buildCheckResult({ currentVersion, hasUpdate: true, info });
  }

  function configureRuntime(releaseChannel: AppReleaseChannel, intent: AppUpdateCheckIntent): void {
    if (configuredReleaseChannel !== releaseChannel) {
      clearUpdateState();
      configuredReleaseChannel = releaseChannel;
    }

    deps.runtime.configure({
      releaseChannel,
      shouldAdmitUpdate: async (info) => {
        const parsed = rolloutManifestSchema.parse(info);
        return shouldAdmitAppUpdate({
          channel: releaseChannel,
          intent,
          rolloutHours: parsed.rolloutHours,
          releaseDate: parsed.releaseDate,
          now: deps.now(),
          bucket: await deps.bucket(),
        });
      },
      onUpdateAvailable(info) {
        cachedUpdateInfo = info;
        if (!isReadyToInstallVersion(info.version)) {
          downloadedUpdateVersion = null;
        }
        publishState();
      },
      onUpdateDownloaded(info) {
        cachedUpdateInfo ??= info;
        downloadedUpdateVersion = info.version;
        if (downloadingVersion === info.version) {
          downloadingVersion = null;
        }
        const isDownloadFailureForVersion =
          lastFailure?.version === info.version && lastFailure.detail.action === "download";
        if (isDownloadFailureForVersion) {
          lastFailure = null;
        }
        publishState();
      },
      onBeforeQuitForUpdate() {
        settleInstallHandoffs({ started: true });
      },
      onError(error) {
        settleInstallHandoffs({
          started: false,
          failure: updaterErrorFailure(getErrorMessage(error)),
        });
        if (downloadingVersion) {
          lastFailure = {
            version: downloadingVersion,
            detail: { action: "download", message: getErrorMessage(error) },
          };
          downloadingVersion = null;
          publishState();
        }
        deps.reportRuntimeError?.(error);
      },
    });
  }

  function runCheckExclusively<T>(check: () => Promise<T>): Promise<T> {
    const result = checkQueue.then(check, check);
    checkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function checkForAppUpdate({
    currentVersion,
    releaseChannel,
    intent,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    intent: AppUpdateCheckIntent;
  }): Promise<AppUpdateCheckResult> {
    if (!deps.isPackaged()) {
      return buildCheckResult({ currentVersion, hasUpdate: false });
    }

    return runCheckExclusively(async () => {
      // 下载或安装进行中不访问更新源，避免清单变化替换掉正在处理的目标版本。
      const busyTarget = downloadingVersion !== null || isInstalling ? cachedUpdateInfo : null;
      if (busyTarget) {
        return buildCheckResult({ currentVersion, hasUpdate: true, info: busyTarget });
      }

      configureRuntime(releaseChannel, intent);

      try {
        const result = await deps.runtime.checkForUpdates();
        if (!result || !result.updateInfo) {
          return buildNoUpdateResult(currentVersion);
        }

        if (!result.isUpdateAvailable) {
          return (
            buildPreviouslyAdmittedUpdateResult(currentVersion, result.updateInfo) ??
            buildNoUpdateResult(currentVersion)
          );
        }

        const info = result.updateInfo;
        if (info.version === currentVersion) {
          return buildNoUpdateResult(currentVersion);
        }

        cachedUpdateInfo = info;
        // 手动检查清掉上次失败，让用户重新开始；自动检查保留失败，错误不会悄悄消失。
        const isStaleFailure =
          lastFailure !== null && (lastFailure.version !== info.version || intent === "manual");
        if (isStaleFailure) {
          lastFailure = null;
        }
        return buildCheckResult({ currentVersion, hasUpdate: true, info });
      } catch (error) {
        deps.reportCheckError?.(error);
        return buildCheckResult({
          currentVersion,
          hasUpdate: false,
          errorMessage: getErrorMessage(error),
        });
      }
    });
  }

  function startDownload(): void {
    const info = cachedUpdateInfo;
    const shouldSkipDownload =
      !info || activeDownload !== null || isInstalling || isReadyToInstallVersion(info.version);
    if (shouldSkipDownload) {
      return;
    }

    const version = info.version;
    downloadingVersion = version;
    if (lastFailure?.version === version) {
      lastFailure = null;
    }
    publishState();

    activeDownload = runDownload(version).finally(() => {
      activeDownload = null;
      publishState();
    });
  }

  async function runDownload(version: string): Promise<void> {
    try {
      await deps.runtime.downloadUpdate(version);
      if (downloadingVersion === version) {
        downloadingVersion = null;
        downloadedUpdateVersion = version;
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (downloadingVersion === version) {
        downloadingVersion = null;
        lastFailure = { version, detail: { action: "download", message } };
      }
      deps.reportDownloadError?.(message);
    }
  }

  async function downloadUpdate(): Promise<AppUpdateState> {
    if (!deps.isPackaged()) {
      return state;
    }

    // 等进行中的检查结束再开始，下载的目标就是最近一次检查确认的版本。
    await runCheckExclusively(async () => {
      startDownload();
    });
    await activeDownload;
    return state;
  }

  // 需要重启的安装只有在更新器真正开始退出时才算成功：Squirrel.Mac 在 quitAndInstall
  // 返回之后才校验新包签名，校验失败只会发出 error 事件。
  function waitForInstallHandoff(): Promise<InstallHandoffOutcome> {
    const deadline = deps.createInstallHandoffDeadline();
    return new Promise((resolve) => {
      function settle(outcome: InstallHandoffOutcome): void {
        installHandoffWaiters.delete(settle);
        deadline.removeEventListener("abort", onDeadline);
        resolve(outcome);
      }
      function onDeadline(): void {
        settle({ started: false, failure: { reason: "handoff-timeout" } });
      }
      installHandoffWaiters.add(settle);
      if (deadline.aborted) onDeadline();
      else deadline.addEventListener("abort", onDeadline, { once: true });
    });
  }

  async function performQuitAndInstall({
    currentVersion,
    targetVersion,
    onBeforeQuit,
    restart,
  }: {
    currentVersion: string;
    targetVersion: string;
    onBeforeQuit?: () => Promise<void>;
    restart: boolean;
  }): Promise<AppUpdateInstallResult> {
    if (onBeforeQuit) await onBeforeQuit();
    const handoff = restart ? waitForInstallHandoff() : null;
    deps.runtime.quitAndInstall({
      targetVersion,
      isSilent: !restart,
      isForceRunAfter: restart,
    });
    const outcome = handoff ? await handoff : ({ started: true } as const);
    if (!outcome.started) {
      deps.reportInstallError?.(describeInstallFailure(outcome.failure));
      return buildFailedInstallResult(currentVersion, outcome.failure);
    }
    return {
      installed: true,
      version: targetVersion,
      message: "Update downloaded. The app will restart shortly.",
      failure: null,
    };
  }

  async function installUpdate(
    { currentVersion }: { currentVersion: string },
    onBeforeQuit?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult> {
    if (!deps.isPackaged()) {
      return buildNotInstalledResult(
        currentVersion,
        "Auto-update is not available in development mode.",
      );
    }

    // 只安装已下载的版本；未下载时不替用户开始下载。
    const targetVersion = getDownloadedTargetVersion();
    if (!targetVersion) {
      return buildNotInstalledResult(currentVersion, "The update has not been downloaded yet.");
    }

    isInstalling = true;
    if (lastFailure?.version === targetVersion) {
      lastFailure = null;
    }
    publishState();

    let result: AppUpdateInstallResult;
    try {
      result = await performQuitAndInstall({
        currentVersion,
        targetVersion,
        onBeforeQuit,
        restart: true,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      deps.reportInstallError?.(message);
      result = buildFailedInstallResult(currentVersion, updaterErrorFailure(message));
    }

    if (!result.installed) {
      isInstalling = false;
      if (result.failure) {
        lastFailure = { version: targetVersion, detail: { action: "install", ...result.failure } };
      }
      publishState();
    }
    return result;
  }

  async function installUpdateOnQuit({
    currentVersion,
    releaseChannel,
    signal,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    signal: AbortSignal;
  }): Promise<boolean> {
    if (!deps.installsOnQuit || !deps.isPackaged() || !downloadedUpdateVersion) {
      return false;
    }

    const check = await checkForAppUpdate({
      currentVersion,
      releaseChannel,
      intent: "automatic",
    });
    if (signal.aborted || !check.hasUpdate) {
      return false;
    }

    // 清单里出现了更新的版本时，不在退出途中替用户下载。
    const targetVersion = getDownloadedTargetVersion();
    if (!targetVersion) {
      return false;
    }

    const result = await performQuitAndInstall({
      currentVersion,
      targetVersion,
      restart: false,
    });
    return result.installed;
  }

  return {
    checkForAppUpdate,
    downloadUpdate,
    installUpdate,
    installUpdateOnQuit,
    getState: () => state,
  };
}
