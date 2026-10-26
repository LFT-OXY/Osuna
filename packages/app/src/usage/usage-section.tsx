import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import type { UsageDisplay } from "./display";
import { UsageControls } from "./controls";
import { UsageList } from "./list";
import { CliSignInsOffNotice } from "./cli-sign-ins-off-notice";
import type { UsageView } from "./types";

export function UsageSection({
  serverId,
  title,
  view,
  display,
  onRefresh,
  testID,
}: {
  serverId: string;
  title: string;
  view: UsageView;
  display: UsageDisplay;
  onRefresh: () => void;
  testID?: string;
}) {
  const trailing = useMemo(
    () => <UsageControls view={view} onRefresh={onRefresh} />,
    [onRefresh, view],
  );

  return (
    <SettingsSection title={title} testID={testID} trailing={trailing}>
      <UsageBody serverId={serverId} view={view} display={display} onRefresh={onRefresh} />
    </SettingsSection>
  );
}

/** What a host's usage view shows: its reports, or why there are none. */
export function UsageBody({
  serverId,
  view,
  display,
  onRefresh,
  onLeave,
}: {
  serverId: string;
  view: UsageView;
  display: UsageDisplay;
  onRefresh: () => void;
  /** Osuna：要跳去别的页面时先调用，弹窗借它先关掉。 */
  onLeave?: () => void;
}) {
  const { t } = useTranslation();
  if (view.kind === "unavailable") {
    return <UsageMessage text={view.message} />;
  }

  if (view.kind === "loading") {
    return <UsageMessage text={t("providerUsage.loading")} />;
  }

  if (view.kind === "error") {
    return (
      <Alert
        size="sm"
        variant="error"
        title={t("providerUsage.errorTitle")}
        description={view.message}
      >
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {t("providerUsage.retry")}
        </Button>
      </Alert>
    );
  }

  if (view.kind === "cliSignInsOff") {
    return <CliSignInsOffNotice serverId={serverId} onLeave={onLeave} />;
  }

  if (view.reports.length === 0) {
    return <UsageMessage text={t("providerUsage.empty")} />;
  }

  return <UsageList serverId={serverId} reports={view.reports} display={display} />;
}

export function UsageMessage({ text }: { text: string }) {
  return (
    <View style={[settingsStyles.card, styles.emptyCard]}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
