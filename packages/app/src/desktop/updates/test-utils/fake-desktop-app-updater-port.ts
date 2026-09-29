import type {
  DesktopAppUpdateCheckResult,
  DesktopAppUpdateCheckIntent,
  DesktopAppUpdateInstallResult,
  DesktopAppUpdateState,
} from "@/desktop/updates/desktop-updates";
import type { DesktopAppUpdaterPort } from "@/desktop/updates/desktop-app-updater";

interface RecordedCheck {
  intent: DesktopAppUpdateCheckIntent;
}

interface Deferred<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
}

export interface FakeDesktopAppUpdaterPort extends DesktopAppUpdaterPort {
  readonly recordedChecks: RecordedCheck[];
  readonly downloadCount: number;
  readonly cancelCount: number;
  readonly installCount: number;
  nextCheckResult(result: DesktopAppUpdateCheckResult): void;
  deferNextCheck(): Deferred<DesktopAppUpdateCheckResult>;
  failNextCheck(error: unknown): void;
  deferNextDownload(): Deferred<DesktopAppUpdateState>;
  failNextDownload(error: unknown): void;
  nextCancelResult(state: DesktopAppUpdateState): void;
  deferNextCancel(): Deferred<DesktopAppUpdateState>;
  failNextCancel(error: unknown): void;
  nextInstallResult(result: DesktopAppUpdateInstallResult): void;
  deferNextInstall(): Deferred<DesktopAppUpdateInstallResult>;
  failNextInstall(error: unknown): void;
  // 模拟主进程向所有窗口广播更新阶段。
  pushState(state: DesktopAppUpdateState): void;
}

type Outcome<T> =
  | { kind: "result"; result: T }
  | { kind: "error"; error: unknown }
  | { kind: "deferred"; promise: Promise<T> };

function createDeferred<T>(): { deferred: Deferred<T>; promise: Promise<T> } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { deferred: { resolve, reject }, promise };
}

async function settle<T>(outcome: Outcome<T> | undefined, fallback: () => T): Promise<T> {
  if (!outcome) return fallback();
  if (outcome.kind === "result") return outcome.result;
  if (outcome.kind === "error") throw outcome.error;
  return outcome.promise;
}

// 自增 revision，保证测试里后建的快照一定比先建的新；需要乱序时显式传 revision。
let nextRevision = 1;

export function buildFakeUpdateState(
  overrides: Partial<DesktopAppUpdateState> = {},
): DesktopAppUpdateState {
  const phase = overrides.phase ?? "none";
  return {
    revision: nextRevision++,
    phase,
    targetVersion: phase === "none" ? null : "1.2.3",
    failure: null,
    progress: null,
    installsOnQuit: true,
    ...overrides,
  };
}

export function buildFakeCheckResult(
  overrides: Partial<DesktopAppUpdateCheckResult> = {},
): DesktopAppUpdateCheckResult {
  return {
    hasUpdate: false,
    readyToInstall: false,
    currentVersion: null,
    latestVersion: null,
    body: null,
    date: null,
    errorMessage: null,
    state: overrides.state ?? buildFakeUpdateState(),
    ...overrides,
  };
}

export function buildFakeInstallResult(
  overrides: Partial<DesktopAppUpdateInstallResult> = {},
): DesktopAppUpdateInstallResult {
  return {
    installed: false,
    version: null,
    message: "Update completed.",
    failure: null,
    ...overrides,
  } as DesktopAppUpdateInstallResult;
}

export function createFakeDesktopAppUpdaterPort(): FakeDesktopAppUpdaterPort {
  const recordedChecks: RecordedCheck[] = [];
  const checkOutcomes: Outcome<DesktopAppUpdateCheckResult>[] = [];
  const downloadOutcomes: Outcome<DesktopAppUpdateState>[] = [];
  const cancelOutcomes: Outcome<DesktopAppUpdateState>[] = [];
  const installOutcomes: Outcome<DesktopAppUpdateInstallResult>[] = [];
  const stateListeners = new Set<(state: DesktopAppUpdateState) => void>();
  let downloadCount = 0;
  let cancelCount = 0;
  let installCount = 0;

  return {
    recordedChecks,
    get downloadCount() {
      return downloadCount;
    },
    get cancelCount() {
      return cancelCount;
    },
    get installCount() {
      return installCount;
    },
    nextCheckResult(result) {
      checkOutcomes.push({ kind: "result", result });
    },
    deferNextCheck() {
      const { deferred, promise } = createDeferred<DesktopAppUpdateCheckResult>();
      checkOutcomes.push({ kind: "deferred", promise });
      return deferred;
    },
    failNextCheck(error) {
      checkOutcomes.push({ kind: "error", error });
    },
    deferNextDownload() {
      const { deferred, promise } = createDeferred<DesktopAppUpdateState>();
      downloadOutcomes.push({ kind: "deferred", promise });
      return deferred;
    },
    failNextDownload(error) {
      downloadOutcomes.push({ kind: "error", error });
    },
    nextCancelResult(state) {
      cancelOutcomes.push({ kind: "result", result: state });
    },
    deferNextCancel() {
      const { deferred, promise } = createDeferred<DesktopAppUpdateState>();
      cancelOutcomes.push({ kind: "deferred", promise });
      return deferred;
    },
    failNextCancel(error) {
      cancelOutcomes.push({ kind: "error", error });
    },
    nextInstallResult(result) {
      installOutcomes.push({ kind: "result", result });
    },
    deferNextInstall() {
      const { deferred, promise } = createDeferred<DesktopAppUpdateInstallResult>();
      installOutcomes.push({ kind: "deferred", promise });
      return deferred;
    },
    failNextInstall(error) {
      installOutcomes.push({ kind: "error", error });
    },
    pushState(state) {
      for (const listener of stateListeners) listener(state);
    },
    async checkDesktopAppUpdate(input) {
      recordedChecks.push(input);
      return settle(checkOutcomes.shift(), () => buildFakeCheckResult());
    },
    async downloadDesktopAppUpdate() {
      downloadCount += 1;
      return settle(downloadOutcomes.shift(), () => buildFakeUpdateState({ phase: "downloaded" }));
    },
    async cancelDesktopAppUpdateDownload() {
      cancelCount += 1;
      return settle(cancelOutcomes.shift(), () => buildFakeUpdateState({ phase: "available" }));
    },
    async installDesktopAppUpdate() {
      installCount += 1;
      return settle(installOutcomes.shift(), () => buildFakeInstallResult());
    },
    subscribeToDesktopAppUpdateState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
  };
}
