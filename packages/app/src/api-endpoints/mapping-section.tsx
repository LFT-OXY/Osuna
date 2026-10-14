import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModel,
  type ApiEndpointModelMapping,
  type ApiEndpointModelTier,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";

/** 接口详情页的「Claude 档位映射（可选）」：四个档位各一个下拉，只列本接口已选的模型。 */
export function ApiEndpointMappingSection({
  models,
  mapping,
  onChange,
}: {
  models: ApiEndpointModel[];
  mapping: ApiEndpointModelMapping | undefined;
  onChange: (mapping: ApiEndpointModelMapping | undefined) => void;
}) {
  const { t } = useTranslation();
  const handleTierChange = useCallback(
    (tier: ApiEndpointModelTier, modelId: string | null) => {
      const next: ApiEndpointModelMapping = { ...mapping };
      if (modelId === null) delete next[tier];
      else next[tier] = modelId;
      onChange(Object.keys(next).length === 0 ? undefined : next);
    },
    [mapping, onChange],
  );
  return (
    <SettingsSection
      title={t("settings.apiEndpoints.mapping.title")}
      info={t("settings.apiEndpoints.mapping.info")}
      testID="api-endpoint-mapping-section"
    >
      <View style={settingsStyles.card}>
        {API_ENDPOINT_MODEL_TIERS.map((tier, index) => (
          <MappingRow
            key={tier}
            tier={tier}
            value={mapping?.[tier] ?? null}
            models={models}
            bordered={index > 0}
            onChange={handleTierChange}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

const TIER_LABELS: Record<ApiEndpointModelTier, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable",
};

// 模型名不会是空串，用它代表「不映射」。
const UNMAPPED = "";

function MappingRow({
  tier,
  value,
  models,
  bordered,
  onChange,
}: {
  tier: ApiEndpointModelTier;
  value: string | null;
  models: ApiEndpointModel[];
  bordered: boolean;
  onChange: (tier: ApiEndpointModelTier, modelId: string | null) => void;
}) {
  const { t } = useTranslation();
  const unmappedLabel = t("settings.apiEndpoints.mapping.none");
  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: "unmapped",
        value: UNMAPPED,
        label: unmappedLabel,
        testID: `api-endpoint-mapping-${tier}-option-unmapped`,
      },
      ...models.map((entry) => ({
        id: entry.id,
        value: entry.id,
        label: entry.id,
        testID: `api-endpoint-mapping-${tier}-option-${entry.id}`,
      })),
    ],
    [models, tier, unmappedLabel],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: value ?? unmappedLabel }),
    [unmappedLabel, value],
  );
  const handleChange = useCallback(
    (next: string) => onChange(tier, next === UNMAPPED ? null : next),
    [onChange, tier],
  );
  return (
    <View style={[settingsStyles.row, bordered && settingsStyles.rowBorder]}>
      <Text style={settingsStyles.rowTitle}>{TIER_LABELS[tier]}</Text>
      <View style={styles.select}>
        <SelectField
          field={false}
          label={TIER_LABELS[tier]}
          value={value ?? UNMAPPED}
          selectedDisplay={selectedDisplay}
          options={options}
          onChange={handleChange}
          placeholder={unmappedLabel}
          emptyText={unmappedLabel}
          searchable={options.length > 6}
          title={t("settings.apiEndpoints.mapping.pickTitle", { tier: TIER_LABELS[tier] })}
          size="sm"
          testID={`api-endpoint-mapping-${tier}`}
          triggerTestID={`api-endpoint-mapping-${tier}-trigger`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  select: {
    width: 260,
    flexShrink: 1,
  },
}));
