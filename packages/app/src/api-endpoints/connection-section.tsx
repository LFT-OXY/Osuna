import React, { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Text as UiText } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import type { FormatTestOutcome, FormatTestResults } from "./use-endpoint-detail";

/**
 * 接口详情页的「连接」区：三种格式的地址与打码的 key，标题右侧「编辑」打开编辑连接弹窗。
 * 头部「测试连接」的结果按格式接在对应地址的行尾。
 */
export function ApiEndpointConnectionSection({
  endpoint,
  isKeyOptional,
  testResults = {},
  onEdit,
}: {
  endpoint: ApiEndpoint;
  // 主机声明了 apiEndpointManagement：没 key 是用户没填，不是缺失。
  isKeyOptional: boolean;
  testResults?: FormatTestResults;
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
          const outcome = url ? testResults[format] : undefined;
          const failureReason =
            outcome && (outcome.kind === "failed" || outcome.kind === "authFailed")
              ? outcome.message
              : "";
          return (
            <View
              key={format}
              style={index > 0 ? settingsStyles.rowBorder : null}
              testID={`api-endpoint-connection-row-${format}`}
            >
              <View style={settingsStyles.row}>
                <Text style={[settingsStyles.rowTitle, styles.title]}>
                  {t(`settings.apiEndpoints.form.formatUrl.${format}`)}
                </Text>
                <View style={styles.valueGroup}>
                  <Text
                    style={[settingsStyles.rowValue, url ? styles.url : null]}
                    numberOfLines={1}
                    selectable={Boolean(url)}
                  >
                    {url ?? t("settings.apiEndpoints.detail.formatNotSet")}
                  </Text>
                  {outcome ? <TestOutcome format={format} outcome={outcome} /> : null}
                </View>
              </View>
              {/* 失败原因可能很长，单独占一行，不挤掉标题和地址。 */}
              {failureReason ? (
                <UiText
                  variant="caption"
                  color="foregroundMuted"
                  style={styles.reason}
                  numberOfLines={2}
                  selectable
                  testID={`api-endpoint-test-reason-${format}`}
                >
                  {failureReason}
                </UiText>
              ) : null}
            </View>
          );
        })}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowTitle}>{t("settings.apiEndpoints.form.apiKey")}</Text>
          <Text style={settingsStyles.rowValue}>
            {keyValue({ hasApiKey: endpoint.hasApiKey, isKeyOptional, t })}
          </Text>
        </View>
      </View>
    </SettingsSection>
  );
}

function keyValue(input: { hasApiKey: boolean; isKeyOptional: boolean; t: TFunction }): string {
  if (input.hasApiKey) return MASKED_KEY;
  return input.t(
    input.isKeyOptional
      ? "settings.apiEndpoints.detail.keyNotSet"
      : "settings.apiEndpoints.detail.noKey",
  );
}

/** 一种格式的测试结论，接在地址后面；失败原因由调用方另起一行。 */
function TestOutcome({
  format,
  outcome,
}: {
  format: ApiEndpointRequestFormat;
  outcome: FormatTestOutcome;
}) {
  const { t } = useTranslation();
  let text: string;
  let color: "foregroundMuted" | "statusSuccess" | "statusDanger";
  if (outcome.kind === "testing") {
    text = t("settings.apiEndpoints.detail.test.testing");
    color = "foregroundMuted";
  } else if (outcome.kind === "ok") {
    text = t("settings.apiEndpoints.detail.test.ok", { ms: outcome.durationMs });
    color = "statusSuccess";
  } else {
    text =
      outcome.kind === "authFailed"
        ? t("settings.apiEndpoints.detail.test.authFailed")
        : t("settings.apiEndpoints.detail.test.failed");
    color = "statusDanger";
  }
  return (
    <UiText
      variant="caption"
      color={color}
      style={styles.outcome}
      numberOfLines={1}
      testID={`api-endpoint-test-result-${format}`}
    >
      {text}
    </UiText>
  );
}

const MASKED_KEY = "••••••••";

const styles = StyleSheet.create((theme) => ({
  url: {
    flexShrink: 1,
    fontFamily: theme.fontFamily.mono,
  },
  valueGroup: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[3],
    flexShrink: 1,
    minWidth: 0,
  },
  title: {
    flexShrink: 0,
  },
  outcome: {
    flexShrink: 0,
  },
  reason: {
    marginTop: -theme.spacing[1],
    paddingBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
}));
