import {
  rolloutManifestSchema,
  shouldAdmitAppUpdate,
  type AppReleaseChannel,
  type AppUpdateCheckIntent,
} from "./app-update-rollout.js";

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string;
  latestVersion: string;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
}

export type AppUpdateInstallFailure =
  | { reason: "handoff-timeout" }
  | { reason: "updater-error"; message: string };

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
  downloadAndInstallUpdate(
    input: {
      currentVersion: string;
      releaseChannel: AppReleaseChannel;
    },
    onBeforeQuit?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult>;
  installUpdateOnQuit(input: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    signal: AbortSignal;
  }): Promise<boolean>;
}

export interface AppUpdateServiceDeps {
  runtime: AppUpdateRuntime;
  isPackaged(): boolean;
  now(): number;
  bucket(): Promise<number>;
  createInstallHandoffDeadline(): AbortSignal;
  reportCheckError?(error: unknown): void;
  reportRuntimeError?(error: unknown): void;
  reportInstallError?(message: string): void;
}

function buildCheckResult(input: {
  currentVersion: string;
  hasUpdate: boolean;
  readyToInstall: boolean;
  info?: RuntimeUpdateInfo | null;
  errorMessage?: string | null;
}): AppUpdateCheckResult {
  const { currentVersion, hasUpdate, readyToInstall, info, errorMessage = null } = input;

  return {
    hasUpdate,
    readyToInstall,
    currentVersion,
    latestVersion: info?.version ?? currentVersion,
    body: typeof info?.releaseNotes === "string" ? info.releaseNotes : null,
    date: typeof info?.releaseDate === "string" ? info.releaseDate : null,
    errorMessage,
  };
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

function buildDeferredInstallResult(currentVersion: string): AppUpdateInstallResult {
  return buildNotInstalledResult(
    currentVersion,
    "Update validation timed out. The update will be installed later.",
  );
}

export function createAppUpdateService(deps: AppUpdateServiceDeps): AppUpdateService {
  let cachedUpdateInfo: RuntimeUpdateInfo | null = null;
  let downloadedUpdateVersion: string | null = null;
  let configuredReleaseChannel: AppReleaseChannel | null = null;
  let preparationError: { version: string; message: string } | null = null;
  let preparingUpdateVersion: string | null = null;
  let checkQueue: Promise<void> = Promise.resolve();
  const installHandoffWaiters = new Set<(outcome: InstallHandoffOutcome) => void>();

  function settleInstallHandoffs(outcome: InstallHandoffOutcome): void {
    for (const settle of installHandoffWaiters) settle(outcome);
  }

  function isReadyToInstallVersion(version: string): boolean {
    return downloadedUpdateVersion === version;
  }

  function clearUpdateState(): void {
    cachedUpdateInfo = null;
    downloadedUpdateVersion = null;
    preparationError = null;
    preparingUpdateVersion = null;
  }

  function buildPreviouslyAdmittedUpdateResult(
    currentVersion: string,
    checkedInfo: RuntimeUpdateInfo,
  ): AppUpdateCheckResult | null {
    const info = cachedUpdateInfo;
    if (!info || info.version === currentVersion || info.version !== checkedInfo.version) {
      return null;
    }

    return buildCheckResult({
      currentVersion,
      hasUpdate: true,
      readyToInstall: isReadyToInstallVersion(info.version),
      info,
      errorMessage: preparationError?.version === info.version ? preparationError.message : null,
    });
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
        const alreadyReady = downloadedUpdateVersion === info.version;
        cachedUpdateInfo = info;
        downloadedUpdateVersion = alreadyReady ? info.version : null;
        if (!alreadyReady && preparingUpdateVersion === null) {
          preparingUpdateVersion = info.version;
        }
      },
      onUpdateDownloaded(info) {
        // A superseded download can finish after a newer manifest check. Keep
        // the validated manifest as the install target in that case.
        cachedUpdateInfo ??= info;
        downloadedUpdateVersion = info.version;
        if (preparingUpdateVersion === info.version) {
          preparingUpdateVersion = null;
        }
        if (preparationError?.version === info.version) {
          preparationError = null;
        }
      },
      onBeforeQuitForUpdate() {
        settleInstallHandoffs({ started: true });
      },
      onError(error) {
        settleInstallHandoffs({
          started: false,
          failure: updaterErrorFailure(getErrorMessage(error)),
        });
        if (preparingUpdateVersion) {
          preparationError = {
            version: preparingUpdateVersion,
            message: getErrorMessage(error),
          };
          preparingUpdateVersion = null;
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
      return buildCheckResult({
        currentVersion,
        hasUpdate: false,
        readyToInstall: false,
      });
    }

    return runCheckExclusively(async () => {
      configureRuntime(releaseChannel, intent);

      try {
        const result = await deps.runtime.checkForUpdates();
        if (!result || !result.updateInfo) {
          clearUpdateState();
          return buildCheckResult({
            currentVersion,
            hasUpdate: false,
            readyToInstall: false,
          });
        }

        if (!result.isUpdateAvailable) {
          const admittedUpdate = buildPreviouslyAdmittedUpdateResult(
            currentVersion,
            result.updateInfo,
          );
          if (admittedUpdate) {
            return admittedUpdate;
          }

          clearUpdateState();
          return buildCheckResult({
            currentVersion,
            hasUpdate: false,
            readyToInstall: false,
          });
        }

        const info = result.updateInfo;
        const latestVersion = info.version;
        const hasUpdate = latestVersion !== currentVersion;

        if (hasUpdate) {
          cachedUpdateInfo = info;
          const errorMessage =
            preparationError?.version === latestVersion ? preparationError.message : null;
          if (!errorMessage) {
            preparationError = null;
          }
          return buildCheckResult({
            currentVersion,
            hasUpdate: true,
            readyToInstall: isReadyToInstallVersion(latestVersion),
            info,
            errorMessage,
          });
        }

        clearUpdateState();
        return buildCheckResult({
          currentVersion,
          hasUpdate: false,
          readyToInstall: false,
        });
      } catch (error) {
        deps.reportCheckError?.(error);
        return buildCheckResult({
          currentVersion,
          hasUpdate: false,
          readyToInstall: false,
          errorMessage: getErrorMessage(error),
        });
      }
    });
  }

  async function downloadAndInstallUpdate(
    {
      currentVersion,
      releaseChannel,
    }: {
      currentVersion: string;
      releaseChannel: AppReleaseChannel;
    },
    onBeforeQuit?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult> {
    if (!deps.isPackaged()) {
      return buildNotInstalledResult(
        currentVersion,
        "Auto-update is not available in development mode.",
      );
    }

    const check = await checkForAppUpdate({
      currentVersion,
      releaseChannel,
      intent: "manual",
    });
    if (!check.hasUpdate) {
      return check.errorMessage
        ? buildFailedInstallResult(currentVersion, updaterErrorFailure(check.errorMessage))
        : buildNotInstalledResult(currentVersion, "No update available.");
    }

    return installCachedUpdate(currentVersion, { onBeforeQuit, restart: true });
  }

  async function ensureUpdateDownloaded(
    readyVersion: string,
    signal?: AbortSignal,
  ): Promise<"ready" | "aborted" | "superseded"> {
    while (!isReadyToInstallVersion(readyVersion)) {
      if (signal?.aborted) return "aborted";
      if (cachedUpdateInfo?.version !== readyVersion) return "superseded";

      const attemptedVersion: string = preparingUpdateVersion ?? readyVersion;
      preparingUpdateVersion ??= readyVersion;
      try {
        await deps.runtime.downloadUpdate(attemptedVersion);
      } catch (error) {
        if (
          attemptedVersion !== readyVersion &&
          cachedUpdateInfo?.version === readyVersion &&
          !signal?.aborted
        ) {
          continue;
        }
        throw error;
      }

      // electron-updater can return an older, already-running download. Its
      // event clears that version, then the next iteration starts the newly
      // validated release instead of treating the stale artifact as ready.
      if (attemptedVersion === readyVersion && !isReadyToInstallVersion(readyVersion)) {
        downloadedUpdateVersion = readyVersion;
        preparingUpdateVersion = null;
      }
    }

    return signal?.aborted ? "aborted" : "ready";
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

  async function installCachedUpdate(
    currentVersion: string,
    {
      onBeforeQuit,
      signal,
      restart,
    }: {
      onBeforeQuit?: () => Promise<void>;
      signal?: AbortSignal;
      restart: boolean;
    },
  ): Promise<AppUpdateInstallResult> {
    if (!cachedUpdateInfo) {
      return buildNotInstalledResult(
        currentVersion,
        "No update available. Check for updates first.",
      );
    }

    const readyVersion = cachedUpdateInfo.version;
    if (signal?.aborted) {
      return buildDeferredInstallResult(currentVersion);
    }

    if (isReadyToInstallVersion(readyVersion)) {
      return performQuitAndInstall({
        currentVersion,
        targetVersion: readyVersion,
        onBeforeQuit,
        restart,
      });
    }

    try {
      const preparation = await ensureUpdateDownloaded(readyVersion, signal);
      if (preparation === "aborted") {
        return buildDeferredInstallResult(currentVersion);
      }
      if (preparation === "superseded") {
        return buildNotInstalledResult(
          currentVersion,
          "A newer update was found and will be installed later.",
        );
      }
      return await performQuitAndInstall({
        currentVersion,
        targetVersion: readyVersion,
        onBeforeQuit,
        restart,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      deps.reportInstallError?.(message);
      return buildFailedInstallResult(currentVersion, updaterErrorFailure(message));
    }
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
    if (!deps.isPackaged() || !downloadedUpdateVersion) {
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

    const result = await installCachedUpdate(currentVersion, { signal, restart: false });
    return result.installed;
  }

  return {
    checkForAppUpdate,
    downloadAndInstallUpdate,
    installUpdateOnQuit,
  };
}
