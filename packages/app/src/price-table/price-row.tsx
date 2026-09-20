import type { UsagePricingModel } from "@osuna/protocol/usage/types";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { renderUsageText } from "@/usage/text";
import { PRICE_COLUMN_GAP, priceColumns } from "./price-columns";
import {
  PRICE_COLUMNS,
  describePriceSource,
  formatPriceCell,
  type PriceDraft,
  type PriceField,
} from "./pricing";

export interface PriceRowProps {
  model: UsagePricingModel;
  /** 打开时四格变成输入框；无价格的行一开始就是打开的。 */
  draft: PriceDraft | null;
  /** 草稿被外部丢弃（取消、保存成功）时变值，把非受控输入框重新播种。 */
  draftToken: number;
  isSaving: boolean;
  error: string | null;
  onEdit: (model: string) => void;
  onCancel: (model: string) => void;
  onChangeField: (model: string, field: PriceField, value: string) => void;
  onSave: (model: string) => void;
}

export function PriceRow({
  model,
  draft,
  draftToken,
  isSaving,
  error,
  onEdit,
  onCancel,
  onChangeField,
  onSave,
}: PriceRowProps) {
  const { t } = useTranslation();
  const modelId = model.model;
  const handleEdit = useCallback(() => onEdit(modelId), [modelId, onEdit]);
  const handleCancel = useCallback(() => onCancel(modelId), [modelId, onCancel]);
  const handleSave = useCallback(() => onSave(modelId), [modelId, onSave]);

  return (
    <View style={styles.rowBlock} testID={`price-table-row-${modelId}`}>
      <View style={styles.row}>
        <View style={styles.modelCell}>
          <Text style={styles.model} numberOfLines={1}>
            {modelId}
          </Text>
          {model.priced ? null : (
            <View style={styles.badgeRow}>
              <StatusBadge label={t("settings.host.priceTable.unpriced")} variant="warning" />
            </View>
          )}
        </View>
        {PRICE_COLUMNS.map((column) => (
          <View key={column.field} style={styles.priceCell}>
            {draft ? (
              <PriceInputCell
                modelId={modelId}
                field={column.field}
                labelKey={column.labelKey}
                value={draft[column.field]}
                draftToken={draftToken}
                onChangeField={onChangeField}
              />
            ) : (
              <Text style={styles.price}>
                {model.pricePerMillion ? formatPriceCell(model.pricePerMillion[column.field]) : "—"}
              </Text>
            )}
          </View>
        ))}
        <Text style={styles.sourceCell} numberOfLines={1}>
          {renderUsageText(t, describePriceSource(model))}
        </Text>
        <View style={styles.actionsCell}>
          {draft ? (
            <>
              <Button
                variant="default"
                size="sm"
                loading={isSaving}
                onPress={handleSave}
                testID={`price-table-save-${modelId}`}
              >
                {t("settings.host.priceTable.save")}
              </Button>
              {model.priced ? (
                <Button variant="ghost" size="sm" onPress={handleCancel}>
                  {t("common.actions.cancel")}
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onPress={handleEdit}
              testID={`price-table-edit-${modelId}`}
            >
              {t("settings.host.priceTable.customPrice")}
            </Button>
          )}
        </View>
      </View>
      {/* 这一行始终占位：条件挂载会在出错时把下面的行整体推走，正好吞掉下一次点击。 */}
      <Text style={styles.error} numberOfLines={1} testID={`price-table-error-${modelId}`}>
        {error ?? ""}
      </Text>
    </View>
  );
}

function PriceInputCell({
  modelId,
  field,
  labelKey,
  value,
  draftToken,
  onChangeField,
}: {
  modelId: string;
  field: PriceField;
  labelKey: string;
  value: string;
  draftToken: number;
  onChangeField: (model: string, field: PriceField, value: string) => void;
}) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (next: string) => onChangeField(modelId, field, next),
    [field, modelId, onChangeField],
  );

  return (
    <FormTextInput
      size="sm"
      initialValue={value}
      resetKey={`${modelId}-${field}-${draftToken}`}
      onChangeText={handleChange}
      keyboardType="decimal-pad"
      accessibilityLabel={`${modelId} ${t(labelKey)}`}
      testID={`price-table-input-${modelId}-${field}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  rowBlock: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: PRICE_COLUMN_GAP,
  },
  // The badge takes its own line: beside a long model id it left no room for the
  // id itself, and the settings column caps at 720.
  modelCell: {
    ...priceColumns.model,
    gap: theme.spacing[1],
  },
  model: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  badgeRow: {
    flexDirection: "row",
  },
  priceCell: priceColumns.price,
  price: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  sourceCell: {
    ...priceColumns.source,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionsCell: {
    ...priceColumns.actions,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    // 固定行高，空字符串时也不塌陷。
    lineHeight: theme.fontSize.sm * 1.4,
    minHeight: theme.fontSize.sm * 1.4,
  },
}));
