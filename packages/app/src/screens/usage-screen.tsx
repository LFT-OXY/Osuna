import { useIsFocused } from "@react-navigation/native";
import type { UsageTrendStackBy } from "@getpaseo/protocol/usage/types";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollView } from "@/components/ui/scroll-view";
import { UsagePlaceholderCard } from "@/components/usage/usage-card";
import { UsageOverviewCard } from "@/components/usage/usage-overview-card";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useUsageReport } from "@/hooks/use-usage-report";
import { EMPTY_USAGE_REPORT } from "@/usage/merge";
import {
  resolveUsageRange,
  shiftUsageAnchor,
  type UsageCustomRange,
  type UsagePeriod,
} from "@/usage/period";
import { useUsageHosts } from "@/usage/use-usage-hosts";
import { getDeviceTimeZone } from "@/utils/device-timezone";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The trend card owns the by-source / by-model switch; until then it stacks by source. */
const TREND_STACK_BY: UsageTrendStackBy = "source";

/** Today in the viewer's own timezone, which is also what the report is bucketed by. */
function resolveToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function UsageScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <UsageScreenContent />;
}

function UsageScreenContent(): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const timezone = useMemo(() => getDeviceTimeZone(), []);
  const today = useMemo(() => resolveToday(timezone), [timezone]);

  const [period, setPeriod] = useState<UsagePeriod>("all");
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState<UsageCustomRange>({ from: today, to: today });
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  const { options: hostOptions, selection: hostSelection } = useUsageHosts(selectedServerId);
  const range = useMemo(
    () => resolveUsageRange({ period, anchor, custom }),
    [anchor, custom, period],
  );
  const { loadState, hostErrors, backfill, isError, isRefetching, refetch } = useUsageReport({
    hosts: hostSelection.hosts,
    range,
    stackBy: TREND_STACK_BY,
    timezone,
  });

  const handlePeriodChange = useCallback(
    (next: UsagePeriod) => {
      setPeriod(next);
      setAnchor(today);
    },
    [today],
  );
  const handleShift = useCallback(
    (delta: -1 | 1) => {
      setAnchor((current) => shiftUsageAnchor({ period, anchor: current, delta }));
    },
    [period],
  );
  // A half-typed date is not a range; the report keeps the last valid one.
  const handleCustomChange = useCallback((next: UsageCustomRange) => {
    if (!DAY_PATTERN.test(next.from) || !DAY_PATTERN.test(next.to)) return;
    setCustom(next);
  }, []);

  const report = loadState.status === "loaded" ? loadState.data : EMPTY_USAGE_REPORT;

  let body: ReactElement;
  if (loadState.status !== "loaded" && !isError) {
    body = (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  } else if (isError) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.message}>{t("usage.common.loadError")}</Text>
        <Button variant="ghost" onPress={refetch} testID="usage-retry">
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  } else {
    const overview = (
      <UsageOverviewCard
        report={report}
        backfill={backfill}
        period={period}
        anchor={anchor}
        custom={custom}
        today={today}
        selectedSourceKey={selectedSourceKey}
        isRefreshing={isRefetching}
        hostOptions={hostOptions}
        hostSelection={hostSelection}
        onPeriodChange={handlePeriodChange}
        onShift={handleShift}
        onCustomChange={handleCustomChange}
        onSelectSource={setSelectedSourceKey}
        onSelectHost={setSelectedServerId}
        onRefresh={refetch}
      />
    );
    const sideColumn = (
      <View style={styles.sideColumn}>
        <UsagePlaceholderCard
          title={t("usage.stats.title")}
          message={t("usage.common.comingSoon")}
          testID="usage-stats-card"
        />
        <UsagePlaceholderCard
          title={t("usage.heatmap.title")}
          message={t("usage.common.comingSoon")}
          testID="usage-heatmap-card"
        />
        <UsagePlaceholderCard
          title={t("usage.trend.title")}
          message={t("usage.common.comingSoon")}
          testID="usage-trend-card"
        />
        <UsagePlaceholderCard
          title={t("usage.planUsage.title")}
          message={t("usage.common.comingSoon")}
          testID="usage-plan-usage-card"
        />
      </View>
    );
    const mainColumn = (
      <View style={styles.mainColumn}>
        {overview}
        <UsagePlaceholderCard
          title={t("usage.details.title")}
          message={t("usage.common.comingSoon")}
          testID="usage-details-card"
        />
      </View>
    );

    body = (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="usage-page"
      >
        {hostErrors.length > 0 ? (
          <View style={styles.errorsBanner} testID="usage-host-errors">
            {hostErrors.map((error) => (
              <Text key={error.serverId} style={styles.errorsBannerText}>
                {t("usage.common.hostLoadError", { host: error.serverName })}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={styles.grid}>
          {isCompact ? (
            <>
              {mainColumn}
              {sideColumn}
            </>
          ) : (
            <>
              {sideColumn}
              {mainColumn}
            </>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader title={t("usage.title")} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface0,
    },
    scroll: {
      flex: 1,
      minHeight: 0,
    },
    scrollContent: {
      padding: { xs: theme.spacing[3], md: theme.spacing[6] },
      gap: theme.spacing[4],
    },
    grid: {
      flexDirection: { xs: "column", md: "row" },
      alignItems: "stretch",
      gap: theme.spacing[4],
    },
    sideColumn: {
      flexGrow: 4,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      gap: theme.spacing[4],
    },
    mainColumn: {
      flexGrow: 8,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      gap: theme.spacing[4],
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: theme.spacing[6],
      padding: theme.spacing[6],
    },
    spinner: {
      color: theme.colors.foregroundMuted,
    },
    message: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.base,
    },
    errorsBanner: {
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: palette.amberBorder,
      backgroundColor: palette.amberBg,
      padding: theme.spacing[3],
      gap: theme.spacing[1],
    },
    errorsBannerText: {
      fontSize: 12,
      color: palette.amberFg,
    },
  };
});
