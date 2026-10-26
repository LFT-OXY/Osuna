import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import type { AccountRotationProvider } from "@getpaseo/protocol/provider-account/rpc-schemas";

/*
 * 第一次为 Codex 或 Claude Code 打开「多号自动轮换」时的风险提示：Ban risk notice 的样式，加两个条款链接，
 * 「我知道了，打开」才打开，「取消」开关不动。宽屏是对话框，手机宽度是底部面板。
 * 文字与出处见任务 10-16-multi-account-rotation 的 prd.md「风险提示」。
 */

const KEY = "settings.providers.accounts.riskNotice";
const SHEET_WIDTH = 520;
// 手机上量出正文高度之前先用的高度。
const UNMEASURED_SNAP_POINTS = ["70%"];
// 手机上正文以外的高度：把手、标题栏、正文上下留白、底部按钮栏。
const COMPACT_SHEET_CHROME_HEIGHT = 192;
const MAX_SNAP_PERCENT = 90;

const LINKS = {
  codex: [
    { key: "codexTermsLink", url: "https://openai.com/policies/sign-in-with-chatgpt-terms/" },
    { key: "codexMaintainerLink", url: "https://github.com/openai/codex/issues/20884" },
  ],
  claude: [
    { key: "claudePolicyLink", url: "https://www.anthropic.com/legal/aup" },
    { key: "claudeLegalLink", url: "https://code.claude.com/docs/en/legal-and-compliance" },
  ],
} as const;

export function ProviderAccountsRiskNoticeSheet(props: {
  provider: AccountRotationProvider;
  providerLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { provider, providerLabel, onConfirm, onClose } = props;
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const handleBodyLayout = useCallback(
    (event: LayoutChangeEvent) => setBodyHeight(event.nativeEvent.layout.height),
    [],
  );
  // 手机上底部面板刚好装下正文。
  const snapPoints = useMemo(() => {
    if (bodyHeight === null || windowHeight <= 0) return UNMEASURED_SNAP_POINTS;
    const needed = COMPACT_SHEET_CHROME_HEIGHT + bodyHeight + safeAreaBottom;
    return [`${Math.min(MAX_SNAP_PERCENT, Math.ceil((needed / windowHeight) * 100))}%`];
  }, [bodyHeight, safeAreaBottom, windowHeight]);
  const header = useMemo<SheetHeader>(
    () => ({ title: t(`${KEY}.sheetTitle`, { name: providerLabel }) }),
    [providerLabel, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onPress={onClose}
          testID="provider-accounts-risk-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={onConfirm}
          testID="provider-accounts-risk-confirm"
        >
          {t(`${KEY}.confirm`)}
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
      testID="provider-accounts-risk-notice"
    >
      <View onLayout={handleBodyLayout}>
        <Alert
          size="sm"
          variant="warning"
          title={t(`${KEY}.${provider}Title`)}
          description={t(`${KEY}.${provider}Body`)}
          testID="provider-accounts-risk-notice-body"
        >
          <View style={styles.links}>
            {LINKS[provider].map((link) => (
              <ExternalLink key={link.key} href={link.url} label={t(`${KEY}.${link.key}`)} />
            ))}
          </View>
        </Alert>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  // 两个链接上下排：手机宽度下并排会挤出提示框。
  links: {
    alignItems: "flex-start",
    gap: theme.spacing[1],
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
