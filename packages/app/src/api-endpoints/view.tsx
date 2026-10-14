import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Button } from "@/components/ui/button";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { buildApiEndpointSettingsRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { ApiEndpointConnectionSheet } from "./connection-form-sheet";
import { ApiEndpointConnectionSection } from "./connection-section";
import { ApiEndpointFormSheet } from "./form-sheet";
import { ApiEndpointsListSection, NoticeCard } from "./host-list-section";
import { ApiEndpointsSection } from "./index";
import type { ConnectionFormSeed, ConnectionSaveResult } from "./internal/connection-form-model";
import { findHostEndpoint } from "./internal/host-list";
import type { ApiEndpointFormSeed } from "./internal/form-model";
import { useApiEndpoints } from "./use-api-endpoints";
import { useHostEndpoints, type UseHostEndpointsResult } from "./use-host-endpoints";

/*
 * 运行时接线：客户端、查询、确认框、toast。surface（index.tsx）保持纯 props，方便 jsdom 测试。
 * 调用方负责能力门控：只在主机声明了 apiEndpoints、provider 受支持时渲染。
 */

export function ApiEndpointsView({
  serverId,
  provider,
  providerLabel,
}: {
  serverId: string;
  provider: string;
  providerLabel: string;
}) {
  const {
    state,
    busy,
    actionError,
    dismissActionError,
    activate,
    reapply,
    remove,
    save,
    fetchModels,
    testConnection,
  } = useApiEndpoints({
    serverId,
    provider,
    providerLabel,
  });
  const [form, setForm] = useState<ApiEndpointFormSeed | null>(null);

  const handleAdd = useCallback(() => setForm({ mode: "create", provider }), [provider]);
  const handleEdit = useCallback(
    (endpoint: ApiEndpoint) => setForm({ mode: "edit", provider, endpoint }),
    [provider],
  );
  const handleCloseForm = useCallback(() => setForm(null), []);

  return (
    <>
      <ApiEndpointsSection
        providerLabel={providerLabel}
        state={state}
        busy={busy}
        actionError={actionError}
        onDismissError={dismissActionError}
        onActivate={activate}
        onReapply={reapply}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={remove}
      />
      {form ? (
        <ApiEndpointFormSheet
          key={form.mode === "edit" ? `edit-${form.endpoint.id}` : "create"}
          seed={form}
          onSave={save}
          onFetchModels={fetchModels}
          onTestConnection={testConnection}
          onClose={handleCloseForm}
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

/** 接口详情页。本票只有「连接」区；模型、档位映射与头部操作在 09 票补上。 */
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
  if (!endpoint) {
    return (
      <NoticeCard text={t("settings.apiEndpoints.loading")} testID="api-endpoint-detail-loading" />
    );
  }
  return (
    <View testID="api-endpoint-detail">
      <ApiEndpointConnectionSection endpoint={endpoint} onEdit={handleEdit} />
      <ConnectionSheet
        sheet={sheet}
        endpoints={endpoints}
        onSaved={handleClose}
        onClose={handleClose}
      />
    </View>
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
