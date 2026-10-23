import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";

/*
 * 「第三方接口」页底部的「自动刷新余额与套餐用量」（照 magpie Settings → Usage 的额度刷新：自动 / 仅手动）。
 * 整台主机共用；拨动即存，存不成时开关回到原样，原因留在下面直到下一次拨动。
 */

const KEY = "settings.apiEndpoints.balance.autoRefresh";

export function ApiEndpointBalanceAutoRefreshSection({
  value,
  onSave,
}: {
  value: boolean;
  onSave: (enabled: boolean) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  // 拨动后、主机回话前显示的值；主机的列表刷新回来后以它为准。
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleChange = useCallback(
    (next: boolean) => {
      setPending(next);
      setError(null);
      void (async () => {
        const failure = await onSave(next);
        setPending(null);
        if (failure !== null) setError(failure);
      })();
    },
    [onSave],
  );
  const label = t(`${KEY}.label`);
  const hint = (
    <>
      <Text style={settingsStyles.rowHint}>{t(`${KEY}.hint`)}</Text>
      {error !== null ? (
        <Text
          accessibilityRole="alert"
          style={settingsStyles.rowError}
          selectable
          testID="api-endpoints-balance-auto-refresh-error"
        >
          {t(`${KEY}.saveFailed`, { message: error })}
        </Text>
      ) : null}
    </>
  );
  return (
    <SettingsSection
      title={t("settings.apiEndpoints.balance.title")}
      testID="api-endpoints-balance-auto-refresh"
    >
      <SettingsCard>
        <SettingsRow label={label} hint={hint}>
          <Switch
            value={pending ?? value}
            onValueChange={handleChange}
            disabled={pending !== null}
            accessibilityLabel={label}
            testID="api-endpoints-balance-auto-refresh-switch"
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
