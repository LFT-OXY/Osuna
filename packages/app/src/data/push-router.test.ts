import type { OwnedSubscription, SubscriptionObserver } from "@getpaseo/client";
import { QueryClient, QueryObserver, skipToken } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { MutableDaemonConfig, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { checkoutDiffQueryKey } from "@/git/query-keys";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { providersSnapshotQueryKey } from "@/data/providers-snapshot";
import {
  checkoutDiffPushRoute,
  invalidateServerDataQueriesAfterReconnect,
  mountServerDataPushRouter,
  workspaceTerminalsPushRoute,
} from "@/data/push-router";

type ProvidersSnapshotUpdateMessage = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>;
type CheckoutDiffUpdateMessage = Extract<SessionOutboundMessage, { type: "checkout_diff_update" }>;
type SubscribeCheckoutDiffResponseMessage = Extract<
  SessionOutboundMessage,
  { type: "subscribe_checkout_diff_response" }
>;
type StatusMessage = Extract<SessionOutboundMessage, { type: "status" }>;
type TerminalsChangedMessage = Extract<SessionOutboundMessage, { type: "terminals_changed" }>;
type RouterMessage =
  | ProvidersSnapshotUpdateMessage
  | CheckoutDiffUpdateMessage
  | SubscribeCheckoutDiffResponseMessage
  | StatusMessage
  | TerminalsChangedMessage;
type RouterMessageType = RouterMessage["type"];
type RouterHandler = (message: RouterMessage) => void;
type RouterClient = Parameters<typeof mountServerDataPushRouter>[0]["client"];

const daemonConfig: MutableDaemonConfig = {
  relay: { enabled: false },
  mcp: { injectIntoAgents: true },
  browserTools: { enabled: false },
  providers: {},
  metadataGeneration: { providers: [] },
  autoArchiveAfterMerge: false,
  enableTerminalAgentHooks: false,
  appendSystemPrompt: "",
};

function createFakeClient(config: { rejectCheckoutDiffSubscribe?: boolean } = {}): {
  client: RouterClient;
  emit: <K extends RouterMessageType>(message: Extract<RouterMessage, { type: K }>) => void;
  subscribeCheckoutDiffCalls: Array<{
    cwd: string;
    compare: {
      mode: "uncommitted" | "base";
      baseRef?: string;
      ignoreWhitespace?: boolean;
      filesOnly?: boolean;
    };
    subscriptionId: string;
  }>;
  unsubscribeCheckoutDiffCalls: string[];
  subscribeTerminalCalls: Array<{ cwd: string; workspaceId?: string }>;
  unsubscribeTerminalCalls: Array<{ cwd: string; workspaceId?: string }>;
} {
  const handlers: Record<RouterMessageType, RouterHandler[]> = {
    providers_snapshot_update: [],
    checkout_diff_update: [],
    subscribe_checkout_diff_response: [],
    status: [],
    terminals_changed: [],
  };
  const subscribeCheckoutDiffCalls: Array<{
    cwd: string;
    compare: {
      mode: "uncommitted" | "base";
      baseRef?: string;
      ignoreWhitespace?: boolean;
      filesOnly?: boolean;
    };
    subscriptionId: string;
  }> = [];
  const unsubscribeCheckoutDiffCalls: string[] = [];
  const subscribeTerminalCalls: Array<{ cwd: string; workspaceId?: string }> = [];
  const unsubscribeTerminalCalls: Array<{ cwd: string; workspaceId?: string }> = [];

  function on<K extends RouterMessageType>(
    type: K,
    handler: (message: Extract<RouterMessage, { type: K }>) => void,
  ): () => void {
    const routerHandler: RouterHandler = (message) => {
      if (message.type === type) {
        handler(message as Extract<RouterMessage, { type: K }>);
      }
    };
    handlers[type].push(routerHandler);
    return () => {
      handlers[type] = handlers[type].filter((candidate) => candidate !== routerHandler);
    };
  }

  function emit<K extends RouterMessageType>(message: Extract<RouterMessage, { type: K }>): void {
    for (const handler of handlers[message.type]) {
      handler(message);
    }
  }

  function observe<T extends { subscriptionId: string }>(
    snapshot: T,
    types: RouterMessageType[],
    released: () => void,
    matches: (message: RouterMessage) => boolean = () => true,
  ): OwnedSubscription<T> {
    const observers = new Set<SubscriptionObserver<T>>();
    let active = true;
    const cleanups = types.map((type) =>
      on(type, (message) => {
        if (!matches(message)) return;
        for (const observer of observers) {
          if (message.type === "subscribe_checkout_diff_response")
            observer.snapshot({ ...snapshot, ...message.payload });
          else observer.update(message);
        }
      }),
    );
    return {
      subscriptionId: snapshot.subscriptionId,
      ready: Promise.resolve(snapshot),
      subscribe: (observer) => {
        observers.add(observer);
        observer.snapshot(snapshot);
        return () => {
          observers.delete(observer);
        };
      },
      release: async () => {
        if (!active) return;
        active = false;
        cleanups.forEach((cleanup) => cleanup());
        observers.clear();
        released();
      },
    };
  }

  return {
    client: {
      async getProvidersSnapshot() {
        throw new Error("Unexpected snapshot pull");
      },
      observeEvents: () =>
        observe(
          { subscriptionId: "events", requestId: "events", events: [] },
          ["status", "providers_snapshot_update"],
          () => {},
        ),
      observeCheckoutDiff(cwd, compare) {
        const subscriptionId = `server-diff-${subscribeCheckoutDiffCalls.length + 1}`;
        subscribeCheckoutDiffCalls.push({ cwd, compare, subscriptionId });
        const handle = observe(
          { subscriptionId, cwd, files: [], error: null, requestId: "subscribe-checkout-diff" },
          ["checkout_diff_update", "subscribe_checkout_diff_response"],
          () => unsubscribeCheckoutDiffCalls.push(subscriptionId),
          (message) =>
            "subscriptionId" in message.payload &&
            message.payload.subscriptionId === subscriptionId,
        );
        if (!config.rejectCheckoutDiffSubscribe) return handle;
        return {
          ...handle,
          subscribe: (observer) => {
            queueMicrotask(() => observer.error?.(new Error("subscribe failed")));
            return () => {};
          },
        };
      },
      observeTerminals(input) {
        const { signal: _signal, ...query } = input;
        subscribeTerminalCalls.push(query);
        return observe(
          {
            ...query,
            subscriptionId: `terminal-${subscribeTerminalCalls.length}`,
            requestId: "terminals",
            terminals: [],
          },
          ["terminals_changed"],
          () => unsubscribeTerminalCalls.push(query),
          (message) => message.type === "terminals_changed" && message.payload.cwd === query.cwd,
        );
      },
    },
    emit,
    subscribeCheckoutDiffCalls,
    unsubscribeCheckoutDiffCalls,
    subscribeTerminalCalls,
    unsubscribeTerminalCalls,
  };
}

function providerUpdate(generatedAt: string): ProvidersSnapshotUpdateMessage {
  return {
    type: "providers_snapshot_update",
    payload: {
      entries: [{ provider: "codex", status: "ready", enabled: true, models: [] }],
      generatedAt,
    },
  };
}

describe("server data push router", () => {
  it("keeps a visible diff subscribed when a hidden panel switches to the same comparison", () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "server-1";
    const cwd = "/repo";
    const options = (mode: "base" | "uncommitted", enabled: boolean) => {
      const queryKey = checkoutDiffQueryKey(
        serverId,
        cwd,
        mode,
        mode === "base" ? "main" : undefined,
      );
      return {
        queryKey,
        queryFn: skipToken as typeof skipToken,
        gcTime: Infinity,
        meta: checkoutDiffPushRoute({
          enabled,
          serverId,
          cwd,
          subscriptionId: `checkoutDiff:${JSON.stringify(queryKey)}`,
          compare: { mode, ...(mode === "base" ? { baseRef: "main" } : {}) },
        }),
      };
    };
    const visible = new QueryObserver(queryClient, options("base", true));
    const hidden = new QueryObserver(queryClient, options("base", false));
    const unsubscribeVisible = visible.subscribe(() => {});
    const unsubscribeHidden = hidden.subscribe(() => {});
    const unmount = mountServerDataPushRouter({ queryClient, client: fake.client, serverId });
    try {
      visible.setOptions(options("uncommitted", true));
      hidden.setOptions(options("uncommitted", false));
      const subscription = fake.subscribeCheckoutDiffCalls.findLast(
        (call) => call.compare.mode === "uncommitted",
      )!;
      const files = [
        {
          path: "README.md",
          isNew: false,
          isDeleted: false,
          additions: 1,
          deletions: 0,
          hunks: [],
        },
      ];
      fake.emit({
        type: "checkout_diff_update",
        payload: { subscriptionId: subscription.subscriptionId, cwd, files, error: null },
      });
      expect(queryClient.getQueryData(options("uncommitted", true).queryKey)).toMatchObject({
        files,
      });
      expect(fake.unsubscribeCheckoutDiffCalls).not.toContain(subscription.subscriptionId);

      unsubscribeVisible();
      expect(fake.unsubscribeCheckoutDiffCalls).toContain(subscription.subscriptionId);
    } finally {
      unsubscribeVisible();
      unsubscribeHidden();
      unmount();
      queryClient.clear();
    }
  });

  it("retains equal diff files without reconstructing changed file bodies", () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "diff-sharing";
    const cwd = "/repo";
    const queryKey = checkoutDiffQueryKey(serverId, cwd, "uncommitted", undefined, false);
    const subscriptionId = "diff-sharing";
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: skipToken,
      meta: checkoutDiffPushRoute({
        enabled: true,
        serverId,
        cwd,
        subscriptionId,
        compare: { mode: "uncommitted" },
      }),
    });
    const unsubscribe = observer.subscribe(() => {});
    const unmount = mountServerDataPushRouter({ queryClient, client: fake.client, serverId });
    type Payload = SubscribeCheckoutDiffResponseMessage["payload"];
    const files: Payload["files"] = ["a.ts", "b.ts"].map((path) => ({
      path,
      isNew: true,
      isDeleted: false,
      additions: 2,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 2,
          lines: [
            {
              type: "add",
              content: "const answer = 42",
              tokens: [
                { text: "const", style: "keyword" },
                { text: " answer = 42", style: null },
              ],
            },
            { type: "add", content: "answer", tokens: [{ text: "answer", style: null }] },
          ],
        },
      ],
    }));
    const publish = (incomingFiles: Payload["files"], requestId: string) => {
      fake.emit({
        type: "subscribe_checkout_diff_response",
        payload: {
          subscriptionId: fake.subscribeCheckoutDiffCalls[0]!.subscriptionId,
          cwd,
          files: incomingFiles,
          requestId,
          error: null,
        },
      });
      return queryClient.getQueryData<Payload>(queryKey)!;
    };
    try {
      const first = publish(files, "first");
      const same = publish(structuredClone(files), "reopen");
      expect(same.files).toBe(first.files);
      expect(same.requestId).toBe("reopen");
      const changed = structuredClone(files);
      changed[0]!.hunks[0]!.lines[0]!.tokens![0]!.style = "variable";
      const next = publish(changed, "edit");
      expect(next.files[1]).toBe(first.files[1]);
      expect(next.files[0]).toBe(changed[0]);
      expect(next.files[0]!.hunks[0]!.lines[0]!.tokens![0]!.style).toBe("variable");
      expect(publish([], "deleted").files).toEqual([]);
    } finally {
      unsubscribe();
      unmount();
      queryClient.clear();
    }
  });

  it("routes provider snapshot and daemon config payloads until detached", async () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "server-1";
    const pairingOfferKey = daemonPairingOfferQueryKey(serverId);
    queryClient.setQueryData(pairingOfferKey, { relayEnabled: true, url: "https://pairing" });
    const unmount = mountServerDataPushRouter({ client: fake.client, queryClient, serverId });

    fake.emit(providerUpdate("2026-01-01T00:00:00.000Z"));
    fake.emit({
      type: "status",
      payload: { status: "daemon_config_changed", config: daemonConfig },
    });

    await expect
      .poll(() => queryClient.getQueryData(providersSnapshotQueryKey(serverId)))
      .toEqual({
        entries: [{ provider: "codex", status: "ready", enabled: true, models: [] }],
        generatedAt: "2026-01-01T00:00:00.000Z",
        requestId: "providers_snapshot_update",
      });
    expect(queryClient.getQueryData(daemonConfigQueryKey(serverId))).toEqual(daemonConfig);
    expect(queryClient.getQueryState(pairingOfferKey)?.isInvalidated).toBe(true);

    unmount();
    fake.emit(providerUpdate("2026-01-01T00:00:01.000Z"));

    await expect
      .poll(() => queryClient.getQueryData(providersSnapshotQueryKey(serverId)))
      .toEqual({
        entries: [{ provider: "codex", status: "ready", enabled: true, models: [] }],
        generatedAt: "2026-01-01T00:00:00.000Z",
        requestId: "providers_snapshot_update",
      });
  });

  it("keeps a files-only subscription apart and switches with the diff body both ways", () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "server-1";
    const cwd = "/repo";
    const options = (filesOnly: boolean) => {
      const queryKey = checkoutDiffQueryKey(serverId, cwd, "uncommitted", undefined, false, {
        filesOnly,
      });
      return {
        queryKey,
        queryFn: skipToken as typeof skipToken,
        gcTime: Infinity,
        meta: checkoutDiffPushRoute({
          enabled: true,
          serverId,
          cwd,
          subscriptionId: `checkoutDiff:${JSON.stringify(queryKey)}`,
          compare: {
            mode: "uncommitted",
            ignoreWhitespace: false,
            ...(filesOnly ? { filesOnly } : {}),
          },
        }),
      };
    };
    const observer = new QueryObserver(queryClient, options(true));
    const unsubscribeObserver = observer.subscribe(() => {});
    const unmount = mountServerDataPushRouter({ queryClient, client: fake.client, serverId });
    try {
      expect(fake.subscribeCheckoutDiffCalls.map((call) => call.compare)).toEqual([
        { mode: "uncommitted", ignoreWhitespace: false, filesOnly: true },
      ]);
      const filesOnlyId = fake.subscribeCheckoutDiffCalls[0]!.subscriptionId;
      const listedFile = {
        path: "README.md",
        isNew: false,
        isDeleted: false,
        additions: 1,
        deletions: 0,
        hunks: [],
      };
      fake.emit({
        type: "checkout_diff_update",
        payload: { subscriptionId: filesOnlyId, cwd, files: [listedFile], error: null },
      });

      observer.setOptions(options(false));

      // 切换途中可能先订阅再释放一次，只看最终留下的那份
      const fullCall = fake.subscribeCheckoutDiffCalls.at(-1)!;
      expect(fullCall.compare).toEqual({ mode: "uncommitted", ignoreWhitespace: false });
      expect(fake.unsubscribeCheckoutDiffCalls).toContain(filesOnlyId);
      expect(fake.unsubscribeCheckoutDiffCalls).not.toContain(fullCall.subscriptionId);
      // 完整订阅的缓存不会拿到清单订阅那份没有 hunks 的数据
      expect(queryClient.getQueryData(options(false).queryKey)).toMatchObject({ files: [] });
      expect(queryClient.getQueryData(options(true).queryKey)).toMatchObject({
        files: [listedFile],
      });

      // 正文再次收起：回到清单订阅，完整订阅释放
      observer.setOptions(options(true));

      const filesOnlyAgain = fake.subscribeCheckoutDiffCalls.at(-1)!;
      expect(filesOnlyAgain.compare).toEqual({
        mode: "uncommitted",
        ignoreWhitespace: false,
        filesOnly: true,
      });
      expect(fake.unsubscribeCheckoutDiffCalls).toContain(fullCall.subscriptionId);
      expect(fake.unsubscribeCheckoutDiffCalls).not.toContain(filesOnlyAgain.subscriptionId);
    } finally {
      unsubscribeObserver();
      unmount();
      queryClient.clear();
    }
  });

  it("subscribes active checkout diff queries and writes matching diff events", () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "server-1";
    const cwd = "/repo";
    const queryKey = checkoutDiffQueryKey(serverId, cwd, "base", "main", true);
    const subscriptionId = `checkoutDiff:${JSON.stringify(queryKey)}`;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
      meta: checkoutDiffPushRoute({
        enabled: true,
        serverId,
        subscriptionId,
        cwd,
        compare: { mode: "base", baseRef: "main", ignoreWhitespace: true },
      }),
    });
    const unsubscribeObserver = observer.subscribe(() => undefined);
    const unmount = mountServerDataPushRouter({ client: fake.client, queryClient, serverId });

    const serverSubscriptionId = fake.subscribeCheckoutDiffCalls[0]!.subscriptionId;
    expect(fake.subscribeCheckoutDiffCalls).toEqual([
      {
        cwd,
        compare: { mode: "base", baseRef: "main", ignoreWhitespace: true },
        subscriptionId: serverSubscriptionId,
      },
    ]);

    fake.emit({
      type: "subscribe_checkout_diff_response",
      payload: {
        subscriptionId: serverSubscriptionId,
        cwd,
        files: [],
        error: null,
        diffTooLarge: true,
        requestId: "diff-1",
      },
    });

    expect(queryClient.getQueryData(queryKey)).toEqual({
      cwd,
      files: [],
      error: null,
      diffTooLarge: true,
      requestId: "diff-1",
    });

    fake.emit({
      type: "checkout_diff_update",
      payload: {
        subscriptionId: serverSubscriptionId,
        cwd,
        files: [],
        error: null,
        diffTooLarge: true,
      },
    });

    expect(queryClient.getQueryData(queryKey)).toEqual({
      cwd,
      files: [],
      error: null,
      diffTooLarge: true,
      requestId: `subscription:${serverSubscriptionId}`,
    });

    unsubscribeObserver();

    expect(fake.unsubscribeCheckoutDiffCalls).toEqual([serverSubscriptionId]);

    unmount();
  });

  it("applies at most one diff push per second, keeping the latest and the trailing one", () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "diff-throttle";
    const cwd = "/repo";
    const queryKey = checkoutDiffQueryKey(serverId, cwd, "uncommitted", undefined, false);
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: skipToken,
      meta: checkoutDiffPushRoute({
        enabled: true,
        serverId,
        cwd,
        subscriptionId: "diff-throttle",
        compare: { mode: "uncommitted" },
      }),
    });
    const unsubscribe = observer.subscribe(() => {});
    const unmount = mountServerDataPushRouter({ queryClient, client: fake.client, serverId });
    const push = (path: string) =>
      fake.emit({
        type: "checkout_diff_update",
        payload: {
          subscriptionId: fake.subscribeCheckoutDiffCalls[0]!.subscriptionId,
          cwd,
          files: [{ path, isNew: false, isDeleted: false, additions: 1, deletions: 0, hunks: [] }],
          error: null,
        },
      });
    const appliedPath = () =>
      queryClient.getQueryData<{ files: Array<{ path: string }> }>(queryKey)?.files[0]?.path;
    try {
      push("first.ts");
      expect(appliedPath()).toBe("first.ts");

      push("second.ts");
      vi.advanceTimersByTime(300);
      push("third.ts");
      vi.advanceTimersByTime(300);
      push("fourth.ts");
      vi.advanceTimersByTime(399);
      expect(appliedPath()).toBe("first.ts");

      vi.advanceTimersByTime(1);
      expect(appliedPath()).toBe("fourth.ts");

      push("trailing.ts");
      vi.advanceTimersByTime(999);
      expect(appliedPath()).toBe("fourth.ts");
      vi.advanceTimersByTime(1);
      expect(appliedPath()).toBe("trailing.ts");
    } finally {
      unsubscribe();
      unmount();
      queryClient.clear();
      vi.useRealTimers();
    }
  });

  it("does not retry failed subscriptions on unrelated cache events", async () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient({ rejectCheckoutDiffSubscribe: true });
    const serverId = "server-1";
    const cwd = "/repo";
    const queryKey = checkoutDiffQueryKey(serverId, cwd, "base", "main", true);
    const subscriptionId = `checkoutDiff:${JSON.stringify(queryKey)}`;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
      meta: checkoutDiffPushRoute({
        enabled: true,
        serverId,
        subscriptionId,
        cwd,
        compare: { mode: "base", baseRef: "main", ignoreWhitespace: true },
      }),
    });
    const unsubscribeObserver = observer.subscribe(() => undefined);
    const unmount = mountServerDataPushRouter({ client: fake.client, queryClient, serverId });

    expect(fake.subscribeCheckoutDiffCalls).toHaveLength(1);

    await Promise.resolve();
    await Promise.resolve();

    queryClient.setQueryData(["unrelated"], "value");

    expect(fake.subscribeCheckoutDiffCalls).toHaveLength(1);

    unsubscribeObserver();
    unmount();
  });

  it("subscribes active terminal queries and filters terminal pushes by workspace", () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "server-1";
    const cwd = "/repo";
    const workspaceId = "workspace-a";
    const queryKey = buildTerminalsQueryKey(serverId, cwd, workspaceId);
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
      meta: workspaceTerminalsPushRoute({
        enabled: true,
        serverId,
        cwd,
        workspaceId,
      }),
    });
    const unsubscribeObserver = observer.subscribe(() => undefined);
    const unmount = mountServerDataPushRouter({ client: fake.client, queryClient, serverId });

    expect(fake.subscribeTerminalCalls).toEqual([{ cwd, workspaceId }]);

    fake.emit({
      type: "terminals_changed",
      payload: {
        cwd,
        terminals: [
          { id: "terminal-a", name: "Main", workspaceId },
          { id: "terminal-b", name: "Sibling", workspaceId: "workspace-b" },
        ],
      },
    });

    expect(queryClient.getQueryData(queryKey)).toEqual({
      cwd,
      terminals: [{ id: "terminal-a", name: "Main", workspaceId }],
      requestId: expect.stringMatching(/^terminals-changed-/),
    });

    unsubscribeObserver();

    expect(fake.unsubscribeTerminalCalls).toEqual([{ cwd, workspaceId }]);

    unmount();
  });

  it("keeps stable handles while invalidating caches after reconnect", () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "server-1";
    const cwd = "/repo";
    const workspaceId = "workspace-a";
    const checkoutDiffKey = checkoutDiffQueryKey(serverId, cwd, "base", "main", true);
    const checkoutDiffSubscriptionId = `checkoutDiff:${JSON.stringify(checkoutDiffKey)}`;
    const terminalKey = buildTerminalsQueryKey(serverId, cwd, workspaceId);
    const checkoutDiffObserver = new QueryObserver(queryClient, {
      queryKey: checkoutDiffKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
      meta: checkoutDiffPushRoute({
        enabled: true,
        serverId,
        subscriptionId: checkoutDiffSubscriptionId,
        cwd,
        compare: { mode: "base", baseRef: "main", ignoreWhitespace: true },
      }),
    });
    const terminalObserver = new QueryObserver(queryClient, {
      queryKey: terminalKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
      meta: workspaceTerminalsPushRoute({
        enabled: true,
        serverId,
        cwd,
        workspaceId,
      }),
    });
    const unsubscribeCheckoutDiffObserver = checkoutDiffObserver.subscribe(() => undefined);
    const unsubscribeTerminalObserver = terminalObserver.subscribe(() => undefined);
    const unmount = mountServerDataPushRouter({ client: fake.client, queryClient, serverId });
    const plainCheckoutDiffObserver = new QueryObserver(queryClient, {
      queryKey: checkoutDiffKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
    });
    const plainTerminalObserver = new QueryObserver(queryClient, {
      queryKey: terminalKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
    });
    const unsubscribePlainCheckoutDiffObserver = plainCheckoutDiffObserver.subscribe(
      () => undefined,
    );
    const unsubscribePlainTerminalObserver = plainTerminalObserver.subscribe(() => undefined);

    invalidateServerDataQueriesAfterReconnect({ queryClient, serverId });

    expect(fake.subscribeCheckoutDiffCalls).toEqual([
      {
        cwd,
        compare: { mode: "base", baseRef: "main", ignoreWhitespace: true },
        subscriptionId: "server-diff-1",
      },
    ]);
    expect(fake.subscribeTerminalCalls).toEqual([{ cwd, workspaceId }]);

    fake.emit({
      type: "terminals_changed",
      payload: {
        cwd,
        terminals: [
          { id: "terminal-a", name: "Main", workspaceId },
          { id: "terminal-b", name: "Sibling", workspaceId: "workspace-b" },
        ],
      },
    });

    expect(queryClient.getQueryData(terminalKey)).toEqual({
      cwd,
      terminals: [{ id: "terminal-a", name: "Main", workspaceId }],
      requestId: expect.stringMatching(/^terminals-changed-/),
    });

    unsubscribePlainCheckoutDiffObserver();
    unsubscribePlainTerminalObserver();
    unsubscribeCheckoutDiffObserver();
    unsubscribeTerminalObserver();
    unmount();
  });

  it("routes terminal pushes after another observer attaches without push metadata", () => {
    const queryClient = new QueryClient();
    const fake = createFakeClient();
    const serverId = "server-1";
    const cwd = "/repo";
    const workspaceId = "workspace-a";
    const queryKey = buildTerminalsQueryKey(serverId, cwd, workspaceId);
    const pushObserver = new QueryObserver(queryClient, {
      queryKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
      meta: workspaceTerminalsPushRoute({
        enabled: true,
        serverId,
        cwd,
        workspaceId,
      }),
    });
    const unsubscribePushObserver = pushObserver.subscribe(() => undefined);
    const unmount = mountServerDataPushRouter({ client: fake.client, queryClient, serverId });
    expect(fake.subscribeTerminalCalls).toEqual([{ cwd, workspaceId }]);

    const plainObserver = new QueryObserver(queryClient, {
      queryKey,
      queryFn: skipToken,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
    });
    const unsubscribePlainObserver = plainObserver.subscribe(() => undefined);

    fake.emit({
      type: "terminals_changed",
      payload: {
        cwd,
        terminals: [
          {
            id: "terminal-a",
            name: "Main",
            workspaceId,
            activity: { state: "idle", attentionReason: "needs_input", changedAt: 1 },
          },
        ],
      },
    });

    expect(queryClient.getQueryData(queryKey)).toEqual({
      cwd,
      terminals: [
        {
          id: "terminal-a",
          name: "Main",
          workspaceId,
          activity: { state: "idle", attentionReason: "needs_input", changedAt: 1 },
        },
      ],
      requestId: expect.stringMatching(/^terminals-changed-/),
    });
    expect(fake.unsubscribeTerminalCalls).toEqual([]);

    unsubscribePlainObserver();
    unsubscribePushObserver();
    unmount();
  });

  it("invalidates only the reconnect-repair scopes for one server", () => {
    const queryClient = new QueryClient();
    const serverId = "server-1";
    const otherServerId = "server-2";
    const providerKey = providersSnapshotQueryKey(serverId);
    const daemonConfigKey = daemonConfigQueryKey(serverId);
    const pairingOfferKey = daemonPairingOfferQueryKey(serverId);
    const diffKey = checkoutDiffQueryKey(serverId, "/repo", "uncommitted", undefined, false);
    const terminalKey = buildTerminalsQueryKey(serverId, "/repo", "workspace-a");
    const otherProviderKey = providersSnapshotQueryKey(otherServerId);

    queryClient.setQueryData(providerKey, { entries: [], generatedAt: "now", requestId: "p" });
    queryClient.setQueryData(daemonConfigKey, daemonConfig);
    queryClient.setQueryData(pairingOfferKey, { relayEnabled: false, url: "" });
    queryClient.setQueryData(diffKey, { cwd: "/repo", files: [], error: null, requestId: "d" });
    queryClient.setQueryData(terminalKey, { cwd: "/repo", terminals: [], requestId: "t" });
    queryClient.setQueryData(otherProviderKey, {
      entries: [],
      generatedAt: "now",
      requestId: "other",
    });

    invalidateServerDataQueriesAfterReconnect({ queryClient, serverId });

    expect(queryClient.getQueryState(providerKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(daemonConfigKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(pairingOfferKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(diffKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(terminalKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherProviderKey)?.isInvalidated).toBe(false);
  });
});
