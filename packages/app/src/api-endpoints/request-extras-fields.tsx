import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Braces, ChevronDown, ChevronRight, Plus, X } from "lucide-react-native";
import type { ApiEndpointKeyHeader } from "@getpaseo/protocol/api-endpoint/request-extras";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { ConnectionFormModel, ConnectionFormState } from "./internal/connection-form-model";
import { isBrokenJson, type HeaderRow } from "./internal/request-extras-form";
import { extraBodyProblemText, headerProblemText } from "./request-extras-copy";
import { CooldownSettingsFields } from "./cooldown-settings-fields";
import { AdvancedFieldLabel } from "./advanced-field-label";
import { BalanceSettingsFields } from "./balance-settings-fields";
import { PriceMultiplierField } from "./price-multiplier-field";

const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// 多行值框（JSON 排版的请求头值、附加请求体）的高度：普通对象，FormTextInput 拆样式时要读得到值。
// 框内的输入区要撑满框宽，排好的 JSON 才不会在缩进处折行。
const JSON_VALUE_STYLE = { height: 112, paddingVertical: 8 };
const EXTRA_BODY_STYLE = { height: 128, paddingVertical: 8 };
const EXTRA_BODY_PLACEHOLDER = '{\n  "prompt_cache_key": "${sessionId}"\n}';

/**
 * 添加 / 编辑窗口的「高级」（照 magpie 编辑窗口的 Advanced）：请求头、附加请求体、key 放在哪个头、余额设置、冷却设置，
 * 以及价格倍率。
 * 默认收起，设了任一项时一打开就展开。说明都在信息提示里，不在字段下面写段落；价格倍率例外，它的算法一句按验收要求写在框下面。
 */
export function RequestExtrasFields({
  state,
  model,
  size,
  isCompact,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
  isCompact: boolean;
}) {
  const { t } = useTranslation();
  const handleToggle = useCallback(() => model.toggleAdvanced(), [model]);
  if (!state.canSetRequestExtras) return null;
  const isOpen = state.isAdvancedOpen;
  const toggleLabel = isOpen
    ? t("settings.apiEndpoints.form.extras.advancedHide")
    : t("settings.apiEndpoints.form.extras.advancedShow");
  return (
    <View style={styles.section} testID="api-endpoint-connection-advanced">
      <Pressable
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={toggleLabel}
        accessibilityState={isOpen ? EXPANDED : COLLAPSED}
        style={styles.toggle}
        testID="api-endpoint-connection-advanced-toggle"
      >
        {isOpen ? (
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedIconMapping} />
        ) : (
          <ThemedChevronRight size={ICON_SIZE.sm} uniProps={mutedIconMapping} />
        )}
        <Text weight="medium">{t("settings.apiEndpoints.form.extras.advanced")}</Text>
      </Pressable>
      {isOpen ? (
        <View style={styles.body}>
          <HeadersField state={state} model={model} size={size} isCompact={isCompact} />
          <ExtraBodyField state={state} model={model} size={size} />
          {state.showsKeyHeader ? <KeyHeaderField state={state} model={model} /> : null}
          {state.canSetBalance ? (
            <BalanceSettingsFields state={state} model={model} size={size} />
          ) : null}
          <CooldownSettingsFields state={state} model={model} size={size} />
          <PriceMultiplierField state={state} model={model} size={size} />
        </View>
      ) : null}
    </View>
  );
}

const EXPANDED = { expanded: true };
const COLLAPSED = { expanded: false };

function HeadersField({
  state,
  model,
  size,
  isCompact,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
  isCompact: boolean;
}) {
  const { t } = useTranslation();
  const handleAdd = useCallback(() => model.addHeader(null), [model]);
  const problem = state.headerProblem;
  return (
    <View style={styles.field} testID="api-endpoint-connection-headers">
      <AdvancedFieldLabel
        label={t("settings.apiEndpoints.form.extras.headers")}
        info={t("settings.apiEndpoints.form.extras.headersInfo")}
        testID="api-endpoint-connection-headers-info"
      />
      <View style={isCompact ? styles.headerPairs : styles.headerRows}>
        {state.headerRows.map((row) => (
          <HeaderRowField
            key={row.id}
            row={row}
            model={model}
            size={size}
            isCompact={isCompact}
            isInvalid={problem !== null && problem.name === row.name.trim()}
          />
        ))}
      </View>
      {problem ? (
        <Text
          variant="caption"
          color="statusWarning"
          selectable
          testID="api-endpoint-connection-headers-problem"
        >
          {headerProblemText(t, problem)}
        </Text>
      ) : null}
      <View style={isCompact ? [styles.adds, styles.addsAfterPairs] : styles.adds}>
        <Button
          variant="outline"
          size="sm"
          leftIcon={Plus}
          onPress={handleAdd}
          testID="api-endpoint-connection-add-header"
        >
          {t("settings.apiEndpoints.form.extras.addHeader")}
        </Button>
      </View>
      {state.headerHints.length > 0 ? (
        <View style={styles.suggested} testID="api-endpoint-connection-suggested-headers">
          <Text variant="caption" color="foregroundMuted">
            {t("settings.apiEndpoints.form.extras.suggested")}
          </Text>
          {state.headerHints.map((name) => (
            <SuggestedHeaderButton key={name} name={name} model={model} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 模板提示的头（照 magpie headerHints）：点了加一行，值留给用户填。 */
function SuggestedHeaderButton({ name, model }: { name: string; model: ConnectionFormModel }) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => model.addHeader(name), [model, name]);
  return (
    <Button
      variant="ghost"
      size="xs"
      leftIcon={Plus}
      onPress={handlePress}
      accessibilityLabel={t("settings.apiEndpoints.form.extras.addSuggested", { name })}
      testID={`api-endpoint-connection-suggested-header-${name}`}
    >
      {name}
    </Button>
  );
}

function HeaderRowField({
  row,
  model,
  size,
  isCompact,
  isInvalid,
}: {
  row: HeaderRow;
  model: ConnectionFormModel;
  size: "sm" | "md";
  isCompact: boolean;
  isInvalid: boolean;
}) {
  const { t } = useTranslation();
  const { id } = row;
  const handleName = useCallback((value: string) => model.setHeaderName(id, value), [id, model]);
  const handleValue = useCallback((value: string) => model.setHeaderValue(id, value), [id, model]);
  const handleJson = useCallback(() => model.toggleHeaderJson(id), [id, model]);
  const handleRemove = useCallback(() => model.removeHeader(id), [id, model]);
  const name = row.name.trim();
  const jsonLabel = row.isJson
    ? t("settings.apiEndpoints.form.extras.collapseJson")
    : t("settings.apiEndpoints.form.extras.editAsJson");
  // 值框换了样子（展开成多行或压回一行）时要换成新值。
  const valueResetKey = row.isJson ? "json" : "line";
  const isValueBroken = row.isJson && isBrokenJson(row.value);
  const nameInput = (
    <View style={styles.flex}>
      <FormTextInput
        initialValue={row.name}
        onChangeText={handleName}
        placeholder={t("settings.apiEndpoints.form.extras.headerName")}
        autoCapitalize="none"
        autoCorrect={false}
        invalid={isInvalid}
        size={size}
        testID={`api-endpoint-connection-header-name-${id}`}
      />
    </View>
  );
  const valueInput = (
    <View style={styles.flex}>
      <FormTextInput
        initialValue={row.value}
        resetKey={valueResetKey}
        onChangeText={handleValue}
        placeholder={t("settings.apiEndpoints.form.extras.headerValue")}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={row.isJson}
        invalid={isValueBroken}
        size={size}
        style={row.isJson ? JSON_VALUE_STYLE : undefined}
        testID={`api-endpoint-connection-header-value-${id}`}
      />
    </View>
  );
  const actions = (
    <View style={styles.rowActions}>
      <Button
        variant={row.isJson ? "secondary" : "ghost"}
        size="sm"
        leftIcon={Braces}
        onPress={handleJson}
        accessibilityLabel={jsonLabel}
        testID={`api-endpoint-connection-header-json-${id}`}
      />
      <Button
        variant="ghost"
        size="sm"
        leftIcon={X}
        onPress={handleRemove}
        accessibilityLabel={t("settings.apiEndpoints.form.extras.removeHeader", { name })}
        testID={`api-endpoint-connection-header-remove-${id}`}
      />
    </View>
  );
  // 窄窗口与按 JSON 编辑时：名字和按钮一行，值单独一行（照 magpie 展开后的 hhead）。
  const isStacked = isCompact || row.isJson;
  if (isStacked) {
    return (
      <View
        style={isCompact ? styles.headerPair : styles.stackedRow}
        testID={`api-endpoint-connection-header-${id}`}
      >
        <View style={styles.inlineRow}>
          {nameInput}
          {actions}
        </View>
        <View style={styles.inlineRow}>{valueInput}</View>
      </View>
    );
  }
  return (
    <View style={styles.inlineRow} testID={`api-endpoint-connection-header-${id}`}>
      {nameInput}
      {valueInput}
      {actions}
    </View>
  );
}

function ExtraBodyField({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const problem = state.extraBodyProblem;
  return (
    <View style={styles.field} testID="api-endpoint-connection-extra-body">
      <AdvancedFieldLabel
        label={t("settings.apiEndpoints.form.extras.extraBody")}
        info={t("settings.apiEndpoints.form.extras.extraBodyInfo")}
        testID="api-endpoint-connection-extra-body-info"
      />
      <FormTextInput
        initialValue={state.extraBodyText}
        onChangeText={model.setExtraBody}
        placeholder={EXTRA_BODY_PLACEHOLDER}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        invalid={problem !== null}
        size={size}
        style={EXTRA_BODY_STYLE}
        testID="api-endpoint-connection-extra-body-input"
      />
      {problem ? (
        <Text
          variant="caption"
          color="statusDanger"
          selectable
          accessibilityLiveRegion="polite"
          testID="api-endpoint-connection-extra-body-problem"
        >
          {extraBodyProblemText(t, problem)}
        </Text>
      ) : null}
    </View>
  );
}

function KeyHeaderField({
  state,
  model,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<ApiEndpointKeyHeader>[]>(
    () => [
      {
        value: "both",
        label: t("settings.apiEndpoints.form.extras.keyHeaderBoth"),
        testID: "api-endpoint-connection-key-header-both",
      },
      {
        value: "x-api-key",
        label: "x-api-key",
        testID: "api-endpoint-connection-key-header-x-api-key",
      },
      {
        value: "bearer",
        label: "Authorization: Bearer",
        testID: "api-endpoint-connection-key-header-bearer",
      },
    ],
    [t],
  );
  return (
    <View style={styles.field} testID="api-endpoint-connection-key-header">
      <AdvancedFieldLabel
        label={t("settings.apiEndpoints.form.extras.keyHeader")}
        info={t("settings.apiEndpoints.form.extras.keyHeaderInfo")}
        testID="api-endpoint-connection-key-header-info"
      />
      <View style={styles.segmentRow}>
        <SegmentedControl
          options={options}
          value={state.keyHeader}
          onValueChange={model.setKeyHeader}
          size="sm"
          style={styles.keyHeaderTrack}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[3],
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  body: {
    gap: theme.spacing[4],
  },
  field: {
    gap: theme.spacing[2],
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerRows: {
    gap: theme.spacing[2],
  },
  // 窄窗口里名和值上下两行：组内收紧、组间拉开，看得出哪两行是一对。
  headerPairs: {
    gap: theme.spacing[4],
  },
  headerPair: {
    gap: theme.spacing[1],
  },
  // 宽窗口按 JSON 编辑时名和值也上下两行，间距照旧。
  stackedRow: {
    gap: theme.spacing[2],
  },
  // 「添加请求头」与最后一组的距离和组间一样，不像那一组的一部分。
  addsAfterPairs: {
    marginTop: theme.spacing[2],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  adds: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  // 模板提示的头：一行浅色的小按钮，前面写着「建议添加」，和「添加请求头」分开。
  suggested: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // 桌面浅色的对话框底色和分段控件的底几乎一样：描一圈输入框的边，三种主题、两种窗口下都看得出这一组。
  keyHeaderTrack: {
    borderWidth: 1,
    borderColor: theme.colors.borderInput,
  },
  segmentRow: {
    flexDirection: "row",
  },
}));
