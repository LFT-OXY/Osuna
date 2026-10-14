import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";

/** 接口详情页的「连接」区：三种格式的地址与打码的 key，标题右侧「编辑」打开编辑连接弹窗。 */
export function ApiEndpointConnectionSection({
  endpoint,
  onEdit,
}: {
  endpoint: ApiEndpoint;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const editButton = useMemo(
    () => (
      <Button variant="ghost" size="sm" onPress={onEdit} testID="api-endpoint-edit-connection">
        {t("settings.apiEndpoints.detail.edit")}
      </Button>
    ),
    [onEdit, t],
  );
  return (
    <SettingsSection
      title={t("settings.apiEndpoints.detail.connection")}
      info={t("settings.apiEndpoints.detail.connectionInfo")}
      trailing={editButton}
      testID="api-endpoint-connection-section"
    >
      <View style={settingsStyles.card}>
        {API_ENDPOINT_REQUEST_FORMATS.map((format, index) => {
          const url = endpoint.baseUrls?.find((entry) => entry.format === format)?.url;
          return (
            <View
              key={format}
              style={[settingsStyles.row, index > 0 && settingsStyles.rowBorder]}
              testID={`api-endpoint-connection-row-${format}`}
            >
              <Text style={settingsStyles.rowTitle}>
                {t(`settings.apiEndpoints.form.formatUrl.${format}`)}
              </Text>
              <Text
                style={[settingsStyles.rowValue, url ? styles.url : null]}
                numberOfLines={1}
                selectable={Boolean(url)}
              >
                {url ?? t("settings.apiEndpoints.detail.formatNotSet")}
              </Text>
            </View>
          );
        })}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowTitle}>{t("settings.apiEndpoints.form.apiKey")}</Text>
          <Text style={settingsStyles.rowValue}>
            {endpoint.hasApiKey ? MASKED_KEY : t("settings.apiEndpoints.detail.noKey")}
          </Text>
        </View>
      </View>
    </SettingsSection>
  );
}

const MASKED_KEY = "••••••••";

const styles = StyleSheet.create((theme) => ({
  url: {
    flexShrink: 1,
    fontFamily: theme.fontFamily.mono,
  },
}));
