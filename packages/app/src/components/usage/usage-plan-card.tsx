import { RefreshCw } from "lucide-react-native";
import { Fragment, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { selectActiveApiEndpoint } from "@/api-endpoints";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UsageCard } from "@/components/usage/usage-card";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { usePlanUsageHosts } from "@/plan-usage/use-hosts";
import { UsageCard as PlanUsageReportCard } from "@/usage/card";
import { usageCopy } from "@/usage/copy";
import { useUsageDisplay } from "@/usage/display";
import { useUsageInSidebar } from "@/usage/in-sidebar";
import type { UsageReportEntry, UsageView } from "@/usage/types";
import type { UsageHostInput } from "@/usage-stats/aggregated-usage";
import { describeTimeAgo } from "@/usage-stats/relative-time";
import { renderUsageText } from "@/usage-stats/text";

interface UsagePlanCardProps {
  hosts: readonly UsageHostInput[];
  /** 计入不止一台主机时，每组前面报出主机名。 */
  isMultiHost: boolean;
}

export function UsagePlanCard({ hosts, isMultiHost }: UsagePlanCardProps) {
  const { t } = useTranslation();
  const { groups, fetchedAt, isBusy, refresh, canRefresh } = usePlanUsageHosts(hosts);
  const updated = describeTimeAgo(fetchedAt, Date.now());

  const renderHeaderRight = useCallback(
    () => (
      <View style={styles.headerRight}>
        {updated ? <Text style={styles.updated}>{renderUsageText(t, updated)}</Text> : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={RefreshCw}
          loading={isBusy}
          disabled={!canRefresh}
          onPress={refresh}
          accessibilityLabel={t("usage.planUsage.refresh")}
        >
          {isBusy ? t("usage.planUsage.refreshing") : t("usage.planUsage.refresh")}
        </Button>
      </View>
    ),
    [canRefresh, isBusy, refresh, t, updated],
  );

  return (
    <UsageCard
      title={t("usage.planUsage.title")}
      renderHeaderRight={renderHeaderRight}
      testID="usage-plan-usage-card"
    >
      {groups.length === 0 ? (
        <Text style={styles.message}>{t("usage.planUsage.hostUnavailable")}</Text>
      ) : (
        <View style={styles.groups}>
          {groups.map((group) => (
            <Fragment key={group.serverId}>
              {isMultiHost ? <Text style={styles.host}>{group.serverName}</Text> : null}
              <PlanUsageBody serverId={group.serverId} view={group.view} onRetry={refresh} />
            </Fragment>
          ))}
        </View>
      )}
    </UsageCard>
  );
}

/** 一台主机的套餐用量：它的账号，或者为什么没有。状态的说法与套餐用量弹窗相同。 */
function PlanUsageBody({
  serverId,
  view,
  onRetry,
}: {
  serverId: string;
  view: UsageView;
  onRetry: () => void;
}) {
  if (view.kind === "unavailable") {
    return <Text style={styles.message}>{view.message}</Text>;
  }

  if (view.kind === "loading") {
    return <Text style={styles.message}>{usageCopy.loading}</Text>;
  }

  if (view.kind === "error") {
    return (
      <Alert size="sm" variant="error" title={usageCopy.errorTitle} description={view.message}>
        <Button variant="outline" size="sm" onPress={onRetry}>
          {usageCopy.retry}
        </Button>
      </Alert>
    );
  }

  if (view.reports.length === 0) {
    return <Text style={styles.message}>{usageCopy.empty}</Text>;
  }

  return <PlanUsageReports serverId={serverId} reports={view.reports} />;
}

/**
 * 每个账号一张上游的额度卡片。外壳是这一页的 `UsageCard`，所以卡片之间只用分隔线，
 * 再包一层卡片会变成双层边框。侧栏摘要打开时窗口行可以固定，与弹窗里一样。
 */
function PlanUsageReports({
  serverId,
  reports,
}: {
  serverId: string;
  reports: UsageReportEntry[];
}) {
  const { t } = useTranslation();
  const { display } = useUsageDisplay(reports);
  const { inSidebar } = useUsageInSidebar();
  // 同一主机的提供方快照，用来标注启用了第三方接口的提供方：它的套餐额度这时不代表实际消耗。
  const { entries } = useProvidersSnapshot(serverId);
  return (
    <View style={styles.reports}>
      {reports.map((entry, index) => {
        const usesApiEndpoints = selectActiveApiEndpoint(entries, entry.sourceId) !== null;
        return (
          <Fragment key={entry.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <PlanUsageReportCard
              serverId={serverId}
              entry={entry}
              display={display}
              compact
              pinnable={inSidebar}
              refreshable
            />
            {usesApiEndpoints ? (
              <Text style={styles.note}>{t("usage.planUsage.apiEndpointsOnNote")}</Text>
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    // 「刷新」的文字收在卡片内容的右边线上、与标题同一行高：按钮的内边距与多出的高度向外让。
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      marginRight: -theme.spacing[3],
      marginVertical: -theme.spacing[1],
    },
    updated: {
      fontSize: 11,
      color: palette.inkFaint,
    },
    groups: {
      gap: theme.spacing[4],
    },
    reports: {
      gap: theme.spacing[3],
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.border,
    },
    note: {
      fontSize: 13,
      color: palette.inkFaint,
    },
    host: {
      fontSize: 11,
      color: palette.inkFaint,
    },
    message: {
      fontSize: 13,
      color: palette.inkFaint,
      paddingVertical: theme.spacing[2],
    },
  };
});
