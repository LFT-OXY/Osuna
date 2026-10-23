import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import type { ConnectionFormModel, ConnectionFormState } from "./internal/connection-form-model";
import { priceMultiplierProblemText } from "./price-multiplier-copy";

const KEY = "settings.apiEndpoints.form.extras.priceMultiplier";
// 与冷却设置的分钟框同宽：普通对象，FormTextInput 拆样式时要读得到值。
const INPUT_STYLE = { width: 112 };
// 空着即按原价，也就是 1 倍。
const PLACEHOLDER = "1";

/**
 * 「高级」里的价格倍率（照 magpie 编辑窗口的 Price rate）：空着按原价。算法一句是验收要求看得见的说明，
 * 不放进信息提示；不是 0 到 1000、多于三位小数时报错换下这句，那一行留两行高，下面不跳。
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
  const label = t(`${KEY}.label`);
  // 与「高级」里别的字段标签同色（AdvancedFieldLabel 的文字），不用 Field 缺省的浅色。
  const labelElement = useMemo(() => <Text>{label}</Text>, [label]);
  if (!state.canSetPriceMultiplier) return null;
  const isInvalid = state.priceMultiplierInvalid;
  return (
    <Field
      label={label}
      labelElement={labelElement}
      hint={t(`${KEY}.hint`)}
      error={isInvalid ? priceMultiplierProblemText(t) : null}
      reservesTwoLines
      testID="api-endpoint-connection-price-multiplier"
    >
      <FormTextInput
        initialValue={state.priceMultiplierText}
        onChangeText={model.setPriceMultiplier}
        placeholder={PLACEHOLDER}
        keyboardType="decimal-pad"
        inputMode="decimal"
        autoCorrect={false}
        invalid={isInvalid}
        size={size}
        style={INPUT_STYLE}
        accessibilityLabel={label}
        testID="api-endpoint-connection-price-multiplier-input"
      />
    </Field>
  );
}
