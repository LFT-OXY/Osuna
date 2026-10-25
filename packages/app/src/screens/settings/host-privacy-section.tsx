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
import { planUsageAccountNames } from "@/usage/model";
import { hostUsageQueryKey, usageReportsQueryKey } from "@/usage/queries";
import type { UsageReportEntry } from "@/usage/types";
import { HOST_PRIVACY_FOCUS } from "@/utils/host-routes";
import { CliSignInsTurnOffSheet } from "./cli-sign-ins-turn-off-sheet";

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
  // 确认框开着时是按下开关那一刻客户端手里的账号名；null 是没在问。
  const [confirmingAccounts, setConfirmingAccounts] = useState<string[] | null>(null);
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

  const saveValue = useCallback(
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

  // 打开直接存；关掉先问，账号名取客户端已经拿到的报告，不为此再去问主机。
  const handleValueChange = useCallback(
    (next: boolean) => {
      if (next) {
        saveValue(true);
        return;
      }
      const reports = queryClient.getQueryData<UsageReportEntry[]>(usageReportsQueryKey(serverId));
      setConfirmingAccounts(planUsageAccountNames(reports ?? []));
    },
    [queryClient, saveValue, serverId],
  );
  const closeConfirmation = useCallback(() => setConfirmingAccounts(null), []);
  const confirmTurnOff = useCallback(() => {
    setConfirmingAccounts(null);
    saveValue(false);
  }, [saveValue]);

  if (!supported) return null;

  const saving = pending !== null;
  // 环境变量压着时显示生效值（关），存的值不动。
  const forcedOff = config?.readCliSignInsForcedOff === true;
  const savedValue = !forcedOff && config?.readCliSignIns !== false;
  const shownValue = pending ?? savedValue;
  const locked = !loaded || saving || !canManage || forcedOff;

  return (
    <View ref={sectionRef}>
      <SettingsSection title={t("settings.host.privacy.title")} testID="host-privacy-section">
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.host.privacy.readCliSignIns.title")}
              </Text>
              <Text style={settingsStyles.rowHint} testID="host-privacy-read-cli-sign-ins-hint">
                {forcedOff
                  ? t("settings.host.privacy.readCliSignIns.forcedOffHint")
                  : t("settings.host.privacy.readCliSignIns.hint")}
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
      {confirmingAccounts ? (
        <CliSignInsTurnOffSheet
          accountNames={confirmingAccounts}
          onConfirm={confirmTurnOff}
          onClose={closeConfirmation}
        />
      ) : null}
    </View>
  );
}

function describeSaveFailure(t: TFunction, reason: string): string {
  if (!reason) return t("settings.host.privacy.readCliSignIns.saveFailed");
  return t("settings.host.privacy.readCliSignIns.saveFailedReason", { reason });
}
