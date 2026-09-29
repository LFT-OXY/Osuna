import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface ComposerAttachmentTrayProps {
  hasAttachments: boolean;
  children?: ReactNode;
}

/** Attachment tray：粘贴 / 拖拽进来的附件排成一行；没有附件时不渲染。 */
export function ComposerAttachmentTray({ hasAttachments, children }: ComposerAttachmentTrayProps) {
  if (!hasAttachments) return null;
  return (
    <View style={styles.tray} testID="composer-attachment-tray">
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  tray: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
}));
