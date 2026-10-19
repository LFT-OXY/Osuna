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
import type { TFunction } from "i18next";
import { ChevronRight, CircleAlert, House, TriangleAlert, Workflow } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  LogicMapSkeleton,
  WorkspaceLogicMapReadResult,
  WorkspaceLogicMapSummary,
} from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { ZoomableViewport } from "@/components/zoomable-viewport";
import type { ViewportFitOptions } from "@/components/zoomable-viewport/geometry";
import { useReplicaQuery } from "@/data/query";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { LogicMapBackdrop } from "./backdrop";
import {
  LOGIC_MAP_GLYPH_COLOR,
  LOGIC_MAP_ICON_SIZE,
  LOGIC_MAP_ICON_STROKE,
  LogicMapCanvas,
} from "./canvas";
import {
  LOGIC_MAP_CARD,
  LOGIC_MAP_CARD_MIN_HEIGHT,
  layoutLogicMapLayer,
  logicMapLayerTrail,
  type LogicMapLayerStep,
  type LogicMapLayout,
} from "./layout";
import { CONTROL_HEIGHT, ICON_SIZE, type Theme } from "@/styles/theme";

export type LogicMapClient = Pick<
  DaemonClient,
  "listWorkspaceLogicMaps" | "getWorkspaceLogicMap" | "observeEvents"
>;

const CHANGED_EVENT = "workspace.logic_map.changed";
const VIEWPORT_MIN_SCALE = 0.25;
const VIEWPORT_MAX_SCALE = 4;
/**
 * 打开时按面板宽度缩放，但最多缩到 70%：320 宽的右边栏里卡片标题约 10px，还认得出；
 * 图更宽时超出的部分左右拖动看。
 */
const LOGIC_MAP_MIN_FIT_SCALE = 0.7;
const FIT_WIDTH: ViewportFitOptions = {
  mode: "width",
  maxFitScale: 1,
  minFitScale: LOGIC_MAP_MIN_FIT_SCALE,
};

/** 下拉框、画布上的提示都用同一个名字指这张图：有标题用标题，没有就是"未命名逻辑图"。 */
function mapLabel(map: WorkspaceLogicMapSummary, t: TFunction): string {
  return map.title ?? t("logicMap.panel.untitled");
}

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
  /** 选中（正在读它的文档）的节点，画蓝色外圈。 */
  selectedNodeId: string | null;
}

export function LogicMapPanelSurface({
  serverId,
  workspaceId,
  client,
  isConnected,
  supported,
  conversationMapName,
  selectedNodeId,
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
      selectedNodeId={selectedNodeId}
    />
  );
}

function LogicMapPanelContent({
  serverId,
  workspaceId,
  client,
  conversationMapName,
  selectedNodeId,
}: {
  serverId: string;
  workspaceId: string;
  client: LogicMapClient;
  conversationMapName: string | null;
  selectedNodeId: string | null;
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
  const skeleton = result?.kind === "ok" ? result.map : null;
  const { layerId, trail, setLayerId } = useCurrentLayer(selectedMapName, skeleton);
  const layout = useMemo(
    () => (skeleton ? layoutLogicMapLayer(skeleton, layerId) : null),
    [layerId, skeleton],
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
  const selectedMap = maps.find((map) => map.name === selectedMapName);
  if (!selectedMap) {
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
  const selectedLabel = mapLabel(selectedMap, t);
  return (
    <View style={styles.panel}>
      <LogicMapHeader
        maps={maps}
        selectedMap={selectedMap}
        nodeCount={layout?.nodes.length ?? null}
        onSelect={setPickedMapName}
      />
      {trail.length > 0 ? (
        <LogicMapBreadcrumb mapLabel={selectedLabel} trail={trail} onSelectLayer={setLayerId} />
      ) : null}
      <LogicMapBody
        mapLabel={selectedLabel}
        result={result}
        layout={layout}
        error={readQuery.isError ? readQuery.error : null}
        onRetry={readQuery.refetch}
        selectedNodeId={selectedNodeId}
        layerId={layerId}
        onEnterSubgraph={setLayerId}
      />
    </View>
  );
}

/**
 * 正在看的层（顶层为 null），在渲染时从"在哪张图里点进了哪一层"推出来：换了图，或 Agent 改图后这一层
 * 不在了，就是顶层。
 */
function useCurrentLayer(mapName: string | null, skeleton: LogicMapSkeleton | null) {
  const [picked, setPicked] = useState<{ mapName: string | null; layerId: string | null }>({
    mapName: null,
    layerId: null,
  });
  const pickedTrail =
    skeleton && picked.mapName === mapName ? logicMapLayerTrail(skeleton, picked.layerId) : null;
  const setLayerId = useCallback(
    (layerId: string | null) => setPicked({ mapName, layerId }),
    [mapName],
  );
  const layerId = pickedTrail ? picked.layerId : null;
  return { layerId, trail: pickedTrail ?? NO_TRAIL, setLayerId };
}

const NO_TRAIL: readonly LogicMapLayerStep[] = [];

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
  selectedMap,
  nodeCount,
  onSelect,
}: {
  maps: readonly WorkspaceLogicMapSummary[];
  selectedMap: WorkspaceLogicMapSummary;
  nodeCount: number | null;
  onSelect: (mapName: string) => void;
}) {
  const { t } = useTranslation();
  const selectedTitle = mapLabel(selectedMap, t);
  const nodeCountKey =
    nodeCount === 1 ? "logicMap.panel.nodeCountOne" : "logicMap.panel.nodeCountMany";
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
                title={mapLabel(map, t)}
                selected={map.name === selectedMap.name}
                onSelect={onSelect}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {nodeCount !== null ? (
        <Text style={styles.nodeCount} numberOfLines={1}>
          {t(nodeCountKey, { count: nodeCount })}
        </Text>
      ) : null}
    </PaneContentToolbar>
  );
}

/** 子图内层才有的一行路径：图名 › 子图 › …，最后一级是当前层，前面每一级点了回到那一层。 */
function LogicMapBreadcrumb({
  mapLabel: label,
  trail,
  onSelectLayer,
}: {
  mapLabel: string;
  trail: readonly LogicMapLayerStep[];
  onSelectLayer: (layerId: string | null) => void;
}) {
  const { t } = useTranslation();
  const current = trail[trail.length - 1];
  const parents = trail.slice(0, -1);
  return (
    <View
      style={styles.breadcrumb}
      accessibilityRole="toolbar"
      accessibilityLabel={t("logicMap.panel.breadcrumb")}
      testID="logic-map-breadcrumb"
    >
      <BreadcrumbParent
        layerId={null}
        title={label}
        onSelectLayer={onSelectLayer}
        testID="logic-map-breadcrumb-top"
      />
      {parents.map((step) => (
        <BreadcrumbParent
          key={step.id}
          layerId={step.id}
          title={step.title}
          onSelectLayer={onSelectLayer}
          testID={`logic-map-breadcrumb-${step.id}`}
        />
      ))}
      <Text
        style={styles.breadcrumbCurrent}
        numberOfLines={1}
        aria-current="page"
        testID="logic-map-breadcrumb-current"
      >
        {current.title}
      </Text>
    </View>
  );
}

function BreadcrumbParent({
  layerId,
  title,
  onSelectLayer,
  testID,
}: {
  layerId: string | null;
  title: string;
  onSelectLayer: (layerId: string | null) => void;
  testID: string;
}) {
  const handlePress = useCallback(() => onSelectLayer(layerId), [layerId, onSelectLayer]);
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        style={styles.breadcrumbParent}
        onPress={handlePress}
        testID={testID}
      >
        {title}
      </Button>
      <BreadcrumbSeparator size={ICON_SIZE.xs} />
    </>
  );
}

const BreadcrumbSeparator = withUnistyles(ChevronRight, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

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
  mapLabel: label,
  result,
  layout,
  error,
  onRetry,
  selectedNodeId,
  layerId,
  onEnterSubgraph,
}: {
  mapLabel: string;
  result: WorkspaceLogicMapReadResult | undefined;
  layout: LogicMapLayout | null;
  error: Error | null;
  onRetry: () => unknown;
  selectedNodeId: string | null;
  layerId: string | null;
  onEnterSubgraph: (layerId: string) => void;
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
          body={t("logicMap.panel.corruptDetail", { map: label, file: result.file })}
          details={result.problem}
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
  // 换一层就是换一张画，视口按新的一层重新适应宽度、回到左上。
  return (
    <LogicMapViewport
      key={layerId ?? TOP_LAYER_KEY}
      layout={layout}
      selectedNodeId={selectedNodeId}
      onEnterSubgraph={onEnterSubgraph}
    />
  );
}

const TOP_LAYER_KEY = "top";

function LogicMapViewport({
  layout,
  selectedNodeId,
  onEnterSubgraph,
}: {
  layout: LogicMapLayout;
  selectedNodeId: string | null;
  onEnterSubgraph: (layerId: string) => void;
}) {
  const { t } = useTranslation();
  const contentSize = useMemo(
    () => ({ width: layout.width, height: layout.height }),
    [layout.height, layout.width],
  );
  return (
    <LogicMapBackdrop testID="logic-map-canvas">
      <ZoomableViewport
        accessibilityLabel={t("logicMap.panel.canvas")}
        contentSize={contentSize}
        fit={FIT_WIDTH}
        initialPosition="top"
        controls="zoom-bar"
        renderAtContentSize
        panWithinViewport
        minScale={VIEWPORT_MIN_SCALE}
        maxScale={VIEWPORT_MAX_SCALE}
        wheelActivation="modifier"
        wheelPan
        testID="logic-map-viewport"
      >
        <LogicMapCanvas
          layout={layout}
          selectedNodeId={selectedNodeId}
          onEnterSubgraph={onEnterSubgraph}
        />
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
  details,
  onRetry,
}: {
  tone: StateTone;
  Glyph: ComponentType<StateGlyphProps>;
  title: string;
  body?: string;
  /** 原始错误文字（daemon 给的，不翻译），默认收起，点"详情"展开。 */
  details?: string;
  onRetry?: () => unknown;
}) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const handleRetry = useCallback(() => {
    void onRetry?.();
  }, [onRetry]);
  const toggleDetails = useCallback(() => setDetailsOpen((open) => !open), []);
  const detailsLabel = detailsOpen ? t("logicMap.panel.hideDetails") : t("logicMap.panel.details");
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
      {details ? (
        <View style={styles.stateActions}>
          <Button
            variant="ghost"
            size="xs"
            onPress={toggleDetails}
            testID="logic-map-state-details-toggle"
          >
            {detailsLabel}
          </Button>
        </View>
      ) : null}
      {details && detailsOpen ? (
        <Text style={styles.stateDetails} selectable testID="logic-map-state-details">
          {details}
        </Text>
      ) : null}
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

/** daemon 刚建好、Agent 还没写入的空图：一张"开始"占位（不算节点，所以头部是 0 个节点）。 */
function NewMapCanvas() {
  const { t } = useTranslation();
  return (
    <StateCanvas testID="logic-map-new-map">
      <View style={styles.startPlaceholder} testID="logic-map-start-placeholder">
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

// 面板头部用应用主题；画布区域（状态卡片、骨架、开始卡片）是 docs/design.md §14 的颜色例外，
// 尺寸与节点卡片共用 LOGIC_MAP_CARD 和设计 token。
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
  breadcrumb: {
    height: CONTROL_HEIGHT.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
    overflow: "hidden",
  },
  breadcrumbParent: {
    flexShrink: 1,
    minWidth: 0,
  },
  breadcrumbCurrent: {
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: theme.spacing[2],
    ...theme.typeScale.caption,
    // 当前层是结构标签（design.md §3），比前几级深一档、加 medium。
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
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
    maxWidth: theme.spacing[32] * 2,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.logicMap.card,
    boxShadow: theme.colors.logicMap.cardShadow,
  },
  stateHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconBlock: {
    width: LOGIC_MAP_CARD.headerHeight,
    height: LOGIC_MAP_CARD.headerHeight,
    borderRadius: theme.radius.sm,
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
  stateDetails: {
    ...theme.typeScale.caption,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.logicMap.muted,
  },
  stateActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  skeletonColumn: {
    paddingTop: theme.spacing[6],
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[8],
  },
  skeletonCard: {
    width: LOGIC_MAP_CARD.width,
    height: LOGIC_MAP_CARD_MIN_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: LOGIC_MAP_CARD.padding,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.logicMap.card,
    boxShadow: theme.colors.logicMap.cardShadow,
  },
  skeletonCardTall: {
    height: theme.spacing[20],
    alignItems: "flex-start",
    paddingTop: LOGIC_MAP_CARD.padding,
  },
  skeletonIcon: {
    width: LOGIC_MAP_CARD.headerHeight,
    height: LOGIC_MAP_CARD.headerHeight,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.logicMap.skeleton,
  },
  skeletonLine: {
    flex: 1,
    height: theme.spacing[2],
    marginTop: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.logicMap.skeleton,
  },
  // 新建的空图里那张"开始"是占位，不是节点：虚线框、不带投影，和节点卡片区分开。
  startPlaceholder: {
    width: LOGIC_MAP_CARD.width,
    height: LOGIC_MAP_CARD_MIN_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: LOGIC_MAP_CARD.padding,
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderStyle: "dashed",
    borderColor: theme.colors.logicMap.branchLabel,
    backgroundColor: theme.colors.logicMap.card,
  },
  startTitle: {
    flex: 1,
    minWidth: 0,
    ...theme.typeScale.body,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.logicMap.muted,
  },
  newMapHint: {
    ...theme.typeScale.caption,
    color: theme.colors.logicMap.muted,
    textAlign: "center",
  },
}));
