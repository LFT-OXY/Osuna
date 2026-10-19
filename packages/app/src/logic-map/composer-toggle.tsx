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
import { LogicMapPicker, type LogicMapChoice, type LogicMapPickerClient } from "./map-picker";

/** 开关在工具栏里的估计宽度：图标、"逻辑图"、Switch 与内边距，算 Agent controls 收缩档位时预留。 */
const LOGIC_MAP_TOGGLE_RESERVED_WIDTH = 140;
/** 老主机时那一行是图标、"逻辑图"加整句"需要更新这台主机上的 Osuna"，要预留整句的宽度。 */
const LOGIC_MAP_HOST_OUTDATED_RESERVED_WIDTH = 300;

/** Agent controls 收缩时给逻辑图控件预留的宽度；主机太旧时提示比开关长得多。 */
export function logicMapToggleReservedWidth(supported: boolean | null): number {
  return supported === false
    ? LOGIC_MAP_HOST_OUTDATED_RESERVED_WIDTH
    : LOGIC_MAP_TOGGLE_RESERVED_WIDTH;
}

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

/** 用户对开关做的事：关掉，或在选择弹层里选了一张图打开。 */
type LogicMapSwitchChange = { kind: "off" } | { kind: "on"; choice: LogicMapChoice };

/** 请求在路上时先显示用户点到的状态；失败时提示并回到原状态。 */
function useLogicMapRequest(
  run: (change: LogicMapSwitchChange) => Promise<void>,
): [pendingValue: boolean | null, change: (change: LogicMapSwitchChange) => Promise<void>] {
  const { t } = useTranslation();
  const toast = useToast();
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const change = useCallback(
    async (next: LogicMapSwitchChange) => {
      setPendingValue(next.kind === "on");
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

/** 接着已有的图时把图名交给 daemon；新建时不带，由 daemon 建一张空图。 */
function continuedMapName(choice: LogicMapChoice): string | undefined {
  return choice.kind === "continue" ? choice.mapName : undefined;
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
    async (change: LogicMapSwitchChange) => {
      if (!client) return;
      await client.setAgentLogicMapEnabled({
        target: { kind: "agent", agentId },
        enabled: change.kind === "on",
        mapName: change.kind === "on" ? continuedMapName(change.choice) : undefined,
      });
      if (change.kind === "on") revealLogicMapTabOnFirstEnable(serverId, workspaceId);
    },
    [agentId, client, serverId, workspaceId],
  );
  const [pendingValue, change] = useLogicMapRequest(run);
  return (
    <LogicMapSwitchControl
      client={client}
      serverId={serverId}
      workspaceId={workspaceId}
      hiddenMapName={null}
      value={pendingValue ?? enabled}
      disabled={!client || pendingValue !== null}
      onChange={change}
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
    async (change: LogicMapSwitchChange) => {
      const store = useDraftLogicMapStore.getState();
      if (change.kind === "off") {
        store.setEnabled(draftKey, false);
        return;
      }
      // 草稿还没发过消息，它建好的图一定是空的；再选"新建"就沿用它，不再多建文件夹。
      const createdMapName = store.draftsByKey[draftKey]?.createdMapName ?? null;
      if (change.choice.kind === "new" && createdMapName) {
        store.turnOnWithNewMap(draftKey, createdMapName);
        revealLogicMapTabOnFirstEnable(serverId, workspaceId);
        return;
      }
      if (!client) return;
      const { mapName } = await client.setAgentLogicMapEnabled({
        target: { kind: "draft", workspaceId },
        enabled: true,
        mapName: continuedMapName(change.choice),
      });
      if (!mapName) return;
      const next = useDraftLogicMapStore.getState();
      if (change.choice.kind === "new") next.turnOnWithNewMap(draftKey, mapName);
      else next.turnOnWithExistingMap(draftKey, mapName);
      revealLogicMapTabOnFirstEnable(serverId, workspaceId);
    },
    [client, draftKey, serverId, workspaceId],
  );
  const [pendingValue, change] = useLogicMapRequest(run);
  // 草稿自己建的空图由"新建"代表，不再列成一张已有的图。
  const hiddenMapName = draft?.createdMapName ?? null;
  return (
    <LogicMapSwitchControl
      client={client}
      serverId={serverId}
      workspaceId={workspaceId}
      hiddenMapName={hiddenMapName}
      value={pendingValue ?? draft?.enabled ?? false}
      disabled={!client || pendingValue !== null}
      onChange={change}
    />
  );
}

/** 开关打开前先弹出选择：新建，或接着已有的图；关掉不用选。 */
function LogicMapSwitchControl({
  client,
  serverId,
  workspaceId,
  hiddenMapName,
  value,
  disabled,
  onChange,
}: {
  client: LogicMapPickerClient | null;
  serverId: string;
  workspaceId: string | null;
  hiddenMapName: string | null;
  value: boolean;
  disabled: boolean;
  onChange: (change: LogicMapSwitchChange) => void;
}) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const handleValueChange = useCallback(
    (next: boolean) => {
      if (next) {
        setPickerOpen(true);
        return;
      }
      onChange({ kind: "off" });
    },
    [onChange],
  );
  const handleChoose = useCallback(
    (choice: LogicMapChoice) => onChange({ kind: "on", choice }),
    [onChange],
  );
  return (
    <LogicMapPicker
      client={client}
      serverId={serverId}
      workspaceId={workspaceId}
      hiddenMapName={hiddenMapName}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      onChoose={handleChoose}
    >
      <Tooltip delayDuration={0} enabledOnDesktop={!pickerOpen} enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <View style={styles.control} testID="composer-logic-map-toggle">
            <LogicMapLabel />
            <Switch
              value={value}
              onValueChange={handleValueChange}
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
    </LogicMapPicker>
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
