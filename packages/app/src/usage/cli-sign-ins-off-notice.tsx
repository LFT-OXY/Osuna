import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { openHostPrivacySettings } from "@/navigation/settings-navigation";

/**
 * 套餐用量因「读取 CLI 登录凭证」关着而空着：说明一行，下面是去主机设置「隐私」一节的按钮。
 * `onLeave` 在跳转前调用，盖在页面上的弹窗借它先关掉。
 */
export function CliSignInsOffNotice({
  serverId,
  onLeave,
}: {
  serverId: string;
  onLeave?: () => void;
}) {
  const { t } = useTranslation();
  const handleOpenSettings = useCallback(() => {
    onLeave?.();
    openHostPrivacySettings(serverId);
  }, [onLeave, serverId]);
  return (
    <View style={styles.notice}>
      <Text style={styles.text} testID="usage-cli-sign-ins-off">
        {t("usage.planUsage.cliSignInsOff")}
      </Text>
      <Button
        variant="outline"
        size="sm"
        onPress={handleOpenSettings}
        testID="usage-open-privacy-settings"
      >
        {t("usage.planUsage.openPrivacySettings")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // 说明与按钮靠左排成一列，按钮不撑满宽度。
  notice: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
