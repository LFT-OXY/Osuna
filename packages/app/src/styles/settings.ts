import { StyleSheet } from "react-native-unistyles";

// 设置行的最小高度：标题加一行说明，或一个 28 高的控件，都落在同一行高里（原型 / t3code）。
const SETTINGS_ROW_MIN_HEIGHT = 56;

export const settingsStyles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[6],
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderTitle: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.label,
    fontWeight: theme.fontWeight.medium,
  },
  sectionHeaderLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  sectionHeaderLinkText: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.label,
  },
  card: {
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    minHeight: SETTINGS_ROW_MIN_HEIGHT,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.foreground,
    ...theme.typeScale.body,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
    marginTop: theme.spacing[0.5],
  },
  rowError: {
    color: theme.colors.statusDanger,
    ...theme.typeScale.caption,
    marginTop: theme.spacing[0.5],
  },
  rowValue: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.body,
  },
  rowIconFrame: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
}));
