import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import { SettingsGroup } from "@/components/settings/headings/settings-group";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { PrimaryTextAlert } from "./primary-text-alert";
import { Button } from "@/components/ui/button";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { Text as UiText } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { AgentIssuesArea, AgentIssuesUpdateHost, type AgentIssuesAreaProps } from "./agent-issues";
import { useDefaultModelLabel } from "./default-model-label";
import { ModelRolesRows, type ModelRoleChangeHandler } from "./model-roles-rows";
import type { ApiEndpointConnection } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type {
  AgentApiEndpointsView,
  AgentEndpointsSummary,
  AgentSwitchBlock,
  ClaudeSideModelsView,
  CodexSideModelsView,
  DefaultModelOption,
  DefaultThinkingView,
  SubagentThinkingView,
} from "./internal/agent-settings";

/*
 * Claude Code / Codex / Pi / OMP 提供方页的「第三方接口」区：一张卡片——总开关、默认模型、默认思考档位、
 * 后台小任务 / Subagent / 记忆模型、OMP 的模型角色、「保留 claude.ai 登录」、「管理第三方接口」入口。纯 props，运行时接线在 view.tsx。
 */

const ThemedChevronRight = withUnistyles(ChevronRight);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface AgentApiEndpointsSectionProps {
  // CLI 的名称，如 "Claude Code"；OMP 命名配置那块带配置名。
  providerLabel: string;
  testID: string;
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
  // 默认思考档位；null 为不设。
  onDefaultThinkingChange: (thinkingOptionId: string | null) => void;
  onUltraCodeChange: (usesUltraCode: boolean) => void;
  // 后台小任务模型、Subagent 模型与它的思考档位（只有 Claude Code）；null 为不设。
  onBackgroundModelChange: (modelId: string | null) => void;
  onSubagentModelChange: (modelId: string | null) => void;
  onSubagentThinkingChange: (thinkingOptionId: string | null) => void;
  // 记忆模型、强制 Subagent 模型与「Codex Subagent 可用任意模型」（只有 Codex）；模型 null 为不设。
  onMemoryModelChange: (modelId: string | null) => void;
  onForcedSubagentModelChange: (modelId: string | null) => void;
  onAnySubagentModelChange: (allowsAnySubagentModel: boolean) => void;
  // OMP 的模型角色：设成某个模型与档位，null 为清空交还 OMP。
  onModelRoleChange: ModelRoleChangeHandler;
  onManage: () => void;
  // 「保留 claude.ai 登录」；主机太旧时为 null，不显示这一行（Codex 页的 view 里本来就没有这个选项）。
  onKeepClaudeAiLoginChange: ((keepsClaudeAiLogin: boolean) => void) | null;
  // 主机声明了 apiEndpointCliWiring 时为提示区的处理；否则为 null，请用户更新主机。
  issueActions: Omit<
    AgentIssuesAreaProps,
    "providerLabel" | "provider" | "issues" | "reopen"
  > | null;
}

export function AgentApiEndpointsSection({
  providerLabel,
  testID,
  view,
  busy,
  actionError,
  actionErrorCode,
  onDismissError,
  connection,
  onToggle,
  onDefaultModelChange,
  onDefaultThinkingChange,
  onUltraCodeChange,
  onBackgroundModelChange,
  onSubagentModelChange,
  onSubagentThinkingChange,
  onMemoryModelChange,
  onForcedSubagentModelChange,
  onAnySubagentModelChange,
  onModelRoleChange,
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
    <View style={styles.block} testID={testID}>
      {actionError ? (
        <View style={styles.alert}>
          <PrimaryTextAlert
            variant="error"
            title={t("settings.apiEndpoints.agent.saveFailed", { agent: providerLabel })}
            description={actionError}
            testID="agent-api-endpoints-error"
          >
            <Button variant="outline" size="sm" onPress={onDismissError}>
              {t("common.actions.dismiss")}
            </Button>
          </PrimaryTextAlert>
        </View>
      ) : null}
      {issueActions ? (
        <AgentIssuesArea
          providerLabel={providerLabel}
          issues={issues}
          reopen={view.reopen}
          {...issueActions}
        />
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
        {view.defaultThinking ? (
          <DefaultThinkingRow
            providerLabel={providerLabel}
            thinking={view.defaultThinking}
            busy={busy}
            onChange={onDefaultThinkingChange}
          />
        ) : null}
        {view.defaultThinking?.usesUltraCode != null ? (
          <UltraCodeRow
            providerLabel={providerLabel}
            value={view.defaultThinking.usesUltraCode}
            busy={busy}
            onChange={onUltraCodeChange}
          />
        ) : null}
        {view.sideModels ? (
          <SideModelRows
            providerLabel={providerLabel}
            sideModels={view.sideModels}
            options={view.modelOptions}
            busy={busy}
            onBackgroundModelChange={onBackgroundModelChange}
            onSubagentModelChange={onSubagentModelChange}
            onSubagentThinkingChange={onSubagentThinkingChange}
          />
        ) : null}
        {view.codexSideModels ? (
          <CodexSideModelRows
            providerLabel={providerLabel}
            sideModels={view.codexSideModels}
            busy={busy}
            onSubagentModelChange={onSubagentModelChange}
            onSubagentThinkingChange={onSubagentThinkingChange}
            onMemoryModelChange={onMemoryModelChange}
            onForcedSubagentModelChange={onForcedSubagentModelChange}
            onAnySubagentModelChange={onAnySubagentModelChange}
          />
        ) : null}
        {view.modelRoles ? (
          <ModelRolesRows
            providerLabel={providerLabel}
            roles={view.modelRoles}
            options={view.modelOptions}
            busy={busy}
            onChange={onModelRoleChange}
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
    </View>
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

/**
 * OMP 有命名配置时的外框：「第三方接口」作分组标题，每套配置一节，节标题是「默认」或配置名（docs/design.md §7）。
 */
export function AgentApiEndpointsProfilesFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <SettingsGroup title={t("settings.apiEndpoints.agent.title")} testID="agent-api-endpoints">
      {children}
    </SettingsGroup>
  );
}

export interface AgentApiEndpointsProfileSectionProps {
  // 「默认」或配置名。
  title: string;
  testID: string;
  children: React.ReactNode;
}

/** OMP 一套配置的一节。 */
export function AgentApiEndpointsProfileSection({
  title,
  testID,
  children,
}: AgentApiEndpointsProfileSectionProps) {
  return (
    <SettingsSection title={title} testID={testID}>
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
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, isCompact && styles.rowStacked]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.apiEndpoints.agent.defaultModel")}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.apiEndpoints.agent.defaultModelHint")}
        </Text>
      </View>
      <View style={isCompact ? styles.selectStacked : styles.select}>
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
          testID="agent-api-endpoints-default-model"
          triggerTestID="agent-api-endpoints-default-model-trigger"
        />
      </View>
    </View>
  );
}

// 「不设」在下拉里的 id：档位 id 不会是空串。
const UNSET_THINKING = "";

/** 默认思考档位：终端新会话从这一档起步；主机说每个会话都锁住时（Claude Code 的 max）写明。 */
function DefaultThinkingRow({
  providerLabel,
  thinking,
  busy,
  onChange,
}: {
  providerLabel: string;
  thinking: DefaultThinkingView;
  busy: boolean;
  onChange: (thinkingOptionId: string | null) => void;
}) {
  const { t } = useTranslation();
  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: UNSET_THINKING,
        value: UNSET_THINKING,
        label: t("settings.apiEndpoints.agent.defaultThinkingUnset", { agent: providerLabel }),
        testID: "agent-api-endpoints-default-thinking-option-unset",
      },
      ...thinking.options.map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label,
        testID: `agent-api-endpoints-default-thinking-option-${option.id}`,
      })),
    ],
    [providerLabel, t, thinking.options],
  );
  const handleChange = useCallback(
    (id: string) => onChange(id === UNSET_THINKING ? null : id),
    [onChange],
  );
  const selectedId = thinking.value ?? UNSET_THINKING;
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(() => {
    const selected = selectOptions.find((option) => option.id === selectedId);
    return selected ? { label: selected.label } : null;
  }, [selectOptions, selectedId]);
  const title = t("settings.apiEndpoints.agent.defaultThinkingPick", { agent: providerLabel });
  const isLocked = thinking.lockedAt !== null;
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, isCompact && styles.rowStacked]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.apiEndpoints.agent.defaultThinking")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.apiEndpoints.agent.defaultThinkingHint")}
        </Text>
        {isLocked ? (
          <UiText
            variant="caption"
            color="statusWarning"
            testID="agent-api-endpoints-default-thinking-max-lock"
          >
            {t("settings.apiEndpoints.agent.defaultThinkingMaxLock", { agent: providerLabel })}
          </UiText>
        ) : null}
      </View>
      <View style={isCompact ? styles.selectStacked : styles.select}>
        <SelectField
          field={false}
          label={title}
          value={selectedId}
          selectedDisplay={selectedDisplay}
          options={selectOptions}
          onChange={handleChange}
          placeholder={t("settings.apiEndpoints.agent.defaultThinking")}
          emptyText={t("settings.apiEndpoints.agent.defaultThinking")}
          title={title}
          size="sm"
          disabled={busy}
          testID="agent-api-endpoints-default-thinking"
          triggerTestID="agent-api-endpoints-default-thinking-trigger"
        />
      </View>
    </View>
  );
}

// 「与默认模型相同」在下拉里的 id：模型 id 不会是空串。
const FOLLOWS_DEFAULT_MODEL = "";

/** 后台小任务模型、Subagent 模型与它的思考档位（照 magpie 的 subagent 与 subagent_effort）。 */
function SideModelRows({
  providerLabel,
  sideModels,
  options,
  busy,
  onBackgroundModelChange,
  onSubagentModelChange,
  onSubagentThinkingChange,
}: {
  providerLabel: string;
  sideModels: ClaudeSideModelsView;
  options: DefaultModelOption[];
  busy: boolean;
  onBackgroundModelChange: (modelId: string | null) => void;
  onSubagentModelChange: (modelId: string | null) => void;
  onSubagentThinkingChange: (thinkingOptionId: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SideModelRow
        title={t("settings.apiEndpoints.agent.backgroundModel")}
        hint={t("settings.apiEndpoints.agent.backgroundModelHint", { agent: providerLabel })}
        pickTitle={t("settings.apiEndpoints.agent.backgroundModelPick", { agent: providerLabel })}
        unsetLabel={t("settings.apiEndpoints.agent.followsDefaultModel")}
        value={sideModels.backgroundModel}
        options={options}
        busy={busy}
        onChange={onBackgroundModelChange}
        testID="agent-api-endpoints-background-model"
      />
      <SideModelRow
        title={t("settings.apiEndpoints.agent.subagentModel")}
        hint={t("settings.apiEndpoints.agent.subagentModelHint")}
        pickTitle={t("settings.apiEndpoints.agent.subagentModelPick", { agent: providerLabel })}
        unsetLabel={t("settings.apiEndpoints.agent.followsDefaultModel")}
        value={sideModels.subagentModel}
        options={options}
        busy={busy}
        onChange={onSubagentModelChange}
        testID="agent-api-endpoints-subagent-model"
      />
      <SubagentThinkingRow
        providerLabel={providerLabel}
        title={t("settings.apiEndpoints.agent.subagentThinking")}
        hint={t("settings.apiEndpoints.agent.subagentThinkingHint", { agent: providerLabel })}
        pickTitle={t("settings.apiEndpoints.agent.subagentThinkingPick", { agent: providerLabel })}
        thinking={sideModels.subagentThinking}
        busy={busy}
        onChange={onSubagentThinkingChange}
      />
    </>
  );
}

/**
 * Codex 的默认 Subagent 模型、它的思考档位、强制 Subagent 模型、「Codex Subagent 可用任意模型」与记忆模型
 * （照 magpie 的 subagents、subagent_effort、subagent model、multi-agent V1 与 memories）。
 */
function CodexSideModelRows({
  providerLabel,
  sideModels,
  busy,
  onSubagentModelChange,
  onSubagentThinkingChange,
  onMemoryModelChange,
  onForcedSubagentModelChange,
  onAnySubagentModelChange,
}: {
  providerLabel: string;
  sideModels: CodexSideModelsView;
  busy: boolean;
  onSubagentModelChange: (modelId: string | null) => void;
  onSubagentThinkingChange: (thinkingOptionId: string | null) => void;
  onMemoryModelChange: (modelId: string | null) => void;
  onForcedSubagentModelChange: (modelId: string | null) => void;
  onAnySubagentModelChange: (allowsAnySubagentModel: boolean) => void;
}) {
  const { t } = useTranslation();
  const agent = { agent: providerLabel };
  return (
    <>
      <SideModelRow
        title={t("settings.apiEndpoints.agent.codexSubagentModel")}
        hint={t("settings.apiEndpoints.agent.codexSubagentModelHint")}
        pickTitle={t("settings.apiEndpoints.agent.codexSubagentModelPick", agent)}
        unsetLabel={t("settings.apiEndpoints.agent.codexSubagentModelUnset")}
        value={sideModels.subagentModel}
        options={sideModels.modelOptions}
        busy={busy}
        onChange={onSubagentModelChange}
        testID="agent-api-endpoints-subagent-model"
      />
      <SubagentThinkingRow
        providerLabel={providerLabel}
        title={t("settings.apiEndpoints.agent.codexSubagentThinking")}
        hint={t("settings.apiEndpoints.agent.codexSubagentThinkingHint")}
        pickTitle={t("settings.apiEndpoints.agent.codexSubagentThinkingPick", agent)}
        thinking={sideModels.subagentThinking}
        busy={busy}
        onChange={onSubagentThinkingChange}
      />
      <SideModelRow
        title={t("settings.apiEndpoints.agent.forcedSubagentModel")}
        hint={t("settings.apiEndpoints.agent.forcedSubagentModelHint")}
        pickTitle={t("settings.apiEndpoints.agent.forcedSubagentModelPick", agent)}
        unsetLabel={t("settings.apiEndpoints.agent.forcedSubagentModelUnset")}
        value={sideModels.forcedSubagentModel}
        options={sideModels.modelOptions}
        busy={busy}
        onChange={onForcedSubagentModelChange}
        testID="agent-api-endpoints-forced-subagent-model"
      />
      <AnySubagentModelRow
        providerLabel={providerLabel}
        value={sideModels.allowsAnySubagentModel}
        busy={busy}
        onChange={onAnySubagentModelChange}
      />
      <SideModelRow
        title={t("settings.apiEndpoints.agent.memoryModel")}
        hint={t("settings.apiEndpoints.agent.memoryModelHint", agent)}
        pickTitle={t("settings.apiEndpoints.agent.memoryModelPick", agent)}
        unsetLabel={t("settings.apiEndpoints.agent.memoryModelUnset", agent)}
        value={sideModels.memoryModel}
        options={sideModels.modelOptions}
        busy={busy}
        onChange={onMemoryModelChange}
        testID="agent-api-endpoints-memory-model"
      />
    </>
  );
}

/** 一个可以不设的模型；不设时显示 unsetLabel（如「与默认模型相同」）。 */
function SideModelRow({
  title,
  hint,
  pickTitle,
  unsetLabel,
  value,
  options,
  busy,
  onChange,
  testID,
}: {
  title: string;
  hint: string;
  pickTitle: string;
  unsetLabel: string;
  value: DefaultModelOption | null;
  options: DefaultModelOption[];
  busy: boolean;
  onChange: (modelId: string | null) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const labelOf = useDefaultModelLabel();
  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: FOLLOWS_DEFAULT_MODEL,
        value: FOLLOWS_DEFAULT_MODEL,
        label: unsetLabel,
        testID: `${testID}-option-default`,
      },
      ...options.map((option) => ({
        id: option.id,
        value: option.id,
        label: labelOf(option),
        testID: `${testID}-option-${option.id}`,
      })),
    ],
    [unsetLabel, labelOf, options, testID],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay>(() => {
    if (value === null) return { label: unsetLabel };
    return { label: labelOf(value) };
  }, [unsetLabel, labelOf, value]);
  const handleChange = useCallback(
    (id: string) => onChange(id === FOLLOWS_DEFAULT_MODEL ? null : id),
    [onChange],
  );
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, isCompact && styles.rowStacked]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={isCompact ? styles.selectStacked : styles.select}>
        <SelectField
          field={false}
          label={pickTitle}
          value={value?.id ?? FOLLOWS_DEFAULT_MODEL}
          selectedDisplay={selectedDisplay}
          options={selectOptions}
          onChange={handleChange}
          placeholder={title}
          emptyText={t("settings.apiEndpoints.agent.noUsableEndpoint")}
          searchable={selectOptions.length > 6}
          title={pickTitle}
          size="sm"
          disabled={busy}
          testID={testID}
          triggerTestID={`${testID}-trigger`}
        />
      </View>
    </View>
  );
}

/** Subagent 的思考档位：选项来自主机按 Subagent 模型给的档位；设了却不在选项里的照 id 显示。 */
function SubagentThinkingRow({
  providerLabel,
  title,
  hint,
  pickTitle,
  thinking,
  busy,
  onChange,
}: {
  providerLabel: string;
  title: string;
  hint: string;
  pickTitle: string;
  thinking: SubagentThinkingView;
  busy: boolean;
  onChange: (thinkingOptionId: string | null) => void;
}) {
  const { t } = useTranslation();
  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: UNSET_THINKING,
        value: UNSET_THINKING,
        label: t("settings.apiEndpoints.agent.subagentThinkingUnset", { agent: providerLabel }),
        testID: "agent-api-endpoints-subagent-thinking-option-unset",
      },
      ...thinking.options.map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label,
        testID: `agent-api-endpoints-subagent-thinking-option-${option.id}`,
      })),
    ],
    [providerLabel, t, thinking.options],
  );
  const handleChange = useCallback(
    (id: string) => onChange(id === UNSET_THINKING ? null : id),
    [onChange],
  );
  const selectedId = thinking.value ?? UNSET_THINKING;
  const selectedDisplay = useMemo<SelectFieldDisplay>(() => {
    const selected = selectOptions.find((option) => option.id === selectedId);
    return { label: selected?.label ?? selectedId };
  }, [selectOptions, selectedId]);
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, isCompact && styles.rowStacked]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={isCompact ? styles.selectStacked : styles.select}>
        <SelectField
          field={false}
          label={pickTitle}
          value={selectedId}
          selectedDisplay={selectedDisplay}
          options={selectOptions}
          onChange={handleChange}
          placeholder={title}
          emptyText={title}
          title={pickTitle}
          size="sm"
          disabled={busy}
          testID="agent-api-endpoints-subagent-thinking"
          triggerTestID="agent-api-endpoints-subagent-thinking-trigger"
        />
      </View>
    </View>
  );
}

/** Ultra Code（照 magpie 的 ultracode 开关）：与思考档位分开，只在默认模型支持 xhigh 时出现。 */
function UltraCodeRow({
  providerLabel,
  value,
  busy,
  onChange,
}: {
  providerLabel: string;
  value: boolean;
  busy: boolean;
  onChange: (usesUltraCode: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.apiEndpoints.agent.ultraCode")}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.apiEndpoints.agent.ultraCodeHint", { agent: providerLabel })}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy}
        accessibilityLabel={t("settings.apiEndpoints.agent.ultraCode")}
        testID="agent-api-endpoints-ultra-code"
      />
    </View>
  );
}

/** 「Codex Subagent 可用任意模型」（照 magpie 的 multi-agent V1）：Codex 自己的 multi_agent_v2 开着时提示区另有说明。 */
function AnySubagentModelRow({
  providerLabel,
  value,
  busy,
  onChange,
}: {
  providerLabel: string;
  value: boolean;
  busy: boolean;
  onChange: (allowsAnySubagentModel: boolean) => void;
}) {
  const { t } = useTranslation();
  const title = t("settings.apiEndpoints.agent.anySubagentModel", { agent: providerLabel });
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.apiEndpoints.agent.anySubagentModelHint", { agent: providerLabel })}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy}
        accessibilityLabel={title}
        testID="agent-api-endpoints-any-subagent-model"
      />
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
  block: {
    gap: theme.spacing[3],
  },
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
  // 窄窗口：下拉放到说明下面、占满整行，标题和说明不被挤断。
  rowStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  selectStacked: {
    width: "100%",
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
