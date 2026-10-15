import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { Text as UiText } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type {
  AgentApiEndpointsView,
  AgentEndpointsSummary,
  AgentSwitchBlock,
} from "./internal/agent-settings";

/*
 * Claude Code / Codex 提供方页的「第三方接口」区：一张三行卡片——总开关、默认模型、
 * 「管理第三方接口」入口。纯 props，运行时接线在 view.tsx。
 */

const ThemedChevronRight = withUnistyles(ChevronRight);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface AgentApiEndpointsSectionProps {
  // CLI 的名称，如 "Claude Code"。
  providerLabel: string;
  view: AgentApiEndpointsView;
  busy: boolean;
  actionError: string | null;
  onDismissError: () => void;
  onToggle: (enabled: boolean) => void;
  onDefaultModelChange: (modelId: string) => void;
  onManage: () => void;
}

export function AgentApiEndpointsSection({
  providerLabel,
  view,
  busy,
  actionError,
  onDismissError,
  onToggle,
  onDefaultModelChange,
  onManage,
}: AgentApiEndpointsSectionProps) {
  const { t } = useTranslation();
  const switchHint = useSwitchHint(providerLabel, view.enableBlockedBy);
  return (
    <AgentApiEndpointsFrame>
      {actionError ? (
        <View style={styles.alert}>
          <Alert
            variant="error"
            size="sm"
            title={t("settings.apiEndpoints.agent.saveFailed", { agent: providerLabel })}
            description={actionError}
            testID="agent-api-endpoints-error"
          >
            <Button variant="outline" size="sm" onPress={onDismissError}>
              {t("common.actions.dismiss")}
            </Button>
          </Alert>
        </View>
      ) : null}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.apiEndpoints.agent.useSwitch")}
            </Text>
            <Text style={settingsStyles.rowHint} testID="agent-api-endpoints-switch-hint">
              {switchHint}
            </Text>
          </View>
          <Switch
            value={view.enabled}
            onValueChange={onToggle}
            disabled={busy || view.enableBlockedBy !== null}
            accessibilityLabel={t("settings.apiEndpoints.agent.useSwitch")}
            testID="agent-api-endpoints-switch"
          />
        </View>
        {view.enabled ? (
          <DefaultModelRow
            providerLabel={providerLabel}
            value={view.defaultModelId}
            options={view.modelOptions}
            busy={busy}
            onChange={onDefaultModelChange}
          />
        ) : null}
        <ManageRow summary={view.summary} onPress={onManage} />
      </View>
    </AgentApiEndpointsFrame>
  );
}

/** 区块外框；加载中、出错与主机太旧时也用它，标题位置不跳。 */
export function AgentApiEndpointsFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t("settings.apiEndpoints.agent.title")} testID="agent-api-endpoints">
      {children}
    </SettingsSection>
  );
}

function useSwitchHint(providerLabel: string, block: AgentSwitchBlock | null): string {
  const { t } = useTranslation();
  if (block === null) return t("settings.apiEndpoints.agent.useHint", { agent: providerLabel });
  if (block.kind === "noUsableEndpoint") return t("settings.apiEndpoints.agent.noUsableEndpoint");
  if (block.issue.code === "gateway_requires_tcp") {
    return t("settings.apiEndpoints.agent.gatewayRequiresTcp");
  }
  if (block.issue.code === "gateway_not_ready") {
    return t("settings.apiEndpoints.agent.gatewayNotReady");
  }
  // 认不出的原因照 daemon 原文。
  return block.issue.message;
}

function DefaultModelRow({
  providerLabel,
  value,
  options,
  busy,
  onChange,
}: {
  providerLabel: string;
  value: string | null;
  options: string[];
  busy: boolean;
  onChange: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      options.map((modelId) => ({
        id: modelId,
        value: modelId,
        label: modelId,
        testID: `agent-api-endpoints-default-option-${modelId}`,
      })),
    [options],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(
    () => (value === null ? null : { label: value }),
    [value],
  );
  const title = t("settings.apiEndpoints.agent.defaultModelPick", { agent: providerLabel });
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.apiEndpoints.agent.defaultModel")}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.apiEndpoints.agent.defaultModelHint")}
        </Text>
      </View>
      <View style={styles.select}>
        <SelectField
          field={false}
          label={title}
          value={value}
          selectedDisplay={selectedDisplay}
          options={selectOptions}
          onChange={onChange}
          placeholder={t("settings.apiEndpoints.agent.defaultModel")}
          emptyText={t("settings.apiEndpoints.agent.noUsableEndpoint")}
          searchable={selectOptions.length > 6}
          title={title}
          size="sm"
          disabled={busy}
          testID="agent-api-endpoints-default-model"
          triggerTestID="agent-api-endpoints-default-model-trigger"
        />
      </View>
    </View>
  );
}

function ManageRow({ summary, onPress }: { summary: AgentEndpointsSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );
  const cooling = summary.cooling;
  return (
    <View style={settingsStyles.rowBorder}>
      <Pressable
        style={rowStyle}
        onPress={onPress}
        accessibilityRole="button"
        testID="agent-api-endpoints-manage"
      >
        {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
          <>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.apiEndpoints.agent.manage")}</Text>
              <View style={styles.summary} testID="agent-api-endpoints-summary">
                <Text style={settingsStyles.rowHint}>
                  {t("settings.apiEndpoints.agent.summaryOn", { count: summary.enabledCount })}
                </Text>
                {cooling ? (
                  <>
                    <Text style={settingsStyles.rowHint}>·</Text>
                    <UiText variant="caption" color="statusWarning" numberOfLines={1}>
                      {t(`settings.apiEndpoints.agent.summaryCooling_${cooling.remaining.unit}`, {
                        name: cooling.name,
                        count: cooling.remaining.value,
                      })}
                    </UiText>
                  </>
                ) : null}
              </View>
            </View>
            <ThemedChevronRight
              size={ICON_SIZE.sm}
              uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  alert: {
    marginBottom: theme.spacing[3],
  },
  select: {
    width: 260,
    flexShrink: 1,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
}));
