import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideIcon } from "lucide-react-native";
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { Row, type RowRenderState } from "@/components/ui/row";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type SidebarHeaderRowVariant = "header" | "compact";

interface SidebarHeaderRowProps {
  icon: LucideIcon;
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
   */
  variant?: SidebarHeaderRowVariant;
  shortcutKeys?: ShortcutKey[][] | null;
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
}: SidebarHeaderRowProps) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);

  const renderLeading = useCallback(
    ({ hovered, pressed, selected }: RowRenderState) => {
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
    <View style={variant === "compact" ? styles.containerCompact : styles.container}>
      <Row
        title={label}
        onPress={onPress}
        selected={isActive}
        size={variant === "compact" ? "sm" : "md"}
        testID={testID}
        nativeID={nativeID}
        accessibilityLabel={accessibilityLabel}
        renderLeading={renderLeading}
        renderTrailing={shortcutKeys ? renderTrailing : undefined}
      />
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
}));
