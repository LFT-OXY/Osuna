import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Text, View } from "react-native";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CircleAlert, House, TriangleAlert, Workflow } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  WorkspaceLogicMapReadResult,
  WorkspaceLogicMapSummary,
} from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { ZoomableViewport } from "@/components/zoomable-viewport";
import type { ViewportFitOptions, ViewportPoint } from "@/components/zoomable-viewport/geometry";
import { useReplicaQuery } from "@/data/query";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { LogicMapBackdrop } from "./backdrop";
import {
  LOGIC_MAP_GLYPH_COLOR,
  LOGIC_MAP_ICON_SIZE,
  LOGIC_MAP_ICON_STROKE,
  LogicMapCanvas,
} from "./canvas";
import { layoutLogicMapLayer, type LogicMapLayout } from "./layout";

export type LogicMapClient = Pick<
  DaemonClient,
  "listWorkspaceLogicMaps" | "getWorkspaceLogicMap" | "observeEvents"
>;

/** fitWidth：按面板宽度缩放、从顶部看起；startAtActualSize：原大、把起点放在顶部正中。 */
export type LogicMapInitialView = "fitWidth" | "startAtActualSize";

/** 打开面板时先看到的视图。 */
export const LOGIC_MAP_INITIAL_VIEW: LogicMapInitialView = "fitWidth";

const CHANGED_EVENT = "workspace.logic_map.changed";
const VIEWPORT_MIN_SCALE = 0.25;
const VIEWPORT_MAX_SCALE = 4;
const START_TOP_OFFSET = 16;

function logicMapQueryRoot(serverId: string, workspaceId: string) {
  return ["logicMap", serverId, workspaceId] as const;
}

function logicMapListQueryKey(serverId: string, workspaceId: string) {
  return [...logicMapQueryRoot(serverId, workspaceId), "list"] as const;
}

function logicMapReadQueryKey(serverId: string, workspaceId: string, mapName: string) {
  return [...logicMapQueryRoot(serverId, workspaceId), "map", mapName] as const;
}

/** 用户在下拉框里挑过的优先，其次是当前对话维护的那张，再次是列表里的第一张。 */
function resolveSelectedMapName(
  maps: readonly WorkspaceLogicMapSummary[],
  picked: string | null,
  conversationMapName: string | null,
): string | null {
  const names = maps.map((map) => map.name);
  if (picked && names.includes(picked)) return picked;
  if (conversationMapName && names.includes(conversationMapName)) return conversationMapName;
  return names[0] ?? null;
}

export interface LogicMapPanelSurfaceProps {
  serverId: string;
  workspaceId: string;
  client: LogicMapClient | null;
  isConnected: boolean;
  /** 主机是否支持逻辑图；还没收到 server_info 时为 null。 */
  supported: boolean | null;
  /** 当前对话（主区域聚焦的 Agent 或草稿）维护的图。 */
  conversationMapName: string | null;
}

export function LogicMapPanelSurface({
  serverId,
  workspaceId,
  client,
  isConnected,
  supported,
  conversationMapName,
}: LogicMapPanelSurfaceProps) {
  const { t } = useTranslation();
  if (!client || !isConnected) {
    return (
      <StateCanvas testID="logic-map-disconnected">
        <StateCard
          tone="neutral"
          Glyph={CircleAlert}
          title={t("workspace.terminal.hostDisconnected")}
        />
      </StateCanvas>
    );
  }
  if (supported === null) {
    return <LoadingCanvas />;
  }
  // COMPAT(logicMap): added in v0.17.0, remove gate after 2027-04-19.
  if (!supported) {
    return (
      <StateCanvas testID="logic-map-host-outdated">
        <StateCard
          tone="neutral"
          Glyph={CircleAlert}
          title={t("logicMap.panel.hostOutdated.title")}
          body={t("logicMap.panel.hostOutdated.body")}
        />
      </StateCanvas>
    );
  }
  return (
    <LogicMapPanelContent
      serverId={serverId}
      workspaceId={workspaceId}
      client={client}
      conversationMapName={conversationMapName}
    />
  );
}

function LogicMapPanelContent({
  serverId,
  workspaceId,
  client,
  conversationMapName,
}: {
  serverId: string;
  workspaceId: string;
  client: LogicMapClient;
  conversationMapName: string | null;
}) {
  const { t } = useTranslation();
  useLogicMapChangeEvents({ client, serverId, workspaceId });
  const [pickedMapName, setPickedMapName] = useState<string | null>(null);
  const listQuery = useReplicaQuery<WorkspaceLogicMapSummary[]>({
    queryKey: logicMapListQueryKey(serverId, workspaceId),
    pushEvent: CHANGED_EVENT,
    queryFn: () => client.listWorkspaceLogicMaps(workspaceId),
  });
  const maps = listQuery.data;
  useRefreshListForNewConversationMap({ maps, conversationMapName, refetch: listQuery.refetch });
  const selectedMapName = maps
    ? resolveSelectedMapName(maps, pickedMapName, conversationMapName)
    : null;
  const readQuery = useReplicaQuery<WorkspaceLogicMapReadResult>({
    queryKey: logicMapReadQueryKey(serverId, workspaceId, selectedMapName ?? ""),
    pushEvent: CHANGED_EVENT,
    queryFn: selectedMapName
      ? () => client.getWorkspaceLogicMap({ workspaceId, mapName: selectedMapName })
      : skipToken,
  });
  const result = selectedMapName ? readQuery.data : undefined;
  const layout = useMemo(
    () => (result?.kind === "ok" ? layoutLogicMapLayer(result.map, null) : null),
    [result],
  );

  if (listQuery.isError) {
    return (
      <StateCanvas testID="logic-map-list-failed">
        <StateCard
          tone="failure"
          Glyph={TriangleAlert}
          title={t("logicMap.panel.listFailed")}
          body={getErrorMessage(listQuery.error)}
          onRetry={listQuery.refetch}
        />
      </StateCanvas>
    );
  }
  if (!maps) {
    return <LoadingCanvas />;
  }
  if (maps.length === 0 || !selectedMapName) {
    return (
      <StateCanvas testID="logic-map-empty">
        <StateCard
          tone="step"
          Glyph={Workflow}
          title={t("logicMap.panel.empty.title")}
          body={t("logicMap.panel.empty.body")}
        />
      </StateCanvas>
    );
  }
  return (
    <View style={styles.panel}>
      <LogicMapHeader
        maps={maps}
        selectedMapName={selectedMapName}
        nodeCount={layout?.nodes.length ?? null}
        onSelect={setPickedMapName}
      />
      <LogicMapBody
        mapName={selectedMapName}
        result={result}
        layout={layout}
        error={readQuery.isError ? readQuery.error : null}
        onRetry={readQuery.refetch}
      />
    </View>
  );
}

/**
 * Agent 改了图之后 daemon 推送变更，按图名让列表和那张图重新读取。重新连上时这期间的推送已经丢了，
 * 所以把这个 workspace 的逻辑图全部重读一遍。
 */
function useLogicMapChangeEvents({
  client,
  serverId,
  workspaceId,
}: {
  client: LogicMapClient;
  serverId: string;
  workspaceId: string;
}) {
  const queryClient = useQueryClient();
  const subscribedBeforeRef = useRef(false);
  useEffect(() => {
    if (subscribedBeforeRef.current) {
      void queryClient.invalidateQueries({ queryKey: logicMapQueryRoot(serverId, workspaceId) });
    }
    subscribedBeforeRef.current = true;
    const observation = client.observeEvents([CHANGED_EVENT]);
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== CHANGED_EVENT || message.payload.workspaceId !== workspaceId) return;
        void queryClient.invalidateQueries({
          queryKey: logicMapListQueryKey(serverId, workspaceId),
        });
        void queryClient.invalidateQueries({
          queryKey: logicMapReadQueryKey(serverId, workspaceId, message.payload.mapName),
        });
      },
    });
    return () => {
      void observation.release().catch(() => {
        /* The socket is gone; the daemon drops the subscription with it. */
      });
    };
  }, [client, queryClient, serverId, workspaceId]);
}

/** 对话刚开开关建了新图、列表还是旧的：重读一次列表，同一张图只重读一次。 */
function useRefreshListForNewConversationMap({
  maps,
  conversationMapName,
  refetch,
}: {
  maps: readonly WorkspaceLogicMapSummary[] | undefined;
  conversationMapName: string | null;
  refetch: () => unknown;
}) {
  const refreshedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!maps || !conversationMapName) return;
    if (maps.some((map) => map.name === conversationMapName)) return;
    if (refreshedForRef.current === conversationMapName) return;
    refreshedForRef.current = conversationMapName;
    void refetch();
  }, [conversationMapName, maps, refetch]);
}

function LogicMapHeader({
  maps,
  selectedMapName,
  nodeCount,
  onSelect,
}: {
  maps: readonly WorkspaceLogicMapSummary[];
  selectedMapName: string;
  nodeCount: number | null;
  onSelect: (mapName: string) => void;
}) {
  const { t } = useTranslation();
  const titleOf = useCallback(
    (map: WorkspaceLogicMapSummary | undefined) => map?.title ?? t("logicMap.panel.untitled"),
    [t],
  );
  const selectedTitle = titleOf(maps.find((map) => map.name === selectedMapName));
  return (
    <PaneContentToolbar style={styles.header} testID="logic-map-header">
      <View style={styles.picker}>
        <DropdownMenu>
          <DropdownTrigger
            size="xs"
            accessibilityLabel={t("logicMap.panel.pickerLabel", { title: selectedTitle })}
            testID="logic-map-picker"
          >
            {selectedTitle}
          </DropdownTrigger>
          <DropdownMenuContent side="bottom" align="start" width={240} scrollable>
            {maps.map((map) => (
              <LogicMapPickerItem
                key={map.name}
                mapName={map.name}
                title={titleOf(map)}
                selected={map.name === selectedMapName}
                onSelect={onSelect}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {nodeCount !== null ? (
        <Text style={styles.nodeCount} numberOfLines={1}>
          {t(nodeCount === 1 ? "logicMap.panel.nodeCountOne" : "logicMap.panel.nodeCountMany", {
            count: nodeCount,
          })}
        </Text>
      ) : null}
    </PaneContentToolbar>
  );
}

function LogicMapPickerItem({
  mapName,
  title,
  selected,
  onSelect,
}: {
  mapName: string;
  title: string;
  selected: boolean;
  onSelect: (mapName: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(mapName), [mapName, onSelect]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {title}
    </DropdownMenuItem>
  );
}

function LogicMapBody({
  mapName,
  result,
  layout,
  error,
  onRetry,
}: {
  mapName: string;
  result: WorkspaceLogicMapReadResult | undefined;
  layout: LogicMapLayout | null;
  error: Error | null;
  onRetry: () => unknown;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <StateCanvas testID="logic-map-read-failed">
        <StateCard
          tone="failure"
          Glyph={TriangleAlert}
          title={t("logicMap.panel.unreadable")}
          body={getErrorMessage(error)}
          onRetry={onRetry}
        />
      </StateCanvas>
    );
  }
  if (!result) {
    return <LoadingCanvas />;
  }
  if (result.kind === "corrupt") {
    return (
      <StateCanvas testID="logic-map-corrupt">
        <StateCard
          tone="failure"
          Glyph={TriangleAlert}
          title={t("logicMap.panel.unreadable")}
          body={t("logicMap.panel.corruptDetail", {
            map: mapName,
            file: result.file,
            problem: result.problem,
          })}
        />
      </StateCanvas>
    );
  }
  if (result.kind === "error") {
    return (
      <StateCanvas testID="logic-map-read-failed">
        <StateCard
          tone="failure"
          Glyph={TriangleAlert}
          title={t("logicMap.panel.unreadable")}
          body={result.message}
        />
      </StateCanvas>
    );
  }
  if (!layout || layout.nodes.length === 0) {
    return <NewMapCanvas />;
  }
  return <LogicMapViewport layout={layout} initialView={LOGIC_MAP_INITIAL_VIEW} />;
}

const FIT_WIDTH: ViewportFitOptions = { mode: "width", maxFitScale: 1 };
const ACTUAL_SIZE: ViewportFitOptions = { mode: "natural" };

function LogicMapViewport({
  layout,
  initialView,
}: {
  layout: LogicMapLayout;
  initialView: LogicMapInitialView;
}) {
  const { t } = useTranslation();
  const contentSize = useMemo(
    () => ({ width: layout.width, height: layout.height }),
    [layout.height, layout.width],
  );
  const initialTopCenter = useMemo<ViewportPoint>(() => {
    const start = layout.nodes.find((node) => node.id === layout.startNodeId);
    if (initialView === "startAtActualSize" && start) {
      return { x: start.x + start.width / 2, y: Math.max(0, start.y - START_TOP_OFFSET) };
    }
    return { x: layout.width / 2, y: 0 };
  }, [initialView, layout]);
  return (
    <LogicMapBackdrop testID="logic-map-canvas">
      <ZoomableViewport
        accessibilityLabel={t("logicMap.panel.canvas")}
        contentSize={contentSize}
        fit={initialView === "fitWidth" ? FIT_WIDTH : ACTUAL_SIZE}
        initialTopCenter={initialTopCenter}
        renderAtContentSize
        panWithinViewport
        minScale={VIEWPORT_MIN_SCALE}
        maxScale={VIEWPORT_MAX_SCALE}
        wheelActivation="modifier"
        wheelPan
        testID="logic-map-viewport"
      >
        <LogicMapCanvas layout={layout} />
      </ZoomableViewport>
    </LogicMapBackdrop>
  );
}

type StateTone = "neutral" | "failure" | "step";

interface StateGlyphProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function StateCanvas({ children, testID }: { children: React.ReactNode; testID: string }) {
  return (
    <LogicMapBackdrop>
      <View style={styles.stateRegion} testID={testID}>
        {children}
      </View>
    </LogicMapBackdrop>
  );
}

function StateCard({
  tone,
  Glyph,
  title,
  body,
  onRetry,
}: {
  tone: StateTone;
  Glyph: ComponentType<StateGlyphProps>;
  title: string;
  body?: string;
  onRetry?: () => unknown;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => {
    void onRetry?.();
  }, [onRetry]);
  return (
    <View style={styles.stateCard}>
      <View style={styles.stateHeader}>
        <View style={[styles.iconBlock, stateToneStyles[tone]]}>
          <Glyph
            size={LOGIC_MAP_ICON_SIZE}
            color={LOGIC_MAP_GLYPH_COLOR}
            strokeWidth={LOGIC_MAP_ICON_STROKE}
          />
        </View>
        <Text style={styles.stateTitle}>{title}</Text>
      </View>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {onRetry ? (
        <View style={styles.stateActions}>
          <Button variant="outline" size="xs" onPress={handleRetry}>
            {t("common.actions.retry")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function LoadingCanvas() {
  const { t } = useTranslation();
  return (
    <LogicMapBackdrop>
      <View
        style={styles.skeletonColumn}
        accessibilityRole="progressbar"
        accessibilityLabel={t("logicMap.panel.loading")}
        testID="logic-map-loading"
      >
        <View style={styles.skeletonCard} testID="logic-map-skeleton-card">
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonLine} />
        </View>
        <View
          style={[styles.skeletonCard, styles.skeletonCardTall]}
          testID="logic-map-skeleton-card"
        >
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonLine} />
        </View>
        <View style={styles.skeletonCard} testID="logic-map-skeleton-card">
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonLine} />
        </View>
      </View>
    </LogicMapBackdrop>
  );
}

/** daemon 刚建好、Agent 还没写入的空图：只有一张"开始"卡片。 */
function NewMapCanvas() {
  const { t } = useTranslation();
  return (
    <StateCanvas testID="logic-map-new-map">
      <View style={styles.startCard}>
        <View style={[styles.iconBlock, stateToneStyles.startEnd]}>
          <House
            size={LOGIC_MAP_ICON_SIZE}
            color={LOGIC_MAP_GLYPH_COLOR}
            strokeWidth={LOGIC_MAP_ICON_STROKE}
          />
        </View>
        <Text style={styles.startTitle} numberOfLines={1}>
          {t("logicMap.panel.newMap.start")}
        </Text>
      </View>
      <Text style={styles.newMapHint}>{t("logicMap.panel.newMap.body")}</Text>
    </StateCanvas>
  );
}

const stateToneStyles = StyleSheet.create((theme) => ({
  neutral: { backgroundColor: theme.colors.logicMap.neutral },
  failure: { backgroundColor: theme.colors.logicMap.failure },
  step: { backgroundColor: theme.colors.logicMap.step },
  startEnd: { backgroundColor: theme.colors.logicMap.startEnd },
}));

// 面板头部用应用主题；画布区域（状态卡片、骨架、开始卡片）是 docs/design.md §14 的颜色例外。
const styles = StyleSheet.create((theme) => ({
  panel: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  picker: {
    flexShrink: 1,
    minWidth: 0,
  },
  nodeCount: {
    marginLeft: "auto",
    flexShrink: 0,
    ...theme.typeScale.caption,
    color: theme.colors.foregroundMuted,
  },
  stateRegion: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  stateCard: {
    width: "100%",
    maxWidth: 264,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: 12,
    backgroundColor: theme.colors.logicMap.card,
    boxShadow: theme.colors.logicMap.cardShadow,
  },
  stateHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconBlock: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stateTitle: {
    flex: 1,
    minWidth: 0,
    ...theme.typeScale.body,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.logicMap.title,
  },
  stateBody: {
    ...theme.typeScale.caption,
    color: theme.colors.logicMap.muted,
  },
  stateActions: {
    flexDirection: "row",
    marginTop: theme.spacing[1],
  },
  skeletonColumn: {
    paddingTop: theme.spacing[6],
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[8],
  },
  skeletonCard: {
    width: 152,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    backgroundColor: theme.colors.logicMap.card,
    boxShadow: theme.colors.logicMap.cardShadow,
  },
  skeletonCardTall: {
    height: 80,
    alignItems: "flex-start",
    paddingTop: theme.spacing[3],
  },
  skeletonIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: theme.colors.logicMap.skeleton,
  },
  skeletonLine: {
    flex: 1,
    height: 10,
    marginTop: theme.spacing[1],
    borderRadius: 5,
    backgroundColor: theme.colors.logicMap.skeleton,
  },
  startCard: {
    width: 152,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    backgroundColor: theme.colors.logicMap.card,
    boxShadow: theme.colors.logicMap.cardShadow,
  },
  startTitle: {
    flex: 1,
    minWidth: 0,
    ...theme.typeScale.body,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.logicMap.title,
  },
  newMapHint: {
    ...theme.typeScale.caption,
    color: theme.colors.logicMap.muted,
    textAlign: "center",
  },
}));
