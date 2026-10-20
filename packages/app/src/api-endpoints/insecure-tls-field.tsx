import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import type { ConnectionFormModel, ConnectionFormState } from "./internal/connection-form-model";

const KEY = "settings.apiEndpoints.form.insecureTls";

/**
 * 添加 / 编辑窗口的「不校验证书」（照 magpie 编辑窗口的 Certificate 一行，放在主表单里、不在「高级」里）：
 * 只对「自定义」、有 https 地址时显示。打开先弹确认框写明风险（比 magpie 多），关掉直接关。说明在信息提示里。
 */
export function InsecureTlsField({
  state,
  model,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  if (!state.showsInsecureTls) return null;
  const label = t(`${KEY}.label`);
  const switchLabel = t(`${KEY}.switch`);
  return (
    <View style={styles.field} testID="api-endpoint-connection-insecure-tls">
      <View style={styles.labelRow}>
        <Text color="foregroundMuted">{label}</Text>
        <SettingsInfoTip
          title={switchLabel}
          info={t(`${KEY}.info`)}
          testID="api-endpoint-connection-insecure-tls-info"
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>{switchLabel}</Text>
        <Switch
          value={state.insecureTls}
          onValueChange={model.setInsecureTls}
          accessibilityLabel={switchLabel}
          testID="api-endpoint-connection-insecure-tls-switch"
        />
      </View>
      {state.isConfirmingInsecureTls ? <InsecureTlsConfirmSheet model={model} /> : null}
    </View>
  );
}

// 窄屏底部弹层只高到放得下说明和按钮；长的译文在里面滚动。
const CONFIRM_SNAP_POINTS = ["50%"];

/**
 * 打开前的确认框：风险说明整段显示，不截断，正文用主前景色，深色下也看得清；取消与确认紧跟在说明下面，
 * 不沉到弹层底部隔出一大片空白。
 */
function InsecureTlsConfirmSheet({ model }: { model: ConnectionFormModel }) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t(`${KEY}.confirmTitle`) }), [t]);
  const risk = useMemo(() => <Text selectable>{t(`${KEY}.confirmMessage`)}</Text>, [t]);
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={model.cancelInsecureTls}
      desktopMaxWidth={440}
      snapPoints={CONFIRM_SNAP_POINTS}
      testID="api-endpoint-insecure-tls-confirm-sheet"
    >
      <View style={styles.confirmBody}>
        <Alert variant="warning" description={risk} testID="api-endpoint-insecure-tls-risk" />
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={model.cancelInsecureTls}
            testID="api-endpoint-insecure-tls-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onPress={model.confirmInsecureTls}
            testID="api-endpoint-insecure-tls-confirm"
          >
            {t(`${KEY}.confirm`)}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  switchText: {
    flex: 1,
  },
  confirmBody: {
    gap: theme.spacing[4],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
