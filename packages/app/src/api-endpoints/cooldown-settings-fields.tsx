import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  API_ENDPOINT_COOLDOWN_DEFAULTS,
  type ApiEndpointCooldownField,
} from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import { FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { AdvancedFieldLabel } from "./advanced-field-label";
import type { ConnectionFormModel, ConnectionFormState } from "./internal/connection-form-model";
import type { QuotaRestMode } from "./internal/cooldown-settings-form";
import { cooldownProblemText } from "./cooldown-settings-copy";

const KEY = "settings.apiEndpoints.form.extras.cooldown";
// 分钟框只放得下五位数，时刻框放得下「00:00+08:00」：普通对象，FormTextInput 拆样式时要读得到值。
const MINUTES_INPUT_STYLE = { width: 112 };
const TIME_INPUT_STYLE = { width: 148 };
const DEFAULTS = API_ENDPOINT_COOLDOWN_DEFAULTS;
const TIME_PLACEHOLDER = "08:00";

/**
 * 「高级」里的冷却设置（magpie 只在命令行设，Osuna 放进界面）：额度用完后冷却多少分钟或冷却到每天几点、冷却最长多久，
 * 以及「原因不明的失败不冷却」（开着时冷却最长多久不起作用，收起）。框空着即用中转站自己的，缺省值写在占位里；
 * 说明在信息提示里，往下开，不盖住上一行。标签和开关的文字同色。
 */
export function CooldownSettingsFields({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const problemField = state.cooldownProblem?.field ?? null;
  const noFailRestLabel = t(`${KEY}.noFailRest`);
  return (
    <>
      <QuotaRestField state={state} model={model} size={size} problemField={problemField} />
      {state.showsRestCap ? (
        <View style={styles.field} testID="api-endpoint-connection-rest-cap">
          <AdvancedFieldLabel
            label={t(`${KEY}.restCap`)}
            info={t(`${KEY}.restCapInfo`, {
              failure: DEFAULTS.failRestCapMinutes,
              rate: DEFAULTS.rateRestCapMinutes,
            })}
            testID="api-endpoint-connection-rest-cap-info"
          />
          <MinutesInput
            field="restCapMinutes"
            label={t(`${KEY}.restCap`)}
            value={state.restCapText}
            placeholder={`${DEFAULTS.failRestCapMinutes} / ${DEFAULTS.rateRestCapMinutes}`}
            onChange={model.setRestCap}
            problemField={problemField}
            size={size}
            testID="api-endpoint-connection-rest-cap"
          />
        </View>
      ) : null}
      <View style={styles.switchRow} testID="api-endpoint-connection-no-fail-rest">
        <View style={styles.switchLabel}>
          <AdvancedFieldLabel
            label={noFailRestLabel}
            info={t(`${KEY}.noFailRestInfo`, { rate: DEFAULTS.rateRestCapMinutes })}
            testID="api-endpoint-connection-no-fail-rest-info"
          />
        </View>
        <Switch
          value={state.noFailRest}
          onValueChange={model.setNoFailRest}
          accessibilityLabel={noFailRestLabel}
          testID="api-endpoint-connection-no-fail-rest-switch"
        />
      </View>
    </>
  );
}

/** 额度用完后：冷却多少分钟，或冷却到每天几点（magpie quota-rest 30m / until 08:00）。 */
function QuotaRestField({
  state,
  model,
  size,
  problemField,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
  problemField: ApiEndpointCooldownField | null;
}) {
  const { t } = useTranslation();
  const label = t(`${KEY}.quotaRest`);
  const options = useMemo<SegmentedControlOption<QuotaRestMode>[]>(
    () => [
      {
        value: "minutes",
        label: t(`${KEY}.forMinutes`),
        testID: "api-endpoint-connection-quota-rest-minutes",
      },
      {
        value: "time",
        label: t(`${KEY}.untilTime`),
        testID: "api-endpoint-connection-quota-rest-time",
      },
    ],
    [t],
  );
  const isTime = state.quotaRestMode === "time";
  return (
    <View style={styles.field} testID="api-endpoint-connection-quota-rest">
      <AdvancedFieldLabel
        label={label}
        info={t(`${KEY}.quotaRestInfo`, { minutes: DEFAULTS.quotaRestMinutes })}
        testID="api-endpoint-connection-quota-rest-info"
      />
      <View style={styles.segmentRow}>
        <SegmentedControl
          options={options}
          value={state.quotaRestMode}
          onValueChange={model.setQuotaRestMode}
          size="sm"
          style={styles.segmentTrack}
        />
      </View>
      {isTime ? (
        <TimeInput state={state} model={model} size={size} label={label} />
      ) : (
        <MinutesInput
          field="quotaRestMinutes"
          label={label}
          value={state.quotaRestText}
          placeholder={String(DEFAULTS.quotaRestMinutes)}
          onChange={model.setQuotaRest}
          problemField={problemField}
          size={size}
          testID="api-endpoint-connection-quota-rest"
        />
      )}
    </View>
  );
}

function TimeInput({
  state,
  model,
  size,
  label,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
  label: string;
}) {
  const { t } = useTranslation();
  const problem = state.cooldownProblem;
  const isInvalid = problem?.field === "quotaResetAt";
  return (
    <>
      <View style={styles.inputRow}>
        <FormTextInput
          initialValue={state.quotaResetAtText}
          onChangeText={model.setQuotaResetAt}
          placeholder={TIME_PLACEHOLDER}
          autoCapitalize="none"
          autoCorrect={false}
          invalid={isInvalid}
          size={size}
          style={TIME_INPUT_STYLE}
          accessibilityLabel={label}
          testID="api-endpoint-connection-quota-reset-at-input"
        />
        <Text color="foregroundMuted">{t(`${KEY}.timeHint`, { example: TIME_PLACEHOLDER })}</Text>
      </View>
      {isInvalid ? (
        <Text
          variant="caption"
          color="statusDanger"
          selectable
          accessibilityLiveRegion="polite"
          testID="api-endpoint-connection-quota-reset-at-problem"
        >
          {cooldownProblemText(t, problem)}
        </Text>
      ) : null}
    </>
  );
}

function MinutesInput({
  field,
  label,
  value,
  placeholder,
  onChange,
  problemField,
  size,
  testID,
}: {
  field: ApiEndpointCooldownField;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  problemField: ApiEndpointCooldownField | null;
  size: "sm" | "md";
  testID: string;
}) {
  const { t } = useTranslation();
  const isInvalid = problemField === field;
  return (
    <>
      <View style={styles.inputRow}>
        <FormTextInput
          initialValue={value}
          onChangeText={onChange}
          placeholder={placeholder}
          keyboardType="number-pad"
          inputMode="numeric"
          autoCorrect={false}
          invalid={isInvalid}
          size={size}
          style={MINUTES_INPUT_STYLE}
          accessibilityLabel={label}
          testID={`${testID}-input`}
        />
        <Text color="foregroundMuted">{t(`${KEY}.minutes`)}</Text>
      </View>
      {isInvalid ? (
        <Text
          variant="caption"
          color="statusDanger"
          selectable
          accessibilityLiveRegion="polite"
          testID={`${testID}-problem`}
        >
          {cooldownProblemText(t, { field })}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  segmentRow: {
    flexDirection: "row",
  },
  // 同「key 放在哪个头」：描一圈输入框的边，浅色对话框里也看得出这一组。
  segmentTrack: {
    borderWidth: 1,
    borderColor: theme.colors.borderInput,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  switchLabel: {
    flex: 1,
    minWidth: 0,
  },
}));
