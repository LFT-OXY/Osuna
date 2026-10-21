// 发现提示条照 magpie（https://github.com/yetone/magpie，7597c132）internal/gui/assets/index.html 的 #providerDiscovery
// 与 app.js 的 renderProviderDiscovery。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ApiEndpointImportCandidate } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import type { IgnoreState } from "./use-import-discovery";

export interface ImportDiscoveryBannerProps {
  candidates: readonly ApiEndpointImportCandidate[];
  ignoreState: IgnoreState;
  // 还没有接口时「查看」是主按钮（magpie 列表空时 review 是 primary）。
  hasNoEndpointsYet: boolean;
  onReview: () => void;
  onIgnore: () => void;
}

/** 「发现 N 个本地配置」：来源软件用「 · 」连起来，「查看」打开导入窗口，「忽略」记在主机上。 */
export function ImportDiscoveryBanner({
  candidates,
  ignoreState,
  hasNoEndpointsYet,
  onReview,
  onIgnore,
}: ImportDiscoveryBannerProps) {
  const { t } = useTranslation();
  const count = candidates.length;
  if (count === 0) return null;
  const title = t("settings.apiEndpoints.import.discovery.found", { count });
  const sources = [...new Set(candidates.map((candidate) => candidate.source))].join(" · ");
  const isIgnoring = ignoreState.status === "ignoring";
  return (
    <View style={[settingsStyles.card, styles.card]} testID="api-endpoints-import-discovery">
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="body" weight="medium" style={styles.title}>
            {title}
          </Text>
          <SettingsInfoTip
            title={title}
            info={t("settings.apiEndpoints.import.discovery.info")}
            side="bottom"
            testID="api-endpoints-import-discovery-info"
          />
        </View>
        <Text variant="caption" color="foregroundMuted" selectable>
          {sources}
        </Text>
        {ignoreState.status === "failed" ? (
          <Text
            variant="caption"
            color="statusDanger"
            selectable
            testID="api-endpoints-import-discovery-error"
          >
            {ignoreState.message}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onIgnore}
          loading={isIgnoring}
          textStyle={styles.ignoreText}
          testID="api-endpoints-import-discovery-ignore"
        >
          {t("settings.apiEndpoints.import.discovery.ignore")}
        </Button>
        <Button
          variant={hasNoEndpointsYet ? "default" : "secondary"}
          size="sm"
          onPress={onReview}
          disabled={isIgnoring}
          testID="api-endpoints-import-discovery-review"
        >
          {t("settings.apiEndpoints.import.discovery.review")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[4],
    rowGap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  body: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  title: {
    flexShrink: 1,
  },
  // 幽灵按钮的默认字色在深色里像是点不了：抬到次要按钮的字色。
  ignoreText: {
    color: theme.colors.secondaryForeground,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginLeft: "auto",
  },
}));
