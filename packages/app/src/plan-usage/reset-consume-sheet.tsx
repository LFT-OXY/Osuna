// 确认框照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 askReset，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { resetTimeText } from "@/api-endpoints/balance-copy";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { UsageReportEntry } from "@/usage/types";
import { RESET_USE_KEY, resetConfirmation } from "./reset-consume";
import type { ResetConsumeState } from "./use-reset-consume";

const SHEET_WIDTH = 480;
// 手机上几段话加底部按钮，半屏就够，不留一大片空白
const SNAP_POINTS = ["50%"];

/**
 * 用掉之前先问：写明是哪个账号、不能撤回、用掉的是最早过期的那张。进行中按钮转圈；
 * 失败的原因留在框里，直到再按一次或关掉。
 */
export function ResetConsumeSheet(props: {
  entry: UsageReportEntry;
  state: ResetConsumeState;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { entry, state, onConfirm, onClose } = props;
  const { t, i18n } = useTranslation();
  const asked = useMemo(
    () =>
      resetConfirmation({
        t,
        entry,
        formatTime: (iso) => resetTimeText({ iso, locale: i18n.language }),
      }),
    [entry, i18n.language, t],
  );
  const isBusy = state.status === "consuming";
  const header = useMemo<SheetHeader>(() => ({ title: asked.title }), [asked.title]);
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onPress={onClose}
          disabled={isBusy}
          testID="usage-resets-use-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onPress={onConfirm}
          loading={isBusy}
          testID="usage-resets-use-confirm"
        >
          {t(`${RESET_USE_KEY}.action`)}
        </Button>
      </View>
    ),
    [isBusy, onClose, onConfirm, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={SHEET_WIDTH}
      snapPoints={SNAP_POINTS}
      testID="usage-resets-use-sheet"
    >
      <View style={styles.body}>
        {asked.paragraphs.map((paragraph) => (
          <Text key={paragraph} variant="caption" color="foregroundMuted">
            {paragraph}
          </Text>
        ))}
        {state.status === "failed" ? (
          <Text variant="caption" color="statusDanger" selectable testID="usage-resets-use-error">
            {t(`${RESET_USE_KEY}.failed`, { error: state.error })}
          </Text>
        ) : null}
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
