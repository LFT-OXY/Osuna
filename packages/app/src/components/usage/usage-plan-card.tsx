import { RefreshCw } from "lucide-react-native";
import { Fragment, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UsageCard } from "@/components/usage/usage-card";
import { ProviderUsageList } from "@/provider-usage/list";
import type { ProviderUsageView } from "@/provider-usage/types";
import { useProviderUsageHosts } from "@/provider-usage/use-provider-usage-hosts";
import type { UsageHostInput } from "@/usage/aggregated-usage";
import { describeTimeAgo } from "@/usage/relative-time";
import { renderUsageText } from "@/usage/text";

interface UsagePlanCardProps {
  hosts: readonly UsageHostInput[];
  /** 计入不止一台主机时，每组前面报出主机名。 */
  isMultiHost: boolean;
}

export function UsagePlanCard({ hosts, isMultiHost }: UsagePlanCardProps) {
  const { t } = useTranslation();
  const { groups, fetchedAt, isBusy, refresh } = useProviderUsageHosts(hosts);
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
          onPress={refresh}
          accessibilityLabel={t("usage.planUsage.refresh")}
        >
          {isBusy ? t("usage.planUsage.refreshing") : t("usage.planUsage.refresh")}
        </Button>
      </View>
    ),
    [isBusy, refresh, t, updated],
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
              <PlanUsageBody view={group.view} onRetry={refresh} />
            </Fragment>
          ))}
        </View>
      )}
    </UsageCard>
  );
}

function PlanUsageBody({ view, onRetry }: { view: ProviderUsageView; onRetry: () => void }) {
  const { t } = useTranslation();

  if (view.kind === "loading") {
    return <Text style={styles.message}>{t("usage.planUsage.loading")}</Text>;
  }

  if (view.kind === "error") {
    return (
      <Alert
        variant="error"
        title={t("usage.planUsage.errorTitle")}
        description={renderUsageText(t, view.message)}
      >
        <Button variant="outline" size="sm" onPress={onRetry}>
          {t("common.actions.retry")}
        </Button>
      </Alert>
    );
  }

  if (view.payload.providers.length === 0) {
    return <Text style={styles.message}>{t("usage.planUsage.empty")}</Text>;
  }

  return <ProviderUsageList providers={view.payload.providers} />;
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    updated: {
      fontSize: 11,
      color: palette.inkFaint,
    },
    groups: {
      gap: theme.spacing[4],
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
