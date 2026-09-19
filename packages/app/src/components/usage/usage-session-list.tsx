import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useOpenUsageSession } from "@/hooks/use-open-usage-session";
import { useUsageSessions } from "@/hooks/use-usage-sessions";
import type { UsageHostsView } from "@/usage/details";
import { formatGroupedNumber, formatUsageCost, formatUsageTokensCompact } from "@/usage/format";
import type { MergedUsageSession } from "@/usage/sessions";
import { usageSourceColor, usageSourceLabel } from "@/usage/sources";
import { totalUsageTokens } from "@/usage/totals";
import { toErrorMessage } from "@/utils/error-messages";
import { formatDuration } from "@/utils/time";

interface UsageSessionListProps {
  day: string;
  hosts: UsageHostsView;
}

/** The sessions of one expanded day, from every counted host. */
export function UsageSessionList({ day, hosts }: UsageSessionListProps) {
  const { t, i18n } = useTranslation();
  const { sessions, truncated, hostErrors, isPending, isError } = useUsageSessions({
    hosts: hosts.hosts,
    day,
    timezone: hosts.timezone,
  });
  const open = useOpenUsageSession();

  if (isPending) {
    return (
      <View style={styles.state} testID={`usage-sessions-loading-${day}`}>
        <LoadingSpinner size="small" color={styles.stateText.color} />
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.state} testID={`usage-sessions-error-${day}`}>
        <Text style={styles.stateText}>{t("usage.sessionRow.loadError")}</Text>
      </View>
    );
  }
  // A host that failed is named rather than silently missing from the list.
  const errors =
    hostErrors.length > 0 ? (
      <View style={styles.errors} testID={`usage-sessions-host-errors-${day}`}>
        {hostErrors.map((error) => (
          <Text key={error.serverId} style={styles.errorText}>
            {t("usage.sessionRow.hostLoadError", { host: error.serverName })}
          </Text>
        ))}
      </View>
    ) : null;

  if (sessions.length === 0) {
    return (
      <View style={styles.state} testID={`usage-sessions-empty-${day}`}>
        {errors}
        <Text style={styles.stateText}>{t("usage.sessionRow.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list} testID={`usage-sessions-${day}`}>
      {errors}
      {open.error ? (
        <Text style={styles.errorText} testID="usage-session-open-error">
          {toErrorMessage(open.error)}
        </Text>
      ) : null}
      {sessions.map((session) => (
        <UsageSessionRow
          key={session.key}
          session={session}
          hostLabel={hosts.isMultiHost ? (hosts.labels.get(session.serverId) ?? null) : null}
          locale={i18n.language}
          isOpening={open.pendingKey === session.key}
          onOpen={open.open}
        />
      ))}
      {truncated ? (
        <Text style={styles.truncated} testID={`usage-sessions-truncated-${day}`}>
          {t("usage.sessionRow.truncated", { count: sessions.length })}
        </Text>
      ) : null}
    </View>
  );
}

function UsageSessionRow({
  session,
  hostLabel,
  locale,
  isOpening,
  onOpen,
}: {
  session: MergedUsageSession;
  hostLabel: string | null;
  locale: string;
  isOpening: boolean;
  onOpen: (session: MergedUsageSession) => void;
}) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => onOpen(session), [onOpen, session]);
  const source = { cli: session.cli, backend: session.backend };
  const uncachedInput = session.totals.input;
  const cached = session.totals.cachedInput + session.totals.cacheWrite;
  const models = session.models.map((model) => model.model).join(" · ");

  return (
    <View style={styles.row} testID={`usage-session-row-${session.key}`}>
      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>
          <View style={[styles.sourceDot, { backgroundColor: usageSourceColor(source) }]} />
          <Text style={styles.projectName} numberOfLines={1}>
            {session.project.displayName}
          </Text>
          <Text style={styles.sourcePill}>{usageSourceLabel(source)}</Text>
          {hostLabel ? (
            <Text style={styles.hostBadge} testID={`usage-session-host-${session.key}`}>
              {hostLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.rowMeta}>
          {models ? (
            <Text style={styles.metaText} numberOfLines={1}>
              {models}
            </Text>
          ) : null}
          <Text style={styles.metaText}>{formatTime(session.firstAt, locale)}</Text>
          <Text style={styles.metaText}>{formatDuration(session.durationMs)}</Text>
        </View>
        <Text style={styles.rowBreakdown}>
          {t("usage.sessionRow.breakdown", {
            input: formatGroupedNumber(uncachedInput, locale),
            output: formatGroupedNumber(session.totals.output, locale),
            cache: formatGroupedNumber(cached, locale),
          })}
        </Text>
      </View>
      <View style={styles.rowStats}>
        <UsageSessionStat
          label={t("usage.columns.tokens")}
          value={formatUsageTokensCompact(totalUsageTokens(session.totals))}
        />
        <UsageSessionStat
          label={t("usage.columns.cost")}
          value={formatUsageCost(session.estimatedCost)}
        />
        <UsageSessionStat
          label={t("usage.columns.turns")}
          value={formatGroupedNumber(session.turns, locale)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("usage.sessionRow.open")}
          disabled={isOpening}
          onPress={handleOpen}
          style={styles.openButton}
          testID={`usage-session-open-${session.key}`}
        >
          <Text style={styles.openLabel}>
            {isOpening ? t("usage.sessionRow.opening") : t("usage.sessionRow.open")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function UsageSessionStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Time of day in the viewer's language; the row already sits under its date. */
function formatTime(at: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(at),
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    list: {
      backgroundColor: palette.tile,
      paddingHorizontal: theme.spacing[3],
    },
    state: {
      backgroundColor: palette.tile,
      paddingVertical: theme.spacing[3],
      alignItems: "center",
    },
    stateText: {
      fontSize: 12,
      color: palette.inkFaint,
    },
    errors: {
      paddingTop: theme.spacing[2],
      gap: 2,
    },
    errorText: {
      fontSize: 12,
      color: palette.amberFg,
      paddingTop: theme.spacing[2],
    },
    truncated: {
      fontSize: 11,
      color: palette.inkFaint,
      paddingVertical: theme.spacing[2],
    },
    row: {
      flexDirection: { xs: "column", md: "row" },
      alignItems: { xs: "stretch", md: "flex-start" },
      justifyContent: "space-between",
      gap: theme.spacing[2],
      paddingVertical: theme.spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: palette.divider,
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    rowTitle: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      flexWrap: "wrap",
    },
    sourceDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    projectName: {
      fontSize: 13,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
      flexShrink: 1,
    },
    sourcePill: {
      fontSize: 10,
      color: palette.inkMuted,
      borderWidth: 1,
      borderColor: palette.cardBorder,
      borderRadius: 999,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    hostBadge: {
      fontSize: 10,
      color: palette.inkFaint,
    },
    rowMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      flexWrap: "wrap",
    },
    metaText: {
      fontSize: 11,
      color: palette.inkMuted,
    },
    rowBreakdown: {
      fontSize: 11,
      color: palette.inkFaint,
    },
    rowStats: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
    },
    stat: {
      alignItems: "flex-end",
      minWidth: 48,
    },
    statValue: {
      fontSize: 13,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
    },
    statLabel: {
      fontSize: 10,
      color: palette.inkFaint,
    },
    openButton: {
      borderWidth: 1,
      borderColor: palette.cardBorder,
      borderRadius: 999,
      paddingHorizontal: theme.spacing[2],
      paddingVertical: 2,
    },
    openLabel: {
      fontSize: 11,
      fontWeight: theme.fontWeight.medium,
      color: palette.inkMuted,
    },
  };
});
