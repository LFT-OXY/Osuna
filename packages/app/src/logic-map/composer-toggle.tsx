import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { Workflow } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Switch } from "@/components/ui/switch";
import { Text as UiText } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { buildDraftLogicMapKey, useDraftLogicMapStore } from "./draft-logic-map-store";

/** 开关在工具栏里的估计宽度：图标、"逻辑图"、Switch 与内边距，算 Agent controls 收缩档位时预留。 */
export const LOGIC_MAP_TOGGLE_RESERVED_WIDTH = 140;

/** 运行中的 Agent 按 agentId 开关；草稿还没有 Agent，按草稿 tab 记住 daemon 建好的图名。 */
type LogicMapComposerToggleProps = { serverId: string } & (
  | { kind: "agent"; agentId: string; workspaceId: string | null }
  | { kind: "draft"; draftTabId: string; workspaceId: string }
);

/** 这个 workspace 第一次有对话打开逻辑图时，把逻辑图标签加进右边栏并选中；之后不再自动加。 */
function revealLogicMapTabOnFirstEnable(serverId: string, workspaceId: string | null): void {
  const workspaceKey = workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId, workspaceId })
    : null;
  if (workspaceKey) useWorkspaceLayoutStore.getState().autoOpenLogicMapTab(workspaceKey);
}

const ThemedWorkflowIcon = withUnistyles(Workflow);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * 输入框工具栏上的"逻辑图"开关。主机不支持时不给开关，只提示更新主机；
 * 还不知道主机版本（没连上）时什么都不显示。
 */
export function LogicMapComposerToggle(props: LogicMapComposerToggleProps) {
  // COMPAT(logicMap): added in v0.17.0, remove gate after 2027-04-19.
  const supported = useHostFeatureAvailability(props.serverId, "logicMap");
  if (supported === null) return null;
  if (!supported) return <LogicMapHostOutdated />;
  if (props.kind === "agent") {
    return (
      <AgentLogicMapSwitch
        serverId={props.serverId}
        agentId={props.agentId}
        workspaceId={props.workspaceId}
      />
    );
  }
  return (
    <DraftLogicMapSwitch
      serverId={props.serverId}
      draftTabId={props.draftTabId}
      workspaceId={props.workspaceId}
    />
  );
}

/** 请求在路上时先显示用户点到的状态；失败时提示并回到原状态。 */
function useLogicMapRequest(
  run: (next: boolean) => Promise<void>,
): [pendingValue: boolean | null, change: (next: boolean) => Promise<void>] {
  const { t } = useTranslation();
  const toast = useToast();
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const change = useCallback(
    async (next: boolean) => {
      setPendingValue(next);
      try {
        await run(next);
      } catch (error) {
        toast.error(t("logicMap.toggle.failed", { error: getErrorMessage(error) }));
      } finally {
        setPendingValue(null);
      }
    },
    [run, t, toast],
  );
  return [pendingValue, change];
}

function AgentLogicMapSwitch({
  serverId,
  agentId,
  workspaceId,
}: {
  serverId: string;
  agentId: string;
  workspaceId: string | null;
}) {
  const client = useHostRuntimeClient(serverId);
  const enabled = useSessionStore((state) => {
    const agent = state.sessions[serverId]?.agents?.get(agentId);
    return getLogicMapNameFromLabels(agent?.labels) !== null;
  });
  const run = useCallback(
    async (next: boolean) => {
      if (!client) return;
      await client.setAgentLogicMapEnabled({ target: { kind: "agent", agentId }, enabled: next });
      if (next) revealLogicMapTabOnFirstEnable(serverId, workspaceId);
    },
    [agentId, client, serverId, workspaceId],
  );
  const [pendingValue, change] = useLogicMapRequest(run);
  return (
    <LogicMapSwitchControl
      value={pendingValue ?? enabled}
      disabled={!client || pendingValue !== null}
      onValueChange={change}
    />
  );
}

function DraftLogicMapSwitch({
  serverId,
  draftTabId,
  workspaceId,
}: {
  serverId: string;
  draftTabId: string;
  workspaceId: string;
}) {
  const client = useHostRuntimeClient(serverId);
  const draftKey = buildDraftLogicMapKey({ serverId, draftTabId });
  const draft = useDraftLogicMapStore((state) => state.draftsByKey[draftKey] ?? null);
  const run = useCallback(
    async (next: boolean) => {
      const store = useDraftLogicMapStore.getState();
      // 关掉再打开沿用这个草稿已建好的图；只有第一次打开才让 daemon 新建。
      if (!next || store.draftsByKey[draftKey]) {
        store.setEnabled(draftKey, next);
        if (next) revealLogicMapTabOnFirstEnable(serverId, workspaceId);
        return;
      }
      if (!client) return;
      const { mapName } = await client.setAgentLogicMapEnabled({
        target: { kind: "draft", workspaceId },
        enabled: true,
      });
      if (!mapName) return;
      useDraftLogicMapStore.getState().turnOnWithMap(draftKey, mapName);
      revealLogicMapTabOnFirstEnable(serverId, workspaceId);
    },
    [client, draftKey, serverId, workspaceId],
  );
  const [pendingValue, change] = useLogicMapRequest(run);
  return (
    <LogicMapSwitchControl
      value={pendingValue ?? draft?.enabled ?? false}
      disabled={!client || pendingValue !== null}
      onValueChange={change}
    />
  );
}

function LogicMapSwitchControl({
  value,
  disabled,
  onValueChange,
}: {
  value: boolean;
  disabled: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View style={styles.control} testID="composer-logic-map-toggle">
          <LogicMapLabel />
          <Switch
            value={value}
            onValueChange={onValueChange}
            disabled={disabled}
            accessibilityLabel={t("logicMap.toggle.label")}
            testID="composer-logic-map-switch"
          />
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>
          {t(value ? "logicMap.toggle.hintOn" : "logicMap.toggle.hintOff")}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

/** 图标加"逻辑图"，开关和老主机提示两种状态共用，保证两处一模一样。 */
function LogicMapLabel() {
  const { t } = useTranslation();
  const { glyphSize } = useComposerControlLayout();
  return (
    <>
      <ComposerToolbarGlyph size={glyphSize}>
        <ThemedWorkflowIcon size={glyphSize} uniProps={mutedIconMapping} />
      </ComposerToolbarGlyph>
      <UiText variant="label" color="foregroundMuted" weight="medium" numberOfLines={1}>
        {t("logicMap.toggle.label")}
      </UiText>
    </>
  );
}

function LogicMapHostOutdated() {
  const { t } = useTranslation();
  return (
    <View
      style={styles.control}
      accessible
      accessibilityLabel={t("logicMap.toggle.hostOutdatedDetail")}
      testID="composer-logic-map-host-outdated"
    >
      <LogicMapLabel />
      <UiText variant="label" color="foregroundMuted" numberOfLines={1}>
        {t("logicMap.toggle.hostOutdated")}
      </UiText>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  control: {
    height: theme.controlHeight.md,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
