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
  ApiEndpointBalanceReading,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { ScreenTitle } from "@/components/headers/screen-title";
import { PrimaryTextAlert } from "./primary-text-alert";
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
import { endpointVendorNotices } from "./internal/vendor-status";
import { useVendorStatus } from "./use-vendor-status";
import { ApiEndpointBalanceAutoRefreshSection } from "./balance-auto-refresh-section";
import { useEndpointBalances } from "./use-endpoint-balances";
import { ApiEndpointBalanceSection } from "./balance-section";
import { ApiEndpointRecentProblemsSection } from "./recent-problems-section";
import { useEndpointRecentProblems } from "./use-endpoint-recent-problems";
import {
  AgentApiEndpointsFrame,
  AgentApiEndpointsProfileSection,
  AgentApiEndpointsProfilesFrame,
  AgentApiEndpointsSection,
} from "./agent-section";
import {
  agentSettingsBlocks,
  selectAgentApiEndpointsView,
  type AgentIssueAction,
  type AgentSettingsBlock,
} from "./internal/agent-settings";
import type { ConnectionFormSeed, ConnectionSaveResult } from "./internal/connection-form-model";
import {
  balanceAutoRefreshOf,
  findHostEndpoint,
  type HostEndpointsLoadState,
} from "./internal/host-list";
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
import { accessKeyVendorOf } from "@getpaseo/protocol/api-endpoint/balance-settings";
import { resolveModelFacts } from "@getpaseo/protocol/api-endpoint/model-settings";
import { ApiEndpointModelsSection, type ModelTestsControl } from "./models-section";
import { useEndpointDetail } from "./use-endpoint-detail";
import { useModelTests } from "./use-model-tests";
import { offeredCliTests } from "./internal/model-tests";
import { useFormatPins } from "./use-format-pins";
import { SwitchOffSheet } from "./switch-off-sheet";
import { ApiEndpointWebSearchSection } from "./web-search-section";
import { EndpointIconHostProvider } from "./endpoint-icon";
import { TemplatePickerSheet } from "./template-picker-sheet";
import { ImportAppsSheet } from "./import-apps-sheet";
import { useImportApps } from "./use-import-apps";
import type { OfferedFingerprints } from "./internal/import-picks";
import { ImportDiscoveryBanner } from "./import-discovery-banner";
import { useImportDiscovery } from "./use-import-discovery";
import { useEndpointTemplates } from "./use-endpoint-templates";
import { useHostEndpoints, type UseHostEndpointsResult } from "./use-host-endpoints";
import type { ModelRoleChangeHandler } from "./model-roles-rows";

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
  const now = useClock();
  const endpoints = useHostEndpoints(serverId);
  const { state } = endpoints;
  if (state.status === "loading") {
    return <AgentNotice text={t("settings.apiEndpoints.loading")} />;
  }
  if (state.status === "error") {
    return <AgentNotice text={state.message} />;
  }
  // OMP 每套命名配置一节；只有默认那块时照旧一节，不显示节标题。
  const blocks = agentSettingsBlocks({ provider, ompProfiles: state.ompProfiles });
  const renderBlock = (block: AgentSettingsBlock) => (
    <AgentApiEndpointsBlock
      key={block.settingsKey}
      serverId={serverId}
      provider={provider}
      providerLabel={providerLabel}
      block={block}
      state={state}
      endpoints={endpoints}
      now={now}
    />
  );
  if (blocks.length === 1) {
    return <AgentApiEndpointsFrame>{blocks.map(renderBlock)}</AgentApiEndpointsFrame>;
  }
  return (
    <AgentApiEndpointsProfilesFrame>
      {blocks.map((block) => (
        <AgentApiEndpointsProfileSection
          key={block.settingsKey}
          title={block.profile ?? t("settings.apiEndpoints.agent.defaultProfile")}
          testID={`agent-api-endpoints-profile-${block.settingsKey}`}
        >
          {renderBlock(block)}
        </AgentApiEndpointsProfileSection>
      ))}
    </AgentApiEndpointsProfilesFrame>
  );
}

interface AgentApiEndpointsBlockProps {
  serverId: string;
  provider: string;
  providerLabel: string;
  block: AgentSettingsBlock;
  state: Extract<HostEndpointsLoadState, { status: "ready" }>;
  endpoints: UseHostEndpointsResult;
  now: Date;
}

/** 一块设置（OMP 的一套配置，别的提供方就是它自己）：开关、默认模型等都改 block.settingsKey 那份。 */
function AgentApiEndpointsBlock({
  serverId,
  provider,
  providerLabel: cliLabel,
  block,
  state,
  endpoints,
  now,
}: AgentApiEndpointsBlockProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { setAgentSettings, runIssueAction } = endpoints;
  const { settingsKey, profile } = block;
  // 命名配置那块的文字里带上配置名，如「Oh My Pi · work 能用……」。
  const providerLabel =
    profile === null
      ? cliLabel
      : t("settings.apiEndpoints.agent.profileAgent", { agent: cliLabel, profile });
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18.
  const hasIssues = useHostFeature(serverId, "apiEndpointCliWiring");
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  // 指定某一家的默认模型取聊天模型选择器同一份分组（「接口标识/模型名」）。
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18. 老主机不收「接口标识/模型名」的默认模型。
  const providerEntry = providerEntries?.find((candidate) => candidate.provider === provider);
  // 命名配置的分组在 OMP 条目的 ompProfileModelGroups 里（OMP 自己的对话选单只看默认那块）。
  const endpointModelGroups = useMemo(() => {
    if (!hasIssues) return null;
    if (profile !== null) return providerEntry?.ompProfileModelGroups?.[settingsKey] ?? null;
    return providerEntry?.apiEndpointModelGroups ?? null;
  }, [hasIssues, profile, providerEntry, settingsKey]);
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
  const isOwnConnection = lastConnection?.provider === settingsKey;
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
      setAgentSettings(settingsKey, { enabled });
    },
    [hasIssues, settingsKey, setAgentSettings],
  );
  const closeSwitchOff = useCallback(() => setIsConfirmingSwitchOff(false), []);
  const handleDefaultModelChange = useCallback(
    (defaultModelId: string) => setAgentSettings(settingsKey, { enabled: true, defaultModelId }),
    [settingsKey, setAgentSettings],
  );
  const handleDefaultThinkingChange = useCallback(
    (defaultThinkingOptionId: string | null) =>
      setAgentSettings(settingsKey, { enabled: true, defaultThinkingOptionId }),
    [settingsKey, setAgentSettings],
  );
  const handleUltraCodeChange = useCallback(
    (usesUltraCode: boolean) => setAgentSettings(settingsKey, { enabled: true, usesUltraCode }),
    [settingsKey, setAgentSettings],
  );
  const handleBackgroundModelChange = useCallback(
    (backgroundModelId: string | null) =>
      setAgentSettings(settingsKey, { enabled: true, backgroundModelId }),
    [settingsKey, setAgentSettings],
  );
  const handleSubagentModelChange = useCallback(
    (subagentModelId: string | null) =>
      setAgentSettings(settingsKey, { enabled: true, subagentModelId }),
    [settingsKey, setAgentSettings],
  );
  const handleSubagentThinkingChange = useCallback(
    (subagentThinkingOptionId: string | null) =>
      setAgentSettings(settingsKey, { enabled: true, subagentThinkingOptionId }),
    [settingsKey, setAgentSettings],
  );
  const handleMemoryModelChange = useCallback(
    (memoryModelId: string | null) =>
      setAgentSettings(settingsKey, { enabled: true, memoryModelId }),
    [settingsKey, setAgentSettings],
  );
  const handleForcedSubagentModelChange = useCallback(
    (forcedSubagentModelId: string | null) =>
      setAgentSettings(settingsKey, { enabled: true, forcedSubagentModelId }),
    [settingsKey, setAgentSettings],
  );
  const handleAnySubagentModelChange = useCallback(
    (allowsAnySubagentModel: boolean) =>
      setAgentSettings(settingsKey, { enabled: true, allowsAnySubagentModel }),
    [settingsKey, setAgentSettings],
  );
  const handleModelRoleChange = useCallback<ModelRoleChangeHandler>(
    (role, value) =>
      setAgentSettings(settingsKey, { enabled: true, modelRoles: { [role]: value } }),
    [settingsKey, setAgentSettings],
  );
  // 总开关开着、关着都能设，开关保持原样。
  const isEnabled = state.agents[settingsKey]?.enabled === true;
  const handleKeepClaudeAiLoginChange = useCallback(
    (keepsClaudeAiLogin: boolean) =>
      setAgentSettings(settingsKey, { enabled: isEnabled, keepsClaudeAiLogin }),
    [isEnabled, settingsKey, setAgentSettings],
  );
  const handleIssueAction = useCallback(
    (action: AgentIssueAction) => {
      if (action === "switchToOfficial") {
        setIsConfirmingSwitchOff(true);
        return;
      }
      runIssueAction(settingsKey, action);
    },
    [settingsKey, runIssueAction],
  );
  const seenReopen = useReopenSeenStore(
    (store) => store.seen[reopenSeenKey({ serverId, provider: settingsKey })] ?? null,
  );
  const markReopenSeen = useReopenSeenStore((store) => store.markSeen);
  const handleDismissReopen = useCallback(
    (signature: string) => markReopenSeen({ serverId, provider: settingsKey, signature }),
    [markReopenSeen, settingsKey, serverId],
  );
  const issueActions = useMemo(() => {
    if (!hasIssues) return null;
    const pending = endpoints.pendingIssueAction;
    const failed = endpoints.issueActionError;
    return {
      pendingAction: pending?.provider === settingsKey ? pending.action : null,
      actionError: failed?.provider === settingsKey ? failed : null,
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
    settingsKey,
  ]);
  const handleManage = useCallback(
    () => router.push(buildSettingsHostSectionRoute(serverId, "api-endpoints")),
    [router, serverId],
  );

  const handleDismissError = useCallback(
    () => endpoints.dismissAgentActionError(settingsKey),
    [endpoints, settingsKey],
  );
  const actionFailure = endpoints.agentActionErrors[settingsKey] ?? null;

  return (
    <>
      <AgentApiEndpointsSection
        providerLabel={providerLabel}
        testID={`agent-api-endpoints-block-${settingsKey}`}
        view={selectAgentApiEndpointsView({
          state,
          provider,
          settingsKey,
          endpointModelGroups,
          lockedThinkingOptionId,
          subagentThinkingOptions,
          sideModelOptions,
          now,
        })}
        busy={endpoints.pendingAgent === settingsKey}
        actionError={actionFailure?.message ?? null}
        actionErrorCode={actionFailure?.code ?? null}
        onDismissError={handleDismissError}
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
        onModelRoleChange={handleModelRoleChange}
        onManage={handleManage}
        // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18. 老主机不认这个选项。
        onKeepClaudeAiLoginChange={hasIssues ? handleKeepClaudeAiLoginChange : null}
        issueActions={issueActions}
      />
      {isConfirmingSwitchOff ? (
        <SwitchOffSheet
          client={client}
          serverId={serverId}
          provider={settingsKey}
          providerLabel={providerLabel}
          onClose={closeSwitchOff}
        />
      ) : null}
    </>
  );
}

// 冷却倒计时按分钟显示；列表数据没变时 React Query 不会重渲染，自己每半分钟取一次时间。
const CLOCK_TICK_MS = 30_000;
const NO_BALANCES: ReadonlyMap<string, ApiEndpointBalanceReading> = new Map();

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
    | "checkBalance"
    | "detectBalanceUrl"
    | "revealBalanceToken"
    | "revealAccessKey"
  >;
  setSheet: Dispatch<SetStateAction<ConnectionSheetState>>;
  onSaved: (result: Extract<ConnectionSaveResult, { status: "saved" }>) => void;
  // 模板列表里点了已加过的模板：打开已有那家。
  onOpenEndpoint: (endpointId: string) => void;
}) {
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机新建时要求 key，也读不回 key，没有模板，
  // 也不认请求头、附加请求体与 key 放哪个头。
  const hasManagement = useHostFeature(serverId, "apiEndpointManagement");
  // COMPAT(apiEndpointBalance): added in v0.17.0, remove gate after 2027-04-22. 老主机不认 balance 与 check_balance。
  const hasBalance = useHostFeature(serverId, "apiEndpointBalance");
  // COMPAT(gatewayLedger): added in v0.17.0, remove gate after 2027-04-23.
  const hasLedger = useHostFeature(serverId, "gatewayLedger");
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
      canSetRequestExtras={hasManagement}
      canSetBalance={hasManagement && hasBalance}
      canSetPriceMultiplier={hasManagement && hasLedger}
      templates={templates.status === "ready" ? templates.templates : []}
      onBack={sheet.backToPicker ? handleBack : null}
      onSave={endpoints.save}
      onDetect={endpoints.detect}
      onRevealKey={endpoints.revealKey}
      onStoreIcon={endpoints.storeIcon}
      onFetchSiteIcon={endpoints.fetchSiteIcon}
      onFetchModels={endpoints.fetchModels}
      onTestConnection={endpoints.testConnection}
      onCheckBalance={endpoints.checkBalance}
      onDetectBalanceUrl={endpoints.detectBalanceUrl}
      onRevealBalanceToken={endpoints.revealBalanceToken}
      onRevealAccessKey={endpoints.revealAccessKey}
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

/** 开着的接口；列表还没读到时为 null。 */
function enabledEndpointIds(state: UseHostEndpointsResult["state"]): string[] | null {
  if (state.status !== "ready") return null;
  return state.endpoints
    .filter((endpoint) => endpoint.enabled !== false)
    .map((endpoint) => endpoint.id);
}

function ApiEndpointsListPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const now = useClock();
  const endpoints = useHostEndpoints(serverId);
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机没有 set_order、长对话设置、已禁用的模型与接口名显示方式。
  const hasManagement = useHostFeature(serverId, "apiEndpointManagement");
  const [sheet, setSheet] = useState<ConnectionSheetState>(null);
  // 导入窗口：null 关着；从发现提示「查看」打开时带提示里的那几条，只选上它们。
  const [importOpen, setImportOpen] = useState<ImportOpen | null>(null);
  const closeImport = useCallback(() => setImportOpen(null), []);
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机没有发现提示。
  const discovery = useImportDiscovery({ serverId, enabled: hasManagement });
  const reviewDiscovery = useCallback(
    () =>
      setImportOpen({
        offered: new Set(discovery.candidates.map((candidate) => candidate.fingerprint)),
      }),
    [discovery.candidates],
  );
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  // 这一页开着时每 5 分钟问一次厂商官方状态页；问不到只是不出提示。
  const vendorStatus = useVendorStatus({ serverId });
  const vendorNotices = useMemo(() => endpointVendorNotices(vendorStatus), [vendorStatus]);
  // 打开这一页时读开着的接口的余额，开关开着时每分钟再读；关着的接口只在它自己的详情页读。
  const enabledIds = useMemo(() => enabledEndpointIds(endpoints.state), [endpoints.state]);
  const balances = useEndpointBalances({
    serverId,
    endpointIds: enabledIds,
    autoRefresh: balanceAutoRefreshOf(endpoints.state),
  });
  const balanceReadings = balances.status === "ready" ? balances.readings : NO_BALANCES;
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机不发 key 打码与默认模型落在哪家。
  const management = useMemo<ListManagement | undefined>(
    () =>
      hasManagement
        ? {
            vendorNotices,
            balances: balanceReadings,
            providerLabel: (provider) => resolveProviderLabel(provider, providerEntries),
            onOpenProvider: (provider) =>
              router.push(buildProviderSettingsRoute(serverId, provider)),
            onDuplicate: (endpoint) =>
              setSheet({ kind: "form", seed: duplicateSeed(endpoint, t), backToPicker: false }),
            onImport: () => setImportOpen({ offered: null }),
          }
        : undefined,
    [hasManagement, providerEntries, router, serverId, t, vendorNotices, balanceReadings],
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

  const hasNoEndpointsYet =
    endpoints.state.status === "ready" && endpoints.state.endpoints.length === 0;

  return (
    <>
      {hasManagement ? (
        <ImportDiscoveryBanner
          candidates={discovery.candidates}
          ignoreState={discovery.ignoreState}
          hasNoEndpointsYet={hasNoEndpointsYet}
          onReview={reviewDiscovery}
          onIgnore={discovery.ignore}
        />
      ) : null}
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
      {/* 主机没声明 apiEndpointBalance 时余额为 off，也就没有自动刷新开关。 */}
      {balances.status !== "off" && endpoints.state.status === "ready" ? (
        <ApiEndpointBalanceAutoRefreshSection
          value={endpoints.state.balanceAutoRefresh}
          onSave={endpoints.setBalanceAutoRefresh}
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
      {importOpen ? (
        <ImportSheet serverId={serverId} offered={importOpen.offered} onClose={closeImport} />
      ) : null}
    </>
  );
}

interface ImportOpen {
  // 发现提示里的那几条；从「导入」按钮打开时为 null，照常默认选择。
  offered: OfferedFingerprints;
}

/** 从别的软件导入：开着时扫一次（含 OpenCode），导入成功就关上。 */
function ImportSheet({
  serverId,
  offered,
  onClose,
}: {
  serverId: string;
  offered: OfferedFingerprints;
  onClose: () => void;
}) {
  const { scan, retryScan, importPicked } = useImportApps({ serverId });
  const handleImport = useCallback(
    async (picks: Parameters<typeof importPicked>[0]) => {
      const result = await importPicked(picks);
      if (result.status === "imported") onClose();
      return result;
    },
    [importPicked, onClose],
  );
  return (
    <ImportAppsSheet
      scan={scan}
      offered={offered}
      onRetry={retryScan}
      onImport={handleImport}
      onClose={onClose}
    />
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
  // 余额分区的「填写余额查询地址」：打开编辑窗口，定位到「高级」里的余额栏。
  const handleFillBalanceUrl = useCallback(() => {
    if (!endpoint) return;
    setSheet({
      kind: "form",
      seed: { mode: "edit", endpoint, focus: "balance" },
      backToPicker: false,
    });
  }, [endpoint]);
  // 余额分区的「填写 AccessKey」：打开编辑窗口，定位到「高级」里的 AccessKey 两栏。
  const handleFillAccessKey = useCallback(() => {
    if (!endpoint) return;
    setSheet({
      kind: "form",
      seed: { mode: "edit", endpoint, focus: "access_key" },
      backToPicker: false,
    });
  }, [endpoint]);
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
        onFillBalanceUrl={canDuplicate ? handleFillBalanceUrl : null}
        onFillAccessKey={canDuplicate ? handleFillAccessKey : null}
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
  onFillBalanceUrl,
  onFillAccessKey,
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
  // 编辑窗口有「高级」时才有（主机声明了 apiEndpointManagement）；余额分区本身只在声明了 apiEndpointBalance 时出现。
  onFillBalanceUrl: (() => void) | null;
  onFillAccessKey: (() => void) | null;
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
  // 打开详情页时读这家的余额（关着的接口也读），开关开着时每分钟再读。
  const balanceIds = useMemo(() => [endpoint.id], [endpoint.id]);
  const balances = useEndpointBalances({
    serverId,
    endpointIds: balanceIds,
    autoRefresh: balanceAutoRefreshOf(hostEndpoints.state),
  });
  // 「最近异常」：主机有中转站账本时读，开着时随 usage.updated 重读。
  const recentProblems = useEndpointRecentProblems({ serverId, endpointId: endpoint.id });
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
  const modelTests = useMemo<ModelTestsControl | null>(() => {
    // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机不认 test_models。
    if (!hasManagement) return null;
    return {
      tests: modelTestsState.tests,
      run: modelTestsState.run,
      onTestAll: modelTestsState.testAll,
      onTestOne: modelTestsState.testOne,
      onTestOneAs: modelTestsState.testOneAs,
      testsAs: offeredCliTests(endpoint.testsAs),
      onCancel: modelTestsState.cancel,
      factsOf: (modelId) => {
        const auto = endpoint.modelFacts?.[modelId] ?? {};
        const facts = resolveModelFacts({ settings: endpoint.modelSettings, modelId, auto });
        return { name: facts.name, context: facts.context };
      },
    };
  }, [endpoint, hasManagement, modelTestsState]);
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
          <PrimaryTextAlert
            variant="error"
            title={pageError.title}
            description={pageError.message}
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
      {balances.status === "off" ? null : (
        <ApiEndpointBalanceSection
          endpointId={endpoint.id}
          hasApiKey={endpoint.hasApiKey}
          balances={balances}
          now={now}
          onFillBalanceUrl={onFillBalanceUrl}
          accessKeyVendor={accessKeyVendorOf(
            (endpoint.baseUrls ?? [{ url: endpoint.baseUrl }]).map((entry) => entry.url),
          )}
          onFillAccessKey={onFillAccessKey}
        />
      )}
      {recentProblems.status === "off" ? null : (
        <ApiEndpointRecentProblemsSection
          endpointId={endpoint.id}
          endpointName={endpoint.name}
          problems={recentProblems}
        />
      )}
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
