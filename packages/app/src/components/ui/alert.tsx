import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react-native";
import React, { type ReactNode, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  type ButtonControlSize,
  buttonIconSize,
  createControlGeometry,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

export type AlertVariant = "default" | "info" | "success" | "warning" | "error";
export type AlertSize = ButtonControlSize;

export interface AlertProps {
  title?: string;
  description?: ReactNode;
  variant?: AlertVariant;
  size?: AlertSize;
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
  size = "md",
  children,
  testID,
}: AlertProps) {
  const containerStyle = useMemo(
    () => [
      styles.container,
      resolveSizeStyles(size).container,
      getVariantStyles(variant).container,
    ],
    [size, variant],
  );
  const titleStyle = useMemo(
    () => [styles.title, resolveSizeStyles(size).text, getVariantStyles(variant).title],
    [size, variant],
  );
  const descriptionStyle = useMemo(
    () => [styles.description, resolveSizeStyles(size).text],
    [size],
  );
  const leadStyle = useMemo(() => [styles.lead, resolveSizeStyles(size).lead], [size]);
  const iconSlotStyle = useMemo(() => [styles.iconSlot, resolveSizeStyles(size).iconSlot], [size]);

  const resolvedIcon = useMemo(() => {
    if (variant === "default") return null;
    const Icon = ThemedIcons[variant];
    return <Icon size={buttonIconSize[size]} uniProps={ICON_COLOR_MAPPINGS[variant]} />;
  }, [variant, size]);

  let descriptionContent: ReactNode = null;
  if (typeof description === "string" && description !== "") {
    descriptionContent = <Text style={descriptionStyle}>{description}</Text>;
  } else if (description != null && description !== "") {
    descriptionContent = <View style={styles.descriptionSlot}>{description}</View>;
  }
  const leadContent = title ? <Text style={titleStyle}>{title}</Text> : descriptionContent;
  const belowLead = title ? descriptionContent : null;
  const hasBody = belowLead !== null || Boolean(children);

  return (
    <View style={containerStyle} testID={testID} accessibilityRole="alert">
      <View style={leadStyle}>
        {resolvedIcon ? <View style={iconSlotStyle}>{resolvedIcon}</View> : null}
        {leadContent ? <View style={styles.leadText}>{leadContent}</View> : null}
      </View>
      {hasBody ? (
        <View style={resolvedIcon ? resolveSizeStyles(size).indent : null}>
          {belowLead}
          {children ? <View style={styles.actions}>{children}</View> : null}
        </View>
      ) : null}
    </View>
  );
}

function resolveSizeStyles(size: AlertSize) {
  if (size === "xs") {
    return {
      container: styles.containerXs,
      text: styles.textXs,
      lead: styles.leadXs,
      iconSlot: styles.iconSlotXs,
      indent: styles.indentXs,
    };
  }
  if (size === "sm") {
    return {
      container: styles.containerSm,
      text: styles.textSm,
      lead: styles.leadSm,
      iconSlot: styles.iconSlotSm,
      indent: styles.indentSm,
    };
  }
  if (size === "lg") {
    return {
      container: styles.containerLg,
      text: styles.textLg,
      lead: styles.leadLg,
      iconSlot: styles.iconSlotLg,
      indent: styles.indentLg,
    };
  }
  return {
    container: styles.containerMd,
    text: styles.textMd,
    lead: styles.leadMd,
    iconSlot: styles.iconSlotMd,
    indent: styles.indentMd,
  };
}

const styles = StyleSheet.create((theme) => {
  const { alert } = createControlGeometry(theme);

  return {
    container: {
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
      backgroundColor: "transparent",
    },
    containerXs: alert.xs.container,
    containerSm: alert.sm.container,
    containerMd: alert.md.container,
    containerLg: alert.lg.container,
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
    lead: {
      flexDirection: "row",
      alignItems: "center",
    },
    iconSlot: {
      alignItems: "center",
    },
    leadText: {
      flex: 1,
      minWidth: 0,
    },
    leadXs: alert.xs.lead,
    leadSm: alert.sm.lead,
    leadMd: alert.md.lead,
    leadLg: alert.lg.lead,
    iconSlotXs: alert.xs.iconSlot,
    iconSlotSm: alert.sm.iconSlot,
    iconSlotMd: alert.md.iconSlot,
    iconSlotLg: alert.lg.iconSlot,
    indentXs: alert.xs.indent,
    indentSm: alert.sm.indent,
    indentMd: alert.md.indent,
    indentLg: alert.lg.indent,
    textXs: alert.xs.text,
    textSm: alert.sm.text,
    textMd: alert.md.text,
    textLg: alert.lg.text,
    title: {
      color: theme.colors.foreground,
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
      fontWeight: theme.fontWeight.normal,
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
  };
});

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
