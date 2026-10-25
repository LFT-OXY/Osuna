import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { extractFailureReason } from "@/price-table/pricing";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";

/** 主机设置的「隐私」一节：「读取 CLI 登录凭证」开关。daemon 不认这个开关时整节不出现。 */
export function HostPrivacySection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  // COMPAT(readCliSignIns): added in v0.17.0, remove gate after 2027-04-25.
  const supported = useHostFeature(serverId, "readCliSignIns");
  const canManage = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.permissions?.includes("daemon.manage") === true,
  );
  const { config, patchConfig } = useDaemonConfig(serverId);
  // 保存中显示要改成的值；失败后清掉，开关回到 daemon 的值。
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleValueChange = useCallback(
    (next: boolean) => {
      setError(null);
      setPending(next);
      void (async () => {
        try {
          await patchConfig({ readCliSignIns: next });
        } catch (cause) {
          console.error("[HostPage] Failed to change Read CLI sign-ins", cause);
          const reason = extractFailureReason(cause);
          const message = t("settings.host.privacy.readCliSignIns.saveFailed");
          setError(reason ? `${message} ${reason}` : message);
        } finally {
          setPending(null);
        }
      })();
    },
    [patchConfig, t],
  );

  if (!supported) return null;

  return (
    <SettingsSection title={t("settings.host.privacy.title")} testID="host-privacy-section">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.privacy.readCliSignIns.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.privacy.readCliSignIns.hint")}
            </Text>
            {error ? (
              <Text style={settingsStyles.rowError} testID="host-privacy-read-cli-sign-ins-error">
                {error}
              </Text>
            ) : null}
          </View>
          <Switch
            value={pending ?? config?.readCliSignIns !== false}
            onValueChange={handleValueChange}
            disabled={!config || pending !== null || !canManage}
            accessibilityLabel={t("settings.host.privacy.readCliSignIns.title")}
            testID="host-privacy-read-cli-sign-ins-switch"
          />
        </View>
      </View>
    </SettingsSection>
  );
}
