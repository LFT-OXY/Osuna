import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  API_ENDPOINT_COOLDOWN_DEFAULTS,
  API_ENDPOINT_COOLDOWN_MAX_MINUTES,
  type ApiEndpointCooldownMinuteField,
} from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import { FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import type { ConnectionFormModel, ConnectionFormState } from "./internal/connection-form-model";
import { cooldownProblemText } from "./request-extras-copy";

const KEY = "settings.apiEndpoints.form.extras.cooldown";
// 分钟框只放得下五位数：普通对象，FormTextInput 拆样式时要读得到值。
const MINUTES_INPUT_STYLE = { width: 112 };
const DEFAULTS = API_ENDPOINT_COOLDOWN_DEFAULTS;

/**
 * 「高级」里的冷却设置（magpie 只在命令行设，Osuna 放进界面）：额度用完后冷却多久、冷却最长多久，
 * 以及「原因不明的失败不冷却」（开着时冷却最长多久不起作用，收起）。框空着即用中转站自己的，缺省值写在占位里；说明在信息提示里。
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
      <MinutesField
        field="quotaRestMinutes"
        label={t(`${KEY}.quotaRest`)}
        info={t(`${KEY}.quotaRestInfo`, { minutes: DEFAULTS.quotaRestMinutes })}
        value={state.quotaRestText}
        placeholder={String(DEFAULTS.quotaRestMinutes)}
        onChange={model.setQuotaRest}
        problemField={problemField}
        size={size}
        testID="api-endpoint-connection-quota-rest"
      />
      {state.showsRestCap ? (
        <MinutesField
          field="restCapMinutes"
          label={t(`${KEY}.restCap`)}
          info={t(`${KEY}.restCapInfo`, {
            failure: DEFAULTS.failRestCapMinutes,
            rate: DEFAULTS.rateRestCapMinutes,
          })}
          value={state.restCapText}
          placeholder={`${DEFAULTS.failRestCapMinutes} / ${DEFAULTS.rateRestCapMinutes}`}
          onChange={model.setRestCap}
          problemField={problemField}
          size={size}
          testID="api-endpoint-connection-rest-cap"
        />
      ) : null}
      <View style={styles.field} testID="api-endpoint-connection-no-fail-rest">
        <View style={styles.switchRow}>
          <View style={styles.switchLabel}>
            <Text style={styles.switchText}>{noFailRestLabel}</Text>
            <SettingsInfoTip
              title={noFailRestLabel}
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
      </View>
    </>
  );
}

function MinutesField({
  field,
  label,
  info,
  value,
  placeholder,
  onChange,
  problemField,
  size,
  testID,
}: {
  field: ApiEndpointCooldownMinuteField;
  label: string;
  info: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  problemField: ApiEndpointCooldownMinuteField | null;
  size: "sm" | "md";
  testID: string;
}) {
  const { t } = useTranslation();
  const isInvalid = problemField === field;
  return (
    <View style={styles.field} testID={testID}>
      <View style={styles.labelRow}>
        <Text color="foregroundMuted">{label}</Text>
        <SettingsInfoTip title={label} info={info} testID={`${testID}-info`} />
      </View>
      <View style={styles.minutesRow}>
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
          {cooldownProblemText(t, { max: API_ENDPOINT_COOLDOWN_MAX_MINUTES })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  minutesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  switchLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  switchText: {
    flexShrink: 1,
  },
}));
