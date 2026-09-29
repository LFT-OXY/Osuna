import type {
  DesktopAppUpdateCheckResult,
  DesktopAppUpdateCheckIntent,
  DesktopAppUpdateDownloadProgress,
  DesktopAppUpdateFailure,
  DesktopAppUpdateInstallResult,
  DesktopAppUpdateState,
} from "@/desktop/updates/desktop-updates";
import { i18n } from "@/i18n/i18next";

type CommandAction = "download" | "cancel" | "install";
type FailedAction = CommandAction | "check";

// 每个失败动作一个状态，状态文案和卡片按钮都由状态决定。
const FAILED_STATUS_BY_ACTION = {
  check: "check-failed",
  download: "download-failed",
  cancel: "cancel-failed",
  install: "install-failed",
} as const satisfies Record<FailedAction, string>;

type DesktopAppUpdateFailedStatus = (typeof FAILED_STATUS_BY_ACTION)[FailedAction];

export type DesktopAppUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | DesktopAppUpdateFailedStatus;

const FAILED_STATUSES: ReadonlySet<DesktopAppUpdateStatus> = new Set(
  Object.values(FAILED_STATUS_BY_ACTION),
);

// 取消失败时下载仍在继续，不引导去手动下载；其余失败说明自动更新走不通。
export function offersManualDownload(status: DesktopAppUpdateStatus): boolean {
  return isFailedStatus(status) && status !== "cancel-failed";
}

function isFailedStatus(status: DesktopAppUpdateStatus): status is DesktopAppUpdateFailedStatus {
  return FAILED_STATUSES.has(status);
}

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
  isCancellingDownload: boolean;
}

export interface DesktopAppUpdaterPort {
  checkDesktopAppUpdate(input: {
    intent: DesktopAppUpdateCheckIntent;
  }): Promise<DesktopAppUpdateCheckResult>;
  downloadDesktopAppUpdate(): Promise<DesktopAppUpdateState>;
  cancelDesktopAppUpdateDownload(): Promise<DesktopAppUpdateState>;
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

export interface DesktopAppUpdateCheckOptions {
  intent?: DesktopAppUpdateCheckIntent;
  silent?: boolean;
}

export interface DesktopAppUpdater {
  getSnapshot(): DesktopAppUpdaterSnapshot;
  subscribe(listener: () => void): () => void;
  // 订阅主进程推送的更新阶段，返回取消订阅函数。
  connect(): () => void;
  checkForUpdates(
    options?: DesktopAppUpdateCheckOptions,
  ): Promise<DesktopAppUpdateCheckResult | null>;
  downloadUpdate(): Promise<DesktopAppUpdateState | null>;
  cancelDownload(): Promise<DesktopAppUpdateState | null>;
  installUpdate(): Promise<DesktopAppUpdateInstallResult | null>;
  retry(): Promise<void>;
  hide(): void;
}

interface ResolvedFailure<Action extends FailedAction = FailedAction> {
  action: Action;
  message: string;
}

interface InternalState {
  // 主进程快照的镜像，更新阶段以它为准。
  mirror: DesktopAppUpdateState;
  check: "idle" | "checking" | "checked";
  // 手动检查失败；不遮住下载中、已下载、安装中的阶段，主进程阶段变化时清掉。
  checkError: string | null;
  // 下载、取消或安装命令本身抛错；下一次动作、非静默检查，或主进程阶段变化时清掉。
  actionError: ResolvedFailure<CommandAction> | null;
  // 命令已发出、主进程快照还没跟上时，先显示对应阶段。
  pendingAction: CommandAction | null;
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

function describeFailure(failure: DesktopAppUpdateFailure): string {
  if (failure.action === "install" && failure.reason === "handoff-timeout") {
    return i18n.t("desktop.updates.installTimedOut");
  }
  return failure.message || i18n.t("desktop.updates.callout.genericError");
}

// 卡片只显示一个失败，文案和「重试」出自同一来源。后发生的优先：本窗口命令报错，
// 再是手动检查失败（它比主进程已有的失败新，过期的在阶段变化时已清掉），最后是主进程的失败。
function resolveFailure(state: InternalState): ResolvedFailure | null {
  if (state.actionError !== null) return state.actionError;
  const { phase, failure } = state.mirror;
  const isCheckErrorVisible = phase === "none" || phase === "available" || phase === "failed";
  if (state.checkError !== null && isCheckErrorVisible) {
    return { action: "check", message: state.checkError };
  }
  if (phase !== "failed") return null;
  return { action: failure.action, message: describeFailure(failure) };
}

function deriveStatus(
  state: InternalState,
  failure: ResolvedFailure | null,
): DesktopAppUpdateStatus {
  if (state.check === "checking") return "checking";
  // 命令报错时 pendingAction 已清空，失败由下面的 failure 给出。
  if (state.pendingAction === "install") return "installing";

  const { mirror } = state;
  const isDownloadRequested =
    state.pendingAction === "download" &&
    (mirror.phase === "available" || mirror.phase === "failed");
  if (isDownloadRequested) return "downloading";
  if (failure !== null) return FAILED_STATUS_BY_ACTION[failure.action];
  switch (mirror.phase) {
    case "available":
    case "downloading":
    case "downloaded":
    case "installing":
      return mirror.phase;
    case "failed":
      return FAILED_STATUS_BY_ACTION[mirror.failure.action];
    case "none":
      return state.check === "checked" ? "up-to-date" : "idle";
  }
}

function buildSnapshot(state: InternalState): DesktopAppUpdaterSnapshot {
  const { mirror } = state;
  const failure = resolveFailure(state);
  const status = deriveStatus(state, failure);
  const downloadProgress = status === "downloading" ? mirror.progress : null;
  // 已下载等阶段手动检查失败时，错误显示在阶段旁边。
  let errorMessage = state.checkError;
  if (isFailedStatus(status) && failure !== null) {
    errorMessage = failure.message;
  }
  return {
    status,
    targetVersion: mirror.targetVersion,
    installsOnQuit: mirror.installsOnQuit,
    downloadProgress,
    errorMessage,
    lastCheckedAt: state.lastCheckedAt,
    isHidden: state.isHidden,
    isCancellingDownload: status === "downloading" && state.pendingAction === "cancel",
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
  "check-failed": "desktop.updates.status.failed",
  "download-failed": "desktop.updates.status.downloadFailed",
  // 取消失败时下载仍在继续，不说「更新失败」。
  "cancel-failed": "desktop.updates.cancelDownloadError",
  "install-failed": "desktop.updates.status.installFailed",
} as const satisfies Partial<Record<DesktopAppUpdateStatus, string>>;

// 向下取整：下载完成前不显示 100%。侧栏卡片和设置页共用这条规则。
export function toWholeDownloadPercent(progress: DesktopAppUpdateDownloadProgress): number {
  return Math.floor(Math.min(Math.max(progress.percent, 0), 100));
}

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
  downloadProgress: DesktopAppUpdateDownloadProgress | null;
  formatVersion: (version: string | null | undefined) => string;
  formatLastCheckedAt: (timestamp: number) => string;
}): string {
  const { status, targetVersion, lastCheckedAt, formatVersion, formatLastCheckedAt } = input;

  if (status === "downloading" && input.downloadProgress) {
    return i18n.t("desktop.updates.status.downloadingWithPercent", {
      percent: toWholeDownloadPercent(input.downloadProgress),
    });
  }

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
    // 进入失败时重新出现，保证错误能被看到；已在失败中的（例如自动检查保留的失败）保持隐藏。
    const entersFailure =
      isFailedStatus(buildSnapshot(next).status) && !isFailedStatus(cachedSnapshot.status);
    state = next;
    if (entersFailure) {
      state = { ...next, isHidden: false };
    }
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
    // 主进程已离开「发现更新」或失败（重试下载），下载请求就算落地了；之后回到「发现更新」
    // （被取消）或再次失败，不再显示下载中。
    const isDownloadRequestSettled =
      base.pendingAction === "download" && next.phase !== "available" && next.phase !== "failed";
    // 命令报错时主进程可能仍在推进（例如取消失败但下载继续）；阶段一变，本地错误就过期了。
    const hasPhaseChanged = next.phase !== base.mirror.phase;
    const pendingAction = isDownloadRequestSettled ? null : base.pendingAction;
    const actionError = hasPhaseChanged ? null : base.actionError;
    const checkError = hasPhaseChanged ? null : base.checkError;
    // 进入「已下载」时重新出现，不论之前在哪个阶段被收起。
    const isHidden = entersDownloaded ? false : base.isHidden;
    return { ...base, mirror: next, pendingAction, actionError, checkError, isHidden };
  }

  function withCheckResult(
    base: InternalState,
    result: DesktopAppUpdateCheckResult,
    { silent }: { silent: boolean },
  ): InternalState {
    // 结果比已镜像的快照旧时，它带的检查错误也比之后推来的失败旧，不再顶替。
    const isStaleResult = result.state.revision < base.mirror.revision;
    // 静默检查不抹掉本地错误，它们在下一次动作、手动检查或阶段变化时过期。
    const keepsCheckError = silent || isStaleResult;
    const next = withMirror(base, result.state);
    const checkError = keepsCheckError ? next.checkError : result.errorMessage;
    const actionError = silent ? next.actionError : null;
    // 手动检查发现新版本时重新出现，即使之前点过「稍后」。下载中的检查不访问更新源，
    // 只返回当前快照，不算发现：下载中被收起的卡片仍等下完再出现。
    const isFoundByManualCheck =
      !silent && result.hasUpdate && result.state.phase !== "downloading";
    const isHidden = isFoundByManualCheck ? false : next.isHidden;
    return { ...next, checkError, actionError, isHidden };
  }

  function applyMirror(next: DesktopAppUpdateState): void {
    const updated = withMirror(state, next);
    if (updated !== state) {
      commit(updated);
    }
  }

  async function checkForUpdates({
    intent = "manual",
    silent = false,
  }: DesktopAppUpdateCheckOptions = {}): Promise<DesktopAppUpdateCheckResult | null> {
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
      const result = await deps.port.checkDesktopAppUpdate({ intent });
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

      commit({ ...withCheckResult(state, result, { silent }), check: "checked", lastCheckedAt });
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
    // 用户发起下载（例如在设置页）时重新出现，离开设置页后在侧栏卡片继续看进度。
    commit({
      ...state,
      pendingAction: "download",
      actionError: null,
      checkError: null,
      isHidden: false,
    });

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
      commit({
        ...state,
        pendingAction: null,
        actionError: { action: "download", message: getErrorMessage(error) },
      });
      return null;
    }
  }

  async function cancelDownload(): Promise<DesktopAppUpdateState | null> {
    commit({ ...state, pendingAction: "cancel", actionError: null, checkError: null });

    try {
      const next = await deps.port.cancelDesktopAppUpdateDownload();
      commit({ ...withMirror(state, next), pendingAction: null });
      return next;
    } catch (error) {
      deps.reportError?.({
        error,
        message: i18n.t("desktop.updates.cancelDownloadError"),
        logLabel: "[DesktopUpdater] Failed to cancel app update download",
      });
      commit({
        ...state,
        pendingAction: null,
        actionError: { action: "cancel", message: getErrorMessage(error) },
      });
      return null;
    }
  }

  async function installUpdate(): Promise<DesktopAppUpdateInstallResult | null> {
    commit({ ...state, pendingAction: "install", actionError: null, checkError: null });

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
      commit({
        ...state,
        pendingAction: null,
        actionError: { action: "install", message: getErrorMessage(error) },
      });
      return null;
    }
  }

  const retryByAction: Record<FailedAction, () => Promise<unknown>> = {
    check: () => checkForUpdates(),
    download: downloadUpdate,
    cancel: cancelDownload,
    install: installUpdate,
  };

  async function retry(): Promise<void> {
    if (!isFailedStatus(cachedSnapshot.status)) {
      return;
    }
    const failure = resolveFailure(state);
    if (failure !== null) {
      await retryByAction[failure.action]();
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
    cancelDownload,
    installUpdate,
    retry,
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
  timer: IntervalTimer;
}): () => void {
  const { updater, timer } = input;
  const check = () => {
    void updater.checkForUpdates({ intent: "automatic", silent: true });
  };

  check();
  return timer.every(AUTOMATIC_CHECK_INTERVAL_MS, check);
}
