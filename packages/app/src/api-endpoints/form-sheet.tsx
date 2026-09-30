import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Trash2 } from "lucide-react-native";
import type { ApiEndpointModel } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useApiEndpointFormModel } from "./use-form-model";
import {
  type ApiEndpointFormSeed,
  type ApiEndpointSaveRequestInput,
  type ApiEndpointSaveResult,
} from "./internal/form-model";

export interface ApiEndpointFormSheetProps {
  seed: ApiEndpointFormSeed;
  onSave: (request: ApiEndpointSaveRequestInput) => Promise<ApiEndpointSaveResult>;
  onClose: () => void;
}

/**
 * 新建或编辑一个第三方接口。调用方按「模式 + 接口 id」给 key，每次打开都是新挂载，
 * 模型只在挂载时构造一次（docs/forms.md）。
 */
export function ApiEndpointFormSheet({ seed, onSave, onClose }: ApiEndpointFormSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const fieldSize = isCompact ? "md" : "sm";
  const model = useApiEndpointFormModel(seed, onSave);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);

  const handleSubmit = useCallback(() => {
    void (async () => {
      if (await model.submit()) onClose();
    })();
  }, [model, onClose]);
  const handleAddModel = useCallback(() => model.addModel(), [model]);

  const header = useMemo<SheetHeader>(
    () => ({
      title:
        seed.mode === "edit"
          ? t("settings.providers.apiEndpoints.form.editTitle")
          : t("settings.providers.apiEndpoints.form.createTitle"),
    }),
    [seed.mode, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={520}
      snapPoints={FORM_SNAP_POINTS}
      testID="api-endpoint-form"
    >
      <View style={styles.form}>
        <Field label={t("settings.providers.apiEndpoints.form.name")}>
          <FormTextInput
            initialValue={state.name}
            onChangeText={model.setName}
            placeholder={t("settings.providers.apiEndpoints.form.namePlaceholder")}
            autoCorrect={false}
            size={fieldSize}
            testID="api-endpoint-form-name"
          />
        </Field>
        <Field
          label={t("settings.providers.apiEndpoints.form.baseUrl")}
          error={
            state.baseUrlInvalid ? t("settings.providers.apiEndpoints.form.baseUrlInvalid") : null
          }
          testID="api-endpoint-form-base-url-field"
        >
          <FormTextInput
            initialValue={state.baseUrl}
            onChangeText={model.setBaseUrl}
            placeholder="https://openrouter.ai/api"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            size={fieldSize}
            testID="api-endpoint-form-base-url"
          />
        </Field>
        <Field label={t("settings.providers.apiEndpoints.form.apiKey")}>
          <FormTextInput
            initialValue=""
            onChangeText={model.setApiKey}
            placeholder={
              state.hasSavedKey
                ? t("settings.providers.apiEndpoints.form.apiKeySavedPlaceholder")
                : t("settings.providers.apiEndpoints.form.apiKeyPlaceholder")
            }
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            size={fieldSize}
            testID="api-endpoint-form-api-key"
          />
        </Field>
        <Field
          label={t("settings.providers.apiEndpoints.form.models")}
          error={
            state.models.length === 0 ? t("settings.providers.apiEndpoints.form.noModels") : null
          }
        >
          <View style={styles.modelInputRow}>
            <View style={styles.modelInput}>
              <FormTextInput
                initialValue=""
                resetKey={`model-draft-${state.modelDraftGeneration}`}
                onChangeText={model.setModelDraft}
                onSubmitEditing={handleAddModel}
                placeholder={t("settings.providers.apiEndpoints.form.modelIdPlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                size={fieldSize}
                testID="api-endpoint-form-model-id"
              />
            </View>
            <Button
              variant="outline"
              size="sm"
              onPress={handleAddModel}
              disabled={!state.canAddModel}
              testID="api-endpoint-form-add-model"
            >
              {t("settings.providers.apiEndpoints.form.addModel")}
            </Button>
          </View>
        </Field>
        {state.models.length > 0 ? (
          <View style={styles.modelList}>
            {state.models.map((modelEntry) => (
              <ModelRow
                key={modelEntry.id}
                model={modelEntry}
                isDefault={state.defaultModelId === modelEntry.id}
                onMakeDefault={model.setDefaultModel}
                onRemove={model.removeModel}
              />
            ))}
          </View>
        ) : null}
        {state.submitError ? (
          <Text variant="caption" color="statusDanger" selectable testID="api-endpoint-form-error">
            {state.submitError}
          </Text>
        ) : null}
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
            testID="api-endpoint-form-save"
          >
            {state.submitting
              ? t("settings.providers.apiEndpoints.form.saving")
              : t("settings.providers.apiEndpoints.form.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function ModelRow({
  model,
  isDefault,
  onMakeDefault,
  onRemove,
}: {
  model: ApiEndpointModel;
  isDefault: boolean;
  onMakeDefault: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleMakeDefault = useCallback(() => onMakeDefault(model.id), [model.id, onMakeDefault]);
  const handleRemove = useCallback(() => onRemove(model.id), [model.id, onRemove]);

  return (
    <View style={styles.modelRow} testID={`api-endpoint-form-model-${model.id}`}>
      <Text
        variant="caption"
        numberOfLines={1}
        selectable
        style={styles.modelId}
        dataSet={CODE_SURFACE_DATASET}
      >
        {model.id}
      </Text>
      {isDefault ? (
        <Text variant="caption" color="foregroundMuted" style={styles.defaultBadge}>
          {t("settings.providers.apiEndpoints.form.default")}
        </Text>
      ) : (
        <Button variant="ghost" size="sm" onPress={handleMakeDefault}>
          {t("settings.providers.apiEndpoints.form.makeDefault")}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Trash2}
        onPress={handleRemove}
        accessibilityLabel={t("settings.providers.apiEndpoints.form.removeModel", {
          id: model.id,
        })}
      />
    </View>
  );
}

const FORM_SNAP_POINTS = ["85%"];

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[4],
  },
  modelInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  modelInput: {
    flex: 1,
  },
  modelList: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
    marginTop: -1,
  },
  modelId: {
    flex: 1,
    fontFamily: theme.fontFamily.mono,
  },
  defaultBadge: {
    paddingHorizontal: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
