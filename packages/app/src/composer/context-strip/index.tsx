import { useCallback, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Folder } from "lucide-react-native";
import { BranchSwitcher, StripBranchTrigger } from "@/components/branch-switcher";
import { Text } from "@/components/ui/text";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import { HOST_BADGE_ICON_SIZE, HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { PlanUsageStripGauge } from "@/provider-usage/strip-gauge";
import { SPACING, type Theme } from "@/styles/theme";
import {
  resolveBranchSwitch,
  resolveComposerContext,
  resolvePlanUsageSpace,
  type BranchSwitchConditions,
} from "./model";

const ThemedFolder = withUnistyles(Folder);
const iconMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// 空间不够时分支名至少保留这么宽（含图标），其余让给套餐用量。
const BRANCH_MIN_WIDTH = SPACING[20];
// 与 styles.strip / styles.fitRegion 的 gap 一致。
const ITEM_GAP = SPACING[3];

const BRANCH_SWITCH_DISABLED_REASON_KEYS = {
  "agent-running": "composer.context.branchSwitchAgentRunning",
  "host-disconnected": "composer.context.branchSwitchHostDisconnected",
} as const;

/** 不可见的保留面板量出 0，沿用上次的宽度。 */
function useMeasuredWidth() {
  const [width, setWidth] = useState<number | null>(null);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = Math.ceil(event.nativeEvent.layout.width);
    if (measured > 0) setWidth(measured);
  }, []);
  return { width, handleLayout };
}

/**
 * 附着在 Composer 底部的窄条。状态没到之前条本身照常占位，内容到了也不改变高度。
 * 分支名是切换分支的入口，工作区类型只读；右侧是当前提供方的套餐用量，host 按该 host
 * 自己的徽标设置显示，本机默认隐藏。
 */
export function ComposerContextStrip({
  serverId,
  workspaceId,
  cwd,
  gitStatus,
  branchSwitchConditions,
  planUsageProviderId,
}: {
  serverId: string;
  workspaceId: string;
  cwd: string;
  gitStatus: CheckoutStatusPayload | null;
  branchSwitchConditions: BranchSwitchConditions;
  /** 显示谁的套餐用量；没有提供方时不显示，也不取数。 */
  planUsageProviderId: string | null;
}) {
  const { t } = useTranslation();
  const hostBadge = useHostBadges({ enabled: true }).get(serverId) ?? null;
  const context = resolveComposerContext(gitStatus);
  const branchSwitch = resolveBranchSwitch(context, branchSwitchConditions);
  const disabledReasonKey =
    branchSwitch.kind === "disabled"
      ? BRANCH_SWITCH_DISABLED_REASON_KEYS[branchSwitch.reason]
      : null;
  const hasBranch = branchSwitch.kind !== "hidden";
  const fitRegion = useMeasuredWidth();
  const branchNatural = useMeasuredWidth();
  const planUsageSpace = resolvePlanUsageSpace({
    regionWidth: fitRegion.width,
    hasBranch,
    branchNaturalWidth: branchNatural.width,
    itemGap: ITEM_GAP,
    branchMinWidth: BRANCH_MIN_WIDTH,
  });
  return (
    <View style={styles.strip} testID="composer-context-strip">
      {context.workspaceKind ? (
        <View style={styles.item}>
          <ThemedFolder size={HOST_BADGE_ICON_SIZE} uniProps={iconMutedMapping} />
          <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
            {context.workspaceKind === "worktree"
              ? t("composer.context.worktree")
              : t("composer.context.local")}
          </Text>
        </View>
      ) : null}
      <View style={styles.fitRegion} onLayout={fitRegion.handleLayout}>
        {planUsageProviderId && hasBranch ? (
          // 分支名不截断时有多宽：同一个触发器的看不见的副本，不受可用宽度挤压。
          <View
            style={styles.measureLayer}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View onLayout={branchNatural.handleLayout}>
              <StripBranchTrigger label={context.branch ?? ""} open={false} disabled />
            </View>
          </View>
        ) : null}
        {hasBranch ? (
          <View style={[styles.item, styles.branch]}>
            <BranchSwitcher
              appearance="strip"
              currentBranchName={context.branch}
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceDirectory={cwd}
              isGitCheckout
              disabledReason={disabledReasonKey ? t(disabledReasonKey) : null}
              testID="composer-context-strip-branch-switcher"
            />
          </View>
        ) : null}
        {hasBranch ? null : <View style={styles.spacer} />}
        {planUsageProviderId ? (
          <PlanUsageStripGauge
            serverId={serverId}
            providerId={planUsageProviderId}
            space={planUsageSpace}
          />
        ) : null}
      </View>
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // 两侧收进，让开 Composer 的底角；顶边由 Composer 的底边充当，所以只画三条边。
  strip: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    height: theme.controlHeight.md,
    marginHorizontal: theme.spacing[6],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderTopWidth: 0,
    borderColor: theme.colors.borderComposer,
    borderBottomLeftRadius: theme.radius.xl,
    borderBottomRightRadius: theme.radius.xl,
    overflow: "hidden",
  },
  item: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // 分支名和套餐用量共用的空间，量出宽度交给套餐用量做取舍。
  fitRegion: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  measureLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0,
    alignItems: "flex-start",
    pointerEvents: "none",
  },
  // 分支名长度不受控，先于其他项截断；有余量时占满，把套餐用量推到右侧。
  branch: {
    minWidth: 0,
    flexShrink: 1,
    flexGrow: 1,
  },
  spacer: {
    flexGrow: 1,
  },
}));
