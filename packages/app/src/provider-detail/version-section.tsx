import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";

// 详情页的"版本"一节：已装的内置提供方才出现，和安装指引互斥；有新版本时显示"v{当前} → v{最新}"。
export function ProviderVersionSection({
  installedVersion,
  latestVersion,
}: {
  installedVersion: string;
  latestVersion?: string;
}) {
  const { t } = useTranslation();
  const value = latestVersion
    ? t("settings.providers.version.update", { from: installedVersion, to: latestVersion })
    : t("settings.providers.version.value", { version: installedVersion });
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
        </View>
      </View>
    </SettingsSection>
  );
}
