import { useCallback, useMemo } from "react";
import { skipToken, useQueryClient, type SkipToken } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import {
  hostUsageQueryKey,
  listHostUsageReports,
  requireUsageClient,
  usageReportsQueryKey,
  useHostReportsUsage,
} from "@/usage/queries";
import type { UsageReportEntry } from "@/usage/types";

// 与 daemon 的 5 分钟缓存对齐：常驻显示的自动刷新不会多打来源的账户接口。
export const STRIP_USAGE_REFRESH_MS = 5 * 60 * 1000;

/** 用量条从哪里取报告；测试里换成假的。 */
export interface StripUsageSource {
  /** 主机上的全部账号，与套餐用量弹窗、侧栏摘要同一条查询。 */
  listHostReports: () => Promise<UsageReportEntry[]>;
  /** daemon 按这个 Agent 实际所用的登录报出的账号。 */
  listAgentReports: (agentId: string) => Promise<UsageReportEntry[]>;
}

/**
 * 用量条自己的一份「这个 Agent 的账号」。上下文圆环悬浮卡的那份只在卡片打开时存在、
 * 关上就丢，常驻的用量条不能和它共用一个键。
 */
function stripAgentReportsQueryKey(serverId: string, agentId: string) {
  return [...hostUsageQueryKey(serverId), "strip", agentId] as const;
}

/**
 * 草稿没有 Agent 可问，直接看主机的列表。有 Agent 时先等 daemon 答：它没报出账号
 * （提供方不随会话报账号）或没问成，才去取主机的列表；之前的答案还在就继续用它。
 */
export function stripNeedsHostReports(input: StripAgentAnswer): boolean {
  if (input.agentId === null) return true;
  if (input.agentReports) return input.agentReports.length === 0;
  return input.agentFailed;
}

/** daemon 对「这个 Agent 用的是哪个账号」答到哪一步了。 */
export interface StripAgentAnswer {
  /** 草稿还没有 Agent 时为 null。 */
  agentId: string | null;
  /** 还没答、或没问成时为 undefined。 */
  agentReports: readonly UsageReportEntry[] | undefined;
  agentFailed: boolean;
}

export interface StripReportsInput extends StripAgentAnswer {
  /** 主机连着且能报套餐用量。 */
  canReport: boolean;
  /** 主机列表那条查询里现有的数据；它与侧栏共用，窄栏没去取时也可能有。 */
  hostReports: readonly UsageReportEntry[] | undefined;
}

/** 交给 `selectPlanUsageStripReport` 挑账号的两份报告。 */
export interface StripReports {
  /** 没有 Agent、还没问到或没问成时为 null。 */
  agentReports: readonly UsageReportEntry[] | null;
  /** 用量条不该看主机的列表、或列表还没取到时为 null。 */
  hostReports: readonly UsageReportEntry[] | null;
}

const NO_STRIP_REPORTS: StripReports = { agentReports: null, hostReports: null };

/**
 * 主机的列表只在用量条该看它的时候才交出去。它和侧栏共用缓存，一打开应用就有；daemon 还没
 * 答出 Agent 的账号时就拿它显示，会先闪一下主机上的第一个账号，再换成 Agent 真正用的那个。
 */
export function resolveStripReports(input: StripReportsInput): StripReports {
  // 主机断开或太旧时缓存里可能还留着之前的报告，这时不拿出来显示。
  if (!input.canReport) return NO_STRIP_REPORTS;
  const hasAgent = input.agentId !== null;
  let agentReports: StripReports["agentReports"] = null;
  if (hasAgent) agentReports = input.agentReports ?? null;
  let hostReports: StripReports["hostReports"] = null;
  if (stripNeedsHostReports(input)) hostReports = input.hostReports ?? null;
  return { agentReports, hostReports };
}

type AgentReportsQueryFn = SkipToken | (() => Promise<UsageReportEntry[]>);

function agentReportsQueryFn(
  source: StripUsageSource,
  agentId: string | null,
): AgentReportsQueryFn {
  if (agentId === null) return skipToken;
  return () => source.listAgentReports(agentId);
}

interface StripAgentReportsQueryInput {
  serverId: string;
  /** 草稿还没有 Agent 时为 null。 */
  agentId: string | null;
  source: StripUsageSource;
  /** 窄栏可见，且主机连着、能报套餐用量。 */
  enabled: boolean;
}

// 写明形状：`skipToken` 的类型从对象字面量里推出来会被放宽成 symbol，查询封装不收。
interface StripAgentReportsQuery {
  queryKey: ReturnType<typeof stripAgentReportsQueryKey>;
  queryFn: AgentReportsQueryFn;
  enabled: boolean;
  dataShape: "value";
  staleTimeMs: number;
  refetchInterval: number | false;
  retry: false;
}

/** 「这个 Agent 用的是哪个账号」。用量条常驻显示，所以开着时每 5 分钟刷新一次。 */
export function stripAgentReportsQueryInput(
  input: StripAgentReportsQueryInput,
): StripAgentReportsQuery {
  const { serverId, agentId, source } = input;
  const hasAgent = agentId !== null;
  const enabled = input.enabled && hasAgent;
  const refetchInterval = enabled ? STRIP_USAGE_REFRESH_MS : false;
  // 草稿没有 Agent：这条查询不取数，键里的空串只是占位。
  const queryKey = stripAgentReportsQueryKey(serverId, agentId ?? "");
  const queryFn = agentReportsQueryFn(source, agentId);
  return {
    queryKey,
    queryFn,
    enabled,
    // 换了 Agent 就是另一个账号，前一个的报告不顶替。
    dataShape: "value",
    staleTimeMs: STRIP_USAGE_REFRESH_MS,
    refetchInterval,
    // daemon 的报错（不认识这个 Agent）重试也不会好；用量条这时改看主机的列表。
    retry: false,
  };
}

interface StripHostReportsQueryInput {
  serverId: string;
  source: StripUsageSource;
  /** 窄栏可见、主机能报套餐用量，并且用量条要看主机的列表（`stripNeedsHostReports`）。 */
  enabled: boolean;
}

/** 主机上的全部账号，与套餐用量弹窗、侧栏摘要同一条查询；用量条用到它时每 5 分钟刷新一次。 */
export function stripHostReportsQueryInput(input: StripHostReportsQueryInput) {
  const { enabled } = input;
  const refetchInterval = enabled ? STRIP_USAGE_REFRESH_MS : (false as const);
  const queryKey = usageReportsQueryKey(input.serverId);
  const queryFn = input.source.listHostReports;
  return {
    queryKey,
    queryFn,
    enabled,
    dataShape: "list" as const,
    staleTimeMs: STRIP_USAGE_REFRESH_MS,
    refetchInterval,
  };
}

interface UseStripUsageInput {
  serverId: string;
  agentId: string | null;
  /** 窄栏是否可见；隐藏的保留面板不取数。 */
  isVisible: boolean;
}

export interface StripUsage extends StripReports {
  /** 再取一次用量条正在看的那份报告；daemon 的缓存挡着来源的接口。 */
  refresh: () => void;
}

/**
 * Composer 用量条读的报告。连着旧 daemon（不报套餐用量）时两条查询都不开，用量条不显示。
 */
export function useStripUsage({ serverId, agentId, isVisible }: UseStripUsageInput): StripUsage {
  const queryClient = useQueryClient();
  const canReport = useHostReportsUsage(serverId);
  const enabled = isVisible && canReport;
  const source = useMemo<StripUsageSource>(
    () => ({
      listHostReports: () => listHostUsageReports(queryClient, serverId),
      listAgentReports: async (id) => {
        const { reports } = await requireUsageClient(serverId).listUsageReports({ agentId: id });
        return reports;
      },
    }),
    [queryClient, serverId],
  );
  const agentInput = stripAgentReportsQueryInput({ serverId, agentId, source, enabled });
  const agentQuery = useFetchQuery(agentInput);
  const agentAnswer: StripAgentAnswer = {
    agentId,
    agentReports: agentQuery.data,
    agentFailed: agentQuery.isError,
  };
  const readsHost = enabled && stripNeedsHostReports(agentAnswer);
  const hostInput = stripHostReportsQueryInput({ serverId, source, enabled: readsHost });
  const hostQuery = useFetchQuery(hostInput);

  const agentKey = agentInput.queryKey;
  const hostKey = hostInput.queryKey;
  const refreshesAgent = agentInput.enabled;
  const refreshesHost = hostInput.enabled;
  const refresh = useCallback(() => {
    if (refreshesAgent) void queryClient.invalidateQueries({ queryKey: agentKey });
    if (refreshesHost) void queryClient.invalidateQueries({ queryKey: hostKey });
  }, [agentKey, hostKey, queryClient, refreshesAgent, refreshesHost]);

  const reports = resolveStripReports({ ...agentAnswer, canReport, hostReports: hostQuery.data });
  return { ...reports, refresh };
}
