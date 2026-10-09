import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Square, SquareCheck, Trash2 } from "lucide-react-native";
import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModel,
  type ApiEndpointModelTier,
} from "@osuna/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SearchField } from "@/components/ui/search-field";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";
import { useApiEndpointFormModel } from "./use-form-model";
import type {
  ApiEndpointFetchModelsRequestInput,
  ApiEndpointFetchModelsResult,
  ApiEndpointFetchedRow,
  ApiEndpointFormModel,
  ApiEndpointFormSeed,
  ApiEndpointFormState,
  ApiEndpointSaveRequestInput,
  ApiEndpointSaveResult,
  ApiEndpointTestConnectionOutcome,
  ApiEndpointTestConnectionRequestInput,
  ApiEndpointTestState,
} from "./internal/form-model";
import { formatApiEndpointTestDuration } from "./internal/section-state";

export interface ApiEndpointFormSheetProps {
  seed: ApiEndpointFormSeed;
  onSave: (request: ApiEndpointSaveRequestInput) => Promise<ApiEndpointSaveResult>;
  onFetchModels: (
    request: ApiEndpointFetchModelsRequestInput,
    signal: AbortSignal,
  ) => Promise<ApiEndpointFetchModelsResult>;
  onTestConnection: (
    request: ApiEndpointTestConnectionRequestInput,
    signal: AbortSignal,
  ) => Promise<ApiEndpointTestConnectionOutcome>;
  onClose: () => void;
}

type HoverableState = PressableStateCallbackType & { hovered?: boolean };

const ThemedSquare = withUnistyles(Square, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedSquareCheck = withUnistyles(SquareCheck, (theme: Theme) => ({
  color: theme.colors.foreground,
}));

// 映射下拉里「不映射」这一项的值；模型 id 不会是空串。
const UNMAPPED = "";

const TIER_LABELS: Record<ApiEndpointModelTier, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable",
};

/**
 * 新建或编辑一个第三方接口。调用方按「模式 + 接口 id」给 key，每次打开都是新挂载，
 * 模型只在挂载时构造一次（docs/forms.md）。
 */
export function ApiEndpointFormSheet({
  seed,
  onSave,
  onFetchModels,
  onTestConnection,
  onClose,
}: ApiEndpointFormSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const fieldSize = isCompact ? "md" : "sm";
  const model = useApiEndpointFormModel(seed, {
    save: onSave,
    fetchModels: onFetchModels,
    testConnection: onTestConnection,
  });
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
          hint={t("settings.providers.apiEndpoints.form.modelsHint")}
        >
          <FetchModelsSection state={state} model={model} />
        </Field>
        <Field
          label={t("settings.providers.apiEndpoints.form.selectedModels")}
          error={
            state.models.length === 0 ? t("settings.providers.apiEndpoints.form.noModels") : null
          }
        >
          <View style={styles.stack}>
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
          </View>
        </Field>
        {state.showMapping ? (
          <Field
            label={t("settings.providers.apiEndpoints.form.mapping")}
            hint={t("settings.providers.apiEndpoints.form.mappingHint")}
          >
            <View style={styles.mappingList}>
              {API_ENDPOINT_MODEL_TIERS.map((tier) => (
                <MappingRow
                  key={tier}
                  tier={tier}
                  value={state.mapping[tier] ?? null}
                  models={state.models}
                  size={fieldSize}
                  onChange={model.setMapping}
                />
              ))}
            </View>
          </Field>
        ) : null}
        <Field
          label={t("settings.providers.apiEndpoints.form.testConnection")}
          hint={t("settings.providers.apiEndpoints.form.testHint")}
        >
          <TestConnectionSection state={state} model={model} />
        </Field>
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

function FetchModelsSection({
  state,
  model,
}: {
  state: ApiEndpointFormState;
  model: ApiEndpointFormModel;
}) {
  const { t } = useTranslation();
  const fetching = state.fetch.status === "fetching";
  const handleFetch = useCallback(() => model.fetchModels(), [model]);
  const handleCancel = useCallback(() => model.cancelFetch(), [model]);

  return (
    <View style={styles.stack}>
      <View style={styles.inlineActions}>
        <Button
          variant="outline"
          size="sm"
          onPress={handleFetch}
          disabled={!state.canFetch}
          loading={fetching}
          testID="api-endpoint-form-fetch-models"
        >
          {state.fetch.status === "fetched"
            ? t("settings.providers.apiEndpoints.form.refetchModels")
            : t("settings.providers.apiEndpoints.form.fetchModels")}
        </Button>
        {fetching ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleCancel}
            testID="api-endpoint-form-cancel-fetch"
          >
            {t("common.actions.cancel")}
          </Button>
        ) : null}
      </View>
      {state.fetch.status === "failed" ? (
        <Text
          variant="caption"
          color="statusDanger"
          selectable
          testID="api-endpoint-form-fetch-error"
        >
          {state.fetch.message}
        </Text>
      ) : null}
      {state.fetch.status === "fetched" ? (
        <FetchedModels
          total={state.fetch.models.length}
          rows={state.fetchedRows}
          hiddenCount={state.hiddenFetchedCount}
          search={state.modelSearch}
          model={model}
        />
      ) : null}
    </View>
  );
}

function TestConnectionSection({
  state,
  model,
}: {
  state: ApiEndpointFormState;
  model: ApiEndpointFormModel;
}) {
  const { t } = useTranslation();
  const testing = state.test.status === "testing";
  const handleCancel = useCallback(() => model.cancelTest(), [model]);

  return (
    <View style={styles.stack}>
      <View style={styles.inlineActions}>
        <DropdownMenu>
          <DropdownTrigger
            disabled={!state.canTest}
            accessibilityRole="button"
            accessibilityLabel={t("settings.providers.apiEndpoints.form.testPick")}
            testID="api-endpoint-form-test"
          >
            <Text>
              {testing
                ? t("settings.providers.apiEndpoints.form.testing")
                : t("settings.providers.apiEndpoints.form.testPick")}
            </Text>
          </DropdownTrigger>
          <DropdownMenuContent side="bottom" align="start" width={280}>
            <DropdownMenuLabel>
              {t("settings.providers.apiEndpoints.form.testMenuTitle")}
            </DropdownMenuLabel>
            {state.models.map((entry) => (
              <TestModelItem key={entry.id} modelId={entry.id} onSelect={model.testConnection} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {testing ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleCancel}
            testID="api-endpoint-form-cancel-test"
          >
            {t("common.actions.cancel")}
          </Button>
        ) : null}
      </View>
      <TestConnectionResult test={state.test} />
    </View>
  );
}

function TestModelItem({
  modelId,
  onSelect,
}: {
  modelId: string;
  onSelect: (modelId: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(modelId), [modelId, onSelect]);
  return (
    <DropdownMenuItem onSelect={handleSelect} testID={`api-endpoint-form-test-model-${modelId}`}>
      {modelId}
    </DropdownMenuItem>
  );
}

/** 一行结论（成功/失败 · HTTP 状态码 · 耗时 · 模型），失败时下面接上游或 daemon 给的原因。 */
function TestConnectionResult({ test }: { test: ApiEndpointTestState }) {
  const { t } = useTranslation();
  if (test.status === "idle" || test.status === "testing") return null;

  if (test.status === "failed") {
    return (
      <Text variant="caption" color="statusDanger" selectable testID="api-endpoint-form-test-error">
        {test.message}
      </Text>
    );
  }

  const { result } = test;
  const summary = [
    result.ok
      ? t("settings.providers.apiEndpoints.form.testSucceeded")
      : t("settings.providers.apiEndpoints.form.testFailed"),
    result.status === null ? null : `HTTP ${result.status}`,
    formatApiEndpointTestDuration(result.durationMs),
    test.modelId,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <View style={styles.testResult} testID="api-endpoint-form-test-result">
      <Text
        variant="caption"
        weight="medium"
        color={result.ok ? "statusSuccess" : "statusDanger"}
        selectable
      >
        {summary}
      </Text>
      {result.error ? (
        <Text variant="caption" color="foregroundMuted" selectable>
          {result.error.message}
        </Text>
      ) : null}
    </View>
  );
}

function FetchedModels({
  total,
  rows,
  hiddenCount,
  search,
  model,
}: {
  total: number;
  rows: ApiEndpointFetchedRow[];
  hiddenCount: number;
  search: string;
  model: ApiEndpointFormModel;
}) {
  const { t } = useTranslation();

  if (total === 0) {
    return (
      <Text variant="caption" color="foregroundMuted">
        {t("settings.providers.apiEndpoints.form.noUpstreamModels")}
      </Text>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.searchRail}>
        <SearchField
          value={search}
          onChangeText={model.setModelSearch}
          placeholder={t("settings.providers.apiEndpoints.form.searchModels", { count: total })}
          clearAccessibilityLabel={t("settings.providers.apiEndpoints.form.clearSearch")}
          testID="api-endpoint-form-model-search"
        />
      </View>
      {rows.length > 0 ? (
        <View style={styles.modelList}>
          {rows.map((row) => (
            <FetchedModelRow key={row.model.id} row={row} onToggle={model.toggleModel} />
          ))}
        </View>
      ) : (
        <Text variant="caption" color="foregroundMuted">
          {t("settings.providers.apiEndpoints.form.noMatchingModels")}
        </Text>
      )}
      {hiddenCount > 0 ? (
        <Text variant="caption" color="foregroundMuted">
          {t("settings.providers.apiEndpoints.form.moreModelsHidden", { count: hiddenCount })}
        </Text>
      ) : null}
    </View>
  );
}

function FetchedModelRow({
  row,
  onToggle,
}: {
  row: ApiEndpointFetchedRow;
  onToggle: (id: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(row.model.id), [onToggle, row.model.id]);
  const pressableStyle = useCallback(
    ({ pressed, hovered }: HoverableState) => [
      styles.modelRow,
      styles.fetchedRow,
      hovered || pressed ? styles.rowHighlighted : null,
    ],
    [],
  );
  const accessibilityState = useMemo(() => ({ checked: row.checked }), [row.checked]);

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={row.model.label ?? row.model.id}
      testID={`api-endpoint-form-fetched-${row.model.id}`}
    >
      {row.checked ? <ThemedSquareCheck size={16} /> : <ThemedSquare size={16} />}
      <Text
        variant="caption"
        numberOfLines={1}
        style={styles.modelId}
        dataSet={CODE_SURFACE_DATASET}
      >
        {row.model.id}
      </Text>
      {row.model.label ? (
        <Text variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.modelLabel}>
          {row.model.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function MappingRow({
  tier,
  value,
  models,
  size,
  onChange,
}: {
  tier: ApiEndpointModelTier;
  value: string | null;
  models: ApiEndpointModel[];
  size: "sm" | "md";
  onChange: (tier: ApiEndpointModelTier, modelId: string | null) => void;
}) {
  const { t } = useTranslation();
  const unmappedLabel = t("settings.providers.apiEndpoints.form.unmapped");
  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: "unmapped", value: UNMAPPED, label: unmappedLabel },
      ...models.map((entry) => ({ id: entry.id, value: entry.id, label: entry.id })),
    ],
    [models, unmappedLabel],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: value ?? unmappedLabel }),
    [unmappedLabel, value],
  );
  const handleChange = useCallback(
    (next: string) => onChange(tier, next === UNMAPPED ? null : next),
    [onChange, tier],
  );

  return (
    <View style={styles.mappingRow}>
      <Text variant="caption" style={styles.mappingTier}>
        {TIER_LABELS[tier]}
      </Text>
      <View style={styles.mappingSelect}>
        <SelectField
          field={false}
          label={TIER_LABELS[tier]}
          value={value ?? UNMAPPED}
          selectedDisplay={selectedDisplay}
          options={options}
          onChange={handleChange}
          placeholder={unmappedLabel}
          emptyText={t("settings.providers.apiEndpoints.form.noModels")}
          searchable={options.length > 6}
          title={t("settings.providers.apiEndpoints.form.mappingTitle", {
            tier: TIER_LABELS[tier],
          })}
          size={size}
          testID={`api-endpoint-form-mapping-${tier}`}
          triggerTestID={`api-endpoint-form-mapping-${tier}-trigger`}
        />
      </View>
    </View>
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
const MAPPING_TIER_WIDTH = 56;

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
  modelLabel: {
    flexShrink: 1,
    maxWidth: "40%",
  },
  stack: {
    gap: theme.spacing[2],
  },
  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  searchRail: {
    flexDirection: "row",
  },
  fetchedRow: {
    paddingVertical: theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  rowHighlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  mappingList: {
    gap: theme.spacing[2],
  },
  mappingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  mappingTier: {
    width: MAPPING_TIER_WIDTH,
  },
  mappingSelect: {
    flex: 1,
    minWidth: 0,
  },
  testResult: {
    gap: theme.spacing[1],
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
