import React from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ArrowUp } from "lucide-react-native";
import type { ProviderUpgradeErrorCode } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { Text as UiText } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProviderUpgradeState } from "./upgrade";

/*
 * 一键升级的按钮和失败块：列表行和详情页的版本一节共用。
 * 按钮只在有新版本时出现，悬停提示"v{当前} → v{最新}"；升级中转圈并禁用。
 * 列表行的按钮放在状态行里，用 xs 尺寸，写成"升级到 v{最新}"。
 */

const UPGRADE_OUTPUT_MAX_HEIGHT = 240;

const ERROR_MESSAGE_KEYS: Record<ProviderUpgradeErrorCode, string> = {
  unsupported: "settings.providers.upgrade.errors.unsupported",
  install_method_unknown: "settings.providers.upgrade.errors.installMethodUnknown",
  not_installed: "settings.providers.upgrade.errors.notInstalled",
  in_progress: "settings.providers.upgrade.errors.inProgress",
  command_failed: "settings.providers.upgrade.errors.failed",
  timeout: "settings.providers.upgrade.errors.timeout",
  version_unchanged: "settings.providers.upgrade.errors.versionUnchanged",
};

function isKnownErrorCode(code: string | null): code is ProviderUpgradeErrorCode {
  return code !== null && Object.prototype.hasOwnProperty.call(ERROR_MESSAGE_KEYS, code);
}

export function ProviderUpgradeButton({
  providerLabel,
  installedVersion,
  latestVersion,
  isUpgrading,
  onUpgrade,
  placement = "section",
}: {
  providerLabel: string;
  installedVersion: string;
  latestVersion: string;
  isUpgrading: boolean;
  onUpgrade: () => void;
  placement?: "statusLine" | "section";
}) {
  const { t } = useTranslation();
  const isStatusLine = placement === "statusLine";
  const label = isStatusLine
    ? t("settings.providers.upgrade.actionTo", { version: latestVersion })
    : t("settings.providers.upgrade.action");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <View>
          <Button
            variant="outline"
            size={isStatusLine ? "xs" : "sm"}
            leftIcon={isStatusLine ? ArrowUp : undefined}
            loading={isUpgrading}
            onPress={onUpgrade}
            accessibilityLabel={t("settings.providers.upgrade.actionLabel", {
              name: providerLabel,
            })}
            testID="provider-upgrade-button"
          >
            {label}
          </Button>
        </View>
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltipText}>
          {t("settings.providers.version.update", { from: installedVersion, to: latestVersion })}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

// 失败块：原因一行加命令输出原文（等宽、可选中），可以关掉。
// hasInstallSectionBelow：同一屏下方有「安装与升级」区块（详情页）时，原因下面加一句指向它的引导；列表行没有。
export function ProviderUpgradeFailure({
  state,
  hasInstallSectionBelow,
  onDismiss,
}: {
  state: Extract<ProviderUpgradeState, { status: "failed" }>;
  hasInstallSectionBelow: boolean;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const knownCode = isKnownErrorCode(state.errorCode) ? state.errorCode : null;
  const title = t(
    knownCode ? ERROR_MESSAGE_KEYS[knownCode] : "settings.providers.upgrade.errors.failed",
  );
  // 没有对应文案的失败（请求没送达、新 daemon 的新错误码）把原因原样带上。
  const detail = knownCode ? null : state.error;
  // 已有升级在进行不是这次升级的失败，用不着手动升级。
  const upgradeItselfFailed = knownCode !== "in_progress";
  const pointsToInstallSection = hasInstallSectionBelow && upgradeItselfFailed;
  return (
    <View style={styles.failure} testID="provider-upgrade-failure">
      <View style={styles.failureHeader}>
        <View style={styles.failureMessage}>
          <UiText variant="caption" color="statusDanger">
            {title}
          </UiText>
          {detail ? (
            <UiText variant="caption" color="foregroundMuted" selectable>
              {detail}
            </UiText>
          ) : null}
          {pointsToInstallSection ? (
            <UiText variant="caption" color="foregroundMuted">
              {t("settings.providers.upgrade.manualHint")}
            </UiText>
          ) : null}
        </View>
        <Button variant="ghost" size="sm" onPress={onDismiss}>
          {t("common.actions.dismiss")}
        </Button>
      </View>
      {state.output ? (
        <ScrollableCodeSurface
          maxHeight={UPGRADE_OUTPUT_MAX_HEIGHT}
          testID="provider-upgrade-output"
        >
          {state.output}
        </ScrollableCodeSurface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  failure: {
    gap: theme.spacing[2],
  },
  failureHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  failureMessage: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
}));
