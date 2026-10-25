import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

const TURN_OFF_KEY = "settings.host.privacy.readCliSignIns.turnOff";
const SHEET_WIDTH = 480;
// 手机上两三句话加底部按钮，半屏就够
const SNAP_POINTS = ["40%"];

interface StoppedThingsInput {
  t: TFunction;
  accountNames: readonly string[];
}

/** 客户端手里没有任何套餐用量账号时，改说「所有套餐用量都不会显示」。 */
function planUsageStops({ t, accountNames }: StoppedThingsInput): string {
  if (accountNames.length === 0) return t(`${TURN_OFF_KEY}.allPlanUsageStops`);
  const accounts = accountNames.join(t(`${TURN_OFF_KEY}.listSeparator`));
  return t(`${TURN_OFF_KEY}.planUsageStops`, { accounts });
}

/** 关掉后会停的事，一件一句。现在只有套餐用量；多号自动轮换（子任务 9）在这里加一项。 */
function stoppedThings(input: StoppedThingsInput): string[] {
  return [planUsageStops(input)];
}

/** 关「读取 CLI 登录凭证」之前先问：按名字列出会停止显示套餐用量的账号。打开时不问。 */
export function CliSignInsTurnOffSheet(props: {
  accountNames: readonly string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { accountNames, onConfirm, onClose } = props;
  const { t } = useTranslation();
  const paragraphs = useMemo(() => stoppedThings({ t, accountNames }), [accountNames, t]);
  const header = useMemo<SheetHeader>(() => ({ title: t(`${TURN_OFF_KEY}.title`) }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={onClose}>
          {t("common.actions.cancel")}
        </Button>
        <Button variant="destructive" size="sm" onPress={onConfirm}>
          {t(`${TURN_OFF_KEY}.confirm`)}
        </Button>
      </View>
    ),
    [onClose, onConfirm, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={SHEET_WIDTH}
      snapPoints={SNAP_POINTS}
      testID="host-privacy-turn-off-sheet"
    >
      <View style={styles.body} testID="host-privacy-turn-off-message">
        {paragraphs.map((paragraph) => (
          <Text key={paragraph} variant="caption" color="foregroundMuted">
            {paragraph}
          </Text>
        ))}
        <Text variant="caption" color="foregroundMuted">
          {t(`${TURN_OFF_KEY}.apiEndpointsKeepWorking`)}
        </Text>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
