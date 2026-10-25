import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

const TURN_OFF_KEY = "settings.host.privacy.readCliSignIns.turnOff";
const SHEET_WIDTH = 480;
// 手机上量出正文高度之前先用的高度。
const UNMEASURED_SNAP_POINTS = ["40%"];
// 手机上正文以外的高度：把手、标题栏、正文上下留白、底部按钮栏。
const COMPACT_SHEET_CHROME_HEIGHT = 192;
const MAX_SNAP_PERCENT = 90;

/** 手机上底部弹层刚好装下正文：留白与按钮栏加正文高度，换算成占窗口高度的百分比。 */
function fitContentSnapPoints(input: {
  bodyHeight: number | null;
  windowHeight: number;
  safeAreaBottom: number;
}): string[] {
  const { bodyHeight, windowHeight, safeAreaBottom } = input;
  if (bodyHeight === null || windowHeight <= 0) return UNMEASURED_SNAP_POINTS;
  const needed = COMPACT_SHEET_CHROME_HEIGHT + bodyHeight + safeAreaBottom;
  const percent = Math.min(MAX_SNAP_PERCENT, Math.ceil((needed / windowHeight) * 100));
  return [`${percent}%`];
}

/** 客户端手里没有任何套餐用量账号时，改说「所有套餐用量都不会显示」。 */
function planUsageStops({
  t,
  accountNames,
}: {
  t: TFunction;
  accountNames: readonly string[];
}): string {
  if (accountNames.length === 0) return t(`${TURN_OFF_KEY}.allPlanUsageStops`);
  const accounts = accountNames.join(t(`${TURN_OFF_KEY}.listSeparator`));
  return t(`${TURN_OFF_KEY}.planUsageStops`, { accounts });
}

/** 关「读取 CLI 登录凭证」之前先问：按名字列出会停止显示套餐用量的账号。打开时不问。 */
export function CliSignInsTurnOffSheet(props: {
  accountNames: readonly string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { accountNames, onConfirm, onClose } = props;
  const { t } = useTranslation();
  // 关掉后会停的事，一件一句。现在只有套餐用量；多号自动轮换（子任务 9）在这里加一项。
  const stopped = useMemo(
    () => [{ id: "planUsage", text: planUsageStops({ t, accountNames }) }],
    [accountNames, t],
  );
  const { height: windowHeight } = useWindowDimensions();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const handleBodyLayout = useCallback(
    (event: LayoutChangeEvent) => setBodyHeight(event.nativeEvent.layout.height),
    [],
  );
  const snapPoints = useMemo(
    () => fitContentSnapPoints({ bodyHeight, windowHeight, safeAreaBottom }),
    [bodyHeight, safeAreaBottom, windowHeight],
  );
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
      snapPoints={snapPoints}
      testID="host-privacy-turn-off-sheet"
    >
      <View style={styles.body} onLayout={handleBodyLayout} testID="host-privacy-turn-off-message">
        {stopped.map((thing) => (
          <Text key={thing.id} variant="caption" color="foregroundMuted">
            {thing.text}
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
