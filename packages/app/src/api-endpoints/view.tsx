import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { reopenSeenKey, useReopenSeenStore } from "@/stores/reopen-seen-store";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import type {
  ApiEndpoint,
  ApiEndpointAgentSettings,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature, useHostFeatureAvailability } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import {
  buildApiEndpointSettingsRoute,
  buildProviderSettingsRoute,
  buildSettingsHostSectionRoute,
} from "@/utils/host-routes";
import { ApiEndpointConnectionSheet } from "./connection-form-sheet";
import { ApiEndpointConnectionSection } from "./connection-section";
import { ApiEndpointDetailHeader } from "./detail-header";
import { ApiEndpointsListSection, NoticeCard, type ListManagement } from "./host-list-section";
import { AgentApiEndpointsFrame, AgentApiEndpointsSection } from "./agent-section";
import { selectAgentApiEndpointsView, type AgentIssueAction } from "./internal/agent-settings";
import type { ConnectionFormSeed, ConnectionSaveResult } from "./internal/connection-form-model";
import { findHostEndpoint } from "./internal/host-list";
import { ApiEndpointDisabledModelsSection } from "./disabled-models-section";
import {
  ApiEndpointNameDisplayRow,
  ApiEndpointNameDisplaySection,
} from "./endpoint-name-display-section";
import { ApiEndpointLongConversationsSection } from "./long-conversations-section";
import { ApiEndpointMappingSection } from "./mapping-section";
import { ApiEndpointModelDefaultsSection } from "./model-defaults-section";
import { ApiEndpointModelScopeSection } from "./model-scope-section";
import { ApiEndpointModelSettingsSheet } from "./model-settings-sheet";
import { resolveModelFacts } from "@getpaseo/protocol/api-endpoint/model-settings";
import { ApiEndpointModelsSection, type ModelTestsControl } from "./models-section";
import { useEndpointDetail } from "./use-endpoint-detail";
import { useModelTests } from "./use-model-tests";
import { useFormatPins } from "./use-format-pins";
import { SwitchOffSheet } from "./switch-off-sheet";
import { ApiEndpointWebSearchSection } from "./web-search-section";
import { EndpointIconHostProvider } from "./endpoint-icon";
import { TemplatePickerSheet } from "./template-picker-sheet";
import { useEndpointTemplates } from "./use-endpoint-templates";
import { useHostEndpoints, type UseHostEndpointsResult } from "./use-host-endpoints";

/*
 * 运行时接线：客户端、查询、确认框。各区块组件（*-section.tsx）保持纯 props。
 */

/** Claude Code / Codex 提供方页的「第三方接口」区。调用方只在 provider 受支持时渲染。 */
export function ApiEndpointsView({
  serverId,
  provider,
  providerLabel,
}: {
  serverId: string;
  provider: string;
  providerLabel: string;
}) {
  const { t } = useTranslation();
  const supported = useHostFeatureAvailability(serverId, "apiEndpointGateway");
  if (supported !== true) {
    // 主机太旧时请用户更新，不保留旧的单选界面（docs/protocol-compatibility.md）。
    const noticeKey =
      supported === null ? "settings.apiEndpoints.unavailable" : "settings.apiEndpoints.updateHost";
    return <AgentNotice text={t(noticeKey)} />;
  }
  return (
    <AgentApiEndpoints serverId={serverId} provider={provider} providerLabel={providerLabel} />
  );
}

function AgentNotice({ text }: { text: string }) {
  return (
    <AgentApiEndpointsFrame>
      <NoticeCard text={text} testID="agent-api-endpoints-notice" />
    </AgentApiEndpointsFrame>
  );
}

function AgentApiEndpoints({
  serverId,
  provider,
  providerLabel,
}: {
  serverId: string;
  provider: string;
  providerLabel: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const now = useClock();
  const endpoints = useHostEndpoints(serverId);
  const { state, setAgentSettings, runIssueAction } = endpoints;
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18.
  const hasIssues = useHostFeature(serverId, "apiEndpointCliWiring");
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  // 指定某一家的默认模型取聊天模型选择器同一份分组（「接口标识/模型名」）。
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18. 老主机不收「接口标识/模型名」的默认模型。
  const providerEntry = providerEntries?.find((candidate) => candidate.provider === provider);
  const endpointModelGroups = useMemo(() => {
    if (!hasIssues) return null;
    return providerEntry?.apiEndpointModelGroups ?? null;
  }, [hasIssues, providerEntry]);
  // 每个会话都锁在哪一档由主机说（只有 Claude Code 的 max 会）。
  const lockedThinkingOptionId = providerEntry?.lockedThinkingOptionId ?? null;
  // Subagent 思考档位的选项由主机按 Subagent 模型或 settings.json 里的主模型给（照 magpie 的 subagent_effort）。
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18. 老主机没有后台小任务、Subagent 与记忆模型这几项。
  const subagentThinkingOptions = useMemo(() => {
    if (!hasIssues) return null;
    const options = providerEntry?.subagentThinkingOptions ?? [];
    return options.map((option) => ({ id: option.id, label: option.label }));
  }, [hasIssues, providerEntry]);
  // Codex 的默认 Subagent 模型与记忆模型的选项由主机合好（用 ChatGPT 登录时 Codex 自己的模型在前）。
  const sideModelOptions = useMemo(() => {
    if (!hasIssues) return [];
    const options = providerEntry?.sideModelOptions ?? [];
    return options.map(({ id, model, endpointName }) => ({ id, model, endpointName }));
  }, [hasIssues, providerEntry]);
  const lastConnection = endpoints.lastConnection;
  const isOwnConnection = lastConnection?.provider === provider;
  const connection = isOwnConnection ? lastConnection.connection : null;

  const client = useHostRuntimeClient(serverId);
  // 关总开关与提示区的「切回官方」先开确认框，看会改回什么，由框里关掉。
  const [isConfirmingSwitchOff, setIsConfirmingSwitchOff] = useState(false);
  const handleToggle = useCallback(
    (enabled: boolean) => {
      // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18. 老主机没有预览，直接关。
      const asksFirst = !enabled && hasIssues;
      if (asksFirst) {
        setIsConfirmingSwitchOff(true);
        return;
      }
      setAgentSettings(provider, { enabled });
    },
    [hasIssues, provider, setAgentSettings],
  );
  const closeSwitchOff = useCallback(() => setIsConfirmingSwitchOff(false), []);
  const handleDefaultModelChange = useCallback(
    (defaultModelId: string) => setAgentSettings(provider, { enabled: true, defaultModelId }),
    [provider, setAgentSettings],
  );
  const handleDefaultThinkingChange = useCallback(
    (defaultThinkingOptionId: string | null) =>
      setAgentSettings(provider, { enabled: true, defaultThinkingOptionId }),
    [provider, setAgentSettings],
  );
  const handleUltraCodeChange = useCallback(
    (usesUltraCode: boolean) => setAgentSettings(provider, { enabled: true, usesUltraCode }),
    [provider, setAgentSettings],
  );
  const handleBackgroundModelChange = useCallback(
    (backgroundModelId: string | null) =>
      setAgentSettings(provider, { enabled: true, backgroundModelId }),
    [provider, setAgentSettings],
  );
  const handleSubagentModelChange = useCallback(
    (subagentModelId: string | null) =>
      setAgentSettings(provider, { enabled: true, subagentModelId }),
    [provider, setAgentSettings],
  );
  const handleSubagentThinkingChange = useCallback(
    (subagentThinkingOptionId: string | null) =>
      setAgentSettings(provider, { enabled: true, subagentThinkingOptionId }),
    [provider, setAgentSettings],
  );
  const handleMemoryModelChange = useCallback(
    (memoryModelId: string | null) => setAgentSettings(provider, { enabled: true, memoryModelId }),
    [provider, setAgentSettings],
  );
  const handleForcedSubagentModelChange = useCallback(
    (forcedSubagentModelId: string | null) =>
      setAgentSettings(provider, { enabled: true, forcedSubagentModelId }),
    [provider, setAgentSettings],
  );
  const handleAnySubagentModelChange = useCallback(
    (allowsAnySubagentModel: boolean) =>
      setAgentSettings(provider, { enabled: true, allowsAnySubagentModel }),
    [provider, setAgentSettings],
  );
  // 总开关开着、关着都能设，开关保持原样。
  const isEnabled = state.status === "ready" && state.agents[provider]?.enabled === true;
  const handleKeepClaudeAiLoginChange = useCallback(
    (keepsClaudeAiLogin: boolean) =>
      setAgentSettings(provider, { enabled: isEnabled, keepsClaudeAiLogin }),
    [isEnabled, provider, setAgentSettings],
  );
  const handleIssueAction = useCallback(
    (action: AgentIssueAction) => {
      if (action === "switchToOfficial") {
        setIsConfirmingSwitchOff(true);
        return;
      }
      runIssueAction(provider, action);
    },
    [provider, runIssueAction],
  );
  const seenReopen = useReopenSeenStore(
    (store) => store.seen[reopenSeenKey({ serverId, provider })] ?? null,
  );
  const markReopenSeen = useReopenSeenStore((store) => store.markSeen);
  const handleDismissReopen = useCallback(
    (signature: string) => markReopenSeen({ serverId, provider, signature }),
    [markReopenSeen, provider, serverId],
  );
  const issueActions = useMemo(() => {
    if (!hasIssues) return null;
    const pending = endpoints.pendingIssueAction;
    const failed = endpoints.issueActionError;
    return {
      pendingAction: pending?.provider === provider ? pending.action : null,
      actionError: failed?.provider === provider ? failed : null,
      onAction: handleIssueAction,
      onDismissError: endpoints.dismissIssueActionError,
      seenReopen,
      onDismissReopen: handleDismissReopen,
    };
  }, [
    endpoints.dismissIssueActionError,
    handleDismissReopen,
    seenReopen,
    endpoints.issueActionError,
    endpoints.pendingIssueAction,
    handleIssueAction,
    hasIssues,
    provider,
  ]);
  const handleManage = useCallback(
    () => router.push(buildSettingsHostSectionRoute(serverId, "api-endpoints")),
    [router, serverId],
  );

  if (state.status === "loading") {
    return <AgentNotice text={t("settings.apiEndpoints.loading")} />;
  }
  if (state.status === "error") {
    return <AgentNotice text={state.message} />;
  }
  return (
    <>
      <AgentApiEndpointsSection
        providerLabel={providerLabel}
        view={selectAgentApiEndpointsView({
          state,
          provider,
          endpointModelGroups,
          lockedThinkingOptionId,
          subagentThinkingOptions,
          sideModelOptions,
          now,
        })}
        busy={endpoints.pendingAgent === provider}
        actionError={endpoints.actionError}
        actionErrorCode={endpoints.actionErrorCode}
        onDismissError={endpoints.dismissActionError}
        connection={connection}
        onToggle={handleToggle}
        onDefaultModelChange={handleDefaultModelChange}
        onDefaultThinkingChange={handleDefaultThinkingChange}
        onUltraCodeChange={handleUltraCodeChange}
        onBackgroundModelChange={handleBackgroundModelChange}
        onSubagentModelChange={handleSubagentModelChange}
        onSubagentThinkingChange={handleSubagentThinkingChange}
        onMemoryModelChange={handleMemoryModelChange}
        onForcedSubagentModelChange={handleForcedSubagentModelChange}
        onAnySubagentModelChange={handleAnySubagentModelChange}
        onManage={handleManage}
        // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18. 老主机不认这个选项。
        onKeepClaudeAiLoginChange={hasIssues ? handleKeepClaudeAiLoginChange : null}
        issueActions={issueActions}
      />
      {isConfirmingSwitchOff ? (
        <SwitchOffSheet
          client={client}
          serverId={serverId}
          provider={provider}
          providerLabel={providerLabel}
          onClose={closeSwitchOff}
        />
      ) : null}
    </>
  );
}

// 冷却倒计时按分钟显示；列表数据没变时 React Query 不会重渲染，自己每半分钟取一次时间。
const CLOCK_TICK_MS = 30_000;

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * 主机没声明 apiEndpointGateway 时请用户更新主机，不做兼容分支（docs/protocol-compatibility.md）；
 * 还没收到 server_info（未连接）时和 Providers 页一样说主机不可用。
 */
function GatewayGate({
  serverId,
  children,
}: {
  serverId: string;
  children: React.ReactNode;
}): React.ReactNode {
  const { t } = useTranslation();
  const supported = useHostFeatureAvailability(serverId, "apiEndpointGateway");
  if (supported === null) {
    return (
      <NoticeCard
        text={t("settings.apiEndpoints.unavailable")}
        testID="api-endpoints-unavailable"
      />
    );
  }
  if (!supported) {
    return (
      <NoticeCard text={t("settings.apiEndpoints.updateHost")} testID="api-endpoints-update-host" />
    );
  }
  return children;
}

// picker：「+」先出的模板列表；form 从列表进来时 backToPicker 为 true，表单的返回键回到列表。
type ConnectionSheetState =
  | { kind: "picker" }
  | { kind: "form"; seed: ConnectionFormSeed; backToPicker: boolean }
  | null;

function ConnectionSheet({
  serverId,
  sheet,
  endpoints,
  setSheet,
  onSaved,
  onOpenEndpoint,
}: {
  serverId: string;
  sheet: ConnectionSheetState;
  endpoints: Pick<
    UseHostEndpointsResult,
    | "state"
    | "save"
    | "detect"
    | "revealKey"
    | "storeIcon"
    | "fetchSiteIcon"
    | "fetchModels"
    | "testConnection"
  >;
  setSheet: Dispatch<SetStateAction<ConnectionSheetState>>;
  onSaved: (result: Extract<ConnectionSaveResult, { status: "saved" }>) => void;
  // 模板列表里点了已加过的模板：打开已有那家。
  onOpenEndpoint: (endpointId: string) => void;
}) {
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机新建时要求 key，也读不回 key，没有模板。
  const hasManagement = useHostFeature(serverId, "apiEndpointManagement");
  const templates = useEndpointTemplates({ serverId, enabled: hasManagement });
  const handlePick = useCallback(
    (templateId: string | null) =>
      setSheet({ kind: "form", seed: { mode: "create", templateId }, backToPicker: true }),
    [setSheet],
  );
  const handleBack = useCallback(() => setSheet({ kind: "picker" }), [setSheet]);
  // 窄屏底部弹层换成另一个时，被换下的那个收起后还会报一次关闭：只关掉仍是它自己的那一层。
  const closePicker = useCallback(
    () => setSheet((current) => (current?.kind === "picker" ? null : current)),
    [setSheet],
  );
  const handleOpenEndpoint = useCallback(
    (endpointId: string) => {
      setSheet(null);
      onOpenEndpoint(endpointId);
    },
    [onOpenEndpoint, setSheet],
  );
  const closeForm = useCallback(
    () => setSheet((current) => (current?.kind === "form" ? null : current)),
    [setSheet],
  );
  if (!sheet) return null;
  if (sheet.kind === "picker") {
    return (
      <TemplatePickerSheet
        templates={templates}
        endpoints={endpoints.state.status === "ready" ? endpoints.state.endpoints : []}
        onRetry={templates.retry}
        onAdd={handlePick}
        onOpenEndpoint={handleOpenEndpoint}
        onClose={closePicker}
      />
    );
  }
  const { seed } = sheet;
  return (
    <ApiEndpointConnectionSheet
      key={sheetKey(seed)}
      seed={seed}
      isKeyOptional={hasManagement}
      canRevealKey={hasManagement}
      canPickIcon={hasManagement}
      canPasteCurl={hasManagement}
      canCheckBeforeSave={hasManagement}
      followsListWhenNew={hasManagement}
      templates={templates.status === "ready" ? templates.templates : []}
      onBack={sheet.backToPicker ? handleBack : null}
      onSave={endpoints.save}
      onDetect={endpoints.detect}
      onRevealKey={endpoints.revealKey}
      onStoreIcon={endpoints.storeIcon}
      onFetchSiteIcon={endpoints.fetchSiteIcon}
      onFetchModels={endpoints.fetchModels}
      onTestConnection={endpoints.testConnection}
      onSaved={onSaved}
      onClose={closeForm}
    />
  );
}

/** 「复制」：以原来那家开添加窗口，名称「原名 副本」，重名由 daemon 避让。 */
function duplicateSeed(endpoint: ApiEndpoint, t: TFunction): ConnectionFormSeed {
  const name = t("settings.apiEndpoints.form.duplicateName", { name: endpoint.name });
  return { mode: "duplicate", source: endpoint, name };
}

function sheetKey(seed: ConnectionFormSeed): string {
  if (seed.mode === "edit") return `edit-${seed.endpoint.id}`;
  if (seed.mode === "duplicate") return `duplicate-${seed.source.id}`;
  return `create-${seed.templateId ?? "custom"}`;
}

/** 设置 › 主机 › 第三方接口：整台主机共用的接口列表。 */
export function ApiEndpointsPage({ serverId }: { serverId: string }) {
  return (
    <GatewayGate serverId={serverId}>
      <EndpointIconHostProvider serverId={serverId}>
        <ApiEndpointsListPage serverId={serverId} />
      </EndpointIconHostProvider>
    </GatewayGate>
  );
}

function ApiEndpointsListPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const now = useClock();
  const endpoints = useHostEndpoints(serverId);
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机没有 set_order、长对话设置、已禁用的模型与接口名显示方式。
  const hasManagement = useHostFeature(serverId, "apiEndpointManagement");
  const [sheet, setSheet] = useState<ConnectionSheetState>(null);
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机不发 key 打码与默认模型落在哪家。
  const management = useMemo<ListManagement | undefined>(
    () =>
      hasManagement
        ? {
            providerLabel: (provider) => resolveProviderLabel(provider, providerEntries),
            onOpenProvider: (provider) =>
              router.push(buildProviderSettingsRoute(serverId, provider)),
            onDuplicate: (endpoint) =>
              setSheet({ kind: "form", seed: duplicateSeed(endpoint, t), backToPicker: false }),
          }
        : undefined,
    [hasManagement, providerEntries, router, serverId, t],
  );

  // 主机声明了 apiEndpointManagement 时「+」先出模板列表，否则直接打开「自定义」表单。
  const handleAdd = useCallback(
    () =>
      setSheet(
        hasManagement
          ? { kind: "picker" }
          : { kind: "form", seed: { mode: "create", templateId: null }, backToPicker: false },
      ),
    [hasManagement],
  );
  const handleOpenById = useCallback(
    (openedId: string) => router.push(buildApiEndpointSettingsRoute(serverId, openedId)),
    [router, serverId],
  );
  const handleOpen = useCallback(
    (endpoint: ApiEndpoint) => handleOpenById(endpoint.id),
    [handleOpenById],
  );
  // 新建的接口保存后直接进它的详情页拉模型。
  const handleSaved = useCallback(
    (result: Extract<ConnectionSaveResult, { status: "saved" }>) => {
      setSheet(null);
      router.push(buildApiEndpointSettingsRoute(serverId, result.endpointId));
    },
    [router, serverId],
  );

  return (
    <>
      <ApiEndpointsListSection
        state={endpoints.state}
        now={now}
        pendingEndpointId={endpoints.pendingEndpointId}
        actionError={endpoints.actionError}
        onDismissError={endpoints.dismissActionError}
        onAdd={handleAdd}
        onOpen={handleOpen}
        onToggle={endpoints.setEnabled}
        onResume={endpoints.resume}
        onArrange={hasManagement ? endpoints.arrange : undefined}
        management={management}
      />
      {hasManagement && endpoints.state.status === "ready" ? (
        <ApiEndpointLongConversationsSection
          initial={endpoints.state.longConversations}
          onSave={endpoints.setLongConversations}
        />
      ) : null}
      {hasManagement && endpoints.state.status === "ready" ? (
        <ApiEndpointDisabledModelsSection
          initial={endpoints.state.disabledModels}
          endpoints={endpoints.state.endpoints}
          onSave={endpoints.setDisabledModels}
        />
      ) : null}
      {hasManagement && endpoints.state.status === "ready" ? (
        <ApiEndpointNameDisplaySection
          value={endpoints.state.endpointNameDisplay}
          onSave={endpoints.setEndpointNameDisplay}
          unreachedAgents={endpoints.state.endpointNamesUnreached.map((provider) =>
            resolveProviderLabel(provider, providerEntries),
          )}
          previewEndpoint={null}
          allEndpoints={endpoints.state.endpoints}
          disabledModels={endpoints.state.disabledModels}
          testID="api-endpoints-endpoint-names"
        />
      ) : null}
      <ConnectionSheet
        serverId={serverId}
        sheet={sheet}
        endpoints={endpoints}
        setSheet={setSheet}
        onSaved={handleSaved}
        onOpenEndpoint={handleOpenById}
      />
    </>
  );
}

/** 接口详情页：头部、连接、模型（按家族挑选）、Claude 档位映射。 */
export function ApiEndpointDetailPage({
  serverId,
  endpointId,
}: {
  serverId: string;
  endpointId: string;
}) {
  return (
    <GatewayGate serverId={serverId}>
      <EndpointIconHostProvider serverId={serverId}>
        <ApiEndpointDetailContent serverId={serverId} endpointId={endpointId} />
      </EndpointIconHostProvider>
    </GatewayGate>
  );
}

function ApiEndpointDetailContent({
  serverId,
  endpointId,
}: {
  serverId: string;
  endpointId: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  // Stack 下层被盖住的设置页仍然挂载；地址只由当前页改。
  const isFocused = useIsFocused();
  const endpoints = useHostEndpoints(serverId);
  const [sheet, setSheet] = useState<ConnectionSheetState>(null);
  const { state } = endpoints;
  const endpoint = findHostEndpoint(state, endpointId);
  const isMissing = state.status === "ready" && endpoint === null;

  useEffect(() => {
    if (!isFocused || !isMissing) return;
    router.replace(buildSettingsHostSectionRoute(serverId, "api-endpoints"));
  }, [isFocused, isMissing, router, serverId]);

  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机不认 copyOf。
  const canDuplicate = useHostFeature(serverId, "apiEndpointManagement");
  const templates = useEndpointTemplates({ serverId, enabled: canDuplicate });
  const handleEdit = useCallback(() => {
    if (endpoint) setSheet({ kind: "form", seed: { mode: "edit", endpoint }, backToPicker: false });
  }, [endpoint]);
  const handleDuplicate = useCallback(() => {
    if (endpoint) {
      setSheet({ kind: "form", seed: duplicateSeed(endpoint, t), backToPicker: false });
    }
  }, [endpoint, t]);
  // 「再加一家」：用这家的模板开新表单；模板清单里没有它（「自定义」加的、主机已不认识的模板）就没有这一项。
  const templateId = endpoint?.templateId ?? null;
  const hasKnownTemplate =
    templateId !== null &&
    templates.status === "ready" &&
    templates.templates.some((candidate) => candidate.id === templateId);
  const handleAddAnother = useCallback(() => {
    if (templateId === null) return;
    setSheet({ kind: "form", seed: { mode: "create", templateId }, backToPicker: false });
  }, [templateId]);
  // 编辑只关掉弹窗；复制出的、再加的新接口保存后进它的详情页。
  const handleOpenById = useCallback(
    (openedId: string) => router.push(buildApiEndpointSettingsRoute(serverId, openedId)),
    [router, serverId],
  );
  const handleSaved = useCallback(
    (result: Extract<ConnectionSaveResult, { status: "saved" }>) => {
      const opensCopy = sheet?.kind === "form" && sheet.seed.mode !== "edit";
      setSheet(null);
      if (opensCopy) router.push(buildApiEndpointSettingsRoute(serverId, result.endpointId));
    },
    [router, serverId, sheet],
  );

  if (state.status === "error") {
    return <NoticeCard text={state.message} testID="api-endpoint-detail-error" />;
  }
  if (!endpoint || state.status !== "ready") {
    return (
      <NoticeCard text={t("settings.apiEndpoints.loading")} testID="api-endpoint-detail-loading" />
    );
  }
  return (
    <View testID="api-endpoint-detail">
      {/* 按接口加 key：换到另一家时草稿、测试结果、搜索词一起清掉。 */}
      <ApiEndpointDetailSections
        key={endpoint.id}
        serverId={serverId}
        endpoint={endpoint}
        allEndpoints={state.endpoints}
        agents={state.agents}
        hostEndpoints={endpoints}
        onEdit={handleEdit}
        onDuplicate={canDuplicate ? handleDuplicate : null}
        onAddAnother={hasKnownTemplate ? handleAddAnother : null}
      />
      <ConnectionSheet
        serverId={serverId}
        sheet={sheet}
        endpoints={endpoints}
        setSheet={setSheet}
        onSaved={handleSaved}
        onOpenEndpoint={handleOpenById}
      />
    </View>
  );
}

function ApiEndpointDetailSections({
  serverId,
  endpoint,
  allEndpoints,
  agents,
  hostEndpoints,
  onEdit,
  onDuplicate,
  onAddAnother,
}: {
  serverId: string;
  endpoint: ApiEndpoint;
  allEndpoints: ApiEndpoint[];
  agents: Record<string, ApiEndpointAgentSettings>;
  hostEndpoints: UseHostEndpointsResult;
  onEdit: () => void;
  // 主机声明了 apiEndpointManagement 才有「复制」。
  onDuplicate: (() => void) | null;
  // 从主机认得的模板加的才有「再加一家」。
  onAddAnother: (() => void) | null;
}) {
  const { t } = useTranslation();
  const now = useClock();
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机上没 key 是缺失，
  // 也不认合并拉取与丢掉清单。
  const hasManagement = useHostFeature(serverId, "apiEndpointManagement");
  const detail = useEndpointDetail({
    serverId,
    endpoint,
    endpoints: allEndpoints,
    agents,
    hasManagement,
  });
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  // 「接口名显示方式」的预览：这家第一个模型在选单里叫什么（magpie 的 Agents’ lists show）。
  const hostState = hostEndpoints.state;
  const nameDisplayRow = useMemo(() => {
    if (!hasManagement || hostState.status !== "ready") return null;
    const unreachedAgents = hostState.endpointNamesUnreached.map((provider) =>
      resolveProviderLabel(provider, providerEntries),
    );
    return (
      <ApiEndpointNameDisplayRow
        label={t("settings.apiEndpoints.endpointNames.title")}
        value={hostState.endpointNameDisplay}
        onSave={hostEndpoints.setEndpointNameDisplay}
        unreachedAgents={unreachedAgents}
        previewEndpoint={endpoint}
        allEndpoints={allEndpoints}
        disabledModels={hostState.disabledModels}
        testID="api-endpoint-endpoint-names"
      />
    );
  }, [
    allEndpoints,
    endpoint,
    hasManagement,
    hostEndpoints.setEndpointNameDisplay,
    hostState,
    providerEntries,
    t,
  ]);
  // 开着「模型设置」窗口的模型；关着为 null。
  const [settingsModelId, setSettingsModelId] = useState<string | null>(null);
  const closeModelSettings = useCallback(() => setSettingsModelId(null), []);
  const formatPins = useFormatPins({
    endpoint,
    hasManagement,
    save: detail.saveModelSettings,
  });
  const modelTestsState = useModelTests({ serverId, endpointId: endpoint.id });
  const servedIds = useMemo(() => detail.source.models.map((model) => model.id), [detail.source]);
  const modelTests = useMemo<ModelTestsControl | null>(() => {
    if (!hasManagement) return null;
    return {
      tests: modelTestsState.tests,
      run: modelTestsState.run,
      onTestAll: () => modelTestsState.testAll(servedIds),
      onTestOne: modelTestsState.testOne,
      onCancel: modelTestsState.cancel,
      factsOf: (modelId) => {
        const facts = resolveModelFacts({
          settings: endpoint.modelSettings,
          modelId,
          auto: endpoint.modelFacts?.[modelId] ?? {},
        });
        return { name: facts.name, context: facts.context };
      },
    };
  }, [endpoint, hasManagement, modelTestsState, servedIds]);
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18.
  const hasCliWiring = useHostFeature(serverId, "apiEndpointCliWiring");
  // 「自己能联网搜索」只在有 Anthropic 或 Responses 地址时算数（ADR 0009）。
  const canSearchWeb = (endpoint.baseUrls ?? []).some(
    (entry) => entry.format === "anthropic_messages" || entry.format === "openai_responses",
  );
  // 头部操作、删除、模型与映射保存的失败共用头部下面一个提示（docs/design.md：每处一个 Alert）。
  let pageError: { title: string; message: string } | null = null;
  if (detail.deleteError !== null) {
    pageError = {
      title: t("settings.apiEndpoints.detail.deleteFailed", { name: endpoint.name }),
      message: detail.deleteError,
    };
  } else if (detail.saveError !== null) {
    pageError = { title: t("settings.apiEndpoints.detail.saveFailed"), message: detail.saveError };
  } else if (formatPins.error !== null) {
    pageError = {
      title: t("settings.apiEndpoints.modelSettings.formatPinFailed"),
      message: formatPins.error,
    };
  } else if (hostEndpoints.actionError !== null) {
    pageError = { title: hostEndpoints.actionError, message: "" };
  }
  return (
    <>
      <ApiEndpointDetailHeader
        endpoint={endpoint}
        now={now}
        isPending={hostEndpoints.pendingEndpointId === endpoint.id}
        isTesting={detail.isTesting}
        isDeleting={detail.isDeleting}
        onToggle={hostEndpoints.setEnabled}
        onResume={hostEndpoints.resume}
        onTest={detail.testConnection}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onAddAnother={onAddAnother}
        onDelete={detail.remove}
      />
      {pageError ? (
        <View style={styles.pageError}>
          <Alert
            variant="error"
            size="sm"
            title={pageError.title}
            description={pageError.message || undefined}
            testID="api-endpoint-detail-error-alert"
          />
        </View>
      ) : null}
      <ApiEndpointConnectionSection
        endpoint={endpoint}
        isKeyOptional={hasManagement}
        testResults={detail.testResults}
        onEdit={onEdit}
      />
      {hasCliWiring && canSearchWeb ? (
        <ApiEndpointWebSearchSection
          value={detail.searchesWeb}
          save={detail.webSearchSave}
          onChange={detail.setSearchesWeb}
        />
      ) : null}
      {hasManagement ? (
        <ApiEndpointModelScopeSection
          scope={detail.modelScope}
          rules={detail.autoPick}
          ruleError={detail.ruleError}
          onChangeScope={detail.changeScope}
          onAddRule={detail.addRule}
          onRemoveRule={detail.removeRule}
        />
      ) : null}
      <ApiEndpointModelsSection
        source={detail.source}
        fetchState={detail.fetchState}
        forgetState={detail.forgetState}
        now={now}
        onFetch={detail.fetchModels}
        onForget={detail.canForgetCatalog ? detail.forgetCatalog : null}
        onChange={detail.changeModels}
        onAdd={detail.addModels}
        onOpenSettings={hasManagement ? setSettingsModelId : null}
        formatPins={formatPins.pins}
        header={nameDisplayRow}
        modelTests={modelTests}
      />
      {hasManagement ? (
        <ApiEndpointModelDefaultsSection
          key={endpoint.id}
          endpoint={endpoint}
          onSave={detail.saveModelSettings}
        />
      ) : null}

      {settingsModelId !== null ? (
        <ApiEndpointModelSettingsSheet
          key={`${endpoint.id}:${settingsModelId}`}
          endpoint={endpoint}
          modelId={settingsModelId}
          onSave={detail.saveModelSettings}
          onClose={closeModelSettings}
        />
      ) : null}
      <ApiEndpointMappingSection
        models={detail.source.models}
        mapping={detail.modelMapping}
        onChange={detail.changeMapping}
      />
    </>
  );
}

/** 详情页的桌面页头：「第三方接口 / 名称」；名称还没到时只显示分区标题。 */
export function ApiEndpointsBreadcrumb({
  serverId,
  endpointId,
  sectionTitle,
  onPressParent,
}: {
  serverId: string;
  endpointId: string;
  sectionTitle: string;
  onPressParent: () => void;
}) {
  const supported = useHostFeatureAvailability(serverId, "apiEndpointGateway");
  if (!supported) {
    return <ScreenTitle testID="settings-detail-header-title">{sectionTitle}</ScreenTitle>;
  }
  return (
    <EndpointBreadcrumb
      serverId={serverId}
      endpointId={endpointId}
      sectionTitle={sectionTitle}
      onPressParent={onPressParent}
    />
  );
}

function EndpointBreadcrumb({
  serverId,
  endpointId,
  sectionTitle,
  onPressParent,
}: {
  serverId: string;
  endpointId: string;
  sectionTitle: string;
  onPressParent: () => void;
}) {
  const { state } = useHostEndpoints(serverId);
  const name = findHostEndpoint(state, endpointId)?.name ?? null;
  if (name === null) {
    return <ScreenTitle testID="settings-detail-header-title">{sectionTitle}</ScreenTitle>;
  }
  return (
    <View style={styles.breadcrumb}>
      <Button
        variant="ghost"
        size="sm"
        style={styles.breadcrumbParent}
        onPress={onPressParent}
        testID="settings-api-endpoints-breadcrumb"
      >
        {sectionTitle}
      </Button>
      <Text style={styles.breadcrumbSeparator}>/</Text>
      <ScreenTitle testID="settings-detail-header-title">{name}</ScreenTitle>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pageError: {
    marginBottom: theme.spacing[6],
  },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  // 文字与左侧图标对齐，悬停底色向外扩。
  breadcrumbParent: {
    paddingHorizontal: theme.spacing[1],
    marginHorizontal: -theme.spacing[1],
  },
  breadcrumbSeparator: {
    color: theme.colors.foregroundExtraMuted,
    ...theme.typeScale.body,
  },
}));
