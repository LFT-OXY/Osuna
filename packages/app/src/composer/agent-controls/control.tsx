import { forwardRef, useCallback, type ComponentProps } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Text as UiText } from "@/components/ui/text";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import type { AgentControlIcon } from "@/agent-controls/icons";
import type { Theme } from "@/styles/theme";

function ControlIcon({
  icon: Icon,
  size,
  color,
}: {
  icon: AgentControlIcon;
  size: number;
  color: string;
}) {
  return <Icon size={size} color={color} />;
}

// 图标色随主题变时经它映射，调用方不必订阅主题。
const ThemedControlIcon = withUnistyles(ControlIcon);

type IconColorMapping = (theme: Theme) => { color: string };

type AgentControlTriggerProps = Omit<
  ComponentProps<typeof ComboboxTrigger>,
  "accessibilityLabel" | "block" | "children" | "chevron" | "onPress" | "style"
> & {
  icon: AgentControlIcon;
  iconColor?: string;
  /** 取代 iconColor，颜色取自主题时用。 */
  iconColorMapping?: IconColorMapping;
  surface: "toolbar" | "sheet";
  label: string;
  value?: string;
  showToolbarLabel?: boolean;
  showCaret?: boolean;
  open?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
};

export const AgentControlTrigger = forwardRef<View, AgentControlTriggerProps>(
  function AgentControlTrigger(
    {
      icon: Icon,
      iconColor,
      iconColorMapping,
      surface,
      label,
      value,
      showToolbarLabel = true,
      showCaret = false,
      open = false,
      disabled = false,
      onPress,
      accessibilityLabel,
      testID,
      ...triggerProps
    },
    ref,
  ) {
    const { glyphSize } = useComposerControlLayout();
    const isSheet = surface === "sheet";
    const resolvedGlyphSize = isSheet ? 16 : glyphSize;
    const resolvedIconColor = iconColor ?? styles.iconColor.color;
    const showValue = isSheet || showToolbarLabel;
    const triggerStyle = useCallback(
      ({ pressed, hovered }: PressableStateCallbackType) => [
        isSheet ? styles.sheetRow : styles.toolbarControl,
        !isSheet && !showToolbarLabel && styles.toolbarIconOnly,
        hovered && (isSheet ? styles.sheetRowInteractive : styles.hovered),
        (pressed || open) && (isSheet ? styles.sheetRowInteractive : styles.pressed),
        disabled && styles.disabled,
      ],
      [disabled, isSheet, open, showToolbarLabel],
    );

    return (
      <ComboboxTrigger
        {...triggerProps}
        ref={ref}
        collapsable={false}
        disabled={disabled}
        onPress={onPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        chevron={showCaret ? undefined : null}
      >
        {isSheet ? (
          <View style={styles.sheetGlyph}>
            <TriggerIcon
              icon={Icon}
              size={resolvedGlyphSize}
              color={resolvedIconColor}
              colorMapping={iconColorMapping}
            />
          </View>
        ) : (
          <ComposerToolbarGlyph size={resolvedGlyphSize}>
            <TriggerIcon
              icon={Icon}
              size={resolvedGlyphSize}
              color={resolvedIconColor}
              colorMapping={iconColorMapping}
            />
          </ComposerToolbarGlyph>
        )}
        {isSheet ? (
          <Text style={styles.sheetLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        {showValue && isSheet ? (
          <Text style={styles.sheetValue} numberOfLines={1}>
            {value ?? label}
          </Text>
        ) : null}
        {showValue && !isSheet ? (
          <UiText
            variant="label"
            color="foregroundMuted"
            style={styles.toolbarValue}
            numberOfLines={1}
          >
            {value ?? label}
          </UiText>
        ) : null}
      </ComboboxTrigger>
    );
  },
);

function TriggerIcon({
  icon,
  size,
  color,
  colorMapping,
}: {
  icon: AgentControlIcon;
  size: number;
  color: string;
  colorMapping: IconColorMapping | undefined;
}) {
  if (colorMapping) {
    return <ThemedControlIcon icon={icon} size={size} uniProps={colorMapping} />;
  }
  return <ControlIcon icon={icon} size={size} color={color} />;
}

const styles = StyleSheet.create((theme) => ({
  toolbarControl: {
    height: theme.controlHeight.md,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radius.md,
    backgroundColor: "transparent",
  },
  toolbarIconOnly: {
    width: theme.controlHeight.md,
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  toolbarValue: {
    minWidth: 0,
    flexShrink: 1,
  },
  sheetRow: {
    minHeight: 44,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginHorizontal: -theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface1,
  },
  sheetRowInteractive: {
    backgroundColor: theme.colors.surface2,
  },
  sheetGlyph: {
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  sheetValue: {
    maxWidth: "45%",
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  hovered: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  pressed: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  disabled: {
    opacity: 0.5,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
}));
