import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react-native";
import React, { type ReactNode, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export type AlertVariant = "default" | "info" | "success" | "warning" | "error";

export interface AlertProps {
  title?: string;
  description?: ReactNode;
  variant?: AlertVariant;
  icon?: ReactNode;
  children?: ReactNode;
  testID?: string;
}

const ICON_COLOR_MAPPINGS: Record<Exclude<AlertVariant, "default">, (theme: Theme) => object> = {
  info: (theme) => ({ color: theme.colors.palette.blue[300] }),
  success: (theme) => ({ color: theme.colors.statusSuccess }),
  warning: (theme) => ({ color: theme.colors.palette.amber[500] }),
  error: (theme) => ({ color: theme.colors.destructive }),
};

const ThemedIcons = {
  info: withUnistyles(Info),
  success: withUnistyles(CheckCircle2),
  warning: withUnistyles(AlertTriangle),
  error: withUnistyles(XCircle),
};

export function Alert({
  title,
  description,
  variant = "default",
  icon,
  children,
  testID,
}: AlertProps) {
  const containerStyle = useMemo(
    () => [styles.container, getVariantStyles(variant).container],
    [variant],
  );
  const titleStyle = useMemo(() => [styles.title, getVariantStyles(variant).title], [variant]);

  const resolvedIcon = useMemo(() => {
    if (icon !== undefined) return icon;
    if (variant === "default") return null;
    const Icon = ThemedIcons[variant];
    return <Icon size={ICON_SIZE.sm} uniProps={ICON_COLOR_MAPPINGS[variant]} />;
  }, [icon, variant]);

  const hasDescription = description != null && description !== "";

  return (
    <View style={containerStyle} testID={testID} accessibilityRole="alert">
      {resolvedIcon ? <View style={styles.iconSlot}>{resolvedIcon}</View> : null}
      <View style={styles.body}>
        {title ? <Text style={titleStyle}>{title}</Text> : null}
        {hasDescription && typeof description === "string" ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
        {hasDescription && typeof description !== "string" ? (
          <View style={styles.descriptionSlot}>{description}</View>
        ) : null}
        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: "transparent",
    borderRadius: theme.borderRadius.xl,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  containerInfo: {
    borderColor: theme.colors.palette.blue[300],
  },
  // The risk block: a light amber fill instead of an outline, so a warning inside a dialog reads
  // as a caution about the action rather than as another bordered card.
  containerWarning: {
    borderColor: "transparent",
    backgroundColor: theme.colors.surfaceWarning,
    borderRadius: theme.radius.md,
  },
  containerError: {
    borderColor: theme.colors.destructive,
  },
  iconSlot: {
    paddingTop: 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  titleInfo: {
    color: theme.colors.palette.blue[300],
  },
  titleSuccess: {
    color: theme.colors.statusSuccess,
  },
  titleWarning: {
    color: theme.colors.palette.amber[500],
  },
  titleError: {
    color: theme.colors.destructive,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  descriptionSlot: {
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));

// 每个 variant 的容器与标题样式放在一张表里；在渲染时取，不在模块作用域读 styles。
function getVariantStyles(variant: AlertVariant) {
  const byVariant = {
    default: { container: null, title: null },
    info: { container: styles.containerInfo, title: styles.titleInfo },
    success: { container: null, title: styles.titleSuccess },
    warning: { container: styles.containerWarning, title: styles.titleWarning },
    error: { container: styles.containerError, title: styles.titleError },
  };
  return byVariant[variant];
}
