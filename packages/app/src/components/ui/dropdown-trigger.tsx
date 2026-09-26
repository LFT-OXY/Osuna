import { useCallback, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { createControlGeometry } from "@/components/ui/control-geometry";
import {
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
  type DropdownMenuTriggerState,
} from "@/components/ui/dropdown-menu";

const ThemedChevronDown = withUnistyles(ChevronDown);

interface DropdownTriggerProps extends Omit<DropdownMenuTriggerProps, "children" | "style"> {
  children?: ReactNode;
  chevron?: ReactNode | null;
}

const chevronColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * 行内下拉的触发器：与同尺寸（sm）的 `<Button>` 同高、同圆角，静止时 `borderInput` 描边，
 * 悬停或展开时换成 `borderAccent`。设置行、表单行里的选值下拉都用它，不各自画外框。
 */
export function DropdownTrigger({
  children,
  chevron,
  disabled,
  ...props
}: DropdownTriggerProps): ReactElement {
  const triggerStyle = useCallback(
    ({ hovered, open }: DropdownMenuTriggerState) => [
      styles.trigger,
      (hovered || open) && !disabled ? styles.triggerHover : null,
      disabled ? styles.triggerDisabled : null,
    ],
    [disabled],
  );
  return (
    <DropdownMenuTrigger {...props} disabled={disabled} style={triggerStyle}>
      {children}
      {chevron !== null &&
        (chevron ?? (
          <View style={styles.chevronContainer}>
            <ThemedChevronDown size={ICON_SIZE.sm} uniProps={chevronColorMapping} />
          </View>
        ))}
    </DropdownMenuTrigger>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);
  return {
    trigger: {
      ...geometry.buttonSm,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      paddingLeft: theme.spacing[3],
      paddingRight: theme.spacing[2],
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.borderInput,
    },
    triggerHover: {
      borderColor: theme.colors.borderAccent,
    },
    triggerDisabled: {
      opacity: theme.opacity[50],
    },
    chevronContainer: {
      transform: [{ translateY: 1 }],
    },
  };
});
