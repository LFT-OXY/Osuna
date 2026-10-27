import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Text as UiText } from "@/components/ui/text";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";

/**
 * 工作区属于哪个项目、跑在哪台机器上。
 *
 * 紧凑布局下两者都显示，在工作区名下方单独一行：侧栏收起时，只有这里能看出工作区在哪，
 * host badge 仍遵循该 host 自己的显示设置，纯本地时不出现。宽屏时项目名在工作区名前作面包屑
 * （`项目 / 工作区`）；项目名与工作区名重复时宽屏不显示，紧凑布局保留，因为那一行本来就为 host 存在。
 */
export function WorkspaceHeaderProjectRow({
  subtitle,
  isSubtitleDistinct,
  serverId,
}: {
  subtitle: string;
  isSubtitleDistinct: boolean;
  serverId: string;
}) {
  const isCompact = useIsCompactFormFactor();
  const hostBadge = useHostBadges({ enabled: isCompact }).get(serverId) ?? null;
  const showProject = isSubtitleDistinct || isCompact;
  if (!showProject && !hostBadge) {
    return null;
  }
  return (
    <View style={styles.row}>
      {showProject ? (
        <Text testID="workspace-header-subtitle" style={styles.project} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {showProject && hostBadge ? <Text style={styles.separator}>·</Text> : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
      {showProject && !isCompact ? (
        <UiText color="foregroundExtraMuted" style={styles.breadcrumbSeparator}>
          /
        </UiText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The compact header stretches this row to its available title width. Within that width,
  // the project truncates and HostBadge yields its label while retaining its fixed icon.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: {
      xs: theme.spacing[1.5],
      md: theme.spacing[2],
    },
    minWidth: 0,
    flexShrink: 1,
  },
  project: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.sm,
      md: theme.fontSize.base,
    },
    flexShrink: 1,
    minWidth: 0,
  },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  breadcrumbSeparator: {
    flexShrink: 0,
  },
}));
