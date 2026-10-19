import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import type {
  ApiEndpointRequestFormat,
  ApiEndpointTemplate,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { EndpointIcon } from "./endpoint-icon";
import {
  templateEndpointHint,
  templateKeyHint,
  templateNote,
  templateRegionLabel,
  templateRegionName,
} from "./template-copy";
import { useConnectionFormModel } from "./use-connection-form-model";
import type {
  ConnectionFormDeps,
  ConnectionFormModel,
  ConnectionFormSeed,
  ConnectionFormState,
  ConnectionFormatField,
  ConnectionSaveResult,
  ConnectionTemplateState,
} from "./internal/connection-form-model";

export interface ApiEndpointConnectionSheetProps {
  seed: ConnectionFormSeed;
  // 主机声明了 apiEndpointManagement：key 可以不填，key 框旁有「显示」。
  isKeyOptional: boolean;
  canRevealKey: boolean;
  // 主机给的模板清单（老主机为空）：新建时按 seed 的模板填好，编辑从模板加的接口时能切区域或套餐。
  templates: readonly ApiEndpointTemplate[];
  // 从模板列表进来时回到列表；其余为 null。
  onBack: (() => void) | null;
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
  templates,
  onBack,
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
    { isKeyOptional, canRevealKey, templates },
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const isCreate = state.mode === "create";
  const keyHint = state.template?.keyHint ?? null;
  const keyPlaceholder = useMemo(
    () => keyPlaceholderOf({ t, seed, hasSavedKey: state.hasSavedKey, keyHint }),
    [keyHint, seed, state.hasSavedKey, t],
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
          {isCreate
            ? t("settings.apiEndpoints.form.saveAndFetch")
            : t("settings.apiEndpoints.form.save")}
        </Button>
      </View>
    ),
    [handleSubmit, isCreate, onClose, state.canSubmit, state.submitting, t],
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
        {template?.endpointExample ? (
          <ResourceEndpointField
            templateId={template.id}
            example={template.endpointExample}
            hint={template.endpointHint}
            endpoint={state.endpoint}
            model={model}
            size={fieldSize}
          />
        ) : (
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
        )}
        <Text variant="caption" color="foregroundMuted">
          {footerTextOf({ t, state })}
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
          <Button variant="ghost" size="sm" onPress={handleCancelDetect}>
            {t("common.actions.cancel")}
          </Button>
        ) : null}
      </View>
    </Field>
  );
}

/** 表单底下的说明：填资源地址的模板说保存后列部署；别的说 key 由三种格式共用。 */
function footerTextOf(input: { t: TFunction; state: ConnectionFormState }): string {
  const { t, state } = input;
  if (state.template?.endpointExample) return t("settings.apiEndpoints.form.footerResource");
  return state.isKeyOptional
    ? t("settings.apiEndpoints.form.footerKeyOptional")
    : t("settings.apiEndpoints.form.footer");
}

/** key 框里的提示：复制时说沿用原来的 key，编辑已存 key 时说留空保留，模板有提示时用它的。 */
function keyPlaceholderOf(input: {
  t: TFunction;
  seed: ConnectionFormSeed;
  hasSavedKey: boolean;
  keyHint: string | null;
}): string {
  const { t, seed } = input;
  if (seed.mode === "duplicate" && seed.source.hasApiKey) {
    const mask = seed.source.apiKeyMask;
    return mask
      ? t("settings.apiEndpoints.form.apiKeyCopiedPlaceholder", { mask })
      : t("settings.apiEndpoints.form.apiKeyCopiedPlaceholderUnmasked");
  }
  if (input.hasSavedKey) return t("settings.apiEndpoints.form.apiKeySavedPlaceholder");
  return input.keyHint === null ? "sk-…" : templateKeyHint(t, input.keyHint);
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
