import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { UsageResetOutcome } from "@getpaseo/protocol/messages";
import { replaceReport } from "@/usage/model";
import { hostUsageQueryKey, requireUsageClient, usageReportsQueryKey } from "@/usage/queries";
import type { UsageReportEntry } from "@/usage/types";

/*
 * 用掉一次重置的进行状态，按主机与账号分键放在 store 里：手机上确认框关掉时，用量弹层会重新挂载卡片，
 * 放在组件里的状态会丢。结果与失败一直留着，直到再用一次或关掉。
 */

export type ResetConsumeState =
  | { status: "idle" }
  | { status: "consuming" }
  | { status: "done"; outcome: UsageResetOutcome }
  | { status: "failed"; error: string };

const IDLE: ResetConsumeState = { status: "idle" };

const useResetConsumeStore = create<{ byKey: Record<string, ResetConsumeState> }>()(() => ({
  byKey: {},
}));

function consumeKey(serverId: string, reportId: string): string {
  return `${serverId}\u0000${reportId}`;
}

function setConsumeState(key: string, state: ResetConsumeState): void {
  useResetConsumeStore.setState((current) => {
    const byKey = { ...current.byKey };
    if (state.status === "idle") delete byKey[key];
    else byKey[key] = state;
    return { byKey };
  });
}

/**
 * 用掉这个账号的一次重置（调用方先问过用户）。成功后用 daemon 重读的报告替换卡片，再让同一主机的
 * 别的视图（Agent 的用量）重新取。
 */
async function consumeReset(input: {
  queryClient: QueryClient;
  serverId: string;
  reportId: string;
}): Promise<boolean> {
  const { queryClient, serverId, reportId } = input;
  const key = consumeKey(serverId, reportId);
  // 不可撤回：进行中再按一次不另发
  if (useResetConsumeStore.getState().byKey[key]?.status === "consuming") return false;
  setConsumeState(key, { status: "consuming" });
  try {
    const payload = await requireUsageClient(serverId).consumeUsageReset(reportId);
    if (payload.error !== null || !payload.outcome) throw new Error(payload.error ?? "");
    const { report } = payload;
    if (report) {
      queryClient.setQueryData<UsageReportEntry[]>(usageReportsQueryKey(serverId), (reports) =>
        reports ? replaceReport(reports, reportId, report) : reports,
      );
      void queryClient.invalidateQueries({
        queryKey: hostUsageQueryKey(serverId),
        predicate: (query) => query.queryKey[2] === "agent",
      });
    }
    setConsumeState(key, { status: "done", outcome: payload.outcome });
    return true;
  } catch (error) {
    setConsumeState(key, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function useResetConsume(input: { serverId: string; reportId: string }): {
  state: ResetConsumeState;
  consume: (onDone: () => void) => void;
  /** 收起结果或失败。 */
  dismiss: () => void;
  /** 只收起失败：关掉确认框时用，刚用完的结果留在卡片上。 */
  clearFailure: () => void;
} {
  const { serverId, reportId } = input;
  const queryClient = useQueryClient();
  const key = consumeKey(serverId, reportId);
  const state = useResetConsumeStore((current) => current.byKey[key] ?? IDLE);
  const consume = useCallback(
    (onDone: () => void) => {
      void (async () => {
        if (await consumeReset({ queryClient, serverId, reportId })) onDone();
      })();
    },
    [queryClient, reportId, serverId],
  );
  const dismiss = useCallback(() => setConsumeState(key, IDLE), [key]);
  const clearFailure = useCallback(() => {
    if (useResetConsumeStore.getState().byKey[key]?.status === "failed") setConsumeState(key, IDLE);
  }, [key]);
  return { state, consume, dismiss, clearFailure };
}
