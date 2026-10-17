import React from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import type { WebSearchSaveState } from "./use-endpoint-detail";

/**
 * 接口详情页的「联网搜索」：一个「自己能联网搜索」开关（ADR 0009）。只在这家有 Anthropic 或 Responses 地址时由
 * 调用方放出来；切换即保存，失败原因留在开关下面，直到再切一次。
 */
export function ApiEndpointWebSearchSection({
  value,
  save,
  onChange,
}: {
  value: boolean;
  save: WebSearchSaveState;
  onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = t("settings.apiEndpoints.webSearch.switch");
  const hint = (
    <>
      <Text style={settingsStyles.rowHint}>{t("settings.apiEndpoints.webSearch.hint")}</Text>
      {save.status === "saving" ? (
        <Text style={settingsStyles.rowHint} testID="api-endpoint-web-search-saving">
          {t("settings.apiEndpoints.webSearch.saving")}
        </Text>
      ) : null}
      {save.status === "failed" ? (
        <Text
          accessibilityRole="alert"
          style={settingsStyles.rowError}
          testID="api-endpoint-web-search-error"
        >
          {t("settings.apiEndpoints.webSearch.saveFailed", { message: save.message })}
        </Text>
      ) : null}
    </>
  );
  return (
    <SettingsSection
      title={t("settings.apiEndpoints.webSearch.title")}
      testID="api-endpoint-web-search-section"
    >
      <SettingsCard>
        <SettingsRow label={label} hint={hint}>
          <Switch
            value={value}
            onValueChange={onChange}
            disabled={save.status === "saving"}
            accessibilityLabel={label}
            testID="api-endpoint-web-search-switch"
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
