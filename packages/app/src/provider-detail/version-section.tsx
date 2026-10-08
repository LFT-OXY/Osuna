import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import type { ProviderUpgradeState } from "./upgrade";
import { ProviderUpgradeButton, ProviderUpgradeFailure } from "./upgrade-view";

export interface ProviderVersionUpgrade {
  providerLabel: string;
  state: ProviderUpgradeState;
  onUpgrade: () => void;
  onDismissFailure: () => void;
}

// 详情页的"版本"一节：已装的内置提供方才出现；有新版本时显示"v{当前} → v{最新}"。
// 传了 upgrade（设置页的 Providers 页）时，有新版本就带"升级"按钮，失败的输出显示在这一节里。
export function ProviderVersionSection({
  installedVersion,
  latestVersion,
  upgrade,
  hasInstallSectionBelow,
}: {
  installedVersion: string;
  latestVersion?: string;
  upgrade?: ProviderVersionUpgrade;
  hasInstallSectionBelow: boolean;
}) {
  const { t } = useTranslation();
  const value = latestVersion
    ? t("settings.providers.version.update", { from: installedVersion, to: latestVersion })
    : t("settings.providers.version.value", { version: installedVersion });
  const failure = upgrade?.state.status === "failed" ? upgrade.state : null;
  return (
    <SettingsSection
      title={t("settings.providers.version.title")}
      testID="provider-version-section"
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text variant="body">{t("settings.providers.version.installed")}</Text>
          </View>
          <Text variant="body" color="foregroundMuted" selectable>
            {value}
          </Text>
          {upgrade && latestVersion ? (
            <ProviderUpgradeButton
              providerLabel={upgrade.providerLabel}
              installedVersion={installedVersion}
              latestVersion={latestVersion}
              isUpgrading={upgrade.state.status === "upgrading"}
              onUpgrade={upgrade.onUpgrade}
            />
          ) : null}
        </View>
        {upgrade && failure ? (
          <View style={[settingsStyles.rowBorder, styles.failureRow]}>
            <ProviderUpgradeFailure
              state={failure}
              hasInstallSectionBelow={hasInstallSectionBelow}
              onDismiss={upgrade.onDismissFailure}
            />
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  failureRow: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
}));
