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
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
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
 * 上游模型名与「只用这种格式」只改中转站发给这家的请求（工单 15）；格式连「自动」不超过 4 项用分段切换，多了用下拉。
 */

const KEY = "settings.apiEndpoints.modelSettings";
const SNAP_POINTS = ["85%"];
const AUTOMATIC_FORMAT = "";
// 分段切换最多这么多段，多了折行读不出选中哪段（docs/design.md §6）。
const MAX_FORMAT_SEGMENTS = 4;

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
        <Field
          label={t(`${KEY}.upstreamName`)}
          hint={t(`${KEY}.upstreamNameHint`)}
          testID="api-endpoint-model-settings-upstream-name-field"
        >
          <FormTextInput
            initialValue={state.upstreamName.text}
            onChangeText={form.setUpstreamName}
            placeholder={state.upstreamName.automatic}
            autoCapitalize="none"
            autoCorrect={false}
            size={fieldSize}
            testID="api-endpoint-model-settings-upstream-name"
          />
        </Field>
        {state.format.options.length > 0 ? (
          <FormatField state={state} form={form} size={fieldSize} />
        ) : null}
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
        keyboardType="default"
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

/** 只用这种格式：「自动」加这家有地址的格式；存着的格式没地址了在下面说明作废。 */
function FormatField({
  state,
  form,
  size,
}: {
  state: ModelSettingsFormState;
  form: ModelSettingsForm;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const { options, value, voidFormat } = state.format;
  const choices = useMemo<SegmentedControlOption<string>[]>(
    () => [
      {
        value: AUTOMATIC_FORMAT,
        label: t(`${KEY}.formatAutomatic`),
        testID: "api-endpoint-model-settings-format-automatic",
      },
      ...options.map((format) => ({
        value: format,
        label: formatLabel(t, format),
        testID: `api-endpoint-model-settings-format-${format}`,
      })),
    ],
    [options, t],
  );
  const handleChange = useCallback(
    (next: string) => form.setFormat(next === AUTOMATIC_FORMAT ? null : next),
    [form],
  );
  const selected = value ?? AUTOMATIC_FORMAT;
  const label = t(`${KEY}.format`);
  const voidCopy =
    voidFormat === null ? null : t(`${KEY}.formatVoid`, { format: formatLabel(t, voidFormat) });
  return (
    <Field
      label={label}
      hint={t(`${KEY}.formatHint`)}
      error={voidCopy}
      testID="api-endpoint-model-settings-format-field"
    >
      {choices.length > MAX_FORMAT_SEGMENTS ? (
        <FormatDropdown
          label={label}
          choices={choices}
          selected={selected}
          onSelect={handleChange}
          disabled={state.isBusy}
          size={size}
        />
      ) : (
        <View style={styles.segmentRow}>
          <SegmentedControl
            options={choices}
            value={selected}
            onValueChange={handleChange}
            size="sm"
            testID="api-endpoint-model-settings-format"
          />
        </View>
      )}
    </Field>
  );
}

function FormatDropdown({
  label,
  choices,
  selected,
  onSelect,
  disabled,
  size,
}: {
  label: string;
  choices: SegmentedControlOption<string>[];
  selected: string;
  onSelect: (value: string) => void;
  disabled: boolean;
  size: "sm" | "md";
}) {
  const current = choices.find((choice) => choice.value === selected) ?? null;
  const display = useMemo(() => (current ? { label: current.label } : null), [current]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        testID="api-endpoint-model-settings-format"
      >
        {({ hovered, open }: DropdownMenuTriggerState) => (
          <SelectFieldTrigger
            display={display}
            placeholder=""
            hovered={hovered}
            active={open}
            disabled={disabled}
            size={size}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" width={240}>
        {choices.map((choice) => (
          <FormatItem
            key={choice.value}
            choice={choice}
            selected={choice.value === selected}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FormatItem({
  choice,
  selected,
  onSelect,
}: {
  choice: SegmentedControlOption<string>;
  selected: boolean;
  onSelect: (value: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(choice.value), [choice.value, onSelect]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} testID={choice.testID}>
      {choice.label}
    </DropdownMenuItem>
  );
}

/** 请求格式的名字（Anthropic、OpenAI Chat…）；不认识的格式照原样。 */
export function formatLabel(t: TFunction, format: string): string {
  return t(`settings.apiEndpoints.formats.${format}`, { defaultValue: format });
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
  segmentRow: {
    flexDirection: "row",
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
