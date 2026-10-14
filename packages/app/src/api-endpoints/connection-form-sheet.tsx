import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { useConnectionFormModel } from "./use-connection-form-model";
import type {
  ConnectionFormDeps,
  ConnectionFormModel,
  ConnectionFormSeed,
  ConnectionFormatField,
  ConnectionSaveResult,
} from "./internal/connection-form-model";

export interface ApiEndpointConnectionSheetProps {
  seed: ConnectionFormSeed;
  onSave: ConnectionFormDeps["save"];
  onDetect: ConnectionFormDeps["detect"];
  // 保存成功：新建时调用方进入详情页，编辑时只关掉弹窗。
  onSaved: (result: Extract<ConnectionSaveResult, { status: "saved" }>) => void;
  onClose: () => void;
}

const ThemedCheck = withUnistyles(Check, (theme: Theme) => ({ color: theme.colors.statusSuccess }));

const URL_PLACEHOLDERS: Record<ApiEndpointRequestFormat, string> = {
  anthropic_messages: "https://relay.example.com",
  openai_chat: "https://relay.example.com/v1",
  openai_responses: "https://relay.example.com/v1",
};

/**
 * 添加第三方接口 / 编辑连接。调用方按「模式 + 接口 id」给 key，每次打开都是新挂载（docs/forms.md）。
 */
export function ApiEndpointConnectionSheet({
  seed,
  onSave,
  onDetect,
  onSaved,
  onClose,
}: ApiEndpointConnectionSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const fieldSize = isCompact ? "md" : "sm";
  const model = useConnectionFormModel(seed, { save: onSave, detect: onDetect });
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const isCreate = state.mode === "create";

  const handleSubmit = useCallback(() => {
    void (async () => {
      const result = await model.submit();
      if (result?.status === "saved") onSaved(result);
    })();
  }, [model, onSaved]);
  const handleDetect = useCallback(() => model.detect(), [model]);
  const handleCancelDetect = useCallback(() => model.cancelDetect(), [model]);

  // 操作按钮放在固定底栏：表单比窗口高时内容区单独滚动，按钮一直看得见。
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={onClose} disabled={state.submitting}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={handleSubmit}
          disabled={!state.canSubmit}
          loading={state.submitting}
          testID="api-endpoint-connection-save"
        >
          {isCreate
            ? t("settings.apiEndpoints.form.saveAndFetch")
            : t("settings.apiEndpoints.form.save")}
        </Button>
      </View>
    ),
    [handleSubmit, isCreate, onClose, state.canSubmit, state.submitting, t],
  );

  const header = useMemo<SheetHeader>(
    () => ({
      title: isCreate
        ? t("settings.apiEndpoints.form.createTitle")
        : t("settings.apiEndpoints.form.editTitle"),
    }),
    [isCreate, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={520}
      snapPoints={FORM_SNAP_POINTS}
      footer={footer}
      testID="api-endpoint-connection-form"
    >
      <View style={styles.form}>
        <Field label={t("settings.apiEndpoints.form.name")}>
          <FormTextInput
            initialValue={state.name}
            onChangeText={model.setName}
            placeholder={t("settings.apiEndpoints.form.namePlaceholder")}
            autoCorrect={false}
            size={fieldSize}
            testID="api-endpoint-connection-name"
          />
        </Field>
        <Field
          label={t("settings.apiEndpoints.form.apiKey")}
          error={state.keyRejected ? t("settings.apiEndpoints.form.keyRejected") : null}
          testID="api-endpoint-connection-api-key-field"
        >
          <FormTextInput
            initialValue=""
            onChangeText={model.setApiKey}
            placeholder={
              state.hasSavedKey ? t("settings.apiEndpoints.form.apiKeySavedPlaceholder") : "sk-…"
            }
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            invalid={state.keyRejected}
            size={fieldSize}
            testID="api-endpoint-connection-api-key"
          />
        </Field>
        <Field
          label={t("settings.apiEndpoints.form.address")}
          hint={t("settings.apiEndpoints.form.addressHint")}
          error={
            state.addressInvalid
              ? t("settings.apiEndpoints.form.urlInvalid")
              : (state.detectError ?? null)
          }
          testID="api-endpoint-connection-address-field"
        >
          <View style={styles.inlineRow}>
            <View style={styles.flex}>
              <FormTextInput
                initialValue={state.address}
                onChangeText={model.setAddress}
                placeholder="https://relay.example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                invalid={state.addressInvalid}
                size={fieldSize}
                testID="api-endpoint-connection-address"
              />
            </View>
            <Button
              variant="outline"
              size="sm"
              onPress={handleDetect}
              disabled={!state.canDetect}
              loading={state.detecting}
              testID="api-endpoint-connection-detect"
            >
              {t("settings.apiEndpoints.form.detect")}
            </Button>
            {state.detecting ? (
              <Button variant="ghost" size="sm" onPress={handleCancelDetect}>
                {t("common.actions.cancel")}
              </Button>
            ) : null}
          </View>
        </Field>
        <View style={styles.formatGroup} testID="api-endpoint-connection-formats">
          {state.formats.map((field) => (
            <FormatUrlField
              key={field.format}
              field={field}
              generation={state.urlGeneration}
              size={fieldSize}
              model={model}
            />
          ))}
        </View>
        <Text variant="caption" color="foregroundMuted">
          {t("settings.apiEndpoints.form.footer")}
        </Text>
        {state.submitError ? (
          <Text
            variant="caption"
            color="statusDanger"
            selectable
            testID="api-endpoint-connection-error"
          >
            {state.submitError}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function FormatUrlField({
  field,
  generation,
  size,
  model,
}: {
  field: ConnectionFormatField;
  generation: number;
  size: "sm" | "md";
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  const { format } = field;
  const handleChange = useCallback((value: string) => model.setUrl(format, value), [format, model]);
  const tag = useMemo(
    () => <DetectionTag detection={field.detection} format={format} />,
    [field.detection, format],
  );
  return (
    <Field
      label={t(`settings.apiEndpoints.form.formatUrl.${format}`)}
      trailing={tag}
      error={field.invalid ? t("settings.apiEndpoints.form.urlInvalid") : null}
      testID={`api-endpoint-connection-url-field-${format}`}
    >
      <FormTextInput
        initialValue={field.url}
        resetKey={generation}
        onChangeText={handleChange}
        placeholder={
          field.detection === "not_detected"
            ? t("settings.apiEndpoints.form.notDetectedPlaceholder")
            : URL_PLACEHOLDERS[format]
        }
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        invalid={field.invalid}
        size={size}
        testID={`api-endpoint-connection-url-${format}`}
      />
    </Field>
  );
}

function DetectionTag({
  detection,
  format,
}: {
  detection: ConnectionFormatField["detection"];
  format: ApiEndpointRequestFormat;
}) {
  const { t } = useTranslation();
  if (detection === null) return null;
  const testID = `api-endpoint-connection-detection-${format}`;
  if (detection === "ok") {
    return (
      <View style={styles.tag} testID={testID}>
        <ThemedCheck size={12} />
        <Text variant="caption" color="statusSuccess">
          {t("settings.apiEndpoints.form.detection.ok")}
        </Text>
      </View>
    );
  }
  return (
    <Text
      variant="caption"
      color={detection === "auth_failed" ? "statusDanger" : "foregroundMuted"}
      testID={testID}
    >
      {t(`settings.apiEndpoints.form.detection.${detection}`)}
    </Text>
  );
}

const FORM_SNAP_POINTS = ["85%"];

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[4],
  },
  flex: {
    flex: 1,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // 三种格式的地址同属一把 key，收在一块浅底里。
  formatGroup: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
