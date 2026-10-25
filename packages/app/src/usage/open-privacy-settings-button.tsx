import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { openHostSettingsSection } from "@/navigation/settings-navigation";
import { usageCopy } from "./copy";

/**
 * 套餐用量因「读取 CLI 登录凭证」关着而空着时的去处：主机设置页，「隐私」一节就在外观下面。
 * `onLeave` 在跳转前调用，盖在页面上的弹窗借它先关掉。
 */
export function OpenPrivacySettingsButton({
  serverId,
  onLeave,
}: {
  serverId: string;
  onLeave?: () => void;
}) {
  const handlePress = useCallback(() => {
    onLeave?.();
    openHostSettingsSection(serverId, "host");
  }, [onLeave, serverId]);
  return (
    <Button variant="outline" size="sm" onPress={handlePress} testID="usage-open-privacy-settings">
      {usageCopy.openPrivacySettings}
    </Button>
  );
}
