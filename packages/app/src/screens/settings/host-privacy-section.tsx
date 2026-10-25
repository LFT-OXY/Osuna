import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { extractFailureReason } from "@/price-table/pricing";
import { revealInScrollContainer } from "@/provider-detail/reveal";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { hostUsageQueryKey } from "@/usage/queries";
import { HOST_PRIVACY_FOCUS } from "@/utils/host-routes";

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
  const queryClient = useQueryClient();
  // 保存中显示要改成的值；失败后清掉，开关回到 daemon 的值。
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sectionRef = useRef<View>(null);
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const loaded = config !== null;
  const revealRequested = supported && loaded && focus === HOST_PRIVACY_FOCUS;

  // 从套餐用量的「打开设置」进来：配置读到、这一节高度定下后滚进视野。
  useEffect(() => {
    if (!revealRequested) return;
    const frame = requestAnimationFrame(() => revealInScrollContainer(sectionRef.current));
    return () => cancelAnimationFrame(frame);
  }, [revealRequested]);

  const handleValueChange = useCallback(
    (next: boolean) => {
      setError(null);
      setPending(next);
      void (async () => {
        try {
          await patchConfig({ readCliSignIns: next });
          // 套餐用量的弹窗、侧栏摘要、用量条马上按新的开关重新问一次。
          void queryClient.invalidateQueries({ queryKey: hostUsageQueryKey(serverId) });
        } catch (cause) {
          console.error("[HostPage] Failed to change Read CLI sign-ins", cause);
          setError(describeSaveFailure(t, extractFailureReason(cause)));
        } finally {
          setPending(null);
        }
      })();
    },
    [patchConfig, queryClient, serverId, t],
  );

  if (!supported) return null;

  const saving = pending !== null;
  const savedValue = config?.readCliSignIns !== false;
  const shownValue = pending ?? savedValue;
  const locked = !loaded || saving || !canManage;

  return (
    <View ref={sectionRef}>
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
              value={shownValue}
              onValueChange={handleValueChange}
              disabled={locked}
              accessibilityLabel={t("settings.host.privacy.readCliSignIns.title")}
              testID="host-privacy-read-cli-sign-ins-switch"
            />
          </View>
        </View>
      </SettingsSection>
    </View>
  );
}

function describeSaveFailure(t: TFunction, reason: string): string {
  if (!reason) return t("settings.host.privacy.readCliSignIns.saveFailed");
  return t("settings.host.privacy.readCliSignIns.saveFailedReason", { reason });
}
