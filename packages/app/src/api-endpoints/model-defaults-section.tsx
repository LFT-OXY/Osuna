import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { MODEL_TOKEN_FIELDS } from "@getpaseo/protocol/api-endpoint/model-settings";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  openModelDefaultsForm,
  tokenFormatOf,
  type ModelDefaultsForm,
  type SaveModelSettings,
  type TokenField,
  type TokenFieldName,
} from "./internal/model-settings-form";

/*
 * 接口详情页的「整家默认」（prd 第 19 条，用户故事 54）：这家所有模型共用的上下文、回复上限、压缩阈值。
 * 单个模型的设置在它前面；空着就是每个模型用自动取到的。改了按「保存」才算，失败原因留在原处。
 * 调用方按接口 id 给 key：换一家是新的表单（docs/forms.md）。
 */

const KEY = "settings.apiEndpoints.modelSettings.defaults";
// FormTextInput 会压平 style 拆成外框与文字，Unistyles 样式在 Web 上压平后没有值，所以用普通对象。
const WIDE_INPUT_STYLE = { width: 180 };
const COMPACT_INPUT_STYLE = { width: 140 };

export function ApiEndpointModelDefaultsSection({
  endpoint,
  onSave,
}: {
  endpoint: ApiEndpoint;
  onSave: SaveModelSettings;
}) {
  const { t, i18n } = useTranslation();
  const [form] = useState(() =>
    openModelDefaultsForm({ endpoint, save: onSave, tokenFormat: tokenFormatOf(i18n.language) }),
  );
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const handleSave = useCallback(() => {
    void form.submit();
  }, [form]);
  const labels = useMemo<Record<TokenFieldName, string>>(
    () => ({
      context: t("settings.apiEndpoints.modelSettings.context"),
      output: t("settings.apiEndpoints.modelSettings.output"),
      compact: t("settings.apiEndpoints.modelSettings.compact"),
    }),
    [t],
  );
  return (
    <SettingsSection title={t(`${KEY}.title`)} testID="api-endpoint-model-defaults-section">
      <SettingsCard>
        {MODEL_TOKEN_FIELDS.map((name) => (
          <DefaultRow key={name} form={form} name={name} field={state[name]} label={labels[name]} />
        ))}
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <Text variant="caption" color="foregroundMuted" style={styles.flex}>
              {t(`${KEY}.hint`)}
            </Text>
            <Button
              variant="outline"
              size="sm"
              onPress={handleSave}
              disabled={!state.canSubmit}
              loading={state.status.kind === "saving"}
              testID="api-endpoint-model-defaults-save"
            >
              {state.status.kind === "saving" ? t(`${KEY}.saving`) : t(`${KEY}.save`)}
            </Button>
          </View>
          {state.status.kind === "failed" ? (
            <Text
              variant="caption"
              color="statusDanger"
              accessibilityRole="alert"
              selectable
              testID="api-endpoint-model-defaults-error"
            >
              {t(`${KEY}.saveFailed`, { message: state.status.message })}
            </Text>
          ) : null}
        </View>
      </SettingsCard>
    </SettingsSection>
  );
}

function DefaultRow({
  form,
  name,
  field,
  label,
}: {
  form: ModelDefaultsForm;
  name: TokenFieldName;
  field: TokenField;
  label: string;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const handleChange = useCallback((text: string) => form.setTokens(name, text), [form, name]);
  return (
    <SettingsRow
      label={label}
      error={field.invalid ? t("settings.apiEndpoints.modelSettings.invalidTokens") : undefined}
      testID={`api-endpoint-model-defaults-${name}-row`}
    >
      <FormTextInput
        initialValue={field.text}
        onChangeText={handleChange}
        placeholder={t("settings.apiEndpoints.modelSettings.automaticUnknown")}
        keyboardType="number-pad"
        accessibilityLabel={label}
        invalid={field.invalid}
        size={isCompact ? "md" : "sm"}
        style={isCompact ? COMPACT_INPUT_STYLE : WIDE_INPUT_STYLE}
        testID={`api-endpoint-model-defaults-${name}`}
      />
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  flex: {
    flex: 1,
  },
}));
