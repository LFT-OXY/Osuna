import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Copy, FileText, RotateCw } from "lucide-react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { Text as UiText } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import type { ProviderDiagnosticState } from "./diagnostic";
import { revealInScrollContainer } from "./reveal";
import { useTimeAgoLabel } from "./time-ago";

/*
 * 详情最底部的诊断节：未运行时是一行说明加「运行诊断」，运行中、完成、失败都在原位显示。
 * ⋯ 菜单与错误卡的「诊断」经 revealRequest 让这一节滚进视野。
 */

export interface ProviderDiagnosticSectionProps {
  providerLabel: string;
  diagnostic: ProviderDiagnosticState;
  // 每次加一表示有人要看诊断节；挂载时的值不算。
  revealRequest: number;
  onRun: () => void;
  onCopy: (output: string) => void;
}

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function ProviderDiagnosticSection({
  providerLabel,
  diagnostic,
  revealRequest,
  onRun,
  onCopy,
}: ProviderDiagnosticSectionProps) {
  const { t } = useTranslation();
  const sectionRef = useRef<View>(null);
  const seenRevealRequest = useRef(revealRequest);
  const isReady = diagnostic.status === "ready";
  // 空输出显示「没有可用诊断」，没有可复制的内容。
  const output = isReady && diagnostic.output ? diagnostic.output : null;
  const ranAtLabel = useTimeAgoLabel(diagnostic.status === "ready" ? diagnostic.ranAt : undefined);

  useEffect(() => {
    if (revealRequest === seenRevealRequest.current) return;
    seenRevealRequest.current = revealRequest;
    revealInScrollContainer(sectionRef.current);
  }, [revealRequest]);

  const handleCopy = useCallback(() => {
    if (output !== null) onCopy(output);
  }, [onCopy, output]);

  const trailing = useMemo(() => {
    if (!isReady) return undefined;
    return (
      <View style={styles.trailing}>
        {ranAtLabel ? (
          <UiText variant="caption" color="foregroundMuted" numberOfLines={1}>
            {ranAtLabel}
          </UiText>
        ) : null}
        {output === null ? null : (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Copy}
            onPress={handleCopy}
            accessibilityLabel={t("settings.providers.diagnostic.copyAccessibility")}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={RotateCw}
          onPress={onRun}
          accessibilityLabel={t("settings.providers.diagnostic.refreshAccessibility")}
        />
      </View>
    );
  }, [handleCopy, isReady, onRun, output, ranAtLabel, t]);

  let body: React.ReactNode;
  switch (diagnostic.status) {
    case "idle":
      body = (
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <UiText variant="caption" color="foregroundMuted" style={settingsStyles.rowContent}>
              {t("settings.providers.diagnostic.description", { name: providerLabel })}
            </UiText>
            <Button variant="outline" size="sm" leftIcon={FileText} onPress={onRun}>
              {t("settings.providers.diagnostic.run")}
            </Button>
          </View>
        </View>
      );
      break;
    case "running":
      body = (
        <View style={settingsStyles.card}>
          <View style={[settingsStyles.row, styles.runningRow]}>
            <ThemedLoadingSpinner size="small" uniProps={mutedIconColorMapping} />
            <UiText color="foregroundMuted">{t("settings.providers.diagnostic.running")}</UiText>
          </View>
        </View>
      );
      break;
    case "ready":
      body = diagnostic.output ? (
        <ScrollableCodeSurface testID="provider-diagnostic-output">
          {diagnostic.output}
        </ScrollableCodeSurface>
      ) : (
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <UiText color="foregroundMuted">{t("settings.providers.diagnostic.none")}</UiText>
          </View>
        </View>
      );
      break;
    case "failed":
      body = (
        <View style={settingsStyles.card} testID="provider-diagnostic-error">
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <UiText color="statusDanger">
                {t("settings.providers.diagnostic.failedToFetch")}
              </UiText>
              <UiText variant="caption" color="foregroundMuted" selectable>
                {diagnostic.message || t("settings.providers.diagnostic.unknownError")}
              </UiText>
            </View>
            <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={onRun}>
              {t("common.actions.retry")}
            </Button>
          </View>
        </View>
      );
      break;
  }

  return (
    <View ref={sectionRef}>
      <SettingsSection
        title={t("settings.providers.diagnostic.title")}
        trailing={trailing}
        testID="provider-diagnostic-section"
      >
        {body}
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  runningRow: {
    justifyContent: "flex-start",
    gap: theme.spacing[2],
  },
}));
