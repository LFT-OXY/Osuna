// 添加窗口的逐个模型识别、自选图标与粘贴 curl移植自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 detectAPIs、iconPicker、curlOf、fromCurl）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Pressable, ScrollView, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AlertTriangle, Check, Info, X } from "lucide-react-native";
import type {
  ApiEndpointModel,
  ApiEndpointRequestFormat,
  ApiEndpointTemplate,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { buttonIconSize, createControlGeometry } from "@/components/ui/control-geometry";
import { AutocompleteFadeFrame } from "@/components/ui/autocomplete-fade";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { useFilePicker, type FilePickFilter } from "@/hooks/use-file-picker";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { BuiltInEndpointIcon, EndpointIcon } from "./endpoint-icon";
import { iconTitle, PICKABLE_ENDPOINT_ICONS } from "./internal/endpoint-icon-names";
import {
  templateEndpointHint,
  templateKeyHint,
  templateNote,
  templateRegionLabel,
  templateRegionName,
} from "./template-copy";
import { useConnectionFormModel } from "./use-connection-form-model";
import { formatLabel } from "./model-settings-sheet";
import { useCurlPasteField } from "./use-curl-paste-field";
import { RequestExtrasFields } from "./request-extras-fields";
import { InsecureTlsField } from "./insecure-tls-field";
import { headerProblemText } from "./request-extras-copy";
import type {
  ConnectionCurlFill,
  ConnectionCurlNote,
  ConnectionDetection,
  ConnectionFormDeps,
  ConnectionFormModel,
  ConnectionFormSeed,
  ConnectionFormState,
  ConnectionFormatField,
  ConnectionIconError,
  ConnectionOnlyChoices,
  ConnectionSaveResult,
  ConnectionTemplateState,
  DetectedFormat,
  DetectionReason,
  FormatTestRow,
  ModelDetectionRow,
  ModelFormatPin,
} from "./internal/connection-form-model";
import { API_ENDPOINT_DETECT_MAX_MODELS } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

export interface ApiEndpointConnectionSheetProps {
  seed: ConnectionFormSeed;
  // 主机声明了 apiEndpointManagement：key 可以不填，key 框旁有「显示」，「自定义」接口能选图标，能粘贴 curl 填表。
  isKeyOptional: boolean;
  canRevealKey: boolean;
  canPickIcon: boolean;
  canPasteCurl: boolean;
  // 同上：保存前能测试连接、添加时能拉模型，自动检测能填试用的模型。
  canCheckBeforeSave: boolean;
  // 同上：新建的接口「跟随接口清单」。
  followsListWhenNew: boolean;
  // 同上：「高级」里能设请求头、附加请求体、key 放哪个头。
  canSetRequestExtras: boolean;
  // 主机给的模板清单（老主机为空）：新建时按 seed 的模板填好，编辑从模板加的接口时能切区域或套餐。
  templates: readonly ApiEndpointTemplate[];
  // 从模板列表进来时回到列表；其余为 null。
  onBack: (() => void) | null;
  onSave: ConnectionFormDeps["save"];
  onDetect: ConnectionFormDeps["detect"];
  onRevealKey: ConnectionFormDeps["revealKey"];
  onStoreIcon: ConnectionFormDeps["storeIcon"];
  onFetchSiteIcon: ConnectionFormDeps["fetchSiteIcon"];
  onFetchModels: ConnectionFormDeps["fetchModels"];
  onTestConnection: ConnectionFormDeps["testConnection"];
  // 保存成功：新建时调用方进入详情页，编辑时只关掉弹窗。
  onSaved: (result: Extract<ConnectionSaveResult, { status: "saved" }>) => void;
  onClose: () => void;
}

const ThemedCheck = withUnistyles(Check, (theme: Theme) => ({ color: theme.colors.statusSuccess }));
const ThemedCross = withUnistyles(X, (theme: Theme) => ({ color: theme.colors.statusDanger }));
const ThemedWarningIcon = withUnistyles(AlertTriangle, (theme: Theme) => ({
  color: theme.colors.statusWarning,
}));
const ThemedInfoIcon = withUnistyles(Info, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

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
  canPickIcon,
  canPasteCurl,
  canCheckBeforeSave,
  followsListWhenNew,
  canSetRequestExtras,
  templates,
  onBack,
  onSave,
  onDetect,
  onRevealKey,
  onStoreIcon,
  onFetchSiteIcon,
  onFetchModels,
  onTestConnection,
  onSaved,
  onClose,
}: ApiEndpointConnectionSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const fieldSize = isCompact ? "md" : "sm";
  const model = useConnectionFormModel(
    seed,
    {
      save: onSave,
      detect: onDetect,
      revealKey: onRevealKey,
      storeIcon: onStoreIcon,
      fetchSiteIcon: onFetchSiteIcon,
      fetchModels: onFetchModels,
      testConnection: onTestConnection,
    },
    {
      isKeyOptional,
      canRevealKey,
      canPickIcon,
      canPasteCurl,
      canCheckBeforeSave,
      followsListWhenNew,
      canSetRequestExtras,
      templates,
    },
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const keyInputRef = useCurlPasteField({ model, field: "apiKey" });
  const saveLabel = saveLabelOf({ t, state });
  const keyHint = state.template?.keyHint ?? null;
  const isTemplateKeyOptional = state.template?.keyOptional === true;
  const keyPlaceholder = useMemo(
    () =>
      keyPlaceholderOf({
        t,
        seed,
        hasSavedKey: state.hasSavedKey,
        keyHint,
        isTemplateKeyOptional,
      }),
    [isTemplateKeyOptional, keyHint, seed, state.hasSavedKey, t],
  );

  const handleSubmit = useCallback(() => {
    void (async () => {
      const result = await model.submit();
      if (result?.status === "saved") onSaved(result);
    })();
  }, [model, onSaved]);
  const handleToggleKey = useCallback(() => model.toggleKeyVisible(), [model]);
  // key 框旁「显示」与地址框旁「自动检测」取两者中较宽的宽度，两个输入框右端对齐。
  const [trailingWidth, setTrailingWidth] = useState(0);
  const handleTrailingLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setTrailingWidth((current) => Math.max(current, width));
  }, []);
  const trailingStyle = useMemo(() => ({ minWidth: trailingWidth }), [trailingWidth]);

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
          {saveLabel}
        </Button>
      </View>
    ),
    [handleSubmit, onClose, saveLabel, state.canSubmit, state.submitting, t],
  );

  const header = useMemo(() => sheetHeaderOf({ t, seed, onBack }), [onBack, seed, t]);
  const template = state.template;

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
        {template ? <TemplateHeading template={template} /> : null}
        {template?.sites ? <SiteSwitch template={template} model={model} /> : null}
        {template?.regions ? <RegionSwitch template={template} model={model} /> : null}
        <Field label={t("settings.apiEndpoints.form.name")}>
          <FormTextInput
            initialValue={state.name}
            resetKey={state.nameGeneration}
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
                ref={keyInputRef}
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
              <View style={trailingStyle} onLayout={handleTrailingLayout}>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={handleToggleKey}
                  loading={state.isRevealingKey}
                  testID="api-endpoint-connection-show-key"
                >
                  {state.isKeyVisible
                    ? t("settings.apiEndpoints.form.hideKey")
                    : t("settings.apiEndpoints.form.showKey")}
                </Button>
              </View>
            ) : null}
          </View>
        </Field>
        <CurlNoteAlert note={state.curlNote} />
        {/* 模板已给好各格式地址，不用自动检测。 */}
        {template ? null : (
          <AddressField
            state={state}
            model={model}
            size={fieldSize}
            trailingStyle={trailingStyle}
            onTrailingLayout={handleTrailingLayout}
          />
        )}
        {state.canPickIcon ? <IconField state={state} model={model} size={fieldSize} /> : null}
        <TemplateAddresses state={state} model={model} size={fieldSize} />
        <InsecureTlsField state={state} model={model} />
        <ConnectionTestField state={state} model={model} />
        {state.hasModelField ? (
          <ModelIdsField state={state} model={model} size={fieldSize} />
        ) : null}
        <Text variant="caption" color="foregroundMuted">
          {footerTextOf({ t, state })}
        </Text>
        <RequestExtrasFields state={state} model={model} size={fieldSize} isCompact={isCompact} />
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

/** 新建时保存后会去拉清单；添加窗口里已经拉过就只是「保存」。 */
function saveLabelOf(input: { t: TFunction; state: ConnectionFormState }): string {
  const { t, state } = input;
  const isSaveAndFetch = state.mode === "create" && state.catalogFetch.status !== "fetched";
  return isSaveAndFetch
    ? t("settings.apiEndpoints.form.saveAndFetch")
    : t("settings.apiEndpoints.form.save");
}

function sheetHeaderOf(input: {
  t: TFunction;
  seed: ConnectionFormSeed;
  onBack: (() => void) | null;
}): SheetHeader {
  const { t, seed, onBack } = input;
  if (seed.mode === "duplicate") {
    return { title: t("settings.apiEndpoints.form.duplicateTitle", { name: seed.source.name }) };
  }
  return {
    title:
      seed.mode === "create"
        ? t("settings.apiEndpoints.form.createTitle")
        : t("settings.apiEndpoints.form.editTitle"),
    ...(onBack ? { back: { onPress: onBack } } : {}),
  };
}

/** 「自定义」的地址框与「自动检测」：检测三种格式各自的地址填到下面。 */
function AddressField({
  state,
  model,
  size,
  trailingStyle,
  onTrailingLayout,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
  trailingStyle: { minWidth: number };
  onTrailingLayout: (event: LayoutChangeEvent) => void;
}) {
  const { t } = useTranslation();
  const handleDetect = useCallback(() => model.detect(), [model]);
  const handleCancelDetect = useCallback(() => model.cancelDetect(), [model]);
  const handleDetectEach = useCallback(() => model.detectEachModel(), [model]);
  const eachLabel = t("settings.apiEndpoints.form.detected.eachButton");
  const eachInfo = t("settings.apiEndpoints.form.detected.eachInfo", {
    max: API_ENDPOINT_DETECT_MAX_MODELS,
  });
  const isCompact = useIsCompactFormFactor();
  const addressInputRef = useCurlPasteField({ model, field: "address" });
  return (
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
            ref={addressInputRef}
            initialValue={state.address}
            onChangeText={model.setAddress}
            placeholder="https://relay.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            invalid={state.addressInvalid}
            size={size}
            testID="api-endpoint-connection-address"
          />
        </View>
        <View style={trailingStyle} onLayout={onTrailingLayout}>
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
        </View>
        {state.detecting ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleCancelDetect}
            testID="api-endpoint-connection-detect-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
        ) : null}
      </View>
      {state.canCheckBeforeSave ? (
        <View style={isCompact ? styles.detectModelStacked : styles.detectModelRow}>
          <View style={isCompact ? null : styles.flex}>
            <FormTextInput
              initialValue={state.detectModel}
              onChangeText={model.setDetectModel}
              placeholder={t("settings.apiEndpoints.form.detectModelPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              size={size}
              testID="api-endpoint-connection-detect-model"
            />
          </View>
          {/* 窄窗口下按钮另起一行，输入框占满宽度、提示文字放得下；按钮与输入框同一档高度。 */}
          <View style={styles.inlineRow}>
            <Button
              variant="outline"
              size={size}
              onPress={handleDetectEach}
              disabled={!state.canDetectEach}
              testID="api-endpoint-connection-detect-each"
            >
              {eachLabel}
            </Button>
            <SettingsInfoTip
              title={eachLabel}
              info={eachInfo}
              testID="api-endpoint-connection-detect-each-info"
            />
          </View>
        </View>
      ) : null}
      {state.eachNeedsModels ? (
        <Text
          variant="caption"
          color="foregroundMuted"
          style={styles.subField}
          testID="api-endpoint-connection-each-needs-models"
        >
          {t("settings.apiEndpoints.form.detected.eachNeedsModels")}
        </Text>
      ) : null}
      {state.detection ? <DetectionResults detection={state.detection} model={model} /> : null}
    </Field>
  );
}

/** 自动检测的结论：每种格式一行耗时或错误；「采用这些」才填进地址栏（照 magpie Detect）。 */
function DetectionResults({
  detection,
  model,
}: {
  detection: ConnectionDetection;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  const handleTake = useCallback(() => model.takeDetected(), [model]);
  return (
    <View style={styles.checkList} testID="api-endpoint-connection-detection">
      {detection.results.map((result) => (
        <CheckRow
          key={result.format}
          format={result.format}
          url={result.url}
          {...detectionRowOf({ t, result })}
          testID={`api-endpoint-connection-detection-${result.format}`}
        />
      ))}
      {detection.byModel ? <ModelDetectionList rows={detection.byModel} /> : null}
      {detection.askedOnlyFirst ? (
        <Text variant="caption" color="foregroundMuted" testID="api-endpoint-connection-each-cut">
          {t("settings.apiEndpoints.form.detected.eachCut", detection.askedOnlyFirst)}
        </Text>
      ) : null}
      {detection.canTake ? (
        <View style={styles.inlineRow}>
          <Button
            variant="outline"
            size="sm"
            onPress={handleTake}
            testID="api-endpoint-connection-use-detected"
          >
            {t("settings.apiEndpoints.form.detected.useThese")}
          </Button>
          {detection.waitsForTake ? (
            <Text
              variant="caption"
              color="foregroundMuted"
              style={styles.flex}
              testID="api-endpoint-connection-take-to-save"
            >
              {t("settings.apiEndpoints.form.detected.takeToSave")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {detection.onlyChoices ? (
        <OnlyFormatChoices choices={detection.onlyChoices} model={model} />
      ) : null}
      {detection.singleFormatPins.length > 0 ? (
        <Text variant="caption" color="foregroundMuted" testID="api-endpoint-connection-each-given">
          {givenPinsText({ t, pins: detection.singleFormatPins, isTaken: detection.isTaken })}
        </Text>
      ) : null}
      {detection.isTaken ? (
        <Text variant="caption" color="foregroundMuted" testID="api-endpoint-connection-taken">
          {t("settings.apiEndpoints.form.detected.taken")}
        </Text>
      ) : null}
      {detection.noneAnswered ? (
        <Text
          variant="caption"
          color="foregroundMuted"
          testID="api-endpoint-connection-none-answered"
        >
          {detection.noneAnswered === "keyless"
            ? t("settings.apiEndpoints.form.detected.noneAnsweredKeyless")
            : t("settings.apiEndpoints.form.detected.noneAnswered")}
        </Text>
      ) : null}
    </View>
  );
}

/** 「采用这些」会（或已经）把哪些模型设成只用这种格式。 */
function givenPinsText(input: { t: TFunction; pins: ModelFormatPin[]; isTaken: boolean }): string {
  const { t, pins } = input;
  const list = pins
    .map((pin) =>
      t("settings.apiEndpoints.form.detected.eachGivenItem", {
        model: pin.modelId,
        format: formatLabel(t, pin.format),
      }),
    )
    .join(" · ");
  if (input.isTaken) return t("settings.apiEndpoints.form.detected.eachGivenOnceSaved", { list });
  return t("settings.apiEndpoints.form.detected.eachGivenByTake", { list });
}

/** 逐个模型识别的结论（照 magpie Each picked model 的表）：每个模型一行，下面每种格式一格，原因写全。 */
function ModelDetectionList({ rows }: { rows: ModelDetectionRow[] }) {
  const isCompact = useIsCompactFormFactor();
  const cellsStyle = isCompact ? styles.eachCellsStacked : styles.eachCells;
  const cellStyle = isCompact ? styles.eachCellStacked : styles.eachCell;
  return (
    <View style={styles.eachList} testID="api-endpoint-connection-each-results">
      {rows.map((row) => (
        <View
          key={row.modelId}
          style={styles.eachRow}
          testID={`api-endpoint-connection-each-${row.modelId}`}
        >
          <Text variant="label" selectable>
            {row.modelId}
          </Text>
          <View style={cellsStyle}>
            {row.cells.map((cell) => (
              <ModelDetectionCell
                key={cell.format}
                cell={cell}
                style={cellStyle}
                testID={`api-endpoint-connection-each-${row.modelId}-${cell.format}`}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function ModelDetectionCell({
  cell,
  style,
  testID,
}: {
  cell: DetectedFormat;
  style: ViewStyle;
  testID: string;
}) {
  const { t } = useTranslation();
  const isOk = cell.label === "ok";
  // 格式名那一行：答上的写耗时，没答上的写 HTTP 状态码（magpie 的格子同样把状态码放在原因前面）。
  let status: string | null = null;
  if (isOk && cell.durationMs !== null) {
    status = t("settings.apiEndpoints.form.detected.eachOk", { ms: cell.durationMs });
  } else if (!isOk && cell.httpStatus !== null) status = String(cell.httpStatus);
  const reason = isOk ? null : cellReasonText({ t, cell });
  return (
    <View style={style} testID={testID}>
      <View style={styles.eachHeading}>
        <View style={styles.checkIcon}>
          {isOk ? <ThemedCheck size={12} /> : <ThemedCross size={12} />}
        </View>
        <Text variant="caption" color="foregroundMuted">
          {t(`settings.apiEndpoints.formats.${cell.format}`)}
        </Text>
        {status !== null ? (
          <Text
            variant="caption"
            color={isOk ? "statusSuccess" : "statusDanger"}
            testID={`${testID}-verdict`}
          >
            {status}
          </Text>
        ) : null}
      </View>
      {reason ? (
        <Text variant="caption" color="foregroundMuted" selectable testID={`${testID}-reason`}>
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

/** 没答上的一格的原因：结论（未检测到 / key 被拒）加 daemon 的原因（按界面语言）或上游原文，状态码已在上一行。 */
function cellReasonText(input: { t: TFunction; cell: DetectedFormat }): string {
  const { t, cell } = input;
  const verdict = t(`settings.apiEndpoints.form.detection.${cell.label}`);
  let said = upstreamReason(cell);
  if (cell.reason !== null) said = detectionReasonText(t, cell.reason);
  if (said === null) return verdict;
  return t("settings.apiEndpoints.form.detected.eachReason", { verdict, reason: said });
}

/** 上游原文去掉开头的「HTTP 状态码:」（状态码已在格式名那一行）。 */
function upstreamReason(cell: DetectedFormat): string | null {
  if (cell.message === null) return null;
  return cell.message.replace(/^HTTP \d+(: )?/, "") || null;
}

function detectionReasonText(t: TFunction, reason: DetectionReason): string {
  const key = "settings.apiEndpoints.form.detected.eachReasons";
  switch (reason.code) {
    case "upstream_timeout":
      return t(`${key}.upstreamTimeout`, { seconds: reason.seconds });
    case "batch_timeout":
      return t(`${key}.batchTimeout`);
    case "not_asked":
      return t(`${key}.notAsked`);
    case "image_model":
      return t(`${key}.imageModel`);
    case "no_model_to_try":
      return t(`${key}.noModelToTry`);
    case "upstream_unreachable":
      return t(`${key}.unreachable`, { detail: reason.detail });
    case "models_list_failed":
      return t(`${key}.listFailed`, { detail: reason.detail });
    case "wrong_shape":
      return t(`${key}.wrongShape`, { format: formatLabel(t, reason.format) });
    case "invalid_header":
      return headerProblemText(t, { reason: reason.headerReason, name: reason.name });
  }
}

/**
 * 「只用 {格式} 问 {模型}」（照 magpie Detect 的 Ask {model} on {api} only，那里是一排可切换的按钮）：每种通了的格式一个，
 * 选着的是实底带勾，再点一次取消；保存时随这家一起存进模型设置。
 */
function OnlyFormatChoices({
  choices,
  model,
}: {
  choices: ConnectionOnlyChoices;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  const { staged, modelId } = choices;
  let note: string | null = null;
  if (choices.isPending && staged !== null) {
    note = t("settings.apiEndpoints.form.detected.onlyOnceSaved", {
      model: modelId,
      format: formatLabel(t, staged),
    });
  } else if (choices.isPending) {
    note = t("settings.apiEndpoints.form.detected.onlyClearedOnceSaved", { model: modelId });
  }
  const undo = staged === null ? null : t("settings.apiEndpoints.form.detected.onlyUndo");
  return (
    <View style={styles.checkList} testID="api-endpoint-connection-only-choices">
      <View style={styles.wrapRow}>
        {choices.formats.map((format) => (
          <OnlyFormatButton
            key={format}
            format={format}
            modelId={modelId}
            isStaged={staged === format}
            onPress={model.askOnlyOn}
          />
        ))}
      </View>
      {note !== null || undo !== null ? (
        <Text
          variant="caption"
          color="foregroundMuted"
          testID="api-endpoint-connection-only-pending"
        >
          {note !== null && undo !== null
            ? t("settings.apiEndpoints.form.detected.noteAndUndo", { note, undo })
            : (note ?? undo)}
        </Text>
      ) : null}
    </View>
  );
}

function OnlyFormatButton({
  format,
  modelId,
  isStaged,
  onPress,
}: {
  format: ApiEndpointRequestFormat;
  modelId: string;
  isStaged: boolean;
  onPress: (format: ApiEndpointRequestFormat) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(format), [format, onPress]);
  const accessibilityState = useMemo(() => ({ selected: isStaged }), [isStaged]);
  return (
    <Button
      variant={isStaged ? "default" : "outline"}
      size="sm"
      leftIcon={isStaged ? Check : undefined}
      onPress={handlePress}
      accessibilityState={accessibilityState}
      testID={`api-endpoint-connection-only-${format}`}
    >
      {t("settings.apiEndpoints.form.detected.askOnly", {
        model: modelId,
        format: formatLabel(t, format),
      })}
    </Button>
  );
}

// 一行结果的结论：通了没有、结论那句、另起一行的原因（没有为 null）。
interface CheckRowResult {
  isOk: boolean | null;
  verdict: string;
  reason: string | null;
}

function detectionRowOf(input: { t: TFunction; result: DetectedFormat }): CheckRowResult {
  const { t, result } = input;
  const modelNote =
    result.modelId === null
      ? null
      : t("settings.apiEndpoints.form.detected.model", { model: result.modelId });
  if (result.label === "ok") {
    const verdict =
      result.durationMs === null
        ? t("settings.apiEndpoints.form.detection.ok")
        : t("settings.apiEndpoints.form.detected.okTook", { ms: result.durationMs });
    return { isOk: true, verdict, reason: modelNote };
  }
  // daemon 自己写的原因按界面语言说，上游原文照登。
  let said = result.message;
  if (result.reason !== null) said = detectionReasonText(t, result.reason);
  const reason = [said, modelNote].filter((part) => part !== null).join(" · ");
  return {
    isOk: false,
    verdict: t(`settings.apiEndpoints.form.detection.${result.label}`),
    reason: reason === "" ? null : reason,
  };
}

function testRowOf(input: { t: TFunction; row: FormatTestRow }): CheckRowResult {
  const { t } = input;
  const { outcome } = input.row;
  switch (outcome.kind) {
    case "testing":
      return { isOk: null, verdict: t("settings.apiEndpoints.detail.test.testing"), reason: null };
    case "ok":
      return {
        isOk: true,
        verdict: t("settings.apiEndpoints.detail.test.ok", { ms: outcome.durationMs }),
        reason: null,
      };
    case "authFailed":
    case "failed": {
      const verdict =
        outcome.kind === "authFailed"
          ? t("settings.apiEndpoints.detail.test.authFailed")
          : t("settings.apiEndpoints.detail.test.failed");
      // 原因里已经写着 HTTP 状态码时不再重复。
      const isStatusTold =
        outcome.status === null || outcome.message.includes(`HTTP ${outcome.status}`);
      const status = isStatusTold ? null : `HTTP ${outcome.status}`;
      const reason = [status, outcome.message].filter((part) => part).join(" · ");
      return { isOk: false, verdict, reason: reason === "" ? null : reason };
    }
  }
}

/** 一种格式一行：图标、格式名与结论，下面是地址，失败原因另起一行。 */
function CheckRow({
  format,
  url,
  isOk,
  verdict,
  reason,
  testID,
}: CheckRowResult & {
  format: ApiEndpointRequestFormat;
  url: string;
  testID: string;
}) {
  const { t } = useTranslation();
  let verdictColor: "foregroundMuted" | "statusSuccess" | "statusDanger" = "foregroundMuted";
  if (isOk === true) verdictColor = "statusSuccess";
  if (isOk === false) verdictColor = "statusDanger";
  return (
    <View style={styles.checkRow} testID={testID}>
      <View style={styles.checkIcon}>
        {isOk === true ? <ThemedCheck size={12} /> : null}
        {isOk === false ? <ThemedCross size={12} /> : null}
      </View>
      <View style={styles.flex}>
        <View style={styles.checkHeading}>
          <Text variant="label">{t(`settings.apiEndpoints.formats.${format}`)}</Text>
          <Text variant="caption" color={verdictColor} testID={`${testID}-verdict`}>
            {verdict}
          </Text>
        </View>
        {url ? (
          <Text variant="caption" color="foregroundMuted" numberOfLines={1} selectable>
            {url}
          </Text>
        ) : null}
        {reason ? (
          <Text
            variant="caption"
            color="foregroundMuted"
            numberOfLines={3}
            selectable
            testID={`${testID}-reason`}
          >
            {reason}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** 保存前「测试连接」：表单里每种格式的地址各发一条最小请求，逐行显示耗时或错误。 */
function ConnectionTestField({
  state,
  model,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  const handleTest = useCallback(() => model.testConnection(), [model]);
  const handleCancel = useCallback(() => model.cancelTest(), [model]);
  if (!state.canCheckBeforeSave) return null;
  return (
    <View style={styles.testField} testID="api-endpoint-connection-test">
      <View style={styles.inlineRow}>
        <Button
          variant="outline"
          size="sm"
          onPress={handleTest}
          disabled={!state.canTest}
          loading={state.isTesting}
          testID="api-endpoint-connection-test-button"
        >
          {t("settings.apiEndpoints.detail.testConnection")}
        </Button>
        {state.isTesting ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleCancel}
            testID="api-endpoint-connection-test-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
        ) : null}
      </View>
      {state.tests.map((row) => (
        <CheckRow
          key={row.format}
          format={row.format}
          url={row.url}
          {...testRowOf({ t, row })}
          testID={`api-endpoint-connection-test-${row.format}`}
        />
      ))}
    </View>
  );
}

/** 新建或复制「自定义」时粘贴 curl 带来的模型（照 magpie 添加窗口的 Models 框）：逗号分隔，可改，保存时选上。 */
function ModelIdsField({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const modelsInputRef = useCurlPasteField({ model, field: "models" });
  const handleFetch = useCallback(() => model.fetchModels(), [model]);
  const handleCancelFetch = useCallback(() => model.cancelFetchModels(), [model]);
  const canFetch = state.canCheckBeforeSave && state.mode !== "edit";
  const { catalogFetch } = state;
  return (
    <Field
      label={t("settings.apiEndpoints.form.models")}
      hint={
        canFetch
          ? t("settings.apiEndpoints.form.modelsHintFetch")
          : t("settings.apiEndpoints.form.modelsHint")
      }
      error={catalogFetch.status === "failed" ? catalogFetch.message : null}
      testID="api-endpoint-connection-models-field"
    >
      <View style={styles.inlineRow}>
        <View style={styles.flex}>
          <FormTextInput
            ref={modelsInputRef}
            initialValue={state.modelIds.join(", ")}
            resetKey={state.modelIdsGeneration}
            onChangeText={model.setModelIds}
            placeholder={t("settings.apiEndpoints.form.modelsPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            size={size}
            testID="api-endpoint-connection-models"
          />
        </View>
        {canFetch ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleFetch}
            disabled={!state.canFetchModels}
            loading={catalogFetch.status === "fetching"}
            testID="api-endpoint-connection-fetch-models"
          >
            {t("settings.apiEndpoints.form.fetch.button")}
          </Button>
        ) : null}
        {catalogFetch.status === "fetching" ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleCancelFetch}
            testID="api-endpoint-connection-fetch-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
        ) : null}
      </View>
      {catalogFetch.status === "fetched" ? (
        <ModelPicker
          models={catalogFetch.models}
          picked={state.modelIds}
          model={model}
          size={size}
        />
      ) : null}
    </Field>
  );
}

// 清单超过这么多个时给筛选框（照 magpie）。
const FILTER_FROM = 24;
// 没筛选时先画这么多个，选上的总画出来（照 magpie）。
const FIRST_SHOWN = 120;

/**
 * 拉到的清单（照 magpie addFormModels）：点一个模型选上或去掉，进「模型」框；已选几个、全选（筛选时是选上显示的）、全不选；
 * 清单长时先只画前 120 个，「显示其余」再画。
 */
function ModelPicker({
  models,
  picked,
  model,
  size,
}: {
  models: ApiEndpointModel[];
  picked: string[];
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [isShowingAll, setIsShowingAll] = useState(false);
  const search = query.trim().toLowerCase();
  const matching = useMemo(
    () =>
      models.filter(
        (entry) =>
          search === "" ||
          entry.id.toLowerCase().includes(search) ||
          (entry.label ?? "").toLowerCase().includes(search),
      ),
    [models, search],
  );
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const isCapped = search === "" && !isShowingAll;
  const shown = isCapped
    ? matching.filter((entry, index) => index < FIRST_SHOWN || pickedSet.has(entry.id))
    : matching;
  const hiddenCount = matching.length - shown.length;
  const pickedCount = models.filter((entry) => pickedSet.has(entry.id)).length;
  const handlePickShown = useCallback(
    () => model.pickModels(matching.map((entry) => entry.id)),
    [matching, model],
  );
  const handlePickNone = useCallback(
    () => model.unpickModels(models.map((entry) => entry.id)),
    [model, models],
  );
  const handleShowAll = useCallback(() => setIsShowingAll(true), []);
  if (models.length === 0) {
    return (
      <Text
        variant="caption"
        color="foregroundMuted"
        testID="api-endpoint-connection-catalog-empty"
      >
        {t("settings.apiEndpoints.form.fetch.empty")}
      </Text>
    );
  }
  return (
    <View style={styles.picker} testID="api-endpoint-connection-catalog">
      {models.length > FILTER_FROM ? (
        <FormTextInput
          initialValue={query}
          onChangeText={setQuery}
          placeholder={t("settings.apiEndpoints.form.fetch.filter", { count: models.length })}
          autoCapitalize="none"
          autoCorrect={false}
          size={size}
          testID="api-endpoint-connection-catalog-filter"
        />
      ) : null}
      <View style={styles.pickerActions}>
        <Text
          variant="caption"
          color="foregroundMuted"
          style={styles.flex}
          testID="api-endpoint-connection-catalog-count"
        >
          {t("settings.apiEndpoints.form.fetch.picked", {
            picked: pickedCount,
            total: models.length,
          })}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          onPress={handlePickShown}
          testID="api-endpoint-connection-catalog-pick-all"
        >
          {search === ""
            ? t("settings.apiEndpoints.form.fetch.pickAll")
            : t("settings.apiEndpoints.form.fetch.pickShown")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={handlePickNone}
          testID="api-endpoint-connection-catalog-pick-none"
        >
          {t("settings.apiEndpoints.form.fetch.pickNone")}
        </Button>
      </View>
      {/* 底部渐隐：看得出清单还能往下滚。 */}
      <AutocompleteFadeFrame>
        <ScrollView style={styles.chipScroll} nestedScrollEnabled>
          <View style={styles.chips}>
            {shown.map((entry) => (
              <ModelChip
                key={entry.id}
                entry={entry}
                selected={pickedSet.has(entry.id)}
                onToggle={model.toggleModel}
              />
            ))}
            {hiddenCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={handleShowAll}
                testID="api-endpoint-connection-catalog-show-rest"
              >
                {t("settings.apiEndpoints.form.fetch.showRest", { count: hiddenCount })}
              </Button>
            ) : null}
          </View>
          {matching.length === 0 ? (
            <Text variant="caption" color="foregroundMuted">
              {t("settings.apiEndpoints.form.fetch.noMatch", { query: query.trim() })}
            </Text>
          ) : null}
        </ScrollView>
      </AutocompleteFadeFrame>
    </View>
  );
}

function ModelChip({
  entry,
  selected,
  onToggle,
}: {
  entry: ApiEndpointModel;
  selected: boolean;
  onToggle: (modelId: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(entry.id), [entry.id, onToggle]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const chipStyle = useCallback(
    ({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
      styles.chip,
      (hovered || pressed) && styles.chipHovered,
      selected && styles.chipSelected,
    ],
    [selected],
  );
  return (
    <Pressable
      style={chipStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={`api-endpoint-connection-catalog-model-${entry.id}`}
    >
      <Text variant="caption" color={selected ? "foreground" : "foregroundMuted"}>
        {entry.label ?? entry.id}
      </Text>
    </Pressable>
  );
}

/** 粘贴 curl 后的提示条：取了什么、URL 结尾认不出、地址里的占位符、key 只是占位符；有要用户自己改的就用警告色。 */
function CurlNoteAlert({ note }: { note: ConnectionCurlNote | null }) {
  const { t } = useTranslation();
  if (!note) return null;
  const sentences: string[] = [];
  if (note.filled.length > 0) {
    const what = note.filled.map((fill) => curlFillText(t, fill)).join(" · ");
    sentences.push(t("settings.apiEndpoints.form.curl.filled", { what }));
  }
  if (note.isEndpointUnknown) sentences.push(t("settings.apiEndpoints.form.curl.unknownEndpoint"));
  if (note.urlPlaceholder) {
    sentences.push(
      t("settings.apiEndpoints.form.curl.urlPlaceholder", { part: note.urlPlaceholder }),
    );
  }
  if (note.keyPlaceholder) {
    sentences.push(
      t("settings.apiEndpoints.form.curl.keyPlaceholder", { key: note.keyPlaceholder }),
    );
  }
  const needsAction =
    note.isEndpointUnknown || note.urlPlaceholder !== null || note.keyPlaceholder !== null;
  // 两种提示条同一结构：浅底、无边框，只换底色与图标（与 <Alert variant="warning"> 的警示块同源）。
  const toneStyle = needsAction ? styles.curlNoteWarning : styles.curlNoteInfo;
  const icon = needsAction ? (
    <ThemedWarningIcon size={buttonIconSize.sm} />
  ) : (
    <ThemedInfoIcon size={buttonIconSize.sm} />
  );
  return (
    <View
      style={[styles.curlNote, toneStyle]}
      accessibilityRole="alert"
      testID="api-endpoint-connection-curl-note"
    >
      <View style={styles.curlNoteIcon}>{icon}</View>
      <Text color="foreground" style={styles.flex}>
        {sentences.join(" ")}
      </Text>
    </View>
  );
}

function curlFillText(t: TFunction, fill: ConnectionCurlFill): string {
  switch (fill.kind) {
    case "baseUrl":
      return t(`settings.apiEndpoints.form.formatUrl.${fill.format}`);
    case "apiKey":
      return t("settings.apiEndpoints.form.apiKey");
    case "model":
      return t("settings.apiEndpoints.form.curl.model", { model: fill.model });
  }
}

/** 表单底下的说明：填资源地址的模板说保存后列部署；别的说 key 由三种格式共用。 */
function footerTextOf(input: { t: TFunction; state: ConnectionFormState }): string {
  const { t, state } = input;
  // 添加窗口里已经拉过清单：保存就把它和点选的模型一起存下。
  if (state.catalogFetch.status === "fetched") return t("settings.apiEndpoints.form.footerFetched");
  if (state.template?.endpointExample) return t("settings.apiEndpoints.form.footerResource");
  // 本机服务的 key 框已写明可以不填，这里不再说一遍。
  if (state.template?.asksServiceAddress) return t("settings.apiEndpoints.form.footerLocal");
  return state.isKeyOptional
    ? t("settings.apiEndpoints.form.footerKeyOptional")
    : t("settings.apiEndpoints.form.footer");
}

/**
 * key 框里的提示：复制时说沿用原来的 key，编辑已存 key 时说留空保留，模板有提示时用它的，
 * 不要 key 的模板（本机服务）说可以不填（照 magpie）。
 */
function keyPlaceholderOf(input: {
  t: TFunction;
  seed: ConnectionFormSeed;
  hasSavedKey: boolean;
  keyHint: string | null;
  isTemplateKeyOptional: boolean;
}): string {
  const { t, seed } = input;
  if (seed.mode === "duplicate" && seed.source.hasApiKey) {
    const mask = seed.source.apiKeyMask;
    return mask
      ? t("settings.apiEndpoints.form.apiKeyCopiedPlaceholder", { mask })
      : t("settings.apiEndpoints.form.apiKeyCopiedPlaceholderUnmasked");
  }
  if (input.hasSavedKey) return t("settings.apiEndpoints.form.apiKeySavedPlaceholder");
  if (input.keyHint !== null) return templateKeyHint(t, input.keyHint);
  return input.isTemplateKeyOptional
    ? t("settings.apiEndpoints.form.apiKeyLocalPlaceholder")
    : "sk-…";
}

/**
 * 模板的图标、名称与说明；下面「官网 ↗」（主机名）与「去拿 key ↗」都跟着所选区域或套餐变（照 magpie 编辑窗口顶上）。
 */
function TemplateHeading({ template }: { template: ConnectionTemplateState }) {
  const { t } = useTranslation();
  const { keysUrl, websiteUrl } = template;
  const handleGetKey = useCallback(() => {
    if (keysUrl) void openExternalUrl(keysUrl);
  }, [keysUrl]);
  const handleWebsite = useCallback(() => {
    if (websiteUrl) void openExternalUrl(websiteUrl);
  }, [websiteUrl]);
  return (
    <View style={styles.templateHeading} testID="api-endpoint-connection-template">
      <View style={styles.templateIdentity}>
        <View style={styles.templateIcon}>
          <EndpointIcon
            icon={null}
            templateId={template.id}
            name={template.name}
            size={ICON_SIZE.lg}
            initialVariant="label"
          />
        </View>
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {template.name}
          </Text>
          {template.note ? (
            <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
              {templateNote(t, template.note)}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.templateLinks}>
        {websiteUrl ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleWebsite}
            testID="api-endpoint-connection-website"
          >
            {`${hostOf(websiteUrl)} ↗`}
          </Button>
        ) : null}
        {keysUrl ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleGetKey}
            testID="api-endpoint-connection-get-key"
          >
            {t("settings.apiEndpoints.templates.getKey")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

// 地址的主机名（照 magpie hostOf）；原生端的 URL 实现不完整，用字符串截。
function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0] ?? url;
}

/** 新建时国际站 / 中国站：只保留 key，其余按那一站的模板重来。 */
function SiteSwitch({
  template,
  model,
}: {
  template: ConnectionTemplateState;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () =>
      (template.sites ?? []).map((site) => ({
        value: site.templateId,
        label: t(`settings.apiEndpoints.templates.area.${site.area}`),
        testID: `api-endpoint-connection-site-${site.area}`,
      })),
    [t, template.sites],
  );
  return (
    <Field label={t("settings.apiEndpoints.templates.region")}>
      <View style={styles.switchRow}>
        <SegmentedControl
          options={options}
          value={template.id}
          onValueChange={model.setSite}
          size="sm"
          testID="api-endpoint-connection-site"
        />
      </View>
    </Field>
  );
}

// 区域或套餐多于这么多个时用下拉菜单：分段切换放不下，折行后读不出哪一段被选中（docs/design.md §6）。
const MAX_REGION_SEGMENTS = 4;

/** 区域或套餐：各格式地址与「去拿 key」跟着换，key 与名称保留。少的用分段切换，多的用下拉菜单。 */
function RegionSwitch({
  template,
  model,
}: {
  template: ConnectionTemplateState;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () =>
      (template.regions ?? []).map((region) => ({
        value: region.id,
        label: templateRegionName(t, region.name),
        testID: `api-endpoint-connection-region-${region.id}`,
      })),
    [t, template.regions],
  );
  const label = templateRegionLabel(t, template.regionLabel);
  const selected = options.find((option) => option.value === template.regionId) ?? null;
  return (
    <Field
      label={label}
      hint={t("settings.apiEndpoints.templates.regionHint", { name: template.name })}
    >
      {options.length > MAX_REGION_SEGMENTS ? (
        <View style={styles.switchRow}>
          <DropdownMenu>
            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={label}
              testID="api-endpoint-connection-region"
            >
              {selected?.label ?? ""}
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="start" width={240}>
              {options.map((option) => (
                <RegionMenuItem
                  key={option.value}
                  option={option}
                  selected={option.value === template.regionId}
                  onSelect={model.setRegion}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      ) : (
        <View style={styles.switchRow}>
          <SegmentedControl
            options={options}
            value={template.regionId ?? ""}
            onValueChange={model.setRegion}
            size="sm"
            testID="api-endpoint-connection-region"
          />
        </View>
      )}
    </Field>
  );
}

function RegionMenuItem({
  option,
  selected,
  onSelect,
}: {
  option: { value: string; label: string; testID: string };
  selected: boolean;
  onSelect: (regionId: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(option.value), [onSelect, option.value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} testID={option.testID}>
      {option.label}
    </DropdownMenuItem>
  );
}

/**
 * 要填自己资源地址的模板（Azure OpenAI）：一个地址框代替各格式地址，Chat 与 Responses 都用它；
 * 只有资源名也行，daemon 保存时放到资源的 v1 API 上（照 magpie 编辑窗口的 Endpoint 框）。
 */
function ResourceEndpointField({
  templateId,
  example,
  hint,
  endpoint,
  model,
  size,
}: {
  templateId: string;
  example: string;
  hint: string | null;
  endpoint: string;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  return (
    <Field
      label={t("settings.apiEndpoints.form.resourceEndpoint")}
      {...(hint === null ? {} : { hint: templateEndpointHint(t, { templateId, hint }) })}
      testID="api-endpoint-connection-endpoint-field"
    >
      <FormTextInput
        initialValue={endpoint}
        onChangeText={model.setEndpoint}
        placeholder={example}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        size={size}
        testID="api-endpoint-connection-endpoint"
      />
    </Field>
  );
}

/** 各格式的地址：本机服务只要服务地址，填自己资源地址的模板只要资源地址，别的列出三种格式各自的地址。 */
function TemplateAddresses({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { template } = state;
  if (template?.asksServiceAddress) {
    return <ServiceAddressField state={state} model={model} size={size} />;
  }
  if (template?.endpointExample) {
    return (
      <ResourceEndpointField
        templateId={template.id}
        example={template.endpointExample}
        hint={template.endpointHint}
        endpoint={state.endpoint}
        model={model}
        size={size}
      />
    );
  }
  return (
    <View style={styles.formatGroup} testID="api-endpoint-connection-formats">
      {state.formats.map((field) => (
        <FormatUrlField
          key={field.format}
          field={field}
          generation={state.urlGeneration}
          size={size}
          model={model}
        />
      ))}
    </View>
  );
}

/**
 * 本机服务的地址（照 magpie 编辑窗口的 Address）：服务换了端口或在别的电脑上时只改这一处，各格式地址的协议、主机、端口跟着换，
 * 路径不变；不写协议按 http。
 */
function ServiceAddressField({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  return (
    <Field
      label={t("settings.apiEndpoints.form.serviceAddress")}
      hint={t("settings.apiEndpoints.form.serviceAddressHint")}
      error={
        state.serviceAddressInvalid
          ? t("settings.apiEndpoints.form.serviceAddressInvalid", {
              address: state.serviceAddress.trim(),
            })
          : null
      }
      testID="api-endpoint-connection-service-address-field"
    >
      <FormTextInput
        initialValue={state.serviceAddress}
        onChangeText={model.setServiceAddress}
        placeholder="http://localhost:11434"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        invalid={state.serviceAddressInvalid}
        size={size}
        testID="api-endpoint-connection-service-address"
      />
    </Field>
  );
}

// 只给选认得的图片（照 magpie iconPicker 的 accept）；别的格式 daemon 也会拒收。
const ICON_PICTURE_FILTER: FilePickFilter = {
  name: "Images",
  mimeTypes: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/x-icon",
    "image/svg+xml",
  ],
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "ico", "svg"],
};

/**
 * 「自定义」接口的图标（照 magpie iconPicker）：现在的图标，「选一张图片…」（本机图片，存到主机上），「从网站取图标」
 * （按填的地址），「内置图标」展开可搜索的格子，选过图标时有「默认」（回到名称首字）。按钮在图标右边自成一栏，窄窗口折行也对齐。
 */
function IconField({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const { pickFiles } = useFilePicker();
  const [isGridOpen, setIsGridOpen] = useState(false);
  const [query, setQuery] = useState("");
  const handlePickPicture = useCallback(() => {
    void (async () => {
      const file = (await pickFiles({ filter: ICON_PICTURE_FILTER }))?.[0];
      if (!file) return;
      model.pickIconImage(await file.readBytes());
    })();
  }, [model, pickFiles]);
  const handleFetchSiteIcon = useCallback(() => model.fetchSiteIcon(), [model]);
  const handleToggleGrid = useCallback(() => setIsGridOpen((open) => !open), []);
  const handleDefault = useCallback(() => model.setIcon(null), [model]);
  const handlePick = useCallback(
    (name: string) => {
      model.setIcon(name);
      setIsGridOpen(false);
    },
    [model],
  );
  const search = query.trim().toLowerCase();
  const names = useMemo(
    () => PICKABLE_ENDPOINT_ICONS.filter((name) => iconTitle(name).includes(search)),
    [search],
  );
  return (
    <Field
      label={t("settings.apiEndpoints.form.icon.label")}
      error={state.iconError ? iconErrorText(t, state.iconError) : null}
      testID="api-endpoint-connection-icon-field"
    >
      <View style={styles.iconControls}>
        <View style={styles.iconPreview} testID="api-endpoint-connection-icon-preview">
          <EndpointIcon
            icon={state.icon}
            templateId={null}
            name={state.name}
            size={ICON_SIZE.lg}
            initialVariant="label"
          />
        </View>
        <View style={styles.iconActions}>
          <Button
            variant="outline"
            size="sm"
            onPress={handlePickPicture}
            loading={state.iconTask === "picture"}
            testID="api-endpoint-connection-icon-picture"
          >
            {t("settings.apiEndpoints.form.icon.choosePicture")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={handleFetchSiteIcon}
            loading={state.iconTask === "website"}
            testID="api-endpoint-connection-icon-website"
          >
            {t("settings.apiEndpoints.form.icon.fromWebsite")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={handleToggleGrid}
            style={isGridOpen ? styles.iconGridToggleOpen : undefined}
            accessibilityState={isGridOpen ? EXPANDED : COLLAPSED}
            testID="api-endpoint-connection-icon-built-in"
          >
            {t("settings.apiEndpoints.form.icon.builtIn")}
          </Button>
          {state.icon === null ? null : (
            <Button
              variant="outline"
              size="sm"
              onPress={handleDefault}
              testID="api-endpoint-connection-icon-default"
            >
              {t("settings.apiEndpoints.form.icon.default")}
            </Button>
          )}
        </View>
      </View>
      {isGridOpen ? (
        <View style={styles.iconPicker}>
          <FormTextInput
            initialValue={query}
            onChangeText={setQuery}
            placeholder={t("settings.apiEndpoints.form.icon.find")}
            autoCapitalize="none"
            autoCorrect={false}
            size={size}
            testID="api-endpoint-connection-icon-search"
          />
          {names.length === 0 ? (
            <Text variant="caption" color="foregroundMuted">
              {t("settings.apiEndpoints.form.icon.noMatch", { query: query.trim() })}
            </Text>
          ) : (
            <View style={styles.iconGrid} testID="api-endpoint-connection-icon-grid">
              {names.map((name) => (
                <IconTile
                  key={name}
                  name={name}
                  selected={name === state.icon}
                  onPick={handlePick}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Field>
  );
}

const EXPANDED = { expanded: true };
const COLLAPSED = { expanded: false };

function iconErrorText(t: TFunction, error: ConnectionIconError): string {
  switch (error.code) {
    case "icon_too_large":
      return t("settings.apiEndpoints.form.icon.tooLarge");
    case "icon_not_image":
      return t("settings.apiEndpoints.form.icon.notImage");
    case "site_icon_no_address":
      return t("settings.apiEndpoints.form.icon.siteNoAddress");
    case "site_icon_local":
      return t("settings.apiEndpoints.form.icon.siteLocal");
    case "site_icon_not_found":
      return t("settings.apiEndpoints.form.icon.siteNotFound", { detail: error.message });
    case "failed":
      return error.message;
  }
}

function IconTile({
  name,
  selected,
  onPick,
}: {
  name: string;
  selected: boolean;
  onPick: (name: string) => void;
}) {
  const handlePress = useCallback(() => onPick(name), [name, onPick]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const tileStyle = useCallback(
    ({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
      styles.iconTile,
      (hovered || pressed) && styles.iconTileHovered,
      selected && styles.iconTileSelected,
    ],
    [selected],
  );
  return (
    <Pressable
      style={tileStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={iconTitle(name)}
      accessibilityState={accessibilityState}
      testID={`api-endpoint-connection-icon-${name}`}
    >
      <BuiltInEndpointIcon name={name} size={ICON_SIZE.md} />
    </Pressable>
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
  return (
    <Field
      label={t(`settings.apiEndpoints.form.formatUrl.${format}`)}
      error={field.invalid ? t("settings.apiEndpoints.form.urlInvalid") : null}
      testID={`api-endpoint-connection-url-field-${format}`}
    >
      <FormTextInput
        initialValue={field.url}
        resetKey={generation}
        onChangeText={handleChange}
        placeholder={URL_PLACEHOLDERS[format]}
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

const FORM_SNAP_POINTS = ["85%"];

const styles = StyleSheet.create((theme) => ({
  curlNote: {
    ...createControlGeometry(theme).alert.sm.container,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  curlNoteWarning: {
    backgroundColor: theme.colors.surfaceWarning,
  },
  curlNoteInfo: {
    backgroundColor: theme.colors.surface2,
  },
  // 图标与第一行文字对齐。
  curlNoteIcon: {
    height: theme.typeScale.body.lineHeight,
    justifyContent: "center",
  },
  form: {
    gap: theme.spacing[4],
  },
  templateHeading: {
    gap: theme.spacing[2],
  },
  templateIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  templateLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  templateIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    // 与模板列表的图标底块同一档：浅色、深色下都看得出。
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  switchRow: {
    flexDirection: "row",
  },
  flex: {
    flex: 1,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  wrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  subField: {
    marginTop: theme.spacing[2],
  },
  checkList: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  // 表单里自成一项，与上下的间距由表单的 gap 给。
  testField: {
    gap: theme.spacing[2],
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  // 图标与第一行文字对齐。
  checkIcon: {
    width: 12,
    height: theme.typeScale.label.lineHeight,
    justifyContent: "center",
  },
  eachList: {
    gap: theme.spacing[2],
  },
  // 模型之间一条细线，模型名在上，各格式的结论在下。
  eachRow: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  eachCells: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  eachCellsStacked: {
    gap: theme.spacing[1],
  },
  eachCell: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  eachCellStacked: {
    gap: theme.spacing[0.5],
  },
  // 一格的第一行：图标、格式名与耗时或状态码挨得紧些，三列宽时放得下一行。
  eachHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: theme.spacing[1],
  },
  detectModelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  detectModelStacked: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  checkHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: theme.spacing[2],
  },
  picker: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  pickerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  chipScroll: {
    maxHeight: 160,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  chip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.radius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.interactionHighlight,
  },
  iconControls: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconActions: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconGridToggleOpen: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  iconPreview: {
    width: theme.controlHeight.lg,
    height: theme.controlHeight.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPicker: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  // 每格都有和模板图标同一档的底块：深色字形在深色主题、淡色字形在浅色主题下都看得出。
  iconTile: {
    width: theme.controlHeight.lg,
    height: theme.controlHeight.lg,
    borderRadius: theme.radius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  iconTileHovered: {
    borderColor: theme.colors.border,
  },
  iconTileSelected: {
    borderColor: theme.colors.borderAccent,
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
