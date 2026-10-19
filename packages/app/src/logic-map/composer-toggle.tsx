import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { Workflow } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
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
import type { Theme } from "@/styles/theme";
import { buildDraftLogicMapKey, useDraftLogicMapStore } from "./draft-logic-map-store";

/** 运行中的 Agent 按 agentId 开关；草稿还没有 Agent，按草稿键记住 daemon 建好的图名。 */
type LogicMapToggleTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "draft"; draftKey: string; cwd: string };

interface LogicMapComposerToggleProps {
  serverId: string;
  /** 运行中的 Agent 的 id；草稿时是草稿 tab 的 id。 */
  agentId: string;
  cwd: string;
  isDraft: boolean;
}

interface LogicMapSwitchProps {
  serverId: string;
  target: LogicMapToggleTarget;
}

const ThemedWorkflowIcon = withUnistyles(Workflow);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function useLogicMapEnabled(serverId: string, target: LogicMapToggleTarget): boolean {
  const agentId = target.kind === "agent" ? target.agentId : null;
  const draftKey = target.kind === "draft" ? target.draftKey : null;
  const agentEnabled = useSessionStore((state) => {
    if (!agentId) return false;
    const agent = state.sessions[serverId]?.agents?.get(agentId);
    return getLogicMapNameFromLabels(agent?.labels) !== null;
  });
  const draftEnabled = useDraftLogicMapStore((state) =>
    draftKey ? Boolean(state.mapNameByDraftKey[draftKey]) : false,
  );
  return target.kind === "agent" ? agentEnabled : draftEnabled;
}

/**
 * 输入框工具栏上的"逻辑图"开关。主机不支持时不给开关，只提示更新主机；
 * 还不知道主机版本（没连上）时什么都不显示。
 */
export function LogicMapComposerToggle({
  serverId,
  agentId,
  cwd,
  isDraft,
}: LogicMapComposerToggleProps) {
  // COMPAT(logicMap): added in v0.17.0, remove gate after 2027-04-19.
  const supported = useHostFeatureAvailability(serverId, "logicMap");
  const target = useMemo<LogicMapToggleTarget>(
    () =>
      isDraft
        ? { kind: "draft", draftKey: buildDraftLogicMapKey({ serverId, draftTabId: agentId }), cwd }
        : { kind: "agent", agentId },
    [agentId, cwd, isDraft, serverId],
  );
  if (supported === null) return null;
  if (!supported) return <LogicMapHostOutdated />;
  return <LogicMapSwitch serverId={serverId} target={target} />;
}

function LogicMapSwitch({ serverId, target }: LogicMapSwitchProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { glyphSize } = useComposerControlLayout();
  const client = useHostRuntimeClient(serverId);
  const enabled = useLogicMapEnabled(serverId, target);
  // 请求在路上时先显示用户点到的状态，回包后以 daemon 为准。
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const value = pendingValue ?? enabled;

  const handleValueChange = useCallback(
    async (next: boolean) => {
      if (!client) return;
      setPendingValue(next);
      try {
        if (target.kind === "agent") {
          await client.setAgentLogicMapEnabled({ agentId: target.agentId, enabled: next });
        } else {
          const { mapName } = await client.setAgentLogicMapEnabled({
            cwd: target.cwd,
            enabled: next,
          });
          useDraftLogicMapStore.getState().setDraftMapName(target.draftKey, mapName);
        }
      } catch (error) {
        toast.error(t("logicMap.toggle.failed", { error: getErrorMessage(error) }));
      } finally {
        setPendingValue(null);
      }
    },
    [client, t, target, toast],
  );

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View style={styles.control} testID="composer-logic-map-toggle">
          <ComposerToolbarGlyph size={glyphSize}>
            <ThemedWorkflowIcon size={glyphSize} uniProps={mutedIconMapping} />
          </ComposerToolbarGlyph>
          <UiText variant="label" color="foregroundMuted" weight="medium" numberOfLines={1}>
            {t("logicMap.toggle.label")}
          </UiText>
          <Switch
            value={value}
            onValueChange={handleValueChange}
            disabled={!client || pendingValue !== null}
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

function LogicMapHostOutdated() {
  const { t } = useTranslation();
  const { glyphSize } = useComposerControlLayout();
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View
          style={styles.control}
          accessible
          accessibilityLabel={t("logicMap.toggle.hostOutdatedDetail")}
          testID="composer-logic-map-host-outdated"
        >
          <ComposerToolbarGlyph size={glyphSize}>
            <ThemedWorkflowIcon size={glyphSize} uniProps={mutedIconMapping} />
          </ComposerToolbarGlyph>
          <UiText variant="label" color="foregroundMuted" weight="medium" numberOfLines={1}>
            {t("logicMap.toggle.label")}
          </UiText>
          <UiText variant="label" color="foregroundMuted" numberOfLines={1} style={styles.note}>
            {t("logicMap.toggle.hostOutdated")}
          </UiText>
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("logicMap.toggle.hostOutdatedDetail")}</Text>
      </TooltipContent>
    </Tooltip>
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
  note: {
    opacity: theme.opacity[50],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
