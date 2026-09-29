import type {
  DesktopAppUpdateCheckResult,
  DesktopAppUpdateCheckIntent,
  DesktopAppUpdateDownloadProgress,
  DesktopAppUpdateFailure,
  DesktopAppUpdateInstallResult,
  DesktopAppUpdateState,
  DesktopReleaseChannel,
} from "@/desktop/updates/desktop-updates";
import { i18n } from "@/i18n/i18next";

export type DesktopAppUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "install-failed"
  | "error";

export const AUTOMATIC_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface DesktopAppUpdaterSnapshot {
  status: DesktopAppUpdateStatus;
  targetVersion: string | null;
  installsOnQuit: boolean;
  // 只在下载中有值；主进程的第一份进度到达前为 null。
  downloadProgress: DesktopAppUpdateDownloadProgress | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  // 本次运行内被「稍后」或 × 收起，只存在内存里，按窗口生效。
  isHidden: boolean;
}

export interface DesktopAppUpdaterPort {
  checkDesktopAppUpdate(input: {
    releaseChannel: DesktopReleaseChannel;
    intent: DesktopAppUpdateCheckIntent;
  }): Promise<DesktopAppUpdateCheckResult>;
  downloadDesktopAppUpdate(): Promise<DesktopAppUpdateState>;
  installDesktopAppUpdate(): Promise<DesktopAppUpdateInstallResult>;
  subscribeToDesktopAppUpdateState(listener: (state: DesktopAppUpdateState) => void): () => void;
}

export interface DesktopAppUpdaterErrorReport {
  error: unknown;
  message: string;
  logLabel: string;
}

export interface DesktopAppUpdaterDeps {
  port: DesktopAppUpdaterPort;
  now(): number;
  reportError?(report: DesktopAppUpdaterErrorReport): void;
}

export interface DesktopAppUpdater {
  getSnapshot(): DesktopAppUpdaterSnapshot;
  subscribe(listener: () => void): () => void;
  // 订阅主进程推送的更新阶段，返回取消订阅函数。
  connect(): () => void;
  checkForUpdates(options?: {
    releaseChannel: DesktopReleaseChannel;
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }): Promise<DesktopAppUpdateCheckResult | null>;
  downloadUpdate(): Promise<DesktopAppUpdateState | null>;
  installUpdate(): Promise<DesktopAppUpdateInstallResult | null>;
  hide(): void;
}

interface InternalState {
  // 主进程快照的镜像，更新阶段以它为准。
  mirror: DesktopAppUpdateState;
  check: "idle" | "checking" | "checked";
  // 手动检查失败；只在还没有可操作的更新时顶替阶段，不遮住已下载的安装入口。
  checkError: string | null;
  // 下载或安装命令本身抛错；下一次动作或非静默检查时清掉。
  actionError: string | null;
  // 命令已发出、主进程快照还没跟上时，先显示对应阶段。
  pendingAction: "download" | "install" | null;
  lastCheckedAt: number | null;
  isHidden: boolean;
  requestVersion: number;
}

const INITIAL_MIRROR: DesktopAppUpdateState = {
  revision: 0,
  phase: "none",
  targetVersion: null,
  failure: null,
  progress: null,
  installsOnQuit: false,
};

const INITIAL_STATE: InternalState = {
  mirror: INITIAL_MIRROR,
  check: "idle",
  checkError: null,
  actionError: null,
  pendingAction: null,
  lastCheckedAt: null,
  isHidden: false,
  requestVersion: 0,
};

function deriveStatus(state: InternalState): DesktopAppUpdateStatus {
  if (state.check === "checking") return "checking";
  if (state.actionError !== null) return "error";
  if (state.pendingAction === "install") return "installing";

  const { phase, failure } = state.mirror;
  // 下载一旦开始，检查失败不再顶替阶段，已下载的「安装」入口保持可见。
  const hasStartedDownload = phase !== "none" && phase !== "available";
  if (state.checkError !== null && !hasStartedDownload) return "error";
  switch (phase) {
    case "available":
      return state.pendingAction === "download" ? "downloading" : "available";
    case "downloading":
    case "downloaded":
    case "installing":
      return phase;
    case "failed":
      return failure?.action === "install" ? "install-failed" : "error";
    case "none":
      return state.check === "checked" ? "up-to-date" : "idle";
  }
}

function describeFailure(failure: DesktopAppUpdateFailure): string {
  if (failure.action === "install" && failure.reason === "handoff-timeout") {
    return i18n.t("desktop.updates.installTimedOut");
  }
  return failure.message || i18n.t("desktop.updates.callout.genericError");
}

function buildSnapshot(state: InternalState): DesktopAppUpdaterSnapshot {
  const { mirror } = state;
  const mirrorError = mirror.phase === "failed" && mirror.failure ? mirror.failure : null;
  const mirrorErrorMessage = mirrorError ? describeFailure(mirrorError) : null;
  const errorMessage = state.actionError ?? state.checkError ?? mirrorErrorMessage;
  const status = deriveStatus(state);
  return {
    status,
    targetVersion: mirror.targetVersion,
    installsOnQuit: mirror.installsOnQuit,
    downloadProgress: status === "downloading" ? mirror.progress : null,
    errorMessage,
    lastCheckedAt: state.lastCheckedAt,
    isHidden: state.isHidden,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

const FIXED_STATUS_TEXT_KEYS = {
  checking: "desktop.updates.status.checking",
  downloading: "desktop.updates.status.downloading",
  installing: "desktop.updates.status.installing",
  "install-failed": "desktop.updates.status.installFailed",
  error: "desktop.updates.status.failed",
} as const satisfies Partial<Record<DesktopAppUpdateStatus, string>>;

function isFixedTextStatus(
  status: DesktopAppUpdateStatus,
): status is keyof typeof FIXED_STATUS_TEXT_KEYS {
  return status in FIXED_STATUS_TEXT_KEYS;
}

const VERSIONED_STATUS_TEXT_KEYS = {
  available: {
    plain: "desktop.updates.status.available",
    withLastChecked: "desktop.updates.status.availableWithLastChecked",
    withVersion: "desktop.updates.status.availableWithVersion",
    withVersionAndLastChecked: "desktop.updates.status.availableWithVersionAndLastChecked",
  },
  downloaded: {
    plain: "desktop.updates.status.downloaded",
    withLastChecked: "desktop.updates.status.downloadedWithLastChecked",
    withVersion: "desktop.updates.status.downloadedWithVersion",
    withVersionAndLastChecked: "desktop.updates.status.downloadedWithVersionAndLastChecked",
  },
} as const;

export function formatStatusText(input: {
  status: DesktopAppUpdateStatus;
  targetVersion: string | null;
  lastCheckedAt: number | null;
  formatVersion: (version: string | null | undefined) => string;
  formatLastCheckedAt: (timestamp: number) => string;
}): string {
  const { status, targetVersion, lastCheckedAt, formatVersion, formatLastCheckedAt } = input;

  if (isFixedTextStatus(status)) {
    return i18n.t(FIXED_STATUS_TEXT_KEYS[status]);
  }

  if (status === "up-to-date") {
    if (lastCheckedAt != null) {
      return i18n.t("desktop.updates.status.upToDateWithLastChecked", {
        time: formatLastCheckedAt(lastCheckedAt),
      });
    }
    return i18n.t("desktop.updates.status.upToDate");
  }

  if (status === "available" || status === "downloaded") {
    const keys = VERSIONED_STATUS_TEXT_KEYS[status];
    const time = lastCheckedAt != null ? formatLastCheckedAt(lastCheckedAt) : undefined;
    if (targetVersion) {
      return i18n.t(time ? keys.withVersionAndLastChecked : keys.withVersion, {
        version: formatVersion(targetVersion),
        time,
      });
    }
    return time ? i18n.t(keys.withLastChecked, { time }) : i18n.t(keys.plain);
  }

  return i18n.t("desktop.updates.status.idle");
}

export function createDesktopAppUpdater(deps: DesktopAppUpdaterDeps): DesktopAppUpdater {
  let state: InternalState = { ...INITIAL_STATE };
  let cachedSnapshot: DesktopAppUpdaterSnapshot = buildSnapshot(state);
  const listeners = new Set<() => void>();

  function commit(next: InternalState): void {
    state = next;
    cachedSnapshot = buildSnapshot(state);
    for (const listener of listeners) {
      listener();
    }
  }

  // 按 revision 丢弃过期快照：命令返回值和推送事件可能乱序到达。
  function withMirror(base: InternalState, next: DesktopAppUpdateState): InternalState {
    if (next.revision < base.mirror.revision) {
      return base;
    }
    const entersDownloaded = next.phase === "downloaded" && base.mirror.phase !== "downloaded";
    return {
      ...base,
      mirror: next,
      // 进入「已下载」时重新出现，不论之前在哪个阶段被收起。
      isHidden: entersDownloaded ? false : base.isHidden,
    };
  }

  function applyMirror(next: DesktopAppUpdateState): void {
    const updated = withMirror(state, next);
    if (updated !== state) {
      commit(updated);
    }
  }

  async function checkForUpdates(options?: {
    releaseChannel: DesktopReleaseChannel;
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }): Promise<DesktopAppUpdateCheckResult | null> {
    if (!options) {
      return null;
    }
    const { releaseChannel, intent = "manual", silent = false } = options;
    if (silent && state.check === "checking") {
      return null;
    }

    const requestVersion = state.requestVersion + 1;

    commit({
      ...state,
      requestVersion,
      check: silent ? state.check : "checking",
      checkError: silent ? state.checkError : null,
      actionError: silent ? state.actionError : null,
    });

    try {
      const result = await deps.port.checkDesktopAppUpdate({ releaseChannel, intent });
      if (requestVersion !== state.requestVersion) {
        applyMirror(result.state);
        return result;
      }

      const lastCheckedAt = intent === "manual" ? deps.now() : state.lastCheckedAt;
      if (result.errorMessage && silent) {
        console.warn("[DesktopUpdater] Silent update check failed", result.errorMessage);
        applyMirror(result.state);
        return result;
      }

      commit({
        ...withMirror(state, result.state),
        check: "checked",
        checkError: result.errorMessage,
        actionError: null,
        lastCheckedAt,
      });
      return result;
    } catch (error) {
      if (requestVersion !== state.requestVersion) {
        return null;
      }

      const message = getErrorMessage(error);
      if (silent) {
        console.warn("[DesktopUpdater] Silent update check failed", message);
      } else {
        commit({
          ...state,
          check: "checked",
          checkError: message,
          lastCheckedAt: intent === "manual" ? deps.now() : state.lastCheckedAt,
        });
      }
      return null;
    }
  }

  async function downloadUpdate(): Promise<DesktopAppUpdateState | null> {
    commit({ ...state, pendingAction: "download", actionError: null });

    try {
      const next = await deps.port.downloadDesktopAppUpdate();
      commit({ ...withMirror(state, next), pendingAction: null });
      return next;
    } catch (error) {
      deps.reportError?.({
        error,
        message: i18n.t("desktop.updates.downloadError"),
        logLabel: "[DesktopUpdater] Failed to download app update",
      });
      commit({ ...state, pendingAction: null, actionError: getErrorMessage(error) });
      return null;
    }
  }

  async function installUpdate(): Promise<DesktopAppUpdateInstallResult | null> {
    commit({ ...state, pendingAction: "install", actionError: null });

    try {
      // 安装结果（含失败原因）随主进程快照推送过来，这里只收尾本地的等待状态。
      const result = await deps.port.installDesktopAppUpdate();
      commit({ ...state, pendingAction: null });
      return result;
    } catch (error) {
      deps.reportError?.({
        error,
        message: i18n.t("desktop.updates.installError"),
        logLabel: "[DesktopUpdater] Failed to install app update",
      });
      commit({ ...state, pendingAction: null, actionError: getErrorMessage(error) });
      return null;
    }
  }

  return {
    getSnapshot: () => cachedSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: () => deps.port.subscribeToDesktopAppUpdateState(applyMirror),
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    hide() {
      if (!state.isHidden) {
        commit({ ...state, isHidden: true });
      }
    },
  };
}

export interface IntervalTimer {
  every(intervalMs: number, run: () => void): () => void;
}

export const systemIntervalTimer: IntervalTimer = {
  every(intervalMs, run) {
    const intervalId = setInterval(run, intervalMs);
    return () => clearInterval(intervalId);
  },
};

// 每个窗口只启动一份，由 DesktopAppUpdaterProvider 负责。
export function startAutomaticUpdateChecks(input: {
  updater: DesktopAppUpdater;
  releaseChannel: DesktopReleaseChannel;
  timer: IntervalTimer;
}): () => void {
  const { updater, releaseChannel, timer } = input;
  const check = () => {
    void updater.checkForUpdates({ releaseChannel, intent: "automatic", silent: true });
  };

  check();
  return timer.every(AUTOMATIC_CHECK_INTERVAL_MS, check);
}
