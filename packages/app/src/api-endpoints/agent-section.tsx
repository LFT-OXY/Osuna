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
import { AgentIssuesArea, AgentIssuesUpdateHost, type AgentIssuesAreaProps } from "./agent-issues";
import type { ApiEndpointConnection } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type {
  AgentApiEndpointsView,
  AgentEndpointsSummary,
  AgentSwitchBlock,
  DefaultModelOption,
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
  // 主机拒绝时的错误码；本地失败为 null。
  actionErrorCode: string | null;
  onDismissError: () => void;
  // 刚打开总开关时默认模型是怎么挑的；没有为 null。
  connection: ApiEndpointConnection | null;
  onToggle: (enabled: boolean) => void;
  onDefaultModelChange: (modelId: string) => void;
  onManage: () => void;
  // 「保留 claude.ai 登录」；主机太旧时为 null，不显示这一行（Codex 页的 view 里本来就没有这个选项）。
  onKeepClaudeAiLoginChange: ((keepsClaudeAiLogin: boolean) => void) | null;
  // 主机声明了 apiEndpointCliWiring 时为提示区的处理；否则为 null，请用户更新主机。
  issueActions: Omit<AgentIssuesAreaProps, "providerLabel" | "issues"> | null;
}

export function AgentApiEndpointsSection({
  providerLabel,
  view,
  busy,
  actionError,
  actionErrorCode,
  onDismissError,
  connection,
  onToggle,
  onDefaultModelChange,
  onManage,
  onKeepClaudeAiLoginChange,
  issueActions,
}: AgentApiEndpointsSectionProps) {
  const { t } = useTranslation();
  const switchHint = useSwitchHint(providerLabel, view.enableBlockedBy);
  // 只有 Claude Code 有这个选项，主机太旧时没有处理函数。
  const keepsClaudeAiLogin = view.keepsClaudeAiLogin;
  const showsKeepClaudeAiLogin = keepsClaudeAiLogin !== null && onKeepClaudeAiLoginChange !== null;
  // 同一区块一次只留一条：打开被拒的原因已在提示区「读不懂」那条里，就只留红色的那条。
  const isRefusalRepeatedByIssue =
    actionErrorCode === "config_unparsable" &&
    view.issues.some((issue) => issue.kind === "configUnparsable");
  const issues = useMemo(() => {
    if (!isRefusalRepeatedByIssue) return view.issues;
    return view.issues.filter((issue) => issue.kind !== "configUnparsable");
  }, [isRefusalRepeatedByIssue, view.issues]);
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
      {issueActions ? (
        <AgentIssuesArea providerLabel={providerLabel} issues={issues} {...issueActions} />
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
            {view.enabled && connection ? (
              <ConnectionLine
                providerLabel={providerLabel}
                connection={connection}
                options={view.modelOptions}
              />
            ) : null}
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
            value={view.defaultModel}
            options={view.modelOptions}
            busy={busy}
            onChange={onDefaultModelChange}
          />
        ) : null}
        {showsKeepClaudeAiLogin ? (
          <KeepClaudeAiLoginRow
            providerLabel={providerLabel}
            value={keepsClaudeAiLogin}
            busy={busy}
            onChange={onKeepClaudeAiLoginChange}
          />
        ) : null}
        <ManageRow summary={view.summary} onPress={onManage} />
      </View>
      {issueActions ? null : (
        <View style={styles.updateHost}>
          <AgentIssuesUpdateHost providerLabel={providerLabel} />
        </View>
      )}
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

/** 默认模型的显示：指定某一家的写成「模型名（接口名）」。 */
function useDefaultModelLabel(): (option: DefaultModelOption) => string {
  const { t } = useTranslation();
  return useCallback(
    (option: DefaultModelOption) =>
      option.endpointName === null
        ? option.model
        : t("settings.apiEndpoints.agent.defaultModelOnEndpoint", {
            model: option.model,
            endpoint: option.endpointName,
          }),
    [t],
  );
}

/** 刚打开总开关时默认模型是怎么挑的（照 magpie 的 connectedSaid）；认不出的挑法不说。 */
function ConnectionLine({
  providerLabel,
  connection,
  options,
}: {
  providerLabel: string;
  connection: ApiEndpointConnection;
  options: DefaultModelOption[];
}) {
  const { t } = useTranslation();
  const labelOf = useDefaultModelLabel();
  const picked = options.find((option) => option.id === connection.model);
  const model = picked ? labelOf(picked) : connection.model;
  const values: ConnectionValues = {
    agent: providerLabel,
    model,
    previous: connection.previousModel ?? "",
    // CLI 里挑模型的命令，两个 CLI 都是 /model。
    command: "/model",
  };
  const text = connectionText({ t, how: connection.how, values });
  if (text === null) return null;
  return (
    <Text style={settingsStyles.rowHint} testID="agent-api-endpoints-connection">
      {text}
    </Text>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** 一句说明里填进去的：CLI 名称、挑中的默认模型、CLI 原来的模型、CLI 里挑模型的命令。 */
interface ConnectionValues {
  agent: string;
  model: string;
  previous: string;
  command: string;
}

interface ConnectionTextInput {
  t: Translate;
  how: string;
  values: ConnectionValues;
}

function connectionText(input: ConnectionTextInput): string | null {
  const { t, how } = input;
  // i18next 的插值参数要是字典类型：展开成对象字面量。
  const values = { ...input.values };
  const key = "settings.apiEndpoints.agent.connection";
  switch (how) {
    case "kept":
      return t(`${key}.kept`, values);
    case "again":
      return t(`${key}.again`, values);
    case "joined":
      return t(`${key}.joined`, values);
    case "same":
      return t(`${key}.same`, values);
    case "default":
      return t(`${key}.default`, values);
    case "alike":
      return t(`${key}.alike`, values);
    case "first":
      return values.previous === "" ? t(`${key}.firstUnset`, values) : t(`${key}.first`, values);
    default:
      return null;
  }
}

function DefaultModelRow({
  providerLabel,
  value,
  options,
  busy,
  onChange,
}: {
  providerLabel: string;
  value: DefaultModelOption | null;
  options: DefaultModelOption[];
  busy: boolean;
  onChange: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const labelOf = useDefaultModelLabel();
  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      options.map((option) => ({
        id: option.id,
        value: option.id,
        label: labelOf(option),
        testID: `agent-api-endpoints-default-option-${option.id}`,
      })),
    [labelOf, options],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(
    () => (value === null ? null : { label: labelOf(value) }),
    [labelOf, value],
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
          value={value?.id ?? null}
          selectedDisplay={selectedDisplay}
          options={selectOptions}
          onChange={onChange}
          placeholder={t("settings.apiEndpoints.agent.defaultModel")}
          emptyText={t("settings.apiEndpoints.agent.noUsableEndpoint")}
          searchable={selectOptions.length > 6}
          title={title}
          size="sm"
          disabled={busy}
          // 这一行在提供方页最下面一张卡片里：列表朝上开，不伸出窗口底边。
          desktopPlacement="top-start"
          testID="agent-api-endpoints-default-model"
          triggerTestID="agent-api-endpoints-default-model-trigger"
        />
      </View>
    </View>
  );
}

/** 「保留 claude.ai 登录」（ADR 0012）：说明打开后哪些能用、哪些仍不能用，用户自己决定。 */
function KeepClaudeAiLoginRow({
  providerLabel,
  value,
  busy,
  onChange,
}: {
  providerLabel: string;
  value: boolean;
  busy: boolean;
  onChange: (keepsClaudeAiLogin: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.apiEndpoints.agent.keepClaudeAiLogin")}
        </Text>
        <Text style={settingsStyles.rowHint} testID="agent-api-endpoints-keep-claude-ai-login-hint">
          {t("settings.apiEndpoints.agent.keepClaudeAiLoginHint", { agent: providerLabel })}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy}
        accessibilityLabel={t("settings.apiEndpoints.agent.keepClaudeAiLogin")}
        testID="agent-api-endpoints-keep-claude-ai-login"
      />
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
  updateHost: {
    marginTop: theme.spacing[2],
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
