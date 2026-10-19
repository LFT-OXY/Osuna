import { shareCheckoutDiff } from "./diff-sharing";
import { hashKey, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useReplicaQuery } from "@/data/query";
import { checkoutDiffPushRoute } from "@/data/push-router";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { ParsedDiffFile, SubscribeCheckoutDiffResponse } from "@getpaseo/protocol/messages";
import { checkoutDiffQueryKey } from "@/git/query-keys";

interface UseCheckoutDiffQueryOptions {
  serverId: string;
  cwd: string;
  mode: "uncommitted" | "base";
  baseRef?: string;
  ignoreWhitespace?: boolean;
  enabled?: boolean;
  queryScope?: string;
  /** 只开文件树、diff 正文不可见：host 支持时只要文件清单。 */
  filesOnly?: boolean;
  /** 每次收到这个 diff 的文件清单（含挂载时缓存里已有的那份）时调用。 */
  onFiles?: (files: ParsedDiffFile[]) => void;
}

type CheckoutDiffQueryPayload = Omit<SubscribeCheckoutDiffResponse["payload"], "subscriptionId">;

// Re-export the canonical protocol type so all consumers share one definition.
export type { ParsedDiffFile };
export type DiffHunk = ParsedDiffFile["hunks"][number];
export type DiffLine = DiffHunk["lines"][number];
export type HighlightToken = NonNullable<DiffLine["tokens"]>[number];

function normalizeCheckoutDiffCompare(compare: {
  mode: "uncommitted" | "base";
  baseRef?: string;
  ignoreWhitespace?: boolean;
}): { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean } {
  const ignoreWhitespace = compare.ignoreWhitespace === true;
  if (compare.mode === "uncommitted") {
    return { mode: "uncommitted", ignoreWhitespace };
  }
  const trimmedBaseRef = compare.baseRef?.trim();
  return trimmedBaseRef
    ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace }
    : { mode: "base", ignoreWhitespace };
}

interface CheckoutDiffSubscriptionInput {
  serverId: string;
  cwd: string;
  mode: "uncommitted" | "base";
  baseRef?: string;
  ignoreWhitespace?: boolean;
  queryScope?: string;
  filesOnly: boolean;
  filesOnlySupported: boolean;
}

/** 订阅哪份 diff：查询缓存的 key、push 订阅 id 与发给 daemon 的 compare。 */
export function resolveCheckoutDiffSubscription(input: CheckoutDiffSubscriptionInput) {
  const compare = normalizeCheckoutDiffCompare(input);
  // COMPAT(checkoutDiffFilesOnly): added in v0.17.0, remove gate after 2027-04-19.
  const filesOnly = input.filesOnly && input.filesOnlySupported;
  const comparisonKey = checkoutDiffQueryKey(
    input.serverId,
    input.cwd,
    compare.mode,
    compare.baseRef,
    compare.ignoreWhitespace,
    { filesOnly },
  );
  const normalizedScope = input.queryScope?.trim();
  const queryKey = normalizedScope ? [...comparisonKey, "scope", normalizedScope] : comparisonKey;
  return {
    queryKey,
    subscriptionId: `checkoutDiff:${JSON.stringify(queryKey)}`,
    compare: {
      mode: compare.mode,
      ...(compare.baseRef ? { baseRef: compare.baseRef } : {}),
      ignoreWhitespace: compare.ignoreWhitespace,
      ...(filesOnly ? { filesOnly: true } : {}),
    },
  };
}

interface CheckoutDiffSubscriptionDemand {
  enabled: boolean;
  retainedPanelActive: boolean;
  appVisible: boolean;
  isConnected: boolean;
  cwd: string;
}

/**
 * 只在面板活跃、页面可见时订阅。页面 hidden（桌面最小化、切走浏览器标签、原生进后台）
 * 与 tab 不活跃同样释放订阅；恢复后重新订阅，订阅响应带回最新快照。
 * 只看 hidden、不看失焦：窗口仍摆在屏幕上时照常刷新。
 */
export function isCheckoutDiffSubscriptionWanted(input: CheckoutDiffSubscriptionDemand): boolean {
  return Boolean(
    input.enabled &&
    input.retainedPanelActive &&
    input.appVisible &&
    input.isConnected &&
    input.cwd,
  );
}

type CheckoutDiffSubscription = ReturnType<typeof resolveCheckoutDiffSubscription>;

/** useCheckoutDiffQuery 交给 useReplicaQuery 的参数：订阅与否全由 demand 决定。 */
export function checkoutDiffQueryInput(
  input: CheckoutDiffSubscriptionDemand & {
    serverId: string;
    subscription: CheckoutDiffSubscription;
  },
) {
  const routeEnabled = isCheckoutDiffSubscriptionWanted(input);
  const { queryKey, subscriptionId, compare } = input.subscription;
  return {
    queryKey,
    structuralSharing: shareCheckoutDiff,
    enabled: routeEnabled,
    pushEvent: "checkout_diff_update",
    meta: checkoutDiffPushRoute({
      enabled: routeEnabled,
      serverId: input.serverId,
      subscriptionId,
      cwd: input.cwd,
      compare,
    }),
  } satisfies Parameters<typeof useReplicaQuery<CheckoutDiffQueryPayload>>[0];
}

export function useCheckoutDiffQuery({
  serverId,
  cwd,
  mode,
  baseRef,
  ignoreWhitespace,
  enabled = true,
  queryScope,
  filesOnly = false,
  onFiles,
}: UseCheckoutDiffQueryOptions) {
  const retainedPanelActive = useRetainedPanelActive();
  const appVisible = useAppVisible();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const filesOnlySupported = useHostFeature(serverId, "checkoutDiffFilesOnly");
  const subscription = useMemo(
    () =>
      resolveCheckoutDiffSubscription({
        serverId,
        cwd,
        mode,
        baseRef,
        ignoreWhitespace,
        queryScope,
        filesOnly,
        filesOnlySupported,
      }),
    [serverId, cwd, mode, baseRef, ignoreWhitespace, queryScope, filesOnly, filesOnlySupported],
  );
  const query = useReplicaQuery<CheckoutDiffQueryPayload>(
    checkoutDiffQueryInput({
      serverId,
      cwd,
      subscription,
      enabled,
      retainedPanelActive,
      appVisible,
      isConnected,
    }),
  );

  const queryClient = useQueryClient();
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const listensForFiles = onFiles !== undefined;
  const { queryKey } = subscription;
  useEffect(() => {
    if (!listensForFiles) return;
    return subscribeCheckoutDiffFiles(queryClient, queryKey, (files) =>
      onFilesRef.current?.(files),
    );
  }, [listensForFiles, queryClient, queryKey]);

  return deriveCheckoutDiffResult(query.data ?? null);
}

/** 订阅查询缓存里这个 diff 的文件清单：先交出已缓存的一份，之后每次更新再交一次。 */
export function subscribeCheckoutDiffFiles(
  queryClient: QueryClient,
  queryKey: QueryKey,
  onFiles: (files: ParsedDiffFile[]) => void,
): () => void {
  const queryHash = hashKey(queryKey);
  const deliver = () => {
    const payload = queryClient.getQueryData<CheckoutDiffQueryPayload>(queryKey);
    if (payload) onFiles(payload.files);
  };
  deliver();
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (event.query.queryHash !== queryHash) return;
    deliver();
  });
}

export interface CheckoutDiffResult {
  files: ParsedDiffFile[];
  payloadError: CheckoutDiffQueryPayload["error"];
  diffTooLarge: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: null;
}

/**
 * The result derives from the payload alone. Until a payload arrives there is no
 * diff to describe, so the boundary reports loading rather than an empty diff —
 * whether the query is idle (an inactive retained panel), in flight, or the host
 * is disconnected. Reporting `files: []` as settled made callers render "+0 -0"
 * and "No changes" for a diff nobody has fetched yet.
 */
export function deriveCheckoutDiffResult(
  payload: CheckoutDiffQueryPayload | null,
): CheckoutDiffResult {
  const payloadError = payload?.error ?? null;
  return {
    files: payload?.files ?? [],
    payloadError,
    diffTooLarge: payload?.diffTooLarge === true,
    isLoading: payload === null,
    isFetching: false,
    isError: Boolean(payloadError),
    error: null,
  };
}
