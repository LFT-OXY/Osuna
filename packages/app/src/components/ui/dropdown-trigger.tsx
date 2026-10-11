import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import {
  buttonIconSize,
  createControlGeometry,
  type ButtonControlSize,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
  type DropdownMenuTriggerState,
} from "@/components/ui/dropdown-menu";

const ThemedChevronDown = withUnistyles(ChevronDown);

interface DropdownTriggerProps extends Omit<DropdownMenuTriggerProps, "children" | "style"> {
  /** 选中项的文字；传节点时内容由调用方自己排。 */
  children?: ReactNode;
  /** Icon or swatch before the label. */
  leading?: ReactNode;
  size?: ButtonControlSize;
  chevron?: ReactNode | null;
  /** 已存的值失效：描边换成警示色，悬停与展开时也不变。 */
  tone?: "warning";
}

const chevronColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * 行内下拉的触发器：与同尺寸的 `<Button>` 同高、同圆角，静止时 `borderInput` 描边，
 * 悬停或展开时换成 `borderAccent`。设置行、表单行里的选值下拉都用它，不各自画外框。
 */
export function DropdownTrigger({
  children,
  leading,
  size = "sm",
  chevron,
  disabled,
  tone,
  ...props
}: DropdownTriggerProps): ReactElement {
  const triggerStyle = useCallback(
    ({ hovered, open }: DropdownMenuTriggerState) => [
      styles.trigger,
      resolveSizeStyle(size),
      (hovered || open) && !disabled ? styles.triggerHover : null,
      tone === "warning" ? styles.triggerWarning : null,
      disabled ? styles.triggerDisabled : null,
    ],
    [disabled, size, tone],
  );
  const labelStyle = useMemo(() => [styles.label, size === "xs" && styles.labelXs], [size]);

  return (
    <DropdownMenuTrigger {...props} disabled={disabled} style={triggerStyle}>
      {leading}
      {typeof children === "string" ? (
        <Text style={labelStyle} numberOfLines={1}>
          {children}
        </Text>
      ) : (
        children
      )}
      {chevron !== null &&
        (chevron ?? (
          <View style={styles.chevronContainer}>
            <ThemedChevronDown size={buttonIconSize[size]} uniProps={chevronColorMapping} />
          </View>
        ))}
    </DropdownMenuTrigger>
  );
}

function resolveSizeStyle(size: ButtonControlSize) {
  if (size === "xs") return styles.xs;
  if (size === "md") return styles.md;
  if (size === "lg") return styles.lg;
  return styles.sm;
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);
  return {
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.borderInput,
    },
    xs: geometry.buttonXs,
    sm: {
      ...geometry.buttonSm,
      paddingLeft: theme.spacing[3],
      paddingRight: theme.spacing[2],
    },
    md: geometry.buttonMd,
    lg: geometry.buttonLg,
    triggerHover: {
      borderColor: theme.colors.borderAccent,
    },
    triggerWarning: {
      borderColor: theme.colors.statusWarning,
    },
    triggerDisabled: {
      opacity: theme.opacity[50],
    },
    label: {
      flexShrink: 1,
      color: theme.colors.foreground,
      ...geometry.buttonText,
    },
    labelXs: geometry.buttonTextXs,
    chevronContainer: {
      transform: [{ translateY: 1 }],
    },
  };
});
