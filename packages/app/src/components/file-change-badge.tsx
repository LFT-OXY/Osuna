import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Text } from "@/components/ui/text";
import {
  DIFF_FILE_CHANGE_SLOT_SIZE,
  diffFileChangePresentation,
  type DiffFileChange,
} from "@/git/file-header-presentation";

const CHANGE_LABEL_KEY = {
  added: "workspace.git.diff.newFile",
  deleted: "workspace.git.diff.deletedFile",
  modified: "workspace.git.diff.modifiedFile",
} as const;

/**
 * 文件变更类型的状态字母（A / D / M），放在 ±统计旁边。画布文件头在同一格子里画同一个字母
 * （`paint.web.ts`、`paint.native.ts`）。
 */
export function FileChangeBadge({ change }: { change: DiffFileChange }): ReactElement {
  const { t } = useTranslation();
  const { letter, tone } = diffFileChangePresentation(change);
  return (
    <View
      style={styles.slot}
      accessibilityRole="image"
      accessibilityLabel={t(CHANGE_LABEL_KEY[change])}
    >
      <Text variant="micro" weight="semibold" color={tone} selectable={false}>
        {letter}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  slot: {
    width: DIFF_FILE_CHANGE_SLOT_SIZE,
    height: DIFF_FILE_CHANGE_SLOT_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
}));
