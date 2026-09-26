import React, { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import { getSurfaceBackdropFillStyle } from "@/styles/surface-backdrop-fill";
import { Text } from "@/components/ui/text";

export interface RowState {
  hovered: boolean;
  pressed: boolean;
  selected: boolean;
}

export interface RowRenderState extends RowState {
  /** 悬停操作是否可见：web 上悬停时可见，原生端与紧凑布局下常显。 */
  showActions: boolean;
}

export type RowBackdrop = Exclude<SidebarSurfaceBackdrop, "surface2">;

/**
 * 行在某个状态下铺的表面。选中压过 hover，所以指针停在选中行上它仍然看得出是选中的；
 * 按下压过两者。
 */
export function getRowBackdrop({
  hovered = false,
  pressed = false,
  selected = false,
}: Partial<RowState>): RowBackdrop {
  if (pressed) return "surfaceSidebarActive";
  if (selected) return "surfaceSidebarSelected";
  if (hovered) return "surfaceSidebarHover";
  return "surfaceSidebar";
}

/**
 * 行的状态部分：圆角、底色、选中描边。给自己持有按下目标（右键菜单 trigger、拖拽句柄）、
 * 因而不能直接渲染 `<Row>` 的行用；布局与内边距仍归调用方。
 */
export function getRowSurfaceStyle(state: Partial<RowState>) {
  return [
    surfaceStyles.surface,
    surfaceFillStyles[getRowBackdrop(state)],
    state.selected ? surfaceStyles.selected : null,
  ];
}

interface RowProps {
  title: string;
  onPress: () => void;
  selected?: boolean;
  /** `sm` 高 32（Sidebar items），`md` 高 36（工作区行）。 */
  size?: "sm" | "md";
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  renderLeading?: (state: RowRenderState) => ReactNode;
  /** 常显，位于第一行标题之后。 */
  renderTrailing?: (state: RowRenderState) => ReactNode;
  /** 悬停显示；盖在 trailing 槽之上，不把它挤走。 */
  renderActions?: (state: RowRenderState) => ReactNode;
  /** 标题下方可选的元信息行。 */
  renderMeta?: (state: RowRenderState) => ReactNode;
}

/**
 * 列表行：前置槽、标题加可选元信息行、后置槽、悬停操作。hover 遵循 docs/hover.md：
 * 外层 `View` 是 hover 包络，内层 `Pressable` 只负责按下。
 */
export function Row({
  title,
  onPress,
  selected = false,
  size = "md",
  testID,
  nativeID,
  accessibilityLabel,
  renderLeading,
  renderTrailing,
  renderActions,
  renderMeta,
}: RowProps) {
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const handlePressIn = useCallback(() => setPressed(true), []);
  const handlePressOut = useCallback(() => setPressed(false), []);

  const state: RowRenderState = {
    hovered,
    pressed,
    selected,
    showActions: hovered || isNative || isCompact,
  };
  const isTitleLifted = hovered || pressed || selected;
  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <View
      style={styles.envelope}
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
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={accessibilityState}
        aria-selected={selected}
        style={[
          styles.row,
          size === "sm" ? styles.rowSm : styles.rowMd,
          renderMeta ? null : styles.rowSingleLine,
          getRowSurfaceStyle(state),
        ]}
      >
        {renderLeading ? <View style={styles.leading}>{renderLeading(state)}</View> : null}
        <View style={styles.content}>
          <View style={styles.titleLine}>
            <Text
              variant="label"
              color={isTitleLifted ? "foreground" : "foregroundMuted"}
              numberOfLines={1}
              style={styles.title}
              testID={testID ? `${testID}-title` : undefined}
            >
              {title}
            </Text>
            {renderTrailing ? <View style={styles.trailing}>{renderTrailing(state)}</View> : null}
            {renderActions ? (
              <RowActions
                visible={state.showActions}
                backdrop={getRowBackdrop(state)}
                testID={testID ? `${testID}-actions` : undefined}
              >
                {renderActions(state)}
              </RowActions>
            ) : null}
          </View>
          {renderMeta ? renderMeta(state) : null}
        </View>
      </Pressable>
    </View>
  );
}

// 用 opacity 隐藏而不卸载：显示时不会在指针下重排行（docs/hover.md 失败模式 2），里面的
// 菜单 trigger 在菜单打开、指针离开后也还挂着，菜单不会失去宿主。它盖住 trailing，所以
// 静止时也铺上身后的表面色（原生端与紧凑布局不经过 hover 就显示）。
function RowActions({
  visible,
  backdrop,
  testID,
  children,
}: {
  visible: boolean;
  backdrop: RowBackdrop;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <View
      testID={testID}
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.actions,
        getSurfaceBackdropFillStyle(backdrop),
        !visible && styles.actionsHidden,
      ]}
    >
      {children}
    </View>
  );
}

const surfaceStyles = StyleSheet.create((theme) => ({
  surface: {
    borderRadius: theme.radius.md,
  },
  // 用内嵌阴影而不是 border：选中不会挪动内容；也不用 outline：不会顶掉键盘焦点环。
  selected: {
    boxShadow: `inset 0 0 0 1px ${theme.colors.borderSidebarSelected}`,
  },
}));

// 行静止时不铺底色，直接透出所在表面。
const surfaceFillStyles = StyleSheet.create((theme) => ({
  surfaceSidebar: {},
  surfaceSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
  surfaceSidebarActive: { backgroundColor: theme.colors.surfaceSidebarActive },
  surfaceSidebarSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
}));

const styles = StyleSheet.create((theme) => ({
  envelope: {
    position: "relative",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    userSelect: "none",
  },
  // 有元信息行时前置槽对齐标题行；没有时整行垂直居中。
  rowSingleLine: {
    alignItems: "center",
  },
  rowSm: {
    minHeight: 32,
    paddingVertical: theme.spacing[1.5],
  },
  rowMd: {
    minHeight: 36,
    paddingVertical: theme.spacing[2],
  },
  leading: {
    minHeight: theme.typeScale.label.lineHeight,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  actions: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.radius.sm,
  },
  actionsHidden: {
    opacity: 0,
  },
}));
