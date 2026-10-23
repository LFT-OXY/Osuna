import { useIsFocused } from "@react-navigation/native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollView } from "@/components/ui/scroll-view";
import { UsageDetailsCard } from "@/components/usage/usage-details-card";
import { UsageHeatmapCard } from "@/components/usage/usage-heatmap-card";
import {
  UsageOverviewCard,
  type UsageBreakdown,
  type UsageEndpointSelection,
} from "@/components/usage/usage-overview-card";
import { UsagePlanCard } from "@/components/usage/usage-plan-card";
import { UsageStatsCard } from "@/components/usage/usage-stats-card";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useUsageReport } from "@/hooks/use-usage-report";
import { useHostFeatureAvailabilityMap } from "@/runtime/host-features";
import type { UsageHostsView } from "@/usage-stats/details";
import { EMPTY_USAGE_REPORT } from "@/usage-stats/merge";
import {
  resolveUsageNow,
  resolveUsageRange,
  shiftUsageAnchor,
  type UsageCustomRange,
  type UsagePeriod,
} from "@/usage-stats/period";
import { useUsageHosts } from "@/usage-stats/use-usage-hosts";
import { getDeviceTimeZone } from "@/utils/device-timezone";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  const now = useMemo(() => resolveUsageNow(timezone), [timezone]);
  const today = now.day;

  const [period, setPeriod] = useState<UsagePeriod>("all");
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState<UsageCustomRange>({ from: today, to: today });
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<UsageEndpointSelection | null>(null);
  const [breakdown, setBreakdown] = useState<UsageBreakdown>("sources");

  const { options: hostOptions, selection: hostSelection } = useUsageHosts(selectedServerId);
  const range = useMemo(
    () => resolveUsageRange({ period, anchor, custom }),
    [anchor, custom, period],
  );
  const { loadState, hostErrors, backfill, isError, isRefetching, refetch } = useUsageReport({
    hosts: hostSelection.hosts,
    range,
    timezone,
  });
  // COMPAT(gatewayLedger): added in v0.17.0, remove gate after 2027-04-23.
  // 只问带中转站账本的主机按接口筛选：老 daemon 不认这个筛选，会把全部的数交回来。
  const hostIds = useMemo(
    () => hostSelection.hosts.map((host) => host.serverId),
    [hostSelection.hosts],
  );
  const ledgerSupport = useHostFeatureAvailabilityMap(hostIds, "gatewayLedger");
  const ledgerHosts = useMemo(
    () => hostSelection.hosts.filter((host) => ledgerSupport.get(host.serverId) === true),
    [hostSelection.hosts, ledgerSupport],
  );
  const activeEndpoint = ledgerHosts.length > 0 ? selectedEndpoint : null;
  const endpointFilter = useMemo(
    () => (activeEndpoint ? [activeEndpoint.endpointId] : undefined),
    [activeEndpoint],
  );
  const filtered = useUsageReport({
    hosts: ledgerHosts,
    range,
    timezone,
    endpoints: endpointFilter,
    enabled: endpointFilter !== undefined,
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

  const allReport = loadState.status === "loaded" ? loadState.data : EMPTY_USAGE_REPORT;
  // 选了一家接口时页面上的数都按它筛过；接口卡片自己仍用全部的数，好换到别家。
  const report =
    endpointFilter && filtered.loadState.status === "loaded" ? filtered.loadState.data : allReport;
  const endpoints = ledgerHosts.length > 0 ? allReport.endpoints : undefined;
  const detailsHosts = useMemo<UsageHostsView>(
    () => ({
      hosts: hostSelection.hosts,
      labels: new Map(hostOptions.map((option) => [option.serverId, option.serverName])),
      isMultiHost: hostSelection.countedCount > 1,
      timezone,
    }),
    [hostOptions, hostSelection.countedCount, hostSelection.hosts, timezone],
  );

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
        endpoints={endpoints}
        selectedEndpoint={activeEndpoint}
        breakdown={breakdown}
        onBreakdownChange={setBreakdown}
        isRefreshing={isRefetching}
        hostOptions={hostOptions}
        hostSelection={hostSelection}
        onPeriodChange={handlePeriodChange}
        onShift={handleShift}
        onCustomChange={handleCustomChange}
        onSelectSource={setSelectedSourceKey}
        onSelectEndpoint={setSelectedEndpoint}
        onSelectHost={setSelectedServerId}
        onRefresh={refetch}
      />
    );
    const sideColumn = (
      <View style={styles.sideColumn}>
        <UsageStatsCard report={report} today={today} />
        <UsageHeatmapCard heatmapDays={report.heatmapDays} today={today} timezone={timezone} />
        <UsagePlanCard hosts={hostSelection.hosts} isMultiHost={hostSelection.countedCount > 1} />
      </View>
    );
    const mainColumn = (
      <View style={styles.mainColumn}>
        {overview}
        <UsageDetailsCard report={report} hosts={detailsHosts} />
      </View>
    );

    body = (
      // The page padding lives on this inner View, not on `contentContainerStyle`:
      // Unistyles drops that prop on web. See docs/unistyles.md.
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} testID="usage-page">
        <View style={styles.content}>
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
    content: {
      padding: { xs: theme.spacing[3], md: theme.spacing[6] },
      gap: theme.spacing[4],
    },
    grid: {
      flexDirection: { xs: "column", md: "row" },
      alignItems: "stretch",
      gap: theme.spacing[4],
    },
    // 只在并排（md）时按 4:8 分宽；窄窗口里上下排，高度跟着内容，否则 flexBasis 0 会把卡片压扁叠在一起。
    sideColumn: {
      flexGrow: { xs: 0, md: 4 },
      flexShrink: 1,
      flexBasis: { xs: "auto", md: 0 },
      minWidth: 0,
      gap: theme.spacing[4],
    },
    mainColumn: {
      flexGrow: { xs: 0, md: 8 },
      flexShrink: 1,
      flexBasis: { xs: "auto", md: 0 },
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
