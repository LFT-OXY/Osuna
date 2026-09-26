import type { StyleProp, ViewStyle } from "react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export type ButtonControlSize = "xs" | "sm" | "md" | "lg";
export type FieldControlSize = "sm" | "md";
export type SegmentedControlSize = "xs" | "sm" | "md";
export type ControlInteractionPhase = "rest" | "hover" | "active";

export interface ControlInteractionState {
  hovered?: boolean;
  focused?: boolean;
  pressed?: boolean;
  open?: boolean;
  active?: boolean;
  disabled?: boolean;
}

export interface ControlInteractionStyleMap {
  controlRest: StyleProp<ViewStyle>;
  controlHover: StyleProp<ViewStyle>;
  controlActive: StyleProp<ViewStyle>;
  controlDisabled?: StyleProp<ViewStyle>;
}

const TIGHT_CONTROL_HEIGHT = 28;
const COMPACT_CONTROL_HEIGHT = 32;
const FIELD_CONTROL_HEIGHT = 44;
export const HEADER_CONTROL_HEIGHT = 26;
// 分段控件的轨道内边距：分段比轨道各边缩进 2，圆角同心收小同样的量。
const SEGMENTED_TRACK_INSET = 2;
const SWITCH_TRACK_WIDTH = 32;
const SWITCH_TRACK_HEIGHT = 18;
const SWITCH_THUMB_SIZE = 14;
const CONTROL_FOCUS_RING_WIDTH = 2;
const CONTROL_FOCUS_RING_OFFSET = 1;
const CONTROL_CENTER_JUSTIFY_CONTENT = "center";
const FIELD_TEXT_LINE_HEIGHT_RATIO = 1.4;

/**
 * The three touch heights every button, field, and segmented control is built from on a
 * compact layout, where a thumb drives it. Exported so a row that hosts one of those controls
 * can size itself from the same numbers instead of guessing a height the control then outgrows.
 * From the `md` breakpoint up (desktop, tablet) a control takes `theme.controlHeight` instead;
 * `md` is where `useIsCompactFormFactor` divides, same as the menu row height.
 */
export const CONTROL_HEIGHTS = {
  tight: TIGHT_CONTROL_HEIGHT,
  compact: COMPACT_CONTROL_HEIGHT,
  field: FIELD_CONTROL_HEIGHT,
};

/** Compact-layout (touch) button heights. */
export const buttonControlHeight: Record<ButtonControlSize, number> = {
  xs: CONTROL_HEIGHTS.tight,
  sm: CONTROL_HEIGHTS.compact,
  md: CONTROL_HEIGHTS.field,
  lg: CONTROL_HEIGHTS.field,
};

export const buttonIconSize: Record<ButtonControlSize, number> = {
  xs: ICON_SIZE.xs,
  sm: ICON_SIZE.sm,
  md: ICON_SIZE.md,
  lg: ICON_SIZE.lg,
};

export const segmentedIconSize: Record<SegmentedControlSize, number> = {
  xs: ICON_SIZE.xs,
  sm: ICON_SIZE.sm,
  md: ICON_SIZE.md,
};

export const switchGeometry = {
  trackWidth: SWITCH_TRACK_WIDTH,
  trackHeight: SWITCH_TRACK_HEIGHT,
  thumbSize: SWITCH_THUMB_SIZE,
  thumbTravel: SWITCH_TRACK_WIDTH - SWITCH_THUMB_SIZE - (SWITCH_TRACK_HEIGHT - SWITCH_THUMB_SIZE),
};

// 断点值用对象字面量类型，不起 interface：Unistyles 的断点值要求可赋给索引签名，interface 不行。
/** A value that is one number on a compact layout and another from the `md` breakpoint up. */
function responsive<T>(compact: T, desktop: T): { xs: T; md: T } {
  return { xs: compact, md: desktop };
}

function mapResponsive<T, R>(value: { xs: T; md: T }, map: (entry: T) => R): { xs: R; md: R } {
  return { xs: map(value.xs), md: map(value.md) };
}

function fieldLineHeight(fontSize: number): number {
  return Math.round(fontSize * FIELD_TEXT_LINE_HEIGHT_RATIO);
}

function fieldVerticalPadding(
  controlHeight: number,
  lineHeight: number,
  borderWidth: number,
): number {
  return (controlHeight - lineHeight - borderWidth * 2) / 2;
}

export function getControlInteractionPhase(
  state: ControlInteractionState,
): ControlInteractionPhase {
  if (state.disabled) {
    return "rest";
  }
  if (state.active || state.focused || state.open || state.pressed) {
    return "active";
  }
  if (state.hovered) {
    return "hover";
  }
  return "rest";
}

export function resolveControlInteractionStyles(
  styles: ControlInteractionStyleMap,
  state: ControlInteractionState,
): StyleProp<ViewStyle> {
  const phase = getControlInteractionPhase(state);
  return [
    styles.controlRest,
    phase === "hover" ? styles.controlHover : null,
    phase === "active" ? styles.controlActive : null,
    state.disabled ? styles.controlDisabled : null,
  ];
}

export function createControlGeometry(theme: Theme) {
  const controlBorderWidth = theme.borderWidth[1];
  const fieldTextSmLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldTextMdLineHeight = fieldLineHeight(theme.fontSize.base);
  const height = {
    xs: responsive(buttonControlHeight.xs, theme.controlHeight.sm),
    sm: responsive(buttonControlHeight.sm, theme.controlHeight.md),
    md: responsive(buttonControlHeight.md, theme.controlHeight.lg),
    lg: responsive(buttonControlHeight.lg, theme.controlHeight.lg),
  };
  const radius = {
    xs: theme.radius.sm,
    sm: theme.radius.md,
    md: theme.radius.md,
    lg: theme.radius.lg,
  };
  const fieldControlSm = {
    minHeight: height.sm,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: mapResponsive(height.sm, (controlHeight) =>
      fieldVerticalPadding(controlHeight, fieldTextSmLineHeight, controlBorderWidth),
    ),
    borderRadius: radius.sm,
  };
  const fieldControlMd = {
    minHeight: height.md,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: mapResponsive(height.md, (controlHeight) =>
      fieldVerticalPadding(controlHeight, fieldTextMdLineHeight, controlBorderWidth),
    ),
    borderRadius: radius.md,
  };
  const fieldTextSm = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextSmLineHeight,
  };
  const fieldTextMd = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextMdLineHeight,
  };
  const switchControl = {
    minHeight: CONTROL_HEIGHTS.compact,
    justifyContent: CONTROL_CENTER_JUSTIFY_CONTENT,
  } satisfies { minHeight: number; justifyContent: "center" };
  function segmentedContainer(size: SegmentedControlSize) {
    return {
      minHeight: height[size],
      padding: SEGMENTED_TRACK_INSET,
      borderRadius: radius[size],
    };
  }
  function segmentedSegment(size: SegmentedControlSize, paddingHorizontal: number) {
    return {
      minHeight: mapResponsive(
        height[size],
        (trackHeight) => trackHeight - SEGMENTED_TRACK_INSET * 2,
      ),
      paddingHorizontal,
      borderRadius: radius[size] - SEGMENTED_TRACK_INSET,
    };
  }

  return {
    buttonXs: {
      minHeight: height.xs,
      paddingHorizontal: theme.spacing[3],
      borderRadius: radius.xs,
    },
    buttonSm: {
      minHeight: height.sm,
      paddingHorizontal: theme.spacing[3],
      borderRadius: radius.sm,
    },
    buttonMd: {
      minHeight: height.md,
      paddingHorizontal: theme.spacing[4],
      borderRadius: radius.md,
    },
    buttonLg: {
      minHeight: height.lg,
      paddingHorizontal: theme.spacing[6],
      borderRadius: radius.lg,
    },
    buttonText: {
      fontSize: theme.fontSize.base,
    },
    buttonTextXs: {
      fontSize: theme.fontSize.sm,
    },
    formTextInputSm: {
      ...fieldControlSm,
      ...fieldTextSm,
    },
    formTextInputMd: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    formTextInput: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    fieldControlSm,
    fieldControlMd,
    fieldTextSm,
    fieldTextMd,
    controlRest: {
      borderWidth: controlBorderWidth,
      borderColor: theme.colors.borderInput,
      outlineWidth: 0,
      outlineColor: "transparent",
    },
    controlHover: {
      borderColor: theme.colors.borderAccent,
    },
    controlActive: {
      borderColor: theme.colors.borderAccent,
      outlineColor: theme.colors.accent,
      outlineOffset: CONTROL_FOCUS_RING_OFFSET,
      outlineStyle: "solid" as const,
      outlineWidth: CONTROL_FOCUS_RING_WIDTH,
    },
    controlFocusRingColor: {
      outlineColor: theme.colors.accent,
    },
    controlDisabled: {
      opacity: theme.opacity[50],
    },
    switchControl,
    segmentedContainerXs: segmentedContainer("xs"),
    segmentedContainerSm: segmentedContainer("sm"),
    segmentedContainerMd: segmentedContainer("md"),
    segmentedSegmentXs: segmentedSegment("xs", theme.spacing[2]),
    segmentedSegmentSm: segmentedSegment("sm", theme.spacing[2]),
    segmentedSegmentMd: segmentedSegment("md", theme.spacing[3]),
    segmentedLabelXs: {
      fontSize: theme.fontSize.sm,
    },
    segmentedLabelSm: {
      fontSize: theme.fontSize.base,
    },
    segmentedLabelMd: {
      fontSize: theme.fontSize.base,
    },
  };
}
