import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { UsageCard } from "@/components/usage/usage-card";
import { formatUsageShare, formatUsageTokensCompact } from "@/usage/format";
import type { MergedUsageReport } from "@/usage/merge";
import { formatUsageDay } from "@/usage/range-label";
import { deriveUsageStats, type UsageTopModel } from "@/usage/stats";

interface UsageStatsCardProps {
  report: MergedUsageReport;
  today: string;
}

export function UsageStatsCard({ report, today }: UsageStatsCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const stats = useMemo(
    () =>
      deriveUsageStats({
        summary: report.summary,
        models: report.models,
        heatmapDays: report.heatmapDays,
        today,
      }),
    [report.heatmapDays, report.models, report.summary, today],
  );

  return (
    <UsageCard title={t("usage.stats.title")} testID="usage-stats-card">
      <View style={styles.tiles}>
        <UsageStatTile
          label={t("usage.stats.last7Days")}
          value={formatUsageTokensCompact(stats.last7Days)}
          testID="usage-stat-last-7-days"
        />
        <UsageStatTile
          label={t("usage.stats.last30Days")}
          value={formatUsageTokensCompact(stats.last30Days)}
          testID="usage-stat-last-30-days"
        />
        <UsageStatTile
          label={t("usage.stats.average")}
          value={formatUsageTokensCompact(stats.avgPerActiveDay)}
          testID="usage-stat-average"
        />
        <UsageStatTile
          label={t("usage.stats.sessions")}
          value={formatUsageTokensCompact(stats.sessionCount)}
          testID="usage-stat-sessions"
        />
      </View>
      {stats.topModels.length > 0 ? (
        <View style={styles.ranks} testID="usage-stats-top-models">
          {stats.topModels.map((model, index) => (
            <UsageModelRank key={model.model} model={model} rank={index + 1} locale={locale} />
          ))}
        </View>
      ) : null}
      <View style={styles.footer}>
        <View style={styles.footerItem} testID="usage-stat-first-used">
          <Text style={styles.footerLabel}>{t("usage.stats.firstUsed")}</Text>
          <Text style={styles.footerValue}>
            {stats.firstActiveDay
              ? formatUsageDay(stats.firstActiveDay, locale)
              : t("usage.stats.none")}
          </Text>
        </View>
        <View style={styles.footerItem} testID="usage-stat-active-days">
          <Text style={styles.footerLabel}>{t("usage.stats.activeDays")}</Text>
          <Text style={styles.footerValue}>
            {stats.activeDays === 1
              ? t("usage.stats.dayCountOne")
              : t("usage.stats.dayCountMany", { count: stats.activeDays })}
          </Text>
        </View>
      </View>
    </UsageCard>
  );
}

function UsageStatTile({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1} testID={testID}>
        {value}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function UsageModelRank({
  model,
  rank,
  locale,
}: {
  model: UsageTopModel;
  rank: number;
  locale: string;
}) {
  return (
    <View style={styles.rank}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankBadgeText}>{rank}</Text>
      </View>
      <Text style={styles.rankName} numberOfLines={1}>
        {model.model}
      </Text>
      <Text style={styles.rankShare}>{formatUsageShare(model.share, locale)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    tiles: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[2],
    },
    tile: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: { xs: "40%", md: 0 },
      minWidth: 0,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[1],
      borderRadius: 8,
      backgroundColor: palette.tile,
    },
    tileValue: {
      fontSize: 14,
      fontWeight: theme.fontWeight.semibold,
      color: palette.ink,
      fontVariant: ["tabular-nums"],
    },
    tileLabel: {
      marginTop: 2,
      fontSize: 10,
      color: palette.inkFaint,
    },
    ranks: {
      marginTop: theme.spacing[4],
      borderTopWidth: 1,
      borderTopColor: palette.divider,
      paddingTop: theme.spacing[1],
    },
    rank: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: theme.spacing[2],
    },
    rankBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.rankBadge,
    },
    rankBadgeText: {
      fontSize: 10,
      fontWeight: theme.fontWeight.semibold,
      color: palette.inkMuted,
    },
    rankName: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: theme.spacing[3],
      fontSize: 14,
      color: palette.ink3,
    },
    rankShare: {
      fontSize: 14,
      fontWeight: theme.fontWeight.semibold,
      color: palette.ink,
      fontVariant: ["tabular-nums"],
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[2],
      marginTop: theme.spacing[4],
      borderTopWidth: 1,
      borderTopColor: palette.divider,
      paddingTop: theme.spacing[3],
    },
    footerItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      minWidth: 0,
    },
    footerLabel: {
      fontSize: 12,
      color: palette.inkFaint,
    },
    footerValue: {
      fontSize: 12,
      color: palette.inkMuted,
      fontVariant: ["tabular-nums"],
    },
  };
});
