import {
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { Row, getRowSurfaceStyle, type RowRenderState } from "@/components/ui/row";
import { Shortcut } from "@/components/ui/shortcut";
import { Text } from "@/components/ui/text";
import type { ShortcutKey } from "@/utils/format-shortcut";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type SidebarHeaderRowVariant = "header" | "compact" | "inline";
type RowSize = NonNullable<Parameters<typeof Row>[0]["size"]>;
type RowLeadingState = Pick<RowRenderState, "hovered" | "pressed" | "selected">;

export type SidebarRowIcon = ComponentType<{ size: number; color: string }>;

interface SidebarHeaderRowProps {
  icon: SidebarRowIcon | null;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  /**
   * "header" (default): a header-height row — the lone header at the top of a
   * sidebar (settings "Back to workspace").
   * "compact": a Sidebar item row, for entries that sit in a header group.
   * "inline": a full-width row with no inset, for a row inside a padded container such as the
   * sidebar footer.
   */
  variant?: SidebarHeaderRowVariant;
  /** Shown in the right slot while the row is hovered, when `trailing` is not set. */
  shortcutKeys?: ShortcutKey[][] | null;
  /**
   * The right slot. A sibling of the row's button, never inside it (web cannot nest buttons). A
   * press on the slot presses the row; a button inside it presses on its own.
   */
  trailing?: ReactNode;
  rowRef?: Ref<View>;
}

export function SidebarHeaderRow({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  testID,
  nativeID,
  accessibilityLabel,
  variant = "header",
  shortcutKeys = null,
  trailing,
  rowRef,
}: SidebarHeaderRowProps) {
  const ThemedIcon = useMemo(() => (Icon ? withUnistyles(Icon) : null), [Icon]);
  const size: RowSize = variant === "header" ? "md" : "sm";

  const renderLeading = useCallback(
    ({ hovered, pressed, selected }: RowLeadingState) => {
      if (!ThemedIcon) return <View style={styles.iconSpacer} />;
      const isIconLifted = hovered || pressed || selected;
      return (
        <ThemedIcon
          size={ICON_SIZE.sm}
          uniProps={isIconLifted ? foregroundColorMapping : foregroundMutedColorMapping}
        />
      );
    },
    [ThemedIcon],
  );

  const renderTrailing = useCallback(
    ({ hovered }: RowRenderState) =>
      shortcutKeys && hovered ? <Shortcut chord={shortcutKeys} /> : null,
    [shortcutKeys],
  );

  return (
    <View ref={rowRef} collapsable={false} style={getContainerStyle(variant)}>
      {trailing === undefined || trailing === null ? (
        <Row
          title={label}
          onPress={onPress}
          selected={isActive}
          size={size}
          testID={testID}
          nativeID={nativeID}
          accessibilityLabel={accessibilityLabel}
          renderLeading={renderLeading}
          renderTrailing={shortcutKeys ? renderTrailing : undefined}
        />
      ) : (
        <RowWithTrailingSlot
          label={label}
          onPress={onPress}
          isActive={isActive}
          size={size}
          testID={testID}
          nativeID={nativeID}
          accessibilityLabel={accessibilityLabel}
          renderLeading={renderLeading}
          trailing={trailing}
        />
      )}
    </View>
  );
}

/**
 * 带右侧槽的行。右侧槽里可以放按钮，所以它是行按钮的兄弟节点，不能交给 <Row>（<Row> 的后置槽在
 * 按钮里面）；外观用 <Row> 的同一套表面状态与尺寸。
 */
interface RowWithTrailingSlotProps extends Pick<
  SidebarHeaderRowProps,
  "label" | "onPress" | "testID" | "nativeID" | "accessibilityLabel"
> {
  isActive: boolean;
  size: RowSize;
  renderLeading: (state: RowLeadingState) => ReactNode;
  trailing: ReactNode;
}

function RowWithTrailingSlot({
  label,
  onPress,
  isActive,
  size,
  testID,
  nativeID,
  accessibilityLabel,
  renderLeading,
  trailing,
}: RowWithTrailingSlotProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const handlePressIn = useCallback(() => setPressed(true), []);
  const handlePressOut = useCallback(() => setPressed(false), []);
  const state = { hovered, pressed, selected: isActive };
  const isTitleLifted = hovered || pressed || isActive;
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);

  return (
    <View
      style={[styles.slotRow, getRowSurfaceStyle(state)]}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        testID={testID}
        nativeID={nativeID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={accessibilityState}
        aria-selected={isActive}
        style={[styles.slotRowButton, size === "sm" ? styles.slotRowSm : styles.slotRowMd]}
      >
        {renderLeading(state)}
        <Text
          variant="label"
          color={isTitleLifted ? "foreground" : "foregroundMuted"}
          numberOfLines={1}
          style={styles.slotRowTitle}
        >
          {label}
        </Text>
      </Pressable>
      <Pressable onPress={onPress} accessible={false} focusable={false} style={styles.trailing}>
        {trailing}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // 加上 <Row> 自己的 spacing[2]，图标仍落在迁移前的 20px 位置上，与设置侧栏下方的行对齐。
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[3],
    justifyContent: "center",
    userSelect: "none",
  },
  containerCompact: {
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  containerInline: {
    width: "100%",
    justifyContent: "center",
    userSelect: "none",
  },
  iconSpacer: { width: ICON_SIZE.sm, height: ICON_SIZE.sm },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  // 与 <Row> 的 row / rowSm / rowMd 同一套内边距与高度。
  slotRowButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    userSelect: "none",
  },
  slotRowSm: {
    minHeight: 32,
    paddingVertical: theme.spacing[1.5],
  },
  slotRowMd: {
    minHeight: 36,
    paddingVertical: theme.spacing[2],
  },
  slotRowTitle: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingRight: theme.spacing[2],
  },
}));

function getContainerStyle(variant: SidebarHeaderRowVariant) {
  switch (variant) {
    case "header":
      return styles.container;
    case "compact":
      return styles.containerCompact;
    case "inline":
      return styles.containerInline;
  }
}
