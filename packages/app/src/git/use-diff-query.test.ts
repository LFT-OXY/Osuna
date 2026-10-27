import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { OwnedSubscription } from "@getpaseo/client";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { replicaQueryOptions } from "@/data/query";
import { mountServerDataPushRouter } from "@/data/push-router";
import {
  checkoutDiffQueryInput,
  deriveCheckoutDiffResult,
  isCheckoutDiffSubscriptionWanted,
  resolveCheckoutDiffSubscription,
  subscribeCheckoutDiffFiles,
} from "./use-diff-query";

function createParsedDiffFile(path: string): ParsedDiffFile {
  return {
    path,
    isNew: false,
    isDeleted: false,
    additions: 3,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [{ type: "add", content: "x", tokens: [] }],
      },
    ],
  } as ParsedDiffFile;
}

function createPayload(files: ParsedDiffFile[]) {
  return { requestId: "req-1", cwd: "/repo", files, error: null };
}

describe("deriveCheckoutDiffResult", () => {
  // No payload covers every not-yet-fetched case: the query is disabled because the
  // retained panel is still inactive, the request is in flight, or the host is
  // disconnected. None of them mean "the diff is empty".
  it("reports loading while no payload has arrived, so an empty diff is never implied", () => {
    const result = deriveCheckoutDiffResult(null);

    expect(result.isLoading).toBe(true);
    expect(result.files).toEqual([]);
  });

  it("reports a settled empty diff once a payload with zero files arrives", () => {
    const result = deriveCheckoutDiffResult(createPayload([]));

    expect(result.isLoading).toBe(false);
    expect(result.files).toEqual([]);
  });

  it("passes the payload files through once the diff arrives", () => {
    const files = [createParsedDiffFile("src/app.ts")];

    const result = deriveCheckoutDiffResult(createPayload(files));

    expect(result.isLoading).toBe(false);
    expect(result.files).toEqual(files);
  });

  it("surfaces a payload error and the too-large flag", () => {
    const error = { code: "NOT_GIT_REPO", message: "not a git repository" } as const;

    const result = deriveCheckoutDiffResult({ ...createPayload([]), error, diffTooLarge: true });

    expect(result).toEqual({
      files: [],
      payloadError: error,
      diffTooLarge: true,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: null,
    });
  });
});

function filePaths(files: ParsedDiffFile[]): string[] {
  return files.map((file) => file.path);
}

describe("subscribeCheckoutDiffFiles", () => {
  const key = ["checkoutDiff", "server", "/repo"];

  it("delivers the cached files at once and every later payload for its key only", () => {
    const queryClient = new QueryClient();
    const first = [createParsedDiffFile("a.ts")];
    const second = [createParsedDiffFile("a.ts"), createParsedDiffFile("b.ts")];
    queryClient.setQueryData(key, createPayload(first));
    const received: string[][] = [];

    const unsubscribe = subscribeCheckoutDiffFiles(queryClient, key, (files) =>
      received.push(filePaths(files)),
    );
    queryClient.setQueryData(["checkoutDiff", "server", "/other"], createPayload(second));
    queryClient.setQueryData(key, createPayload(second));
    unsubscribe();
    queryClient.setQueryData(key, createPayload(first));

    expect(received).toEqual([["a.ts"], ["a.ts", "b.ts"]]);
  });

  it("waits for the first payload when nothing is cached yet", () => {
    const queryClient = new QueryClient();
    const received: string[][] = [];

    const unsubscribe = subscribeCheckoutDiffFiles(queryClient, key, (files) =>
      received.push(filePaths(files)),
    );
    expect(received).toEqual([]);
    queryClient.setQueryData(key, createPayload([createParsedDiffFile("a.ts")]));
    unsubscribe();

    expect(received).toEqual([["a.ts"]]);
  });
});

describe("resolveCheckoutDiffSubscription", () => {
  const base = {
    serverId: "server",
    cwd: "/repo",
    mode: "base" as const,
    baseRef: " main ",
    ignoreWhitespace: true,
  };
  const full = {
    queryKey: ["checkoutDiff", "server", "/repo", "base", "main", true],
    subscriptionId: 'checkoutDiff:["checkoutDiff","server","/repo","base","main",true]',
    compare: { mode: "base", baseRef: "main", ignoreWhitespace: true },
  };

  it("asks for the file list alone when only the tree shows and the host supports it", () => {
    expect(
      resolveCheckoutDiffSubscription({ ...base, filesOnly: true, filesOnlySupported: true }),
    ).toEqual({
      queryKey: ["checkoutDiff", "server", "/repo", "base", "main", true, "filesOnly"],
      subscriptionId:
        'checkoutDiff:["checkoutDiff","server","/repo","base","main",true,"filesOnly"]',
      compare: { mode: "base", baseRef: "main", ignoreWhitespace: true, filesOnly: true },
    });
  });

  it("asks for the All changes file list alone when only the tree shows", () => {
    expect(
      resolveCheckoutDiffSubscription({
        ...base,
        mode: "all",
        filesOnly: true,
        filesOnlySupported: true,
      }).compare,
    ).toEqual({ mode: "all", baseRef: "main", ignoreWhitespace: true, filesOnly: true });
  });

  it("asks for the full diff once the diff body shows", () => {
    expect(
      resolveCheckoutDiffSubscription({ ...base, filesOnly: false, filesOnlySupported: true }),
    ).toEqual(full);
  });

  it("always asks for the full diff from a host without the feature", () => {
    expect(
      resolveCheckoutDiffSubscription({ ...base, filesOnly: true, filesOnlySupported: false }),
    ).toEqual(full);
  });
});

describe("isCheckoutDiffSubscriptionWanted", () => {
  const shown = {
    enabled: true,
    retainedPanelActive: true,
    appVisible: true,
    isConnected: true,
    cwd: "/repo",
  };

  it("subscribes while the panel is active and the page is visible", () => {
    expect(isCheckoutDiffSubscriptionWanted(shown)).toBe(true);
  });

  // 最小化窗口、切到别的浏览器标签、原生端进后台：页面 hidden 时释放订阅
  it("releases the subscription while the page is hidden", () => {
    expect(isCheckoutDiffSubscriptionWanted({ ...shown, appVisible: false })).toBe(false);
  });

  it("releases the subscription while the retained panel is inactive", () => {
    expect(isCheckoutDiffSubscriptionWanted({ ...shown, retainedPanelActive: false })).toBe(false);
  });

  it("does not subscribe while disconnected or without a cwd", () => {
    expect(isCheckoutDiffSubscriptionWanted({ ...shown, isConnected: false })).toBe(false);
    expect(isCheckoutDiffSubscriptionWanted({ ...shown, cwd: "" })).toBe(false);
  });
});

type PushRouterClient = Parameters<typeof mountServerDataPushRouter>[0]["client"];

function idleSubscription<T extends { subscriptionId: string }>(
  snapshot: T,
  onRelease = () => {},
): OwnedSubscription<T> {
  return {
    subscriptionId: snapshot.subscriptionId,
    ready: Promise.resolve(snapshot),
    subscribe: (observer) => {
      observer.snapshot(snapshot);
      return () => {};
    },
    release: async () => onRelease(),
  };
}

function createDiffSubscriptionRecorder() {
  const events: string[] = [];
  const client: PushRouterClient = {
    async getProvidersSnapshot() {
      throw new Error("Unexpected snapshot pull");
    },
    observeEvents: () =>
      idleSubscription({ subscriptionId: "events", requestId: "events", events: [] }),
    observeTerminals: () =>
      idleSubscription({
        subscriptionId: "terminals",
        requestId: "terminals",
        cwd: "",
        terminals: [],
      }),
    observeCheckoutDiff(cwd) {
      events.push(`subscribe ${cwd}`);
      return idleSubscription(
        { subscriptionId: `diff-${events.length}`, requestId: "diff", cwd, files: [], error: null },
        () => events.push(`release ${cwd}`),
      );
    },
  };
  return { client, events };
}

describe("checkoutDiffQueryInput", () => {
  const subscription = resolveCheckoutDiffSubscription({
    serverId: "server",
    cwd: "/repo",
    mode: "uncommitted",
    filesOnly: false,
    filesOnlySupported: true,
  });
  const inputs = (appVisible: boolean) => ({
    serverId: "server",
    cwd: "/repo",
    subscription,
    enabled: true,
    retainedPanelActive: true,
    appVisible,
    isConnected: true,
  });

  it("releases the diff subscription while the app is hidden and resubscribes once visible", () => {
    const queryClient = new QueryClient();
    const recorder = createDiffSubscriptionRecorder();
    const observer = new QueryObserver(
      queryClient,
      replicaQueryOptions(checkoutDiffQueryInput(inputs(true))),
    );
    const unsubscribe = observer.subscribe(() => {});
    const unmount = mountServerDataPushRouter({
      queryClient,
      client: recorder.client,
      serverId: "server",
    });
    try {
      expect(recorder.events).toEqual(["subscribe /repo"]);

      observer.setOptions(replicaQueryOptions(checkoutDiffQueryInput(inputs(false))));
      expect(recorder.events).toEqual(["subscribe /repo", "release /repo"]);

      observer.setOptions(replicaQueryOptions(checkoutDiffQueryInput(inputs(true))));
      expect(recorder.events).toEqual(["subscribe /repo", "release /repo", "subscribe /repo"]);
    } finally {
      unsubscribe();
      unmount();
      queryClient.clear();
    }
  });
});
