import React, { createContext, memo, useCallback, useContext, useMemo, useState } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, FileDiff } from "lucide-react-native";
import { DiffStat } from "@/components/diff-stat";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import {
  summarizeTurnChangedFiles,
  type TurnChangedFile,
  type TurnChangedFilesSummary,
} from "./turn-changed-files";

export interface TurnChangedFilesActions {
  cwd: string | undefined;
  /** 概览模式下连续的工具调用折成一个宿主行，这里取回组内全部调用。 */
  expandGroup: (hostId: string) => readonly ToolCallItem[] | undefined;
  openFile: (path: string) => void;
  /** 非 git 工作区没有 Changes 视图，这时为 undefined，卡片不显示 Open diff。 */
  openChanges: (() => void) | undefined;
}

const TurnChangedFilesContext = createContext<TurnChangedFilesActions | null>(null);

export const TurnChangedFilesProvider = TurnChangedFilesContext.Provider;

const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** 回合结束后汇总本轮改过的文件；没有改动时不渲染。 */
export const TurnChangedFiles = memo(function TurnChangedFiles({
  items,
}: {
  items: readonly StreamItem[];
}) {
  const actions = useContext(TurnChangedFilesContext);
  const summary = useMemo(
    () =>
      actions
        ? summarizeTurnChangedFiles({ items, cwd: actions.cwd, expandGroup: actions.expandGroup })
        : null,
    [actions, items],
  );
  if (!actions || !summary) {
    return null;
  }
  return <TurnChangedFilesCard summary={summary} actions={actions} />;
});

function TurnChangedFilesCard({
  summary,
  actions,
}: {
  summary: TurnChangedFilesSummary;
  actions: TurnChangedFilesActions;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const count = summary.files.length;
  const label =
    count === 1
      ? t("message.changedFiles.one", { count })
      : t("message.changedFiles.other", { count });
  const toggle = useCallback(() => setExpanded((previous) => !previous), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const chevronStyle = useMemo(
    () => (expanded ? [styles.chevron, styles.chevronExpanded] : styles.chevron),
    [expanded],
  );

  return (
    <View style={styles.card} testID="turn-changed-files">
      <View style={styles.header}>
        <Pressable
          style={styles.toggle}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          testID="turn-changed-files-toggle"
        >
          <View style={chevronStyle}>
            <ThemedChevronRight size={ICON_SIZE.sm} uniProps={mutedIconMapping} />
          </View>
          <Text variant="label" numberOfLines={1} style={styles.title}>
            {label}
          </Text>
          <DiffStat additions={summary.additions} deletions={summary.deletions} />
        </Pressable>
        {actions.openChanges ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={FileDiff}
            onPress={actions.openChanges}
            testID="turn-changed-files-open-diff"
          >
            {t("message.changedFiles.openDiff")}
          </Button>
        ) : null}
      </View>
      {expanded ? (
        <View style={styles.list}>
          {summary.files.map((file) => (
            <ChangedFileRow key={file.path} file={file} onOpen={actions.openFile} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface DisplayPathParts {
  directory: string;
  name: string;
}

function splitDisplayPath(displayPath: string): DisplayPathParts {
  const slash = displayPath.lastIndexOf("/");
  if (slash < 0) return { directory: "", name: displayPath };
  return { directory: displayPath.slice(0, slash + 1), name: displayPath.slice(slash + 1) };
}

// 卡片底色是 surface2，<Row> 的状态色取自侧栏角色，叠在这里分不开，所以文件行自己画悬停。
function fileRowStyle({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.fileRow, hovered ? styles.fileRowHovered : null, pressed ? styles.pressed : null];
}

function ChangedFileRow({
  file,
  onOpen,
}: {
  file: TurnChangedFile;
  onOpen: (path: string) => void;
}) {
  const handlePress = useCallback(() => onOpen(file.path), [file.path, onOpen]);
  const { directory, name } = splitDisplayPath(file.displayPath);
  return (
    <Pressable
      style={fileRowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={file.displayPath}
      testID="turn-changed-file-row"
    >
      <Text variant="label" numberOfLines={1} style={styles.filePath}>
        <Text variant="label" color="foregroundMuted">
          {directory}
        </Text>
        {name}
      </Text>
      <DiffStat additions={file.additions} deletions={file.deletions} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    alignSelf: "stretch",
    marginBottom: theme.spacing[2],
    borderRadius: theme.radius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderCodeBlock,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  header: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
  },
  toggle: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  chevron: {
    flexShrink: 0,
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  title: {
    flexShrink: 1,
  },
  list: {
    paddingBottom: theme.spacing[1],
  },
  fileRow: {
    minHeight: theme.controlHeight.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingLeft: theme.spacing[3] + theme.iconSize.sm + theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  fileRowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  pressed: {
    opacity: 0.8,
  },
  filePath: {
    flex: 1,
    minWidth: 0,
  },
}));
