import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import type { ConnectionFormModel, ConnectionFormState } from "./internal/connection-form-model";
import { priceMultiplierProblemText } from "./price-multiplier-copy";

const KEY = "settings.apiEndpoints.form.extras.priceMultiplier";
// 框里放得下「1000.125」与占位：普通对象，FormTextInput 拆样式时要读得到值。
const INPUT_STYLE = { width: 148 };

/**
 * 「高级」里的价格倍率（照 magpie 编辑窗口的 Price rate）：空着按原价；算法一句写在框下面，一直看得见。
 * 不是 0 到 1000、多于三位小数时说明换成报错，留在框下面。
 */
export function PriceMultiplierField({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  if (!state.canSetPriceMultiplier) return null;
  const label = t(`${KEY}.label`);
  const isInvalid = state.priceMultiplierInvalid;
  return (
    <View style={styles.field} testID="api-endpoint-connection-price-multiplier">
      <Text>{label}</Text>
      <FormTextInput
        initialValue={state.priceMultiplierText}
        onChangeText={model.setPriceMultiplier}
        placeholder={t(`${KEY}.placeholder`)}
        keyboardType="decimal-pad"
        inputMode="decimal"
        autoCorrect={false}
        invalid={isInvalid}
        size={size}
        style={INPUT_STYLE}
        accessibilityLabel={label}
        testID="api-endpoint-connection-price-multiplier-input"
      />
      {isInvalid ? (
        <Text
          variant="caption"
          color="statusDanger"
          selectable
          accessibilityLiveRegion="polite"
          testID="api-endpoint-connection-price-multiplier-problem"
        >
          {priceMultiplierProblemText(t)}
        </Text>
      ) : (
        <Text variant="caption" color="foregroundMuted">
          {t(`${KEY}.hint`)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
}));
