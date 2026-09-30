import type { TFunction } from "i18next";

/** 客户端自己生成的错误说明是「翻译键 + 参数」，由界面渲染；`{ text }` 是守护进程或运行时的原始错误，保持原文。 */
export type DaemonLifecycleText =
  | { key: string; params?: Record<string, string | DaemonLifecycleText> }
  | { text: string };

/** 本模块在运行时拼出的 `settings.host.daemon.lifecycleErrors.*` 键，测试逐个校验存在。 */
export const DAEMON_LIFECYCLE_ERROR_KEYS = [
  "restartAcknowledged",
  "restartUnacknowledged",
  "packageInstallFailed",
  "versionUnconfirmed",
  "versionMismatch",
  "unknownVersion",
  "identityChanged",
  "replacementTimeout",
  "nestedError",
] as const;

type DaemonLifecycleErrorKey = (typeof DAEMON_LIFECYCLE_ERROR_KEYS)[number];

function errorDescription(
  name: DaemonLifecycleErrorKey,
  params?: Record<string, string | DaemonLifecycleText>,
): Extract<DaemonLifecycleText, { key: string }> {
  return { key: `settings.host.daemon.lifecycleErrors.${name}`, ...(params ? { params } : {}) };
}

export class DaemonLifecycleError extends Error {
  readonly description: DaemonLifecycleText;

  constructor(description: Extract<DaemonLifecycleText, { key: string }>, options?: ErrorOptions) {
    super(description.key, options);
    this.name = "DaemonLifecycleError";
    this.description = description;
  }
}

export function describeDaemonLifecycleFailure(error: unknown): DaemonLifecycleText {
  if (error instanceof DaemonLifecycleError) return error.description;
  return { text: error instanceof Error ? error.message : String(error) };
}

export function renderDaemonLifecycleText(t: TFunction, text: DaemonLifecycleText): string {
  if ("text" in text) return text.text;
  const params = text.params
    ? Object.fromEntries(
        Object.entries(text.params).map(([name, value]) => [
          name,
          typeof value === "object" ? renderDaemonLifecycleText(t, value) : value,
        ]),
      )
    : undefined;
  return t(text.key, params);
}

// 嵌套进外层说明时保持 String(error) 的形状，英文仍带 "Error: " 前缀
function describeCause(error: unknown): DaemonLifecycleText {
  return error instanceof DaemonLifecycleError
    ? errorDescription("nestedError", { detail: error.description })
    : { text: String(error) };
}

interface WorkerStatus {
  pid: number;
  serverId: string;
  version: string | null;
}
interface StatusReader {
  getStatus: () => Promise<WorkerStatus>;
}

export interface SettingsDaemonRestartDeps extends StatusReader {
  restartServer: (reason: string) => Promise<unknown>;
}

/** Acknowledgment starts the wait; only a different ready worker completes it. */
export async function restartDaemonFromSettings(
  hostServerId: string,
  reason: string,
  deps: SettingsDaemonRestartDeps,
): Promise<void> {
  const previous = await readSelectedWorker(hostServerId, deps);
  let acknowledged = false;
  try {
    await deps.restartServer(reason);
    acknowledged = true;
  } catch (error) {
    if (!isReconnectFailure(error)) throw error;
  }
  try {
    await observeReplacement(previous, deps);
  } catch (error) {
    throw new DaemonLifecycleError(
      errorDescription(acknowledged ? "restartAcknowledged" : "restartUnacknowledged", {
        detail: describeCause(error),
      }),
      { cause: error },
    );
  }
}

export async function updateDaemonFromSettings(
  hostServerId: string,
  deps: StatusReader & {
    updateDaemon: () => Promise<{
      success: boolean;
      error: string | null;
      newVersion: string | null;
    }>;
  },
): Promise<{ workerVersion: string }> {
  const previous = await readSelectedWorker(hostServerId, deps);
  const installed = await deps.updateDaemon();
  if (!installed.success) {
    if (installed.error !== null) throw new Error(installed.error);
    throw new DaemonLifecycleError(errorDescription("packageInstallFailed"));
  }
  try {
    const worker = await observeReplacement(previous, deps);
    if (!worker.version || !installed.newVersion || worker.version !== installed.newVersion) {
      throw new DaemonLifecycleError(
        errorDescription("versionMismatch", {
          expected: installed.newVersion ?? errorDescription("unknownVersion"),
          observed: worker.version ?? errorDescription("unknownVersion"),
        }),
      );
    }
    return { workerVersion: worker.version };
  } catch (error) {
    throw new DaemonLifecycleError(
      errorDescription("versionUnconfirmed", { detail: describeCause(error) }),
      { cause: error },
    );
  }
}

async function readSelectedWorker(serverId: string, deps: StatusReader): Promise<WorkerStatus> {
  const worker = await deps.getStatus();
  if (worker.serverId !== serverId) {
    throw new DaemonLifecycleError(errorDescription("identityChanged"));
  }
  return worker;
}

async function observeReplacement(
  previous: WorkerStatus,
  deps: StatusReader,
): Promise<WorkerStatus> {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    try {
      const current = await readSelectedWorker(previous.serverId, deps);
      if (current.pid !== previous.pid) return current;
    } catch (error) {
      if (!isReconnectFailure(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new DaemonLifecycleError(errorDescription("replacementTimeout"));
}

function isReconnectFailure(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["DAEMON_CONNECTION_LOST", "DAEMON_REQUEST_TIMEOUT"].includes(String(error.code)),
  );
}
