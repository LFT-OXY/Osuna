import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type DropdownMenuTriggerState,
} from "@/components/ui/dropdown-menu";
import { SelectFieldTrigger } from "@/components/ui/select-field";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  openModelSettingsForm,
  tokenFormatOf,
  type TokenFormat,
  type ModelSettingsForm,
  type ModelSettingsFormState,
  type SaveModelSettings,
  type TokenField,
  type TokenFieldName,
} from "./internal/model-settings-form";

/*
 * 「模型设置」窗口（prd 第 19、22 条）：模型行菜单打开，一次只改这家的一个模型。
 * 调用方按「接口 id + 模型 id」给 key，每次打开都是新挂载（docs/forms.md）；表单模型只在挂载时构造一次。
 * 写明哪些项对哪个 CLI 不起作用：Claude Code 没有显示名与看图的设置，Codex 没有回复上限的设置（R2-Q6）。
 */

const KEY = "settings.apiEndpoints.modelSettings";
const SNAP_POINTS = ["85%"];

export interface ApiEndpointModelSettingsSheetProps {
  endpoint: ApiEndpoint;
  modelId: string;
  onSave: SaveModelSettings;
  onClose: () => void;
}

export function ApiEndpointModelSettingsSheet({
  endpoint,
  modelId,
  onSave,
  onClose,
}: ApiEndpointModelSettingsSheetProps) {
  const { t, i18n } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const fieldSize = isCompact ? "md" : "sm";
  const [tokenFormat] = useState(() => tokenFormatOf(i18n.language));
  const [form] = useState(() =>
    openModelSettingsForm({ endpoint, modelId, save: onSave, tokenFormat }),
  );
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);

  const handleSubmit = useCallback(() => {
    void (async () => {
      if ((await form.submit()) === "saved") onClose();
    })();
  }, [form, onClose]);
  const handleRestoreDefaults = useCallback(() => {
    void (async () => {
      if ((await form.restoreDefaults()) === "saved") onClose();
    })();
  }, [form, onClose]);
  const handleRestoreName = useCallback(() => form.restoreName(), [form]);
  const hasName = state.name.text !== "";
  const nameTrailing = useMemo(
    () =>
      hasName ? (
        <Button
          variant="ghost"
          size="xs"
          onPress={handleRestoreName}
          disabled={state.isBusy}
          testID="api-endpoint-model-settings-restore-name"
        >
          {t(`${KEY}.restoreName`)}
        </Button>
      ) : null,
    [handleRestoreName, hasName, state.isBusy, t],
  );

  const header = useMemo<SheetHeader>(() => ({ title: t(`${KEY}.title`) }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleRestoreDefaults}
          disabled={state.isBusy}
          loading={state.status.kind === "restoring"}
          testID="api-endpoint-model-settings-restore"
        >
          {t(`${KEY}.restoreAll`)}
        </Button>
        <View style={styles.footerActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={state.isBusy}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleSubmit}
            disabled={!state.canSubmit}
            loading={state.status.kind === "saving"}
            testID="api-endpoint-model-settings-save"
          >
            {state.status.kind === "saving" ? t(`${KEY}.saving`) : t(`${KEY}.save`)}
          </Button>
        </View>
      </View>
    ),
    [handleRestoreDefaults, handleSubmit, onClose, state, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={480}
      snapPoints={SNAP_POINTS}
      footer={footer}
      testID="api-endpoint-model-settings"
    >
      <View style={styles.form}>
        <Text color="foregroundMuted" selectable testID="api-endpoint-model-settings-model">
          {t(`${KEY}.subtitle`, { model: modelId, endpoint: endpoint.name })}
        </Text>
        <Field
          label={t(`${KEY}.name`)}
          hint={t(`${KEY}.nameHint`)}
          trailing={nameTrailing}
          testID="api-endpoint-model-settings-name-field"
        >
          <FormTextInput
            initialValue={state.name.text}
            resetKey={state.name.generation}
            onChangeText={form.setName}
            placeholder={state.name.automatic}
            autoCorrect={false}
            size={fieldSize}
            testID="api-endpoint-model-settings-name"
          />
        </Field>
        <TokenInput
          form={form}
          name="context"
          field={state.context}
          label={t(`${KEY}.context`)}
          hint={null}
          size={fieldSize}
          tokenFormat={tokenFormat}
        />
        <TokenInput
          form={form}
          name="output"
          field={state.output}
          label={t(`${KEY}.output`)}
          hint={t(`${KEY}.outputHint`)}
          size={fieldSize}
          tokenFormat={tokenFormat}
        />
        <TokenInput
          form={form}
          name="compact"
          field={state.compact}
          label={t(`${KEY}.compact`)}
          hint={t(`${KEY}.compactHint`)}
          size={fieldSize}
          tokenFormat={tokenFormat}
        />
        <EffortsField state={state} form={form} size={fieldSize} />
        <ImagesRow state={state} form={form} />
        {state.status.kind === "failed" ? (
          <Text
            variant="caption"
            color="statusDanger"
            selectable
            accessibilityRole="alert"
            testID="api-endpoint-model-settings-error"
          >
            {t(`${KEY}.saveFailed`, { message: state.status.message })}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

/** 一个 token 数的输入框：空着用自动的值，灰字写出是多少；读不懂的数在原处说明。 */
export function TokenInput({
  form,
  name,
  field,
  label,
  hint,
  size,
  tokenFormat,
}: {
  form: Pick<ModelSettingsForm, "setTokens">;
  name: TokenFieldName;
  field: TokenField;
  label: string;
  hint: string | null;
  size: "sm" | "md";
  tokenFormat: TokenFormat;
}) {
  const { t } = useTranslation();
  const handleChange = useCallback((text: string) => form.setTokens(name, text), [form, name]);
  return (
    <Field
      label={label}
      hint={hint ?? undefined}
      error={field.invalid ? t(`${KEY}.invalidTokens`) : null}
      testID={`api-endpoint-model-settings-${name}-field`}
    >
      <FormTextInput
        initialValue={field.text}
        onChangeText={handleChange}
        placeholder={automaticCopy({ t, value: field.automatic, tokenFormat })}
        keyboardType="number-pad"
        invalid={field.invalid}
        size={size}
        testID={`api-endpoint-model-settings-${name}`}
      />
    </Field>
  );
}

function automaticCopy(input: {
  t: TFunction;
  value: number | null;
  tokenFormat: TokenFormat;
}): string {
  if (input.value === null) return input.t(`${KEY}.automaticUnknown`);
  return input.t(`${KEY}.automatic`, { value: input.tokenFormat.format(input.value) });
}

/** 思考档位：多选下拉，勾着的带勾，点了不收起；一档不勾就不发思考参数。 */
function EffortsField({
  state,
  form,
  size,
}: {
  state: ModelSettingsFormState;
  form: ModelSettingsForm;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const { levels, picked, isSet } = state.efforts;
  // 没设、也不知道它的档位时只有灰字「自动」；勾着的档位与「不发」用正文颜色。
  const isUnset = !isSet && picked.length === 0;
  const summary = picked.length === 0 ? t(`${KEY}.effortsNone`) : picked.join(", ");
  const display = useMemo(() => (isUnset ? null : { label: summary }), [isUnset, summary]);
  return (
    <Field
      label={t(`${KEY}.efforts`)}
      hint={t(`${KEY}.effortsHint`)}
      testID="api-endpoint-model-settings-efforts-field"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t(`${KEY}.efforts`)}
          disabled={state.isBusy}
          testID="api-endpoint-model-settings-efforts"
        >
          {({ hovered, open }: DropdownMenuTriggerState) => (
            <SelectFieldTrigger
              display={display}
              placeholder={t(`${KEY}.effortsAutomatic`)}
              hovered={hovered}
              active={open}
              disabled={state.isBusy}
              size={size}
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" width={240}>
          {levels.map((level) => (
            <EffortItem
              key={level}
              level={level}
              selected={picked.includes(level)}
              onToggle={form.toggleEffort}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

function EffortItem({
  level,
  selected,
  onToggle,
}: {
  level: string;
  selected: boolean;
  onToggle: (level: string) => void;
}) {
  const handleSelect = useCallback(() => onToggle(level), [level, onToggle]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      closeOnSelect={false}
      onSelect={handleSelect}
      testID={`api-endpoint-model-settings-effort-${level}`}
    >
      {level}
    </DropdownMenuItem>
  );
}

function ImagesRow({ state, form }: { state: ModelSettingsFormState; form: ModelSettingsForm }) {
  const { t } = useTranslation();
  const label = t(`${KEY}.images`);
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text>{label}</Text>
        <Text variant="caption" color="foregroundMuted">
          {t(`${KEY}.imagesHint`)}
        </Text>
      </View>
      <Switch
        value={state.images.value}
        onValueChange={form.setImages}
        disabled={state.isBusy}
        accessibilityLabel={label}
        testID="api-endpoint-model-settings-images"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[4],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  switchText: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  footerActions: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
