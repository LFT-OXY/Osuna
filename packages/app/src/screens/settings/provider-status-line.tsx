import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { ProviderStatusDisplay } from "@/provider-detail/status";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Providers 列表行与「添加提供方」弹窗行名称下面的一行：状态点加文字，列表行已装的内置提供方再接版本号。
export function ProviderStatusLine({
  status,
  version,
}: {
  status: ProviderStatusDisplay;
  version?: string;
}) {
  const { t } = useTranslation();
  let label = t(status.label.key, status.label.params);
  if (version) {
    label = `${label} · ${t("settings.providers.version.value", { version })}`;
  }
  return (
    <View style={styles.statusLine}>
      {status.tone === "loading" ? (
        <ThemedLoadingSpinner size={10} uniProps={foregroundMutedColorMapping} />
      ) : (
        <View
          style={[styles.statusDot, statusDotStyles[status.tone]]}
          testID={`provider-status-dot-${status.tone}`}
        />
      )}
      <Text style={styles.statusLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    marginTop: theme.spacing[0.5],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
}));

const statusDotStyles = StyleSheet.create((theme) => ({
  success: { backgroundColor: theme.colors.statusSuccess },
  warning: { backgroundColor: theme.colors.statusWarning },
  danger: { backgroundColor: theme.colors.statusDanger },
  muted: { backgroundColor: theme.colors.foregroundMuted },
  loading: { backgroundColor: theme.colors.foregroundMuted },
}));
