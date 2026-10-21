import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text as RNText, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { X } from "lucide-react-native";
import type { ApiEndpointModelScope } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { SERVED_LIST_LIMIT } from "./internal/model-scope";

/*
 * 接口详情页的「服务范围」：跟随接口清单 / 只用挑选的；只用挑选的时下面是自动勾选规则（prd 第 17、18a 条）。
 * 切换即保存，失败原因走页头的保存失败提示；规则增删的失败留在规则区。
 */

// FormTextInput 会压平 style 拆成外框与文字，Unistyles 样式在 Web 上压平后没有值，所以用普通对象。
const RULE_INPUT_STYLE = { flex: 1 };
// xs 按钮 24px，四周各加 4 到 32px 的点按范围。
const REMOVE_HIT_SLOP = 4;

export function ApiEndpointModelScopeSection({
  scope,
  rules,
  ruleError,
  onChangeScope,
  onAddRule,
  onRemoveRule,
}: {
  scope: ApiEndpointModelScope;
  rules: string[];
  ruleError: string | null;
  onChangeScope: (scope: ApiEndpointModelScope) => void;
  onAddRule: (text: string) => Promise<boolean>;
  onRemoveRule: (rule: string) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<ApiEndpointModelScope>[]>(
    () => [
      {
        value: "vendor",
        label: t("settings.apiEndpoints.modelScope.vendor"),
        testID: "api-endpoint-model-scope-vendor",
      },
      {
        value: "picked",
        label: t("settings.apiEndpoints.modelScope.picked"),
        testID: "api-endpoint-model-scope-picked",
      },
    ],
    [t],
  );
  const hint = useMemo(
    () => (
      <View testID="api-endpoint-model-scope-hint">
        <RNText style={settingsStyles.rowHint}>
          {scope === "vendor"
            ? t("settings.apiEndpoints.modelScope.vendorHint")
            : t("settings.apiEndpoints.modelScope.pickedHint")}
        </RNText>
        {scope === "vendor" ? (
          <RNText style={settingsStyles.rowHint} testID="api-endpoint-model-scope-limit">
            {t("settings.apiEndpoints.modelScope.vendorLimit", { limit: SERVED_LIST_LIMIT })}
          </RNText>
        ) : null}
      </View>
    ),
    [scope, t],
  );
  return (
    <SettingsSection
      title={t("settings.apiEndpoints.modelScope.title")}
      testID="api-endpoint-model-scope-section"
    >
      <SettingsCard>
        <SettingsRow label={t("settings.apiEndpoints.modelScope.label")} hint={hint}>
          <SegmentedControl
            size="sm"
            options={options}
            value={scope}
            onValueChange={onChangeScope}
            testID="api-endpoint-model-scope"
          />
        </SettingsRow>
        {scope === "picked" ? (
          <AutoPickRules
            rules={rules}
            error={ruleError}
            onAdd={onAddRule}
            onRemove={onRemoveRule}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

function AutoPickRules({
  rules,
  error,
  onAdd,
  onRemove,
}: {
  rules: string[];
  error: string | null;
  onAdd: (text: string) => Promise<boolean>;
  onRemove: (rule: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  // 加成功后换一个 key 让输入框清空（FormTextInput 不受控，只认 initialValue）。
  const [inputGeneration, setInputGeneration] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const canAdd = !isAdding && draft.trim() !== "";
  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setIsAdding(true);
    void (async () => {
      const isAdded = await onAdd(draft);
      setIsAdding(false);
      if (!isAdded) return;
      setDraft("");
      setInputGeneration((generation) => generation + 1);
    })();
  }, [canAdd, draft, onAdd]);
  return (
    <View style={styles.rules} testID="api-endpoint-auto-pick">
      <View style={styles.rulesHeading}>
        <View style={styles.rulesTitleRow}>
          <RNText style={settingsStyles.rowTitle}>
            {t("settings.apiEndpoints.modelScope.rules.title")}
          </RNText>
          <SettingsInfoTip
            title={t("settings.apiEndpoints.modelScope.rules.title")}
            info={t("settings.apiEndpoints.modelScope.rules.syntax")}
            side="bottom"
            testID="api-endpoint-auto-pick-info"
          />
        </View>
        <RNText style={settingsStyles.rowHint}>
          {t("settings.apiEndpoints.modelScope.rules.hint")}
        </RNText>
      </View>
      {rules.length > 0 ? (
        <View style={styles.ruleList}>
          {rules.map((rule) => (
            <RuleChip key={rule} rule={rule} onRemove={onRemove} />
          ))}
        </View>
      ) : null}
      <View style={styles.addRow}>
        <FormTextInput
          key={inputGeneration}
          size="sm"
          initialValue=""
          onChangeText={setDraft}
          onSubmitEditing={handleAdd}
          editable={!isAdding}
          placeholder={t("settings.apiEndpoints.modelScope.rules.placeholder")}
          accessibilityLabel={t("settings.apiEndpoints.modelScope.rules.title")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={RULE_INPUT_STYLE}
          testID="api-endpoint-auto-pick-input"
        />
        <Button
          variant="outline"
          size="sm"
          onPress={handleAdd}
          disabled={!canAdd}
          testID="api-endpoint-auto-pick-add"
        >
          {isAdding
            ? t("settings.apiEndpoints.modelScope.rules.adding")
            : t("settings.apiEndpoints.modelScope.rules.add")}
        </Button>
      </View>
      {error ? (
        <RNText
          accessibilityRole="alert"
          style={settingsStyles.rowError}
          selectable
          testID="api-endpoint-auto-pick-error"
        >
          {error}
        </RNText>
      ) : null}
    </View>
  );
}

function RuleChip({ rule, onRemove }: { rule: string; onRemove: (rule: string) => void }) {
  const { t } = useTranslation();
  const handleRemove = useCallback(() => onRemove(rule), [onRemove, rule]);
  return (
    <View style={styles.chip} testID={`api-endpoint-auto-pick-rule-${rule}`}>
      <Text numberOfLines={1} selectable style={styles.chipText}>
        {rule}
      </Text>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={X}
        onPress={handleRemove}
        accessibilityLabel={t("settings.apiEndpoints.modelScope.rules.remove", { rule })}
        hitSlop={REMOVE_HIT_SLOP}
        testID={`api-endpoint-auto-pick-remove-${rule}`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rules: {
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rulesHeading: {
    gap: theme.spacing[0.5],
  },
  rulesTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  ruleList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: "100%",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[0.5],
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface2,
  },
  chipText: {
    flexShrink: 1,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
