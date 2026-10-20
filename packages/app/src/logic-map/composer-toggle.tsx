import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { TriangleAlert, Workflow } from "lucide-react-native";
import { useCallback, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text as UiText } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { useToast } from "@/contexts/toast-context";
import { openHostSettingsSection } from "@/navigation/settings-navigation";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { buildDraftLogicMapKey, useDraftLogicMapStore } from "./draft-logic-map-store";
import { LogicMapPicker, type LogicMapChoice, type LogicMapPickerClient } from "./map-picker";
import type { LogicMapToolsUnavailableReason } from "./osuna-tools-availability";

/** 开关在工具栏里的估计宽度：图标、"逻辑图"、Switch 与内边距，算 Agent controls 收缩档位时预留。 */
const LOGIC_MAP_TOGGLE_RESERVED_WIDTH = 140;
/** 老主机时那一行是图标、"逻辑图"加整句"需要更新这台主机上的 Osuna"，要预留整句的宽度。 */
const LOGIC_MAP_HOST_OUTDATED_RESERVED_WIDTH = 300;
/** Osuna 工具不可用时开关后面多出警告图标、原因和"去开启"按钮。 */
const LOGIC_MAP_TOOLS_UNAVAILABLE_EXTRA_WIDTH = 260;

/** Agent controls 收缩时给逻辑图控件预留的宽度；主机太旧或工具不可用时提示比开关长得多。 */
export function logicMapToggleReservedWidth(input: {
  supported: boolean | null;
  toolsUnavailable: boolean;
}): number {
  if (input.supported === false) return LOGIC_MAP_HOST_OUTDATED_RESERVED_WIDTH;
  return input.toolsUnavailable
    ? LOGIC_MAP_TOGGLE_RESERVED_WIDTH + LOGIC_MAP_TOOLS_UNAVAILABLE_EXTRA_WIDTH
    : LOGIC_MAP_TOGGLE_RESERVED_WIDTH;
}

/** 运行中的 Agent 按 agentId 开关；草稿还没有 Agent，按草稿 tab 记住 daemon 建好的图名。 */
type LogicMapComposerToggleProps = {
  serverId: string;
  /** 输入框外框，选择弹层开在它上方，不盖住输入框里的文字。 */
  popoverEdgeRef: RefObject<View | null> | null;
  /** 会话拿不到 Osuna 工具的原因；有原因时开关后面给出说明，开关照常能用。 */
  toolsUnavailableReason: LogicMapToolsUnavailableReason | null;
} & (
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
const ThemedWarningIcon = withUnistyles(TriangleAlert);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const warningIconMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

/**
 * 输入框工具栏上的"逻辑图"开关。主机不支持时不给开关，只提示更新主机；
 * 还不知道主机版本（没连上）时什么都不显示。
 */
export function LogicMapComposerToggle(props: LogicMapComposerToggleProps) {
  // COMPAT(logicMap): added in v0.17.0, remove gate after 2027-04-19.
  const supported = useHostFeatureAvailability(props.serverId, "logicMap");
  if (supported === null) return null;
  if (!supported) return <LogicMapHostOutdated />;
  const toggle =
    props.kind === "agent" ? (
      <AgentLogicMapSwitch
        serverId={props.serverId}
        popoverEdgeRef={props.popoverEdgeRef}
        agentId={props.agentId}
        workspaceId={props.workspaceId}
      />
    ) : (
      <DraftLogicMapSwitch
        serverId={props.serverId}
        popoverEdgeRef={props.popoverEdgeRef}
        draftTabId={props.draftTabId}
        workspaceId={props.workspaceId}
      />
    );
  if (!props.toolsUnavailableReason) return toggle;
  return (
    <View style={styles.withHint}>
      {toggle}
      <LogicMapToolsUnavailableHint
        serverId={props.serverId}
        reason={props.toolsUnavailableReason}
        isDraft={props.kind === "draft"}
      />
    </View>
  );
}

const TOOLS_UNAVAILABLE_MESSAGE_KEYS = {
  tools_not_injected: "logicMap.toggle.toolsNotInjected",
  mcp_disabled: "logicMap.toggle.mcpDisabled",
  tools_not_delivered: "logicMap.toggle.toolsNotDelivered",
} as const satisfies Record<LogicMapToolsUnavailableReason, string>;

/** 说明全文：运行中的 Agent 开启后要重新加载才拿得到工具，草稿新建时就能拿到。 */
function toolsUnavailableDetailKey(reason: LogicMapToolsUnavailableReason, isDraft: boolean) {
  if (reason === "tools_not_injected") {
    return isDraft
      ? "logicMap.toggle.toolsNotInjectedDraftDetail"
      : "logicMap.toggle.toolsNotInjectedDetail";
  }
  return reason === "mcp_disabled"
    ? "logicMap.toggle.mcpDisabledDetail"
    : "logicMap.toggle.toolsNotDeliveredDetail";
}

/** 开关后面的警告：短原因常显，全文在悬停提示与读屏文字里；能在设置里打开的给"去开启"。 */
function LogicMapToolsUnavailableHint({
  serverId,
  reason,
  isDraft,
}: {
  serverId: string;
  reason: LogicMapToolsUnavailableReason;
  isDraft: boolean;
}) {
  const { t } = useTranslation();
  const { glyphSize } = useComposerControlLayout();
  const detail = t(toolsUnavailableDetailKey(reason, isDraft));
  const openAgentsSettings = useCallback(
    () => openHostSettingsSection(serverId, "agents"),
    [serverId],
  );
  return (
    <View style={styles.hint} testID="composer-logic-map-tools-unavailable">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <View
            style={styles.hintReason}
            accessible
            accessibilityLabel={detail}
            testID="composer-logic-map-tools-unavailable-reason"
          >
            <ComposerToolbarGlyph size={glyphSize}>
              <ThemedWarningIcon size={glyphSize} uniProps={warningIconMapping} />
            </ComposerToolbarGlyph>
            <UiText variant="label" color="foregroundMuted" numberOfLines={1}>
              {t(TOOLS_UNAVAILABLE_MESSAGE_KEYS[reason])}
            </UiText>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{detail}</Text>
        </TooltipContent>
      </Tooltip>
      {reason === "tools_not_injected" ? (
        <Button
          variant="outline"
          size="xs"
          onPress={openAgentsSettings}
          testID="composer-logic-map-tools-unavailable-action"
        >
          {t("logicMap.toggle.openAgentsSettings")}
        </Button>
      ) : null}
    </View>
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
  popoverEdgeRef,
  agentId,
  workspaceId,
}: {
  serverId: string;
  popoverEdgeRef: RefObject<View | null> | null;
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
      popoverEdgeRef={popoverEdgeRef}
      value={pendingValue ?? enabled}
      disabled={!client || pendingValue !== null}
      onChange={change}
    />
  );
}

function DraftLogicMapSwitch({
  serverId,
  popoverEdgeRef,
  draftTabId,
  workspaceId,
}: {
  serverId: string;
  popoverEdgeRef: RefObject<View | null> | null;
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
      // 改为接着别的图时带上之前建的空图，daemon 在它没用过时删掉。
      const { mapName } = await client.setAgentLogicMapEnabled({
        target: {
          kind: "draft",
          workspaceId,
          ...(createdMapName ? { createdMapName } : {}),
        },
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
      popoverEdgeRef={popoverEdgeRef}
      value={pendingValue ?? draft?.enabled ?? false}
      disabled={!client || pendingValue !== null}
      onChange={change}
    />
  );
}

/** 开关打开前先弹出选择：新建，或接着已有的图；关掉不用选。弹层开着时开关显示为开，没选就关掉弹层则回到关。 */
function LogicMapSwitchControl({
  client,
  serverId,
  workspaceId,
  hiddenMapName,
  popoverEdgeRef,
  value,
  disabled,
  onChange,
}: {
  client: LogicMapPickerClient | null;
  serverId: string;
  workspaceId: string | null;
  hiddenMapName: string | null;
  popoverEdgeRef: RefObject<View | null> | null;
  value: boolean;
  disabled: boolean;
  onChange: (change: LogicMapSwitchChange) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const handleChoose = useCallback(
    (choice: LogicMapChoice) => onChange({ kind: "on", choice }),
    [onChange],
  );
  const handleTurnOff = useCallback(() => onChange({ kind: "off" }), [onChange]);
  const shownValue = pickerOpen || value;
  return (
    <LogicMapPicker
      client={client}
      serverId={serverId}
      workspaceId={workspaceId}
      hiddenMapName={hiddenMapName}
      edgeRef={popoverEdgeRef}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      onChoose={handleChoose}
    >
      {(openPicker) => (
        <LogicMapSwitchRow
          value={shownValue}
          disabled={disabled}
          tooltipEnabled={!pickerOpen}
          onTurnOn={openPicker}
          onTurnOff={handleTurnOff}
        />
      )}
    </LogicMapPicker>
  );
}

function LogicMapSwitchRow({
  value,
  disabled,
  tooltipEnabled,
  onTurnOn,
  onTurnOff,
}: {
  value: boolean;
  disabled: boolean;
  tooltipEnabled: boolean;
  onTurnOn: () => void;
  onTurnOff: () => void;
}) {
  const { t } = useTranslation();
  const handleValueChange = useCallback(
    (next: boolean) => (next ? onTurnOn() : onTurnOff()),
    [onTurnOff, onTurnOn],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop={tooltipEnabled} enabledOnMobile={false}>
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
  withHint: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  hint: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  hintReason: {
    height: theme.controlHeight.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
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
