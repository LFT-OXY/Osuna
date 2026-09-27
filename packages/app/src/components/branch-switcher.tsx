import { forwardRef, useCallback, useMemo, useRef } from "react";
import { Pressable, Text, View, type PressableProps } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher } from "@/hooks/use-branch-switcher";
import {
  ToolbarLabelSelectTrigger,
  toolbarLabelTriggerStyle,
  type ToolbarLabelTriggerState,
} from "@/components/ui/toolbar-label-trigger";
import { Text as UiText } from "@/components/ui/text";
import { HOST_BADGE_ICON_SIZE } from "@/hosts/host-badge";

interface BranchSwitcherProps {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  testID?: string;
  /** toolbar：Changes 面板工具栏样式；strip：Composer 上下文条里的紧凑样式。 */
  appearance?: "toolbar" | "strip";
  /** 非空即不可用：触发器置灰、不响应点击与键盘，tooltip 显示这段原因。 */
  disabledReason?: string | null;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedGitBranch = withUnistyles(GitBranch);

interface StripBranchTriggerProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  open: boolean;
}

// 与上下文条里只读项同一副内容（分支图标 + caption 弱色文字），外框与高亮沿用工具栏标签触发器。
const StripBranchTrigger = forwardRef<View, StripBranchTriggerProps>(function StripBranchTrigger(
  { label, open, disabled, ...props },
  ref,
) {
  const triggerStyle = useCallback(
    (state: ToolbarLabelTriggerState) => [
      toolbarLabelTriggerStyle({ ...state, open }),
      styles.stripTrigger,
      disabled ? styles.disabled : null,
    ],
    [disabled, open],
  );
  return (
    <Pressable {...props} ref={ref} disabled={disabled} style={triggerStyle}>
      <ThemedGitBranch size={HOST_BADGE_ICON_SIZE} uniProps={foregroundMutedIconColorMapping} />
      <UiText variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.stripLabel}>
        {label}
      </UiText>
    </Pressable>
  );
});

export function BranchSwitcher({
  currentBranchName,
  serverId,
  workspaceId,
  workspaceDirectory,
  isGitCheckout,
  testID = "workspace-header-branch-switcher",
  appearance = "toolbar",
  disabledReason = null,
}: BranchSwitcherProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();

  const { branchOptions, isOpen, setIsOpen, handleBranchSelect } = useBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory,
    currentBranchName,
    isGitCheckout,
    isConnected,
    toast,
    queryClient,
  });

  const isDisabled = disabledReason !== null;
  const handleOpen = useCallback(() => {
    if (!isDisabled) setIsOpen(true);
  }, [isDisabled, setIsOpen]);

  const branchLeadingSlot = useMemo(
    () => <ThemedGitBranch size={14} uniProps={foregroundMutedIconColorMapping} />,
    [],
  );

  const renderBranchOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={branchLeadingSlot}
      />
    ),
    [branchLeadingSlot],
  );

  if (!currentBranchName) {
    return null;
  }

  const accessibilityLabel =
    disabledReason === null
      ? t("branchSwitcher.currentBranch", { branchName: currentBranchName })
      : t("branchSwitcher.currentBranchUnavailable", {
          branchName: currentBranchName,
          reason: disabledReason,
        });
  const isStrip = appearance === "strip";

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          {isStrip ? (
            <StripBranchTrigger
              testID={testID}
              label={currentBranchName}
              open={isOpen}
              disabled={isDisabled}
              onPress={handleOpen}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
            />
          ) : (
            <ToolbarLabelSelectTrigger
              testID={testID}
              label={currentBranchName}
              open={isOpen}
              disabled={isDisabled}
              onPress={handleOpen}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
            />
          )}
        </TooltipTrigger>
        <TooltipContent side={isStrip ? "top" : "bottom"}>
          <Text style={styles.tooltipText}>
            {disabledReason ?? t("branchSwitcher.triggerTooltip")}
          </Text>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={branchOptions}
        value={currentBranchName}
        onSelect={handleBranchSelect}
        searchable
        placeholder={t("branchSwitcher.placeholder")}
        searchPlaceholder={t("branchSwitcher.searchPlaceholder")}
        emptyText={t("branchSwitcher.empty")}
        title={t("branchSwitcher.title")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        // 上下文条贴着 Composer 底边，下拉往上开才不会被窗口底部截住。
        desktopPlacement={isStrip ? "top-start" : "bottom-start"}
        desktopPreventInitialFlash
        desktopMinWidth={280}
        renderOption={renderBranchOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  // 底色往两侧多出一点，文字位置与只读时保持一致。
  stripTrigger: {
    marginHorizontal: -theme.spacing[1],
  },
  stripLabel: {
    minWidth: 0,
    flexShrink: 1,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
}));
