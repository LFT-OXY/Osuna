import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExternalLink } from "lucide-react-native";
import type { ProviderUpgradeErrorCode } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { Text as UiText } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveProviderInstallGuide } from "@/provider-install-guide";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { ProviderUpgradeState } from "./upgrade";

/*
 * 一键升级的按钮和失败块：列表行和详情页的版本一节共用。
 * 按钮只在有新版本时出现，悬停提示"v{当前} → v{最新}"；升级中转圈并禁用。
 */

const UPGRADE_OUTPUT_MAX_HEIGHT = 240;

const ThemedExternalLink = withUnistyles(ExternalLink);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ERROR_MESSAGE_KEYS: Record<ProviderUpgradeErrorCode, string> = {
  unsupported: "settings.providers.upgrade.errors.unsupported",
  install_method_unknown: "settings.providers.upgrade.errors.installMethodUnknown",
  not_installed: "settings.providers.upgrade.errors.notInstalled",
  in_progress: "settings.providers.upgrade.errors.inProgress",
  command_failed: "settings.providers.upgrade.errors.failed",
  timeout: "settings.providers.upgrade.errors.timeout",
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
}: {
  providerLabel: string;
  installedVersion: string;
  latestVersion: string;
  isUpgrading: boolean;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <View>
          <Button
            variant="outline"
            size="sm"
            loading={isUpgrading}
            onPress={onUpgrade}
            accessibilityLabel={t("settings.providers.upgrade.actionLabel", {
              name: providerLabel,
            })}
            testID="provider-upgrade-button"
          >
            {t("settings.providers.upgrade.action")}
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

// 判断不出安装方式时的手动升级指引：按当初的安装方式自己升级，附官方文档链接。
function ManualUpgradeHint({
  provider,
  providerLabel,
  onOpenDocs,
}: {
  provider: string;
  providerLabel: string;
  onOpenDocs: (url: string) => void;
}) {
  const { t } = useTranslation();
  const docsUrl = resolveProviderInstallGuide({ provider, hostPlatform: undefined })?.docsUrl;
  const handleOpenDocs = useCallback(() => {
    if (docsUrl) onOpenDocs(docsUrl);
  }, [docsUrl, onOpenDocs]);
  return (
    <View style={styles.manualHint} testID="provider-upgrade-manual-hint">
      <UiText variant="caption" color="foregroundMuted">
        {t("settings.providers.upgrade.manualHint")}
      </UiText>
      {docsUrl ? (
        <View style={styles.docsLink}>
          <UiText
            variant="caption"
            color="foregroundMuted"
            accessibilityRole="link"
            accessibilityLabel={t("settings.providers.install.docsFor", { name: providerLabel })}
            onPress={handleOpenDocs}
            numberOfLines={1}
          >
            {t("settings.providers.install.docs")}
          </UiText>
          <ThemedExternalLink size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
        </View>
      ) : null}
    </View>
  );
}

// 失败块：原因一行加命令输出原文（等宽、可选中），可以关掉。
export function ProviderUpgradeFailure({
  provider,
  providerLabel,
  state,
  onDismiss,
  onOpenDocs,
}: {
  provider: string;
  providerLabel: string;
  state: Extract<ProviderUpgradeState, { status: "failed" }>;
  onDismiss: () => void;
  onOpenDocs: (url: string) => void;
}) {
  const { t } = useTranslation();
  const knownCode = isKnownErrorCode(state.errorCode) ? state.errorCode : null;
  const title = t(
    knownCode ? ERROR_MESSAGE_KEYS[knownCode] : "settings.providers.upgrade.errors.failed",
  );
  // 没有对应文案的失败（请求没送达、新 daemon 的新错误码）把原因原样带上。
  const detail = knownCode ? null : state.error;
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
          {knownCode === "install_method_unknown" ? (
            <ManualUpgradeHint
              provider={provider}
              providerLabel={providerLabel}
              onOpenDocs={onOpenDocs}
            />
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
  manualHint: {
    gap: theme.spacing[0.5],
  },
  docsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    alignSelf: "flex-start",
  },
}));
