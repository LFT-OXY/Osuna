import React, { useCallback } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreHorizontal } from "lucide-react-native";
import { DropdownMenuTrigger, type DropdownMenuTriggerState } from "@/components/ui/dropdown-menu";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * 设置页行尾与详情头部的 ⋯ 菜单按钮：28×28，悬停或展开时 surface2、按下时 surface3，
 * 图标从 foregroundMuted 变成 foreground。放在 <DropdownMenu> 里用。
 */
export function RowActionsMenuTrigger({
  accessibilityLabel,
  testID,
}: {
  accessibilityLabel: string;
  testID?: string;
}) {
  const triggerStyle = useCallback(
    ({ pressed, hovered, open }: DropdownMenuTriggerState) => [
      styles.button,
      (hovered || open) && styles.buttonHovered,
      pressed && styles.buttonPressed,
    ],
    [],
  );
  const renderIcon = useCallback(
    ({ hovered, open }: DropdownMenuTriggerState) => (
      <ThemedMoreHorizontal
        size={ICON_SIZE.sm}
        uniProps={hovered || open ? foregroundColorMapping : mutedIconColorMapping}
      />
    ),
    [],
  );
  return (
    <DropdownMenuTrigger
      hitSlop={8}
      style={triggerStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {renderIcon}
    </DropdownMenuTrigger>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  buttonPressed: {
    backgroundColor: theme.colors.surface3,
  },
}));
