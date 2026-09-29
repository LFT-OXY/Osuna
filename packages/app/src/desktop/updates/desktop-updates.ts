import { isElectronRuntime } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { isWeb } from "@/constants/platform";
import { openExternalUrl } from "@/utils/open-external-url";

export type DesktopAppUpdateInstallFailure =
  | { reason: "handoff-timeout" }
  | { reason: "updater-error"; message: string };

export type DesktopAppUpdatePhase =
  | "none"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "failed";

export type DesktopAppUpdateFailure =
  | { action: "download"; message: string }
  | ({ action: "install" } & DesktopAppUpdateInstallFailure);

// percent 是 0–100；差量下载时 total 可能小于完整安装包。
export interface DesktopAppUpdateDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

// 主进程持有的更新阶段快照（features/app-update-service.ts 的 AppUpdateState）。
export interface DesktopAppUpdateState {
  revision: number;
  phase: DesktopAppUpdatePhase;
  targetVersion: string | null;
  failure: DesktopAppUpdateFailure | null;
  progress: DesktopAppUpdateDownloadProgress | null;
  installsOnQuit: boolean;
}

export interface DesktopAppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
  state: DesktopAppUpdateState;
}

// failure 为 null 的未安装结果是正常情况（无更新、稍后安装等），不是安装失败。
export type DesktopAppUpdateInstallResult =
  | { installed: true; version: string | null; message: string; failure: null }
  | {
      installed: false;
      version: string | null;
      message: string;
      failure: DesktopAppUpdateInstallFailure | null;
    };

export interface DesktopRuntimeInfo {
  appVersion: string | null;
  runningUnderARM64Translation: boolean;
}

export type DesktopReleaseChannel = "stable" | "beta";
export type DesktopAppUpdateCheckIntent = "automatic" | "manual";

export interface LocalDaemonUpdateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LocalDaemonVersionResult {
  version: string | null;
  error: string | null;
}

const DESKTOP_RELEASES_URL = "https://github.com/LFT-OXY/Osuna/releases";
const RELEASE_DOWNLOAD_BASE_URL = `${DESKTOP_RELEASES_URL}/download`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumberOr(defaultValue: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
}

export function shouldShowDesktopUpdateSection(): boolean {
  return isWeb && isElectronRuntime();
}

export function parseLocalDaemonVersionResult(raw: unknown): LocalDaemonVersionResult {
  if (!isRecord(raw)) {
    return { version: null, error: "Unexpected response from version check." };
  }

  return {
    version: toStringOrNull(raw.version),
    error: toStringOrNull(raw.error),
  };
}

export async function getLocalDaemonVersion(): Promise<LocalDaemonVersionResult> {
  const result = await invokeDesktopCommand<unknown>("get_local_daemon_version");
  return parseLocalDaemonVersionResult(result);
}

export function parseDesktopRuntimeInfo(raw: unknown): DesktopRuntimeInfo {
  if (!isRecord(raw)) {
    return {
      appVersion: null,
      runningUnderARM64Translation: false,
    };
  }

  return {
    appVersion: toStringOrNull(raw.appVersion),
    runningUnderARM64Translation: raw.runningUnderARM64Translation === true,
  };
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo> {
  const result = await invokeDesktopCommand<unknown>("desktop_get_runtime_info");
  return parseDesktopRuntimeInfo(result);
}

const DESKTOP_APP_UPDATE_PHASES: ReadonlySet<string> = new Set<DesktopAppUpdatePhase>([
  "none",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "failed",
]);

function isDesktopAppUpdatePhase(value: unknown): value is DesktopAppUpdatePhase {
  return typeof value === "string" && DESKTOP_APP_UPDATE_PHASES.has(value);
}

function parseUpdateFailure(raw: unknown): DesktopAppUpdateFailure | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.action === "download") {
    return { action: "download", message: toStringOrEmpty(raw.message) };
  }
  if (raw.action === "install") {
    const failure = parseInstallFailure(raw);
    return failure ? { action: "install", ...failure } : null;
  }
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseDownloadProgress(raw: unknown): DesktopAppUpdateDownloadProgress | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { percent, transferred, total, bytesPerSecond } = raw;
  if (
    !isFiniteNumber(percent) ||
    !isFiniteNumber(transferred) ||
    !isFiniteNumber(total) ||
    !isFiniteNumber(bytesPerSecond)
  ) {
    return null;
  }
  return { percent, transferred, total, bytesPerSecond };
}

export function parseDesktopAppUpdateState(raw: unknown): DesktopAppUpdateState | null {
  if (!isRecord(raw) || typeof raw.revision !== "number" || !isDesktopAppUpdatePhase(raw.phase)) {
    return null;
  }

  return {
    revision: raw.revision,
    phase: raw.phase,
    targetVersion: toStringOrNull(raw.targetVersion),
    failure: parseUpdateFailure(raw.failure),
    progress: parseDownloadProgress(raw.progress),
    installsOnQuit: raw.installsOnQuit === true,
  };
}

function requireDesktopAppUpdateState(raw: unknown, context: string): DesktopAppUpdateState {
  const state = parseDesktopAppUpdateState(raw);
  if (!state) {
    throw new Error(`Unexpected update state while ${context}.`);
  }
  return state;
}

export async function checkDesktopAppUpdate({
  releaseChannel,
  intent,
}: {
  releaseChannel: DesktopReleaseChannel;
  intent: DesktopAppUpdateCheckIntent;
}): Promise<DesktopAppUpdateCheckResult> {
  const result = await invokeDesktopCommand<unknown>("check_app_update", {
    releaseChannel,
    intent,
  });
  if (!isRecord(result)) {
    throw new Error("Unexpected response while checking desktop updates.");
  }

  return {
    hasUpdate: result.hasUpdate === true,
    readyToInstall: result.readyToInstall === true,
    currentVersion: toStringOrNull(result.currentVersion),
    latestVersion: toStringOrNull(result.latestVersion),
    body: toStringOrNull(result.body),
    date: toStringOrNull(result.date),
    errorMessage: toStringOrNull(result.errorMessage),
    state: requireDesktopAppUpdateState(result.state, "checking desktop updates"),
  };
}

export async function downloadDesktopAppUpdate(): Promise<DesktopAppUpdateState> {
  const result = await invokeDesktopCommand<unknown>("download_app_update");
  return requireDesktopAppUpdateState(result, "downloading the desktop update");
}

// 主进程每次更新阶段变化都会推送给所有窗口。
export function subscribeToDesktopAppUpdateState(
  listener: (state: DesktopAppUpdateState) => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  void (async () => {
    try {
      const dispose = await listenToDesktopEvent<unknown>("app-update-state", (raw) => {
        const state = parseDesktopAppUpdateState(raw);
        if (state) {
          listener(state);
        } else {
          console.warn("[DesktopUpdater] Ignoring malformed update state", raw);
        }
      });
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    } catch (error) {
      console.warn("[DesktopUpdater] Failed to subscribe to update state", error);
    }
  })();

  return () => {
    disposed = true;
    unlisten?.();
  };
}

function parseInstallFailure(raw: unknown): DesktopAppUpdateInstallFailure | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.reason === "handoff-timeout") {
    return { reason: "handoff-timeout" };
  }
  return { reason: "updater-error", message: toStringOrNull(raw.message) ?? "" };
}

export async function installDesktopAppUpdate(): Promise<DesktopAppUpdateInstallResult> {
  const result = await invokeDesktopCommand<unknown>("install_app_update");
  if (!isRecord(result)) {
    throw new Error("Unexpected response while installing desktop update.");
  }

  const version = toStringOrNull(result.version);
  const message = toStringOrEmpty(result.message);
  if (result.installed === true) {
    return { installed: true, version, message, failure: null };
  }
  return { installed: false, version, message, failure: parseInstallFailure(result.failure) };
}

export function openDesktopReleasesPage(): void {
  void openExternalUrl(DESKTOP_RELEASES_URL);
}

export async function runLocalDaemonUpdate(): Promise<LocalDaemonUpdateResult> {
  const result = await invokeDesktopCommand<unknown>("run_local_daemon_update");
  if (!isRecord(result)) {
    throw new Error("Unexpected response while updating local daemon.");
  }

  return {
    exitCode: toNumberOr(1, result.exitCode),
    stdout: toStringOrEmpty(result.stdout),
    stderr: toStringOrEmpty(result.stderr),
  };
}

export function normalizeVersionForComparison(version: string | null | undefined): string | null {
  const value = version?.trim();
  if (!value) {
    return null;
  }

  return value.replace(/^v/i, "");
}

export function isVersionMismatch(
  appVersion: string | null | undefined,
  daemonVersion: string | null | undefined,
): boolean {
  const app = normalizeVersionForComparison(appVersion);
  const daemon = normalizeVersionForComparison(daemonVersion);

  if (!app || !daemon) {
    return false;
  }

  return app !== daemon;
}

export function formatVersionWithPrefix(version: string | null | undefined): string {
  const value = version?.trim();
  if (!value) {
    return "\u2014";
  }

  return value.startsWith("v") ? value : `v${value}`;
}

export function buildMacAppleSiliconDownloadUrl(version: string | null | undefined): string | null {
  const normalizedVersion = normalizeVersionForComparison(version);
  if (!normalizedVersion) {
    return null;
  }

  return `${RELEASE_DOWNLOAD_BASE_URL}/v${normalizedVersion}/Osuna-${normalizedVersion}-arm64.dmg`;
}

export function buildDaemonUpdateDiagnostics(result: LocalDaemonUpdateResult): string {
  const stdout = result.stdout.length > 0 ? result.stdout : "(empty)";
  const stderr = result.stderr.length > 0 ? result.stderr : "(empty)";

  return [`Exit code: ${result.exitCode}`, "", "STDOUT:", stdout, "", "STDERR:", stderr].join("\n");
}
