import type { UsagePricingModel } from "@getpaseo/protocol/usage/types";
import { CircleAlert, Pencil, X, type LucideIcon } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import {
  PRICE_COLUMN_GAP,
  PRICE_INPUT_PADDING_X,
  PRICE_VALUE_INSET_RIGHT,
  priceColumns,
  type PriceTableLayout,
} from "./price-columns";
import {
  PRICE_COLUMNS,
  formatPriceCell,
  parsePriceInput,
  type PriceDraft,
  type PriceField,
} from "./pricing";

const dangerIconMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const ThemedCircleAlert = withUnistyles(CircleAlert, dangerIconMapping);

export interface CustomPriceRowErrorState {
  message: string;
  /** 校验没过（而不是 daemon 拒绝）：没填或填错的格子要标出来。 */
  invalid: boolean;
}

export interface CustomPriceRowProps {
  model: UsagePricingModel;
  layout: PriceTableLayout;
  /** 打开时四格变成输入框；无价格的行一开始就是打开的。 */
  draft: PriceDraft | null;
  /** 草稿被外部丢弃（取消、保存成功）时变值，把非受控输入框重新播种。 */
  draftToken: number;
  isSaving: boolean;
  error: CustomPriceRowErrorState | null;
  onEdit: (model: string) => void;
  onCancel: (model: string) => void;
  onChangeField: (model: string, field: PriceField, value: string) => void;
  onSave: (model: string) => void;
}

/** 「自定义价格」组的一行：模型名与状态行、四个价格、操作。 */
export function CustomPriceRow({
  model,
  layout,
  draft,
  draftToken,
  isSaving,
  error,
  onEdit,
  onCancel,
  onChangeField,
  onSave,
}: CustomPriceRowProps) {
  const { t } = useTranslation();
  const modelId = model.model;
  const stacked = layout === "stacked";
  const unpriced = model.priceSource === null;
  // 只有校验没过才标格子：daemon 拒绝时四格都填对了。
  const flagInvalidCells = error?.invalid === true;
  const handleEdit = useCallback(() => onEdit(modelId), [modelId, onEdit]);
  const handleCancel = useCallback(() => onCancel(modelId), [modelId, onCancel]);
  const handleSave = useCallback(() => onSave(modelId), [modelId, onSave]);

  return (
    <View
      style={[
        styles.row,
        stacked ? styles.rowStacked : styles.rowTable,
        unpriced ? styles.rowUnpriced : null,
      ]}
      testID={`price-table-row-${modelId}`}
    >
      <View style={styles.modelCell}>
        <ModelIdText modelId={modelId} />
        <PriceRowStatus model={model} error={error} />
      </View>
      <View style={styles.prices}>
        {PRICE_COLUMNS.map((column) => {
          const cellStyle = stacked ? styles.priceCellStacked : styles.priceCell;
          if (!draft) {
            const price = model.pricePerMillion?.[column.field] ?? null;
            return (
              <View key={column.field} style={cellStyle}>
                <PriceValue value={price} />
              </View>
            );
          }
          const value = draft[column.field];
          const cellInvalid = flagInvalidCells && parsePriceInput(value) === null;
          return (
            <View key={column.field} style={cellStyle}>
              <PriceInputCell
                modelId={modelId}
                field={column.field}
                labelKey={column.labelKey}
                value={value}
                draftToken={draftToken}
                invalid={cellInvalid}
                onChangeField={onChangeField}
              />
            </View>
          );
        })}
      </View>
      <View style={stacked ? styles.actionsStacked : styles.actionsTable}>
        {draft ? (
          <>
            {unpriced ? null : (
              <IconAction
                icon={X}
                label={t("common.actions.cancel")}
                onPress={handleCancel}
                testID={`price-table-cancel-${modelId}`}
              />
            )}
            <Button
              variant="default"
              size="sm"
              loading={isSaving}
              onPress={handleSave}
              testID={`price-table-save-${modelId}`}
            >
              {t("settings.host.priceTable.save")}
            </Button>
          </>
        ) : (
          <IconAction
            icon={Pencil}
            label={t("settings.host.priceTable.edit")}
            accessibilityLabel={t("settings.host.priceTable.editAccessibility", { model: modelId })}
            onPress={handleEdit}
            testID={`price-table-edit-${modelId}`}
          />
        )}
      </View>
    </View>
  );
}

/**
 * 操作列里的图标按钮：定宽的列放不下「取消」「编辑」这类文字按钮与「保存」并排
 * （fr「Annuler」+「Enregistrer」），所以只有主操作「保存」留文字，其余是图标加 tooltip。
 */
function IconAction({
  icon,
  label,
  accessibilityLabel,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  /** tooltip 里的短标签；没给 `accessibilityLabel` 时也是读屏读到的名字。 */
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <View collapsable={false}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={icon}
            onPress={onPress}
            style={styles.iconAction}
            accessibilityLabel={accessibilityLabel ?? label}
            testID={testID}
          />
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text variant="caption">{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * 模型名下面固定高度的一行：出错时错误替换状态，而不是另起一行，这样下面的行不会被
 * 推走——那正好会吞掉用户接下来的那一次点击。
 */
function PriceRowStatus({
  model,
  error,
}: {
  model: UsagePricingModel;
  error: CustomPriceRowErrorState | null;
}) {
  const { t } = useTranslation();
  if (error) {
    // 模型列很窄，daemon 给的原因常被截断；悬停看全文，行高不变。
    return (
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <View style={styles.status} collapsable={false}>
            <ThemedCircleAlert size={12} />
            <Text
              variant="caption"
              color="statusDanger"
              numberOfLines={1}
              style={styles.statusText}
              testID={`price-table-error-${model.model}`}
            >
              {error.message}
            </Text>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" offset={8}>
          <Text variant="caption">{error.message}</Text>
        </TooltipContent>
      </Tooltip>
    );
  }
  const unpriced = model.priceSource === null;
  return (
    <View style={styles.status}>
      <View style={[styles.dot, unpriced ? styles.dotUnpriced : styles.dotCustom]} />
      <Text variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.statusText}>
        {unpriced
          ? t("settings.host.priceTable.unpriced")
          : t("settings.host.priceTable.customPrice")}
      </Text>
    </View>
  );
}

/**
 * 模型 id 单行省略；列放不下时悬停看完整 id，好分清两个相近的模型。
 */
export function ModelIdText({ modelId }: { modelId: string }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <View collapsable={false} style={styles.modelId}>
          <Text variant="label" numberOfLines={1}>
            {modelId}
          </Text>
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" offset={8}>
        <Text variant="caption">{modelId}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/** 只读的一格价格。0 用次级色：多数是上游缺这一列，读的时候不该和真实价格一样重。 */
export function PriceValue({ value }: { value: number | null }) {
  return (
    <Text
      variant="label"
      color={value === 0 ? "foregroundMuted" : "foreground"}
      numberOfLines={1}
      style={styles.value}
    >
      {value === null ? "—" : formatPriceCell(value)}
    </Text>
  );
}

// 调用方给 FormTextInput 的样式要是普通对象：它在 Web 上压平后拆成外框与文字两份，
// Unistyles 的样式压平后只剩 class（`components/ui/form-field.tsx`）。
const PRICE_INPUT_STYLE: TextStyle = {
  paddingHorizontal: PRICE_INPUT_PADDING_X,
  textAlign: "right",
  fontVariant: ["tabular-nums"],
};

function PriceInputCell({
  modelId,
  field,
  labelKey,
  value,
  draftToken,
  invalid,
  onChangeField,
}: {
  modelId: string;
  field: PriceField;
  labelKey: string;
  value: string;
  draftToken: number;
  invalid: boolean;
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
      prefix="$"
      invalid={invalid}
      placeholder="0.00"
      initialValue={value}
      resetKey={`${modelId}-${field}-${draftToken}`}
      onChangeText={handleChange}
      keyboardType="decimal-pad"
      style={PRICE_INPUT_STYLE}
      accessibilityLabel={`${modelId} ${t(labelKey)}`}
      testID={`price-table-input-${modelId}-${field}`}
    />
  );
}

/** 表头与行共用同一套列：表头里模型列与操作列留空，窄屏只剩四个价格列。 */
export function PriceTableHeader({ layout }: { layout: PriceTableLayout }) {
  const { t } = useTranslation();
  const stacked = layout === "stacked";
  return (
    <View style={styles.header}>
      {stacked ? null : (
        <Text variant="caption" color="foregroundMuted" style={styles.modelCell}>
          {t("settings.host.priceTable.columns.model")}
        </Text>
      )}
      <View style={[styles.prices, stacked ? styles.pricesFill : null]}>
        {PRICE_COLUMNS.map((column) => (
          <Text
            key={column.field}
            variant="caption"
            color="foregroundMuted"
            style={[stacked ? styles.priceCellStacked : styles.priceCell, styles.value]}
          >
            {t(column.labelKey)}
          </Text>
        ))}
      </View>
      {stacked ? null : <View style={priceColumns.actions} />}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  rowTable: {
    flexDirection: "row",
    alignItems: "center",
    gap: PRICE_COLUMN_GAP,
    minHeight: 60,
  },
  rowStacked: {
    gap: theme.spacing[2],
  },
  // 无价格数据的行：提示「这一行要填」，用主题现成的警示底色，不另调一档更淡的。
  rowUnpriced: {
    backgroundColor: theme.colors.surfaceWarning,
  },
  modelId: {
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  modelCell: {
    ...priceColumns.model,
    gap: theme.spacing[0.5],
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    // 与 caption 的行高相同：状态与错误互换时这一行不变高。
    height: theme.typeScale.caption.lineHeight,
  },
  statusText: {
    flexShrink: 1,
    minWidth: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotUnpriced: {
    backgroundColor: theme.colors.statusWarning,
  },
  dotCustom: {
    backgroundColor: theme.colors.accent,
  },
  prices: {
    flexDirection: "row",
    alignItems: "center",
    gap: PRICE_COLUMN_GAP,
  },
  pricesFill: {
    flex: 1,
  },
  priceCell: priceColumns.price,
  priceCellStacked: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    textAlign: "right",
    paddingRight: PRICE_VALUE_INSET_RIGHT,
    fontVariant: ["tabular-nums"],
  },
  actionsTable: {
    ...priceColumns.actions,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  // sm 按钮高 28，左右各 6 加 14 的图标与 1px 边框正好是方的。
  iconAction: {
    paddingHorizontal: theme.spacing[1.5],
  },
  actionsStacked: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: PRICE_COLUMN_GAP,
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1.5],
  },
}));
