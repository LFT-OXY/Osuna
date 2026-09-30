import React, { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderGlyph } from "@/components/provider-icons";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

// 页内头部块是 40 的框；弹窗头部和列表行一样是 28 的框。
const ICON_FRAME_GLYPH = { lg: ICON_SIZE.lg, sm: ICON_SIZE.md } as const;

// glyph 取 resolveProviderGlyph 的 brand 结果：品牌色写死，彩色图标与无品牌色的单色图标跟随前景色。
export function ProviderIconFrame({
  glyph,
  size,
}: {
  glyph: ProviderGlyph;
  size: keyof typeof ICON_FRAME_GLYPH;
}) {
  const { Icon, brandColor } = glyph;
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  return (
    <View style={size === "lg" ? styles.iconFrame : settingsStyles.rowIconFrame}>
      {brandColor ? (
        <Icon size={ICON_FRAME_GLYPH[size]} color={brandColor} />
      ) : (
        <ThemedIcon size={ICON_FRAME_GLYPH[size]} uniProps={foregroundColorMapping} />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  iconFrame: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
}));
