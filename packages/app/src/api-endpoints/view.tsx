import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { buildApiEndpointSettingsRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { ApiEndpointConnectionSheet } from "./connection-form-sheet";
import { ApiEndpointConnectionSection } from "./connection-section";
import { ApiEndpointDetailHeader } from "./detail-header";
import { ApiEndpointsListSection, NoticeCard } from "./host-list-section";
import { AgentApiEndpointsFrame, AgentApiEndpointsSection } from "./agent-section";
import { selectAgentApiEndpointsView, type AgentIssueAction } from "./internal/agent-settings";
import type { ConnectionFormSeed, ConnectionSaveResult } from "./internal/connection-form-model";
import { findHostEndpoint } from "./internal/host-list";
import { ApiEndpointMappingSection } from "./mapping-section";
import { ApiEndpointModelsSection } from "./models-section";
import { useEndpointDetail } from "./use-endpoint-detail";
import { ApiEndpointWebSearchSection } from "./web-search-section";
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
  const lastConnection = endpoints.lastConnection;
  const isOwnConnection = lastConnection?.provider === provider;
  const connection = isOwnConnection ? lastConnection.connection : null;

  const handleToggle = useCallback(
    (enabled: boolean) => setAgentSettings(provider, { enabled }),
    [provider, setAgentSettings],
  );
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
  // 总开关开着、关着都能设，开关保持原样。
  const isEnabled = state.status === "ready" && state.agents[provider]?.enabled === true;
  const handleKeepClaudeAiLoginChange = useCallback(
    (keepsClaudeAiLogin: boolean) =>
      setAgentSettings(provider, { enabled: isEnabled, keepsClaudeAiLogin }),
    [isEnabled, provider, setAgentSettings],
  );
  const handleIssueAction = useCallback(
    (action: AgentIssueAction) => runIssueAction(provider, action),
    [provider, runIssueAction],
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
    };
  }, [
    endpoints.dismissIssueActionError,
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
    <AgentApiEndpointsSection
      providerLabel={providerLabel}
      view={selectAgentApiEndpointsView({
        state,
        provider,
        endpointModelGroups,
        lockedThinkingOptionId,
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
      onManage={handleManage}
      // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18. 老主机不认这个选项。
      onKeepClaudeAiLoginChange={hasIssues ? handleKeepClaudeAiLoginChange : null}
      issueActions={issueActions}
    />
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

type ConnectionSheetState = { seed: ConnectionFormSeed } | null;

function ConnectionSheet({
  sheet,
  endpoints,
  onSaved,
  onClose,
}: {
  sheet: ConnectionSheetState;
  endpoints: Pick<UseHostEndpointsResult, "save" | "detect">;
  onSaved: (result: Extract<ConnectionSaveResult, { status: "saved" }>) => void;
  onClose: () => void;
}) {
  if (!sheet) return null;
  const { seed } = sheet;
  return (
    <ApiEndpointConnectionSheet
      key={seed.mode === "edit" ? `edit-${seed.endpoint.id}` : "create"}
      seed={seed}
      onSave={endpoints.save}
      onDetect={endpoints.detect}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/** 设置 › 主机 › 第三方接口：整台主机共用的接口列表。 */
export function ApiEndpointsPage({ serverId }: { serverId: string }) {
  return (
    <GatewayGate serverId={serverId}>
      <ApiEndpointsListPage serverId={serverId} />
    </GatewayGate>
  );
}

function ApiEndpointsListPage({ serverId }: { serverId: string }) {
  const router = useRouter();
  const now = useClock();
  const endpoints = useHostEndpoints(serverId);
  const [sheet, setSheet] = useState<ConnectionSheetState>(null);

  const handleAdd = useCallback(() => setSheet({ seed: { mode: "create" } }), []);
  const handleClose = useCallback(() => setSheet(null), []);
  const handleOpen = useCallback(
    (endpoint: ApiEndpoint) => router.push(buildApiEndpointSettingsRoute(serverId, endpoint.id)),
    [router, serverId],
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
      />
      <ConnectionSheet
        sheet={sheet}
        endpoints={endpoints}
        onSaved={handleSaved}
        onClose={handleClose}
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
      <ApiEndpointDetailContent serverId={serverId} endpointId={endpointId} />
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

  const handleEdit = useCallback(() => {
    if (endpoint) setSheet({ seed: { mode: "edit", endpoint } });
  }, [endpoint]);
  const handleClose = useCallback(() => setSheet(null), []);

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
      />
      <ConnectionSheet
        sheet={sheet}
        endpoints={endpoints}
        onSaved={handleClose}
        onClose={handleClose}
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
}: {
  serverId: string;
  endpoint: ApiEndpoint;
  allEndpoints: ApiEndpoint[];
  agents: Record<string, ApiEndpointAgentSettings>;
  hostEndpoints: UseHostEndpointsResult;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const now = useClock();
  const detail = useEndpointDetail({ serverId, endpoint, endpoints: allEndpoints, agents });
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
      <ApiEndpointModelsSection
        source={detail.source}
        fetchState={detail.fetchState}
        now={now}
        onFetch={detail.fetchModels}
        onChange={detail.changeModels}
        onAdd={detail.addModel}
      />
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
