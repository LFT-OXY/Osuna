import React from "react";
import { Pressable, Text, View } from "react-native";
import { Minus, Plus, Scan, ZoomIn, ZoomOut } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import type { ZoomableViewportAction } from "./types";

interface ViewportToolbarProps {
  actions: ZoomableViewportAction[];
  maxScale: number;
  minScale: number;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** 已经是打开时的视图，复位没有可做的。 */
  resetDisabled: boolean;
  scale: number;
  visible: boolean;
}

interface ResolvedViewportAction extends ZoomableViewportAction {
  disabled: boolean;
}

export const ViewportToolbar = React.memo(function ViewportToolbar({
  actions,
  maxScale,
  minScale,
  onReset,
  onZoomIn,
  onZoomOut,
  resetDisabled,
  scale,
  visible,
}: ViewportToolbarProps) {
  const { t } = useTranslation();
  const viewportActions: ResolvedViewportAction[] = [
    {
      icon: ZoomIn,
      label: t("message.diagram.zoomIn"),
      onPress: onZoomIn,
      disabled: scale >= maxScale,
    },
    {
      icon: ZoomOut,
      label: t("message.diagram.zoomOut"),
      onPress: onZoomOut,
      disabled: scale <= minScale,
    },
    {
      icon: Scan,
      label: t("message.diagram.resetZoom"),
      onPress: onReset,
      disabled: resetDisabled,
    },
    ...actions.map((action) => ({ ...action, disabled: false })),
  ];

  return (
    <View style={styles.cluster} testID="zoomable-viewport-toolbar">
      {viewportActions.map((action) => (
        <ViewportToolbarButton
          key={action.label}
          action={action}
          disabled={action.disabled}
          visible={visible}
        />
      ))}
    </View>
  );
});

function ViewportToolbarButton({
  action,
  disabled,
  visible,
  surface = "floating",
}: {
  action: ZoomableViewportAction;
  disabled: boolean;
  visible: boolean;
  /** floating：自己带底色浮在内容上；bar：放在缩放条里，用条的底色。 */
  surface?: "floating" | "bar";
}) {
  const Icon = action.icon;
  const isCompact = useIsCompactFormFactor();
  const iconSize = iconButtonChromeGlyphSize("small", isCompact);
  const buttonStyle = React.useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) =>
      iconButtonChromeStyle({
        size: "small",
        compact: isCompact,
        state: { hovered, pressed },
        disabled,
        style: resolveButtonStyle({ surface, visible }),
      }),
    [disabled, isCompact, surface, visible],
  );
  return (
    <Pressable
      accessibilityLabel={action.label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={isCompact ? 6 : 4}
      onPress={action.onPress}
      style={buttonStyle}
      testID={action.testID}
    >
      {({ hovered }) => (
        <Icon size={iconSize} color={hovered ? styles.iconHovered.color : styles.icon.color} />
      )}
    </Pressable>
  );
}

interface ViewportZoomBarProps {
  /** 相对内容原始尺寸的比例，显示成百分比。 */
  displayScale: number;
  maxScale: number;
  minScale: number;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  resetDisabled: boolean;
  scale: number;
}

/** 右下角常驻的缩放条：缩小、百分比、放大、回到打开时的视图。 */
export const ViewportZoomBar = React.memo(function ViewportZoomBar({
  displayScale,
  maxScale,
  minScale,
  onReset,
  onZoomIn,
  onZoomOut,
  resetDisabled,
  scale,
}: ViewportZoomBarProps) {
  const { t } = useTranslation();
  const zoomOut = React.useMemo(
    () => ({ icon: Minus, label: t("message.diagram.zoomOut"), onPress: onZoomOut }),
    [onZoomOut, t],
  );
  const zoomIn = React.useMemo(
    () => ({ icon: Plus, label: t("message.diagram.zoomIn"), onPress: onZoomIn }),
    [onZoomIn, t],
  );
  const reset = React.useMemo(
    () => ({ icon: Scan, label: t("message.diagram.resetZoom"), onPress: onReset }),
    [onReset, t],
  );
  return (
    <View style={styles.zoomBar} testID="zoomable-viewport-zoom-bar">
      <ViewportToolbarButton action={zoomOut} disabled={scale <= minScale} visible surface="bar" />
      <Text style={styles.zoomPercent} testID="zoomable-viewport-zoom-percent">
        {`${Math.round(displayScale * 100)}%`}
      </Text>
      <ViewportToolbarButton action={zoomIn} disabled={scale >= maxScale} visible surface="bar" />
      <ViewportToolbarButton action={reset} disabled={resetDisabled} visible surface="bar" />
    </View>
  );
});

function resolveButtonStyle(input: { surface: "floating" | "bar"; visible: boolean }) {
  if (input.surface === "bar") return styles.barButton;
  return input.visible ? styles.button : styles.buttonHidden;
}

const styles = StyleSheet.create((theme) => ({
  cluster: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
    zIndex: 1,
    flexDirection: "row",
    gap: theme.spacing[1],
    pointerEvents: "box-none",
  },
  button: {
    backgroundColor: theme.colors.surface2,
    opacity: 1,
    pointerEvents: "auto",
  },
  buttonHidden: {
    backgroundColor: theme.colors.surface2,
    opacity: 0,
    pointerEvents: "none",
  },
  barButton: {
    opacity: 1,
    pointerEvents: "auto",
  },
  icon: { color: theme.colors.foregroundMuted },
  zoomBar: {
    position: "absolute",
    right: theme.spacing[2],
    bottom: theme.spacing[2],
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
    height: theme.controlHeight.lg,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.radius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceCard,
  },
  zoomPercent: {
    minWidth: theme.spacing[8],
    textAlign: "center",
    ...theme.typeScale.caption,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  iconHovered: { color: theme.colors.foreground },
}));
