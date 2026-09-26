import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import { ICON_SIZE, SPACING, type Theme } from "@/styles/theme";

// Shared presentation primitives for the app's directory trees. Both the Files
// explorer (server-loaded listings) and the Changes view (client-built from diff
// paths) render different data, but their ROWS should look identical — same
// indentation, density, name emphasis, and chevron. Keep those here so the two trees can't
// drift apart.
// 行的 hover / 按下 / 选中底色取 `getRowSurfaceStyle`，与侧栏行同一条规则：Explorer 铺在侧栏表面上。
export const TREE_INDENT_PER_LEVEL = 12;
export const WORKSPACE_FILE_ROW_VERTICAL_PADDING = SPACING[1];
/** Explorer 树形行高（与改动文件行一致）。 */
export const WORKSPACE_TREE_ROW_HEIGHT = 28;
/**
 * 行两侧收进的距离：状态底色是圆角块，不贴 pane 边。文字与尾部字形的轨道不随之移动，
 * 收进量从行的内边距里扣回（`treeRowIndent`）。
 */
export const WORKSPACE_TREE_ROW_INSET = SPACING[1.5];
export const WORKSPACE_TREE_ICON_SIZE = ICON_SIZE.md;
export const WORKSPACE_TREE_LOADING_ICON_SIZE = ICON_SIZE.sm;
export const WORKSPACE_TREE_ICON_LABEL_GAP = SPACING[2];
/**
 * Trailing glyph rail shared with the explorer X and Changes options chevron.
 * The extra 2px is optical: text ink ends inside its layout box, while the
 * header icons' strokes extend to theirs.
 */
/** Shared painted-edge rail for pane headers, toolbars, and tree/diff rows. */
export const WORKSPACE_PANE_TRAILING_GLYPH_RAIL = SPACING[2];

/** Left padding for a row in either workspace tree. */
export function treeRowPaddingLeft(depth: number): number {
  return SPACING[3] + depth * TREE_INDENT_PER_LEVEL;
}

/** 收进后的树形行的左内边距，让内容仍落在 `treeRowPaddingLeft` 的轨道上。 */
export function treeRowIndent(depth: number): number {
  return treeRowPaddingLeft(depth) - WORKSPACE_TREE_ROW_INSET;
}

const foregroundExtraMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
});

const ThemedChevronRight = withUnistyles(ChevronRight);

/** Rotating disclosure chevron for a directory row (points right; rotates down when expanded). */
export function TreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <View style={expanded ? [styles.chevron, styles.chevronExpanded] : styles.chevron}>
      <ThemedChevronRight
        size={WORKSPACE_TREE_ICON_SIZE}
        uniProps={foregroundExtraMutedIconColorMapping}
      />
    </View>
  );
}

export const workspaceTreeRowStyles = StyleSheet.create((_theme: Theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: WORKSPACE_TREE_ROW_HEIGHT,
    marginHorizontal: WORKSPACE_TREE_ROW_INSET,
    paddingVertical: WORKSPACE_FILE_ROW_VERTICAL_PADDING,
    paddingRight: WORKSPACE_PANE_TRAILING_GLYPH_RAIL - WORKSPACE_TREE_ROW_INSET,
  },
  name: { opacity: 0.76 },
  nameHovered: { opacity: 1 },
}));

const styles = StyleSheet.create((_theme: Theme) => ({
  chevron: {
    width: WORKSPACE_TREE_ICON_SIZE,
    height: WORKSPACE_TREE_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
}));
