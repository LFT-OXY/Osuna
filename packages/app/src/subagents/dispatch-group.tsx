import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react-native";
import equal from "fast-deep-equal";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { PARENT_TOOL_CALL_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { getProviderIcon } from "@/components/provider-icons";
import { LiveElapsed } from "@/components/message";
import { Text } from "@/components/ui/text";
import { ComposerTrackMark } from "@/composer/tracks";
import { useFetchQueries } from "@/data/query";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { useSessionStore } from "@/stores/session-store";
import { isCreateAgentCall } from "@/tool-calls/detail-level/dispatch/model";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import type { AgentToolCallItem } from "@/types/stream";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { formatDuration } from "@/utils/time";
import { useProviderSubagentStore } from "./provider-store";
import {
  createDispatchSubagentsSelector,
  createProviderDispatchSubagentsSelector,
  isDispatchChildOf,
  PENDING_DISPATCH_LOOKUP,
  resolveDispatchCall,
  resolveProviderDispatchCall,
  splitDispatchSegments,
  toDispatchSubagent,
  type DispatchLookup,
  type DispatchRowState,
  type DispatchSubagent,
} from "./select";
import {
  buildDispatchGroupHeaderPresentation,
  buildDispatchRowPresentation,
  type DispatchOpenTarget,
  type DispatchRowBucket,
  type DispatchRowPresentation,
} from "./track-presentation";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ROW_ICON_SIZE = 16;

export interface DispatchGroupViewProps {
  serverId: string;
  parentAgentId: string;
  calls: readonly AgentToolCallItem[];
  isLastInSequence: boolean;
  onOpenSubagent: (agentId: string) => void;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
  /** 关联不上的调用退回通用工具卡，由时间线按原样渲染。 */
  renderGenericCall: (call: AgentToolCallItem, isLastInSequence: boolean) => ReactNode;
}

/**
 * 时间线是否把 `create_agent` 调用画成派发组。能力开关只在这里读一次；只读面板与草稿不给打开处理，
 * 调用照常是通用工具卡。
 */
export function useDispatchGroupsEnabled(input: {
  serverId: string;
  canOpenSubagents: boolean;
}): boolean {
  // COMPAT(subagentCallLinks): added in v0.12.x, remove gate after 2027-09-30.
  const supportsCallLinks = useHostFeature(input.serverId, "subagentCallLinks");
  return supportsCallLinks && input.canOpenSubagents;
}

/** 两种子智能体各自的 callId 索引：Paseo 按关联标签一对一，provider 按描述符的 `toolCallId` 一对多。 */
interface DispatchSubagentIndex {
  paseo: Record<string, DispatchSubagent>;
  provider: Record<string, DispatchSubagent[]>;
}

const EMPTY_PASEO_DISPATCH_SUBAGENTS: Record<string, DispatchSubagent> = {};
const EMPTY_PROVIDER_DISPATCH_SUBAGENTS: Record<string, DispatchSubagent[]> = {};
const EMPTY_DISPATCH_SUBAGENT_INDEX: DispatchSubagentIndex = {
  paseo: EMPTY_PASEO_DISPATCH_SUBAGENTS,
  provider: EMPTY_PROVIDER_DISPATCH_SUBAGENTS,
};

function selectNoPaseoDispatchSubagents(): Record<string, DispatchSubagent> {
  return EMPTY_PASEO_DISPATCH_SUBAGENTS;
}

function selectNoProviderDispatchSubagents(): Record<string, DispatchSubagent[]> {
  return EMPTY_PROVIDER_DISPATCH_SUBAGENTS;
}

const DispatchSubagentIndexContext = createContext<DispatchSubagentIndex>(
  EMPTY_DISPATCH_SUBAGENT_INDEX,
);

export const DispatchSubagentIndexProvider = DispatchSubagentIndexContext.Provider;

/**
 * 时间线是派发组这个集合的 owner：它订阅一次、按 callId 建好索引，经 context 交给各组，
 * 各组不再各自订阅热 store（docs/coding-standards.md React 一节）。
 */
export function useDispatchSubagentIndex(input: {
  serverId: string;
  parentAgentId: string;
  enabled: boolean;
}): DispatchSubagentIndex {
  const { serverId, parentAgentId, enabled } = input;
  const selectPaseo = useMemo(
    () =>
      enabled
        ? createDispatchSubagentsSelector({ serverId, parentAgentId })
        : selectNoPaseoDispatchSubagents,
    [enabled, parentAgentId, serverId],
  );
  const selectProvider = useMemo(
    () =>
      enabled
        ? createProviderDispatchSubagentsSelector({ serverId, parentAgentId })
        : selectNoProviderDispatchSubagents,
    [enabled, parentAgentId, serverId],
  );
  const paseo = useStoreWithEqualityFn(useSessionStore, selectPaseo, equal);
  const provider = useStoreWithEqualityFn(useProviderSubagentStore, selectProvider, equal);
  return useMemo(() => ({ paseo, provider }), [paseo, provider]);
}

export function dispatchSubagentLookupQueryKey(input: {
  serverId: string;
  parentAgentId: string;
  callId: string;
}) {
  return ["dispatchSubagentLookup", input.serverId, input.parentAgentId, input.callId] as const;
}

/**
 * active 目录不含已归档的智能体。调用结束后 store 里仍找不到的，按关联标签带 `includeArchived`
 * 查一次；结果只用来画最终状态，所以查到或查不到都不再刷新。
 */
function useArchivedDispatchLookups(input: {
  serverId: string;
  parentAgentId: string;
  callIds: readonly string[];
}): Record<string, DispatchLookup> {
  const client = useHostRuntimeClient(input.serverId);
  const queries = useFetchQueries<DispatchLookup>(
    input.callIds.map((callId) => ({
      queryKey: dispatchSubagentLookupQueryKey({ ...input, callId }),
      dataShape: "value",
      immutableWhen: () => true,
      enabled: Boolean(client),
      queryFn: async (): Promise<DispatchLookup> => {
        if (!client) {
          return { status: "missing" };
        }
        const payload = await client.fetchAgents({
          filter: { labels: { [PARENT_TOOL_CALL_ID_LABEL]: callId }, includeArchived: true },
        });
        const agent = payload.entries
          .map((entry) => normalizeAgentSnapshot(entry.agent, input.serverId))
          .find((candidate) => isDispatchChildOf(candidate, input.parentAgentId));
        if (!agent) {
          return { status: "missing" };
        }
        return { status: "found", subagent: toDispatchSubagent(agent) };
      },
    })),
  );
  const lookups: Record<string, DispatchLookup> = {};
  input.callIds.forEach((callId, index) => {
    const query = queries[index];
    // 查询出错按查不到处理：退回通用卡，不让一行永远停在"启动中"。
    if (query?.isError) {
      lookups[callId] = { status: "missing" };
      return;
    }
    lookups[callId] = query?.data ?? PENDING_DISPATCH_LOOKUP;
  });
  return lookups;
}

/**
 * 时间线派发组：同一段输出里连续的子智能体调用（`create_agent` 与 provider 子智能体调用）。每行与
 * Subagents track 用同一份子智能体数据，点击打开子会话或只读面板；关联不上的调用切开这一组，
 * 按通用工具卡原样显示。
 */
export const DispatchGroupView = memo(function DispatchGroupView({
  serverId,
  parentAgentId,
  calls,
  isLastInSequence,
  onOpenSubagent,
  onOpenProviderSubagent,
  renderGenericCall,
}: DispatchGroupViewProps): ReactElement {
  const linked = useContext(DispatchSubagentIndexContext);
  // 只有 `create_agent` 的子智能体会归档出 active 目录，provider 子智能体不用补查。
  const unlinkedFinishedCallIds = useMemo(
    () =>
      calls
        .filter((call) => {
          const isFinished = call.payload.data.status !== "running";
          return isCreateAgentCall(call) && isFinished;
        })
        .map((call) => call.payload.data.callId)
        .filter((callId) => !linked.paseo[callId]),
    [calls, linked],
  );
  const lookups = useArchivedDispatchLookups({
    serverId,
    parentAgentId,
    callIds: unlinkedFinishedCallIds,
  });
  const segments = useMemo(
    () =>
      splitDispatchSegments(
        calls.flatMap((call) => {
          const callId = call.payload.data.callId;
          if (!isCreateAgentCall(call)) {
            return resolveProviderDispatchCall({ call, subagents: linked.provider[callId] });
          }
          const lookup = lookups[callId] ?? PENDING_DISPATCH_LOOKUP;
          return [resolveDispatchCall({ call, subagent: linked.paseo[callId], lookup })];
        }),
      ),
    [calls, linked, lookups],
  );
  const lastIndex = segments.length - 1;
  const handleOpen = useCallback(
    (target: DispatchOpenTarget) => {
      if (target.kind === "agent") {
        onOpenSubagent(target.agentId);
        return;
      }
      onOpenProviderSubagent(target.parentAgentId, target.subagentId);
    },
    [onOpenProviderSubagent, onOpenSubagent],
  );

  return (
    <View style={styles.stack}>
      {segments.map((segment, index) =>
        segment.kind === "generic" ? (
          <View key={segment.call.id}>
            {renderGenericCall(segment.call, isLastInSequence && index === lastIndex)}
          </View>
        ) : (
          <DispatchGroupCard
            key={segment.key}
            serverId={serverId}
            rows={segment.rows}
            onOpen={handleOpen}
          />
        ),
      )}
    </View>
  );
});

function DispatchGroupCard({
  serverId,
  rows,
  onOpen,
}: {
  serverId: string;
  rows: DispatchRowState[];
  onOpen: (target: DispatchOpenTarget) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const { entries } = useProvidersSnapshot(serverId);
  const providerLabelOf = useCallback(
    (provider: string) => resolveProviderLabel(provider, entries),
    [entries],
  );
  const header = useMemo(() => buildDispatchGroupHeaderPresentation(t, rows), [rows, t]);
  const toggle = useCallback(() => setCollapsed((value) => !value), []);
  const chevronStyle = collapsed ? styles.chevronCollapsed : styles.chevronExpanded;
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <View style={settingsStyles.card} testID="dispatch-group">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={header.accessibilityLabel}
        accessibilityState={accessibilityState}
        testID="dispatch-group-header"
        onPress={toggle}
        style={styles.header}
      >
        <View style={chevronStyle}>
          <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {header.title}
        </Text>
        <View style={styles.segments}>
          {header.segments.map((segment) => (
            <View key={segment.bucket} style={styles.segment}>
              <ComposerTrackMark bucket={markBucket(segment.bucket)} />
              <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
                {segment.text}
              </Text>
            </View>
          ))}
        </View>
      </Pressable>
      {collapsed
        ? null
        : rows.map((row) => (
            <DispatchGroupRow
              key={row.key}
              serverId={serverId}
              presentation={buildDispatchRowPresentation({ t, state: row, providerLabelOf })}
              onOpen={onOpen}
            />
          ))}
    </View>
  );
}

/** 启动中与运行中用同一个转圈标记。 */
function markBucket(bucket: DispatchRowBucket) {
  return bucket === "starting" ? "running" : bucket;
}

function DispatchGroupRow({
  serverId,
  presentation,
  onOpen,
}: {
  serverId: string;
  presentation: DispatchRowPresentation;
  onOpen: (target: DispatchOpenTarget) => void;
}): ReactElement {
  const { open } = presentation;
  const openable = open !== null;
  const iconPresentation = useMemo(
    () => buildIconPresentation(presentation, serverId),
    [presentation, serverId],
  );
  const handlePress = useCallback(() => {
    if (open) {
      onOpen(open);
    }
  }, [open, onOpen]);
  const renderRow = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => {
      const active = openable && (Boolean(hovered) || pressed);
      const subtitleColor = presentation.tone === "warning" ? "statusWarning" : "foregroundMuted";
      return (
        <View style={active ? styles.rowActive : styles.row}>
          <WorkspaceTabIcon
            presentation={iconPresentation}
            size={ROW_ICON_SIZE}
            backdrop={active ? "surface2" : "surfaceCard"}
          />
          <View style={styles.rowText}>
            <Text numberOfLines={1}>{presentation.label}</Text>
            {presentation.subtitle ? (
              <Text variant="caption" color={subtitleColor} numberOfLines={1}>
                {presentation.subtitle}
              </Text>
            ) : null}
          </View>
          <DispatchRowTrailing presentation={presentation} />
        </View>
      );
    },
    [iconPresentation, openable, presentation],
  );
  // 不可点只降透明度，不换颜色（docs/design.md §11、§14）；加在按下目标上，分隔线跟着变淡。
  const pressableStyle = useMemo(
    () => [settingsStyles.rowBorder, openable ? null : styles.disabled],
    [openable],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={presentation.label}
      testID={`dispatch-group-row-${presentation.key}`}
      disabled={!openable}
      onPress={handlePress}
      style={pressableStyle}
    >
      {renderRow}
    </Pressable>
  );
}

function buildIconPresentation(
  presentation: DispatchRowPresentation,
  serverId: string,
): WorkspaceTabPresentation {
  const icon = getProviderIcon(presentation.provider ?? "", serverId);
  return {
    key: presentation.key,
    kind: "agent",
    label: presentation.label,
    subtitle: presentation.subtitle,
    tooltip: presentation.label,
    modified: false,
    titleState: "ready",
    icon,
    statusBucket: markBucket(presentation.bucket),
  };
}

function renderTrailingText(text: string): ReactElement {
  return (
    <Text variant="caption" color="foregroundMuted" style={styles.trailing}>
      {text}
    </Text>
  );
}

function DispatchRowTrailing({
  presentation,
}: {
  presentation: DispatchRowPresentation;
}): ReactElement | null {
  const { t } = useTranslation();
  const { timing } = presentation;
  switch (timing.kind) {
    case "starting":
      return renderTrailingText(t("subagents.dispatchStartingRow"));
    case "live":
      return <LiveElapsed startedAt={timing.startedAt} renderLabel={renderTrailingText} />;
    case "frozen":
      return renderTrailingText(formatDuration(timing.durationMs));
    case "none":
      return null;
  }
}

const styles = StyleSheet.create((theme) => {
  const row = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: theme.spacing[3],
    minHeight: 48,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  };
  return {
    // 卡片本身用 settingsStyles.card（docs/design.md §5），上下留白放在外层。
    stack: {
      gap: theme.spacing[2],
      paddingVertical: theme.spacing[1],
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
    },
    chevronExpanded: {
      transform: [{ rotate: "180deg" }],
    },
    chevronCollapsed: {},
    headerTitle: {
      flexShrink: 1,
    },
    segments: {
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 1,
      minWidth: 0,
      gap: theme.spacing[3],
      marginLeft: "auto",
    },
    segment: {
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    row,
    rowActive: {
      ...row,
      backgroundColor: theme.colors.surface2,
    },
    disabled: {
      opacity: theme.opacity[50],
    },
    rowText: {
      flex: 1,
      minWidth: 0,
    },
    trailing: {
      fontVariant: ["tabular-nums"],
    },
  };
});
