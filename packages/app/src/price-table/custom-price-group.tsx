import type { UsagePricingModel } from "@getpaseo/protocol/usage/types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { StatusBadge } from "@/components/ui/status-badge";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import type { PriceTableLayout } from "./price-columns";
import { CustomPriceRow, PriceTableHeader, type CustomPriceRowErrorState } from "./price-row";
import {
  EMPTY_PRICE_DRAFT,
  countUnpricedModels,
  type PriceDraft,
  type PriceField,
} from "./pricing";

export interface CustomPriceRowError extends CustomPriceRowErrorState {
  model: string;
}

interface CustomPriceGroupProps {
  models: readonly UsagePricingModel[];
  layout: PriceTableLayout;
  drafts: Record<string, PriceDraft>;
  draftToken: number;
  savingModel: string | null;
  rowError: CustomPriceRowError | null;
  onEdit: (model: string) => void;
  onCancel: (model: string) => void;
  onChangeField: (model: string, field: PriceField, value: string) => void;
  onSave: (model: string) => void;
}

/**
 * 「自定义价格」组：用户来这一页要处理的东西。无价格数据的行一直开着输入框，保存后
 * 行留在原处变成只读，方便核对刚填的数字。
 */
export function CustomPriceGroup(props: CustomPriceGroupProps) {
  const { t } = useTranslation();
  const { models, layout } = props;
  const unpricedCount = countUnpricedModels(models);
  const trailing = useMemo(
    () =>
      unpricedCount > 0 ? (
        <StatusBadge
          label={t("settings.host.priceTable.customGroup.unpricedCount", {
            count: unpricedCount,
          })}
          variant="warning"
        />
      ) : null,
    [t, unpricedCount],
  );

  return (
    <SettingsSection
      title={t("settings.host.priceTable.customGroup.title")}
      count={models.length > 0 ? models.length : undefined}
      trailing={trailing}
      testID="price-table-custom-group"
    >
      <View style={settingsStyles.card}>
        {models.length === 0 ? (
          <Text color="foregroundMuted" style={styles.empty}>
            {t("settings.host.priceTable.customGroup.empty")}
          </Text>
        ) : (
          <>
            <Text variant="caption" color="foregroundMuted" style={styles.intro}>
              {t("settings.host.priceTable.customGroup.intro")}
            </Text>
            <PriceTableHeader layout={layout} />
            {models.map((model) => {
              // 无价格数据的行一直开着输入框，没有草稿时从空的四格开始。
              const openDraft = model.priceSource === null ? EMPTY_PRICE_DRAFT : null;
              const draft = props.drafts[model.model] ?? openDraft;
              const error = props.rowError?.model === model.model ? props.rowError : null;
              return (
                <CustomPriceRow
                  key={model.model}
                  model={model}
                  layout={layout}
                  draft={draft}
                  draftToken={props.draftToken}
                  isSaving={props.savingModel === model.model}
                  error={error}
                  onEdit={props.onEdit}
                  onCancel={props.onCancel}
                  onChangeField={props.onChangeField}
                  onSave={props.onSave}
                />
              );
            })}
          </>
        )}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  intro: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
  },
  empty: {
    padding: theme.spacing[4],
    textAlign: "center",
  },
}));
