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
  // 主机声明了 apiEndpointManagement：key 可以不填，key 框旁有「显示」。
  isKeyOptional: boolean;
  canRevealKey: boolean;
  onSave: ConnectionFormDeps["save"];
  onDetect: ConnectionFormDeps["detect"];
  onRevealKey: ConnectionFormDeps["revealKey"];
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
 * 添加第三方接口 / 编辑连接 / 复制一家（以添加窗口打开）。调用方按「模式 + 接口 id」给 key，每次打开都是新挂载（docs/forms.md）。
 */
export function ApiEndpointConnectionSheet({
  seed,
  isKeyOptional,
  canRevealKey,
  onSave,
  onDetect,
  onRevealKey,
  onSaved,
  onClose,
}: ApiEndpointConnectionSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const fieldSize = isCompact ? "md" : "sm";
  const model = useConnectionFormModel(
    seed,
    { save: onSave, detect: onDetect, revealKey: onRevealKey },
    { isKeyOptional, canRevealKey },
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const isCreate = state.mode === "create";
  const keyPlaceholder = useMemo(() => {
    if (seed.mode === "duplicate" && seed.source.hasApiKey) {
      return t("settings.apiEndpoints.form.apiKeyCopiedPlaceholder", {
        mask: seed.source.apiKeyMask ?? "••••",
      });
    }
    return state.hasSavedKey ? t("settings.apiEndpoints.form.apiKeySavedPlaceholder") : "sk-…";
  }, [seed, state.hasSavedKey, t]);

  const handleSubmit = useCallback(() => {
    void (async () => {
      const result = await model.submit();
      if (result?.status === "saved") onSaved(result);
    })();
  }, [model, onSaved]);
  const handleDetect = useCallback(() => model.detect(), [model]);
  const handleCancelDetect = useCallback(() => model.cancelDetect(), [model]);
  const handleToggleKey = useCallback(() => model.toggleKeyVisible(), [model]);

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

  const header = useMemo<SheetHeader>(() => {
    if (seed.mode === "duplicate") {
      return { title: t("settings.apiEndpoints.form.duplicateTitle", { name: seed.source.name }) };
    }
    return {
      title: isCreate
        ? t("settings.apiEndpoints.form.createTitle")
        : t("settings.apiEndpoints.form.editTitle"),
    };
  }, [isCreate, seed, t]);

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
          label={
            state.isKeyOptional
              ? t("settings.apiEndpoints.form.apiKeyOptionalLabel")
              : t("settings.apiEndpoints.form.apiKey")
          }
          error={
            state.revealError ??
            (state.keyRejected ? t("settings.apiEndpoints.form.keyRejected") : null)
          }
          testID="api-endpoint-connection-api-key-field"
        >
          <View style={styles.inlineRow}>
            <View style={styles.flex}>
              <FormTextInput
                initialValue={state.keyBoxValue}
                resetKey={state.keyBoxGeneration}
                onChangeText={model.setApiKey}
                placeholder={keyPlaceholder}
                secureTextEntry={!state.isKeyVisible}
                autoCapitalize="none"
                autoCorrect={false}
                invalid={state.keyRejected || state.revealError !== null}
                size={fieldSize}
                testID="api-endpoint-connection-api-key"
              />
            </View>
            {state.canShowKey ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={handleToggleKey}
                loading={state.isRevealingKey}
                testID="api-endpoint-connection-show-key"
              >
                {state.isKeyVisible
                  ? t("settings.apiEndpoints.form.hideKey")
                  : t("settings.apiEndpoints.form.showKey")}
              </Button>
            ) : null}
          </View>
        </Field>
        <Field
          label={t("settings.apiEndpoints.form.address")}
          hint={
            state.isKeyOptional
              ? t("settings.apiEndpoints.form.addressHintKeyOptional")
              : t("settings.apiEndpoints.form.addressHint")
          }
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
          {state.isKeyOptional
            ? t("settings.apiEndpoints.form.footerKeyOptional")
            : t("settings.apiEndpoints.form.footer")}
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
