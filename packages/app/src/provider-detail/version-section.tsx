import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";

// 详情页的"版本"一节：已装的内置提供方才出现，和安装指引互斥。
export function ProviderVersionSection({ installedVersion }: { installedVersion: string }) {
  const { t } = useTranslation();
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
            {t("settings.providers.version.value", { version: installedVersion })}
          </Text>
        </View>
      </View>
    </SettingsSection>
  );
}
