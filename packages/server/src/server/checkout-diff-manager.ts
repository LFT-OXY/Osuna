import type pino from "pino";
import type { SubscribeCheckoutDiffRequest, SessionOutboundMessage } from "./messages.js";
import type {
  CheckoutDiffReadOptions,
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitService,
} from "./workspace-git-service.js";
import { expandTilde } from "../utils/path.js";
import { CheckoutDiffFileReuse } from "../utils/checkout-diff-file-reuse.js";
import { toCheckoutError } from "./checkout-git-utils.js";

const CHECKOUT_DIFF_WATCH_DEBOUNCE_MS = 150;
const CHECKOUT_DIFF_MIN_PUSH_INTERVAL_MS = 1000;

type CheckoutDiffWorkspace = Pick<
  WorkspaceGitService,
  | "getCheckoutDiff"
  | "getSnapshot"
  | "peekSnapshot"
  | "registerWorkspace"
  | "requestWorkingTreeWatch"
>;

export type CheckoutDiffCompareInput = SubscribeCheckoutDiffRequest["compare"];

export type CheckoutDiffSnapshotPayload = Omit<
  Extract<SessionOutboundMessage, { type: "checkout_diff_update" }>["payload"],
  "subscriptionId"
>;

export interface CheckoutDiffMetrics {
  checkoutDiffTargetCount: number;
  checkoutDiffSubscriptionCount: number;
  checkoutDiffWatcherCount: number;
  checkoutDiffFallbackRefreshTargetCount: number;
}

interface CheckoutDiffWatchTarget {
  key: string;
  cwd: string;
  diffCwd: string;
  compare: CheckoutDiffCompareInput;
  listeners: Set<(snapshot: CheckoutDiffSnapshotPayload) => void>;
  workingTreeWatchUnsubscribe: (() => void) | null;
  workspaceGitUnsubscribe: (() => void) | null;
  latestWorkspaceStructureFingerprint: string | null;
  latestWorkspaceWorktreeFingerprint: string | null;
  latestWorkspaceForgeFingerprint: string | null;
  debounceTimer: NodeJS.Timeout | null;
  pendingDebounceForce: boolean;
  throttleTimer: NodeJS.Timeout | null;
  pendingThrottleForce: boolean;
  lastRefreshStartedAt: number | null;
  lastPushAt: number | null;
  pushGapWait: { timer: NodeJS.Timeout; release: () => void } | null;
  refreshPromise: Promise<void> | null;
  refreshQueued: boolean;
  refreshQueuedForce: boolean;
  latestPayload: CheckoutDiffSnapshotPayload | null;
  latestFingerprint: string | null;
  openPromise: Promise<void> | null;
  // 按文件复用 patch 与高亮，随 target 关闭释放
  fileReuse: CheckoutDiffFileReuse;
}

export interface CheckoutDiffSubscriptionRequest {
  cwd: string;
  compare: CheckoutDiffCompareInput;
  signal?: AbortSignal;
}

export interface CheckoutDiffSubscription {
  initial: CheckoutDiffSnapshotPayload;
  unsubscribe: () => void;
}

function msUntilIntervalElapsed(lastAt: number | null): number {
  if (lastAt === null) {
    return 0;
  }
  return lastAt + CHECKOUT_DIFF_MIN_PUSH_INTERVAL_MS - Date.now();
}

export class CheckoutDiffManager {
  private readonly workspaceGitService: CheckoutDiffWorkspace;
  private readonly targets = new Map<string, CheckoutDiffWatchTarget>();

  constructor(options: {
    logger: pino.Logger;
    paseoHome: string;
    workspaceGitService: CheckoutDiffWorkspace;
  }) {
    this.workspaceGitService = options.workspaceGitService;
  }

  async read(
    params: Omit<CheckoutDiffSubscriptionRequest, "signal">,
  ): Promise<CheckoutDiffSnapshotPayload> {
    return this.computeCheckoutDiffSnapshot(params.cwd, this.normalizeCompare(params.compare));
  }

  async subscribe(
    params: CheckoutDiffSubscriptionRequest,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): Promise<CheckoutDiffSubscription> {
    const cwd = params.cwd;
    const compare = this.normalizeCompare(params.compare);
    const target = this.ensureTarget(cwd, compare);
    target.listeners.add(listener);
    target.openPromise ??= this.openTarget(target);

    let isSubscribed = true;
    const unsubscribe = () => {
      if (!isSubscribed) {
        return;
      }
      isSubscribed = false;
      params.signal?.removeEventListener("abort", unsubscribe);
      this.removeListener(target, listener);
    };
    params.signal?.addEventListener("abort", unsubscribe, { once: true });
    if (params.signal?.aborted) {
      unsubscribe();
    }

    try {
      await target.openPromise;
      const initial =
        target.latestPayload ??
        (await this.computeCheckoutDiffSnapshot(target.cwd, target.compare, {
          diffCwd: target.diffCwd,
          fileReuse: target.fileReuse,
        }));
      target.latestPayload = initial;
      target.latestFingerprint = JSON.stringify(initial);
      return { initial, unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  scheduleRefreshForCwd(cwd: string): void {
    const resolvedCwd = expandTilde(cwd);
    for (const target of this.targets.values()) {
      if (target.cwd !== resolvedCwd && target.diffCwd !== resolvedCwd) {
        continue;
      }
      this.scheduleTargetRefresh(target);
    }
  }

  getMetrics(): CheckoutDiffMetrics {
    let checkoutDiffSubscriptionCount = 0;

    for (const target of this.targets.values()) {
      checkoutDiffSubscriptionCount += target.listeners.size;
    }

    return {
      checkoutDiffTargetCount: this.targets.size,
      checkoutDiffSubscriptionCount,
      checkoutDiffWatcherCount: 0,
      checkoutDiffFallbackRefreshTargetCount: 0,
    };
  }

  dispose(): void {
    for (const target of this.targets.values()) {
      this.closeTarget(target);
    }
    this.targets.clear();
  }

  private normalizeCompare(compare: CheckoutDiffCompareInput): CheckoutDiffCompareInput {
    const ignoreWhitespace = compare.ignoreWhitespace === true;
    // 清单订阅与完整订阅各算各的：filesOnly 进 target key，各自缓存、各自推送
    const filesOnly = compare.filesOnly === true ? { filesOnly: true } : {};
    if (compare.mode === "uncommitted") {
      return { mode: "uncommitted", ignoreWhitespace, ...filesOnly };
    }
    const trimmedBaseRef = compare.baseRef?.trim();
    return trimmedBaseRef
      ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace, ...filesOnly }
      : { mode: "base", ignoreWhitespace, ...filesOnly };
  }

  private buildTargetKey(cwd: string, compare: CheckoutDiffCompareInput): string {
    return JSON.stringify([
      cwd,
      compare.mode,
      compare.mode === "base" ? (compare.baseRef ?? "") : "",
      compare.ignoreWhitespace === true,
      compare.filesOnly === true,
    ]);
  }

  private closeTarget(target: CheckoutDiffWatchTarget): void {
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
      target.debounceTimer = null;
    }
    if (target.throttleTimer) {
      clearTimeout(target.throttleTimer);
      target.throttleTimer = null;
    }
    if (target.pushGapWait) {
      clearTimeout(target.pushGapWait.timer);
      target.pushGapWait.release();
      target.pushGapWait = null;
    }
    target.workingTreeWatchUnsubscribe?.();
    target.workingTreeWatchUnsubscribe = null;
    target.workspaceGitUnsubscribe?.();
    target.workspaceGitUnsubscribe = null;
    target.listeners.clear();
    target.fileReuse.clear();
  }

  private rememberWorkspaceSnapshot(
    target: CheckoutDiffWatchTarget,
    snapshot: WorkspaceGitRuntimeSnapshot,
  ): void {
    const structureFingerprint = JSON.stringify({
      isGit: snapshot.git.isGit,
      repoRoot: snapshot.git.repoRoot,
      mainRepoRoot: snapshot.git.mainRepoRoot,
      currentBranch: snapshot.git.currentBranch,
      remoteUrl: snapshot.git.remoteUrl,
      isPaseoOwnedWorktree: snapshot.git.isPaseoOwnedWorktree,
      baseRef: snapshot.git.baseRef,
      aheadBehind: snapshot.git.aheadBehind,
      aheadOfOrigin: snapshot.git.aheadOfOrigin,
      behindOfOrigin: snapshot.git.behindOfOrigin,
      hasRemote: snapshot.git.hasRemote,
    });
    const worktreeFingerprint = JSON.stringify({
      isDirty: snapshot.git.isDirty,
      diffStat: snapshot.git.diffStat,
    });
    const forgeFingerprint = JSON.stringify(snapshot.forge);
    const previousStructureFingerprint = target.latestWorkspaceStructureFingerprint;
    const previousWorktreeFingerprint = target.latestWorkspaceWorktreeFingerprint;
    const previousForgeFingerprint = target.latestWorkspaceForgeFingerprint;
    target.latestWorkspaceStructureFingerprint = structureFingerprint;
    target.latestWorkspaceWorktreeFingerprint = worktreeFingerprint;
    target.latestWorkspaceForgeFingerprint = forgeFingerprint;

    if (previousStructureFingerprint === null) {
      return;
    }
    const structureChanged = structureFingerprint !== previousStructureFingerprint;
    const worktreeChanged = worktreeFingerprint !== previousWorktreeFingerprint;
    const forgeChanged = forgeFingerprint !== previousForgeFingerprint;
    if (structureChanged || (!worktreeChanged && !forgeChanged)) {
      this.scheduleTargetRefresh(target, false);
    }
  }

  private removeListener(
    target: CheckoutDiffWatchTarget,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): void {
    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }
    this.closeTarget(target);
    if (this.targets.get(target.key) === target) {
      this.targets.delete(target.key);
    }
  }

  private scheduleTargetRefresh(target: CheckoutDiffWatchTarget, force = true): void {
    target.pendingDebounceForce ||= force;
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
    }
    target.debounceTimer = setTimeout(() => {
      target.debounceTimer = null;
      const pendingForce = target.pendingDebounceForce;
      target.pendingDebounceForce = false;
      this.scheduleThrottledRefresh(target, pendingForce);
    }, CHECKOUT_DIFF_WATCH_DEBOUNCE_MS);
  }

  // 同一 target 两次开算至少隔 1 秒：防抖到点后离上次开算不足 1 秒，就等到满 1 秒再算
  private scheduleThrottledRefresh(target: CheckoutDiffWatchTarget, force: boolean): void {
    target.pendingThrottleForce ||= force;
    if (target.throttleTimer) {
      return;
    }
    const waitMs = msUntilIntervalElapsed(target.lastRefreshStartedAt);
    if (waitMs <= 0) {
      this.runThrottledRefresh(target);
      return;
    }
    target.throttleTimer = setTimeout(() => {
      target.throttleTimer = null;
      this.runThrottledRefresh(target);
    }, waitMs);
  }

  private runThrottledRefresh(target: CheckoutDiffWatchTarget): void {
    const pendingForce = target.pendingThrottleForce;
    target.pendingThrottleForce = false;
    void this.refreshTarget(target, pendingForce);
  }

  private async computeCheckoutDiffSnapshot(
    cwd: string,
    compare: CheckoutDiffCompareInput,
    options?: {
      diffCwd?: string;
      force?: boolean;
      reason?: string;
      fileReuse?: CheckoutDiffFileReuse;
    },
  ): Promise<CheckoutDiffSnapshotPayload> {
    const diffCwd = options?.diffCwd ?? cwd;
    const fileReuse = options?.fileReuse;
    const readOptions: CheckoutDiffReadOptions | undefined = options?.force
      ? { force: true, reason: options.reason ?? "checkout-diff-refresh", fileReuse }
      : fileReuse && { fileReuse };
    try {
      const diffResult = await this.workspaceGitService.getCheckoutDiff(
        diffCwd,
        {
          mode: compare.mode,
          baseRef: compare.baseRef,
          ignoreWhitespace: compare.ignoreWhitespace,
          includeStructured: true,
          ...(compare.filesOnly === true ? { filesOnly: true } : {}),
        },
        readOptions,
      );
      if (diffResult.diffTooLarge) {
        return {
          cwd,
          files: [],
          diffTooLarge: true,
          error: toCheckoutError(new Error("Diff too large to display")),
        };
      }
      const files = [...(diffResult.structured ?? [])];
      files.sort((a, b) => {
        if (a.path === b.path) return 0;
        return a.path < b.path ? -1 : 1;
      });
      return {
        cwd,
        files,
        error: null,
      };
    } catch (error) {
      return {
        cwd,
        files: [],
        error: toCheckoutError(error),
      };
    }
  }

  private async refreshTarget(target: CheckoutDiffWatchTarget, force: boolean): Promise<void> {
    if (target.refreshPromise) {
      target.refreshQueued = true;
      target.refreshQueuedForce ||= force;
      return;
    }

    target.refreshPromise = (async () => {
      target.refreshQueued = false;
      target.refreshQueuedForce = false;
      target.lastRefreshStartedAt = Date.now();
      const snapshot = await this.computeCheckoutDiffSnapshot(target.cwd, target.compare, {
        diffCwd: target.diffCwd,
        force,
        ...(force ? { reason: "working-tree-watch" } : {}),
        fileReuse: target.fileReuse,
      });
      const fingerprint = JSON.stringify(snapshot);
      if (fingerprint === target.latestFingerprint) {
        target.latestPayload = snapshot;
        return;
      }
      // 两次开算隔了 1 秒，但前一次算得慢、这次算得快时推送仍可能挨得太近，补足间隔再推。
      // 等待期间 latestPayload 仍是上一份，新订阅者拿到的首份与随后的推送不会重复
      const pushWaitMs = msUntilIntervalElapsed(target.lastPushAt);
      if (pushWaitMs > 0) {
        await this.waitForPushGap(target, pushWaitMs);
        if (target.listeners.size === 0) {
          return;
        }
      }
      target.latestPayload = snapshot;
      target.latestFingerprint = fingerprint;
      target.lastPushAt = Date.now();
      for (const listener of target.listeners) {
        listener(snapshot);
      }
    })();

    try {
      await target.refreshPromise;
    } finally {
      target.refreshPromise = null;
    }
    // 算的过程中又来的变化只补一次，同样受 1 秒间隔约束
    if (target.refreshQueued && this.targets.get(target.key) === target) {
      const queuedForce = target.refreshQueuedForce;
      target.refreshQueued = false;
      target.refreshQueuedForce = false;
      this.scheduleThrottledRefresh(target, queuedForce);
    }
  }

  private waitForPushGap(target: CheckoutDiffWatchTarget, waitMs: number): Promise<void> {
    return new Promise((resolve) => {
      target.pushGapWait = {
        timer: setTimeout(() => {
          target.pushGapWait = null;
          resolve();
        }, waitMs),
        release: resolve,
      };
    });
  }

  private ensureTarget(cwd: string, compare: CheckoutDiffCompareInput): CheckoutDiffWatchTarget {
    const targetKey = this.buildTargetKey(cwd, compare);
    const existing = this.targets.get(targetKey);
    if (existing) {
      return existing;
    }

    const target: CheckoutDiffWatchTarget = {
      key: targetKey,
      cwd,
      diffCwd: cwd,
      compare,
      listeners: new Set(),
      workingTreeWatchUnsubscribe: null,
      workspaceGitUnsubscribe: null,
      latestWorkspaceStructureFingerprint: null,
      latestWorkspaceWorktreeFingerprint: null,
      latestWorkspaceForgeFingerprint: null,
      debounceTimer: null,
      pendingDebounceForce: false,
      throttleTimer: null,
      pendingThrottleForce: false,
      lastRefreshStartedAt: null,
      lastPushAt: null,
      pushGapWait: null,
      refreshPromise: null,
      refreshQueued: false,
      refreshQueuedForce: false,
      latestPayload: null,
      latestFingerprint: null,
      openPromise: null,
      fileReuse: new CheckoutDiffFileReuse(),
    };
    this.targets.set(targetKey, target);
    return target;
  }

  private async openTarget(target: CheckoutDiffWatchTarget): Promise<void> {
    if (target.compare.mode === "base") {
      const snapshot =
        this.workspaceGitService.peekSnapshot(target.cwd) ??
        (await this.workspaceGitService.getSnapshot(target.cwd, { includeForge: false }));
      target.diffCwd = snapshot.git.repoRoot ?? target.cwd;
      if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
        return;
      }
      this.rememberWorkspaceSnapshot(target, snapshot);
      const workspaceSubscription = this.workspaceGitService.registerWorkspace(
        { cwd: target.cwd },
        (nextSnapshot) => this.rememberWorkspaceSnapshot(target, nextSnapshot),
      );
      if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
        workspaceSubscription.unsubscribe();
        return;
      }
      target.workspaceGitUnsubscribe = workspaceSubscription.unsubscribe;
      return;
    }

    const { repoRoot, unsubscribe } = await this.workspaceGitService.requestWorkingTreeWatch(
      target.cwd,
      (change) => {
        target.fileReuse.markChanged(change?.changedPaths ?? []);
        this.scheduleTargetRefresh(target);
      },
    );
    target.diffCwd = repoRoot ?? target.cwd;
    if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
      unsubscribe();
      return;
    }
    target.workingTreeWatchUnsubscribe = unsubscribe;
  }
}
