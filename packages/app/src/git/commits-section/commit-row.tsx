import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ICON_SIZE } from "@/styles/theme";
import { getRowSurfaceStyle } from "@/components/ui/row";
import { Text as UiText } from "@/components/ui/text";
import { WORKSPACE_TREE_ROW_HEIGHT, WORKSPACE_TREE_ROW_INSET } from "@/components/tree-primitives";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { formatTimeAgo } from "@/utils/time";
import { CommitGraphNode } from "./commit-graph-node";

interface CommitRowProps {
  commit: ClassifiedCheckoutCommit;
  isFirst: boolean;
  isLast: boolean;
  now: Date;
  onCommitPress: (sha: string) => void;
}

function commitRowPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, getRowSurfaceStyle({ hovered: Boolean(hovered), pressed })];
}

export const CommitRow = memo(function CommitRow({
  commit,
  isFirst,
  isLast,
  now,
  onCommitPress,
}: CommitRowProps) {
  const handlePress = useCallback(() => {
    onCommitPress(commit.sha);
  }, [commit.sha, onCommitPress]);

  return (
    <Pressable
      accessibilityRole="button"
      testID={`commit-row-${commit.shortSha}`}
      onPress={handlePress}
      style={commitRowPressableStyle}
    >
      <CommitGraphNode commit={commit} isFirst={isFirst} isLast={isLast} />
      <View style={styles.commitDetails}>
        <Text dataSet={CODE_SURFACE_DATASET} style={styles.shortSha} numberOfLines={1}>
          {commit.shortSha}
        </Text>
        <UiText variant="label" style={styles.subject} numberOfLines={1}>
          {commit.subject}
        </UiText>
      </View>
      <Text style={styles.timestamp}>{formatTimeAgo(new Date(commit.authorDate), now)}</Text>
      <View style={styles.caret}>
        <ThemedChevron size={ICON_SIZE.sm} uniProps={chevronColorMapping} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  // 与上方改动文件树的行同高、同样两侧收进，收进量从内边距扣回，提交图节点不挪位。
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: WORKSPACE_TREE_ROW_HEIGHT,
    marginHorizontal: WORKSPACE_TREE_ROW_INSET,
    paddingLeft: theme.spacing[2] - WORKSPACE_TREE_ROW_INSET,
    paddingRight: theme.spacing[2] - WORKSPACE_TREE_ROW_INSET,
    paddingVertical: theme.spacing[1],
  },
  commitDetails: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  shortSha: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
    width: 70,
    flexShrink: 0,
  },
  subject: {
    flex: 1,
    minWidth: 0,
  },
  timestamp: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  caret: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
}));
