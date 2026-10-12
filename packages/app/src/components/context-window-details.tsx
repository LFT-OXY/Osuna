import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { selectActiveApiEndpoint } from "@/api-endpoints";
import { Text as UiText } from "@/components/ui/text";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { AgentUsage } from "@/usage";
import { formatSessionCost, formatTokenArrows } from "@/usage-stats/format";
import { isUsageTrackedProvider } from "@/usage-stats/sources";
import {
  addRunningTurnElapsed,
  hasAgentUsage,
  resolveSessionSpanMs,
} from "@/usage-stats/turn-usage";
import {
  useAgentUsageSummary,
  type AgentUsageScope,
  type AgentUsageSummaryPayload,
} from "@/usage-stats/use-agent-usage";
import { formatDuration } from "@/utils/time";
import { formatTokenCount } from "./context-window-meter.utils";

interface ContextWindowDetailsProps {
  serverId: string;
  agentId: string;
  context: {
    percentage: number;
    usedTokens: number;
    maxTokens: number;
  } | null;
  /** The Paseo provider key; names the API endpoint the agent runs on. */
  provider: string | null;
  /** `features.usage`; `null` while the host has not said. */
  usageSupport: boolean | null;
  /** Start of the turn in flight, added to the agent's settled runtime as a stopwatch. */
  runningTurnStartedAt: Date | null;
  /** The hover card and tooltip title themselves; the sheet's header carries the title instead. */
  showTitle: boolean;
  /** Whether the usage cards have a Refresh button; without one they show their freshness. */
  refreshable: boolean;
}

/**
 * What the context window meter opens: how full the window is, Osuna's session total for this
 * agent (tokens, estimated cost, runtime), the API endpoint it runs on, then the usage of the
 * agent's account. The desktop hover card, the native wide tooltip, and the compact sheet all
 * render it.
 */
export function ContextWindowDetails({
  serverId,
  agentId,
  context,
  provider,
  usageSupport,
  runningTurnStartedAt,
  showTitle,
  refreshable,
}: ContextWindowDetailsProps) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.summary}>
        {showTitle ? <Text style={styles.title}>{t("contextWindow.title")}</Text> : null}
        {context ? (
          <>
            <Text style={styles.text}>
              {t("contextWindow.used", { percentage: context.percentage })}
            </Text>
            <Text style={styles.detail}>
              {t("contextWindow.tokens", {
                used: formatTokenCount(context.usedTokens),
                max: formatTokenCount(context.maxTokens),
              })}
            </Text>
          </>
        ) : (
          <Text style={styles.detail}>{t("contextWindow.noData")}</Text>
        )}
      </View>
      <SessionTotal
        serverId={serverId}
        agentId={agentId}
        provider={provider}
        usageSupport={usageSupport}
        runningTurnStartedAt={runningTurnStartedAt}
      />
      <ActiveApiEndpointNote serverId={serverId} provider={provider} />
      <AgentUsage serverId={serverId} agentId={agentId} refreshable={refreshable} />
    </>
  );
}

type SessionTotalState =
  | { kind: "hostUpgradeRequired" }
  | { kind: "summary"; summary: AgentUsageSummaryPayload };

/**
 * What this agent has spent across every provider session it ran in. A host
 * that predates `features.usage` says so instead of showing nothing, so the
 * missing numbers read as an old daemon rather than as a zero.
 */
function resolveSessionTotal(
  usageSupport: boolean | null,
  summary: AgentUsageSummaryPayload | undefined,
  provider: string | null,
): SessionTotalState | null {
  if (usageSupport === null) return null;
  if (usageSupport === false) return { kind: "hostUpgradeRequired" };
  // Zero for a CLI the scanner reads means the scan has not reached this agent —
  // the section shows and marks itself incomplete. Zero for any other provider
  // means there is nothing to read, and a row of zeroes would read as "free".
  if (!summary || !(hasAgentUsage(summary) || isUsageTrackedProvider(provider))) return null;
  return { kind: "summary", summary };
}

/** Osuna 的本会话合计。详情只在打开时挂载，所以这里直接读汇总；事件订阅在圆环上。 */
function SessionTotal({
  serverId,
  agentId,
  provider,
  usageSupport,
  runningTurnStartedAt,
}: {
  serverId: string;
  agentId: string;
  provider: string | null;
  usageSupport: boolean | null;
  runningTurnStartedAt: Date | null;
}) {
  const usageScope = useMemo<AgentUsageScope | null>(
    () => (usageSupport === true ? { serverId, agentId } : null),
    [agentId, serverId, usageSupport],
  );
  const { payload: summary } = useAgentUsageSummary(usageScope);
  const state = resolveSessionTotal(usageSupport, summary, provider);
  if (!state) return null;
  return (
    <>
      <View style={styles.divider} />
      <SessionTotalSection state={state} runningTurnStartedAt={runningTurnStartedAt} />
    </>
  );
}

function SessionTotalSection({
  state,
  runningTurnStartedAt,
}: {
  state: SessionTotalState;
  runningTurnStartedAt: Date | null;
}) {
  const { t } = useTranslation();
  if (state.kind === "hostUpgradeRequired") {
    return (
      <View style={styles.section} testID="context-window-session-total">
        <UiText variant="micro" weight="medium" color="foregroundExtraMuted">
          {t("contextWindow.sessionTotal.title")}
        </UiText>
        <UiText variant="caption" color="foregroundMuted">
          {t("contextWindow.sessionTotal.hostUpgradeRequired")}
        </UiText>
      </View>
    );
  }

  const { summary } = state;
  const spanMs = resolveSessionSpanMs(summary);
  const turnsValue = runningTurnStartedAt
    ? t("contextWindow.sessionTotal.turnsRunning", { turns: summary.turns })
    : String(summary.turns);
  return (
    <View style={styles.section} testID="context-window-session-total">
      <View style={styles.sectionHeader}>
        <UiText variant="micro" weight="medium" color="foregroundExtraMuted">
          {t("contextWindow.sessionTotal.title")}
        </UiText>
        {summary.complete ? null : (
          <UiText variant="micro" color="statusWarning">
            {t("contextWindow.sessionTotal.incomplete")}
          </UiText>
        )}
      </View>
      <KeyValueRow label={t("contextWindow.sessionTotal.tokens")}>
        {formatTokenArrows(summary.totals.input, summary.totals.output)}
      </KeyValueRow>
      <KeyValueRow label={t("contextWindow.sessionTotal.estimatedCost")}>
        {formatSessionCost(summary.estimatedCost)}
      </KeyValueRow>
      <KeyValueRow label={t("contextWindow.sessionTotal.turns")}>{turnsValue}</KeyValueRow>
      <KeyValueRow label={t("contextWindow.sessionTotal.agentRuntime")}>
        <AgentRuntimeValue
          durationMs={summary.durationMs}
          runningTurnStartedAt={runningTurnStartedAt}
        />
      </KeyValueRow>
      {spanMs === null ? null : (
        <KeyValueRow label={t("contextWindow.sessionTotal.sessionSpan")}>
          {formatDuration(spanMs)}
        </KeyValueRow>
      )}
    </View>
  );
}

/** 该提供方当前启用的第三方接口；套餐额度这时不代表实际消耗。 */
function ActiveApiEndpointNote({
  serverId,
  provider,
}: {
  serverId: string;
  provider: string | null;
}) {
  const { t } = useTranslation();
  const { entries } = useProvidersSnapshot(serverId, { enabled: provider !== null });
  const activeApiEndpoint = selectActiveApiEndpoint(entries, provider);
  if (!activeApiEndpoint) return null;
  return (
    <UiText variant="caption" color="foregroundMuted" testID="context-window-api-endpoint">
      {t("usage.planUsage.apiEndpointNote", { name: activeApiEndpoint.name })}
    </UiText>
  );
}

/** 文字值按等宽数字排；组件值（如跳动的运行时长）自己负责排版。 */
function KeyValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.keyValueRow}>
      <UiText variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.keyLabel}>
        {label}
      </UiText>
      {typeof children === "string" ? (
        <UiText variant="caption" numberOfLines={1} style={styles.number}>
          {children}
        </UiText>
      ) : (
        children
      )}
    </View>
  );
}

/** Ticks only while a turn is in flight; a settled agent renders one string. */
function AgentRuntimeValue({
  durationMs,
  runningTurnStartedAt,
}: {
  durationMs: number;
  runningTurnStartedAt: Date | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const runningStartedAtMs = runningTurnStartedAt ? runningTurnStartedAt.getTime() : null;

  useEffect(() => {
    if (runningStartedAtMs === null) return;
    setNowMs(Date.now());
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [runningStartedAtMs]);

  return (
    <UiText variant="caption" numberOfLines={1} style={styles.number}>
      {formatDuration(addRunningTurnElapsed(durationMs, runningStartedAtMs, nowMs))}
    </UiText>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    gap: theme.spacing[1.5],
    minWidth: 200,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  // 与 AgentUsage 的分隔线同一条：浮层描边用的就是 borderAccent。
  divider: { height: 1, backgroundColor: theme.colors.borderAccent },
  section: {
    gap: theme.spacing[1.5],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  keyValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  keyLabel: {
    flexShrink: 1,
  },
  number: {
    fontVariant: ["tabular-nums"],
  },
}));
