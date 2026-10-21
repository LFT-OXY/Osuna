import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { TriangleAlert } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text, type TextColor } from "@/components/ui/text";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import type { VendorNotice, VendorNoticeDetail, VendorNoticeTone } from "./internal/vendor-status";

/*
 * 厂商官方状态页的提示：「{厂商} 官方报告服务异常」、受影响的项与事件，加「状态页 ↗」；只给链接的厂商只有链接。
 * 自成一行放在名称下面，不和名称抢宽度；文字不截断，窄屏换行。
 */

const ThemedTriangleAlert = withUnistyles(TriangleAlert);

const TONE_TEXT_COLORS: Record<VendorNoticeTone, TextColor> = {
  warning: "statusWarning",
  danger: "statusDanger",
  muted: "foregroundMuted",
};

const TONE_ICON_COLORS: Record<VendorNoticeTone, (theme: Theme) => { color: string }> = {
  warning: (theme) => ({ color: theme.colors.statusWarning }),
  danger: (theme) => ({ color: theme.colors.statusDanger }),
  muted: (theme) => ({ color: theme.colors.foregroundMuted }),
};

export function VendorNoticeLine({ notice, testID }: { notice: VendorNotice; testID: string }) {
  const { t } = useTranslation();
  const { link, problem, vendorName } = notice;
  const handleOpen = useCallback(() => {
    void openExternalUrl(link);
  }, [link]);
  const statusPage = (
    <Button
      variant="outline"
      size="xs"
      onPress={handleOpen}
      accessibilityRole="link"
      accessibilityLabel={t("settings.apiEndpoints.vendorStatus.statusPageLabel", {
        vendor: vendorName,
      })}
      testID={`${testID}-link`}
    >
      {t("settings.apiEndpoints.vendorStatus.statusPage")}
    </Button>
  );
  if (problem === null) {
    return (
      <View style={styles.linkOnly} testID={testID}>
        {statusPage}
      </View>
    );
  }
  return (
    <View style={styles.notice} testID={testID}>
      <View style={styles.headline}>
        {/* 图标和文字是一块，放不下时链接整块挪到下一行。 */}
        <View style={styles.message}>
          <ThemedTriangleAlert size={ICON_SIZE.sm} uniProps={TONE_ICON_COLORS[problem.tone]} />
          <Text
            variant="caption"
            weight="medium"
            color={TONE_TEXT_COLORS[problem.tone]}
            style={styles.messageText}
            testID={`${testID}-text`}
          >
            {t("settings.apiEndpoints.vendorStatus.reportsProblems", { vendor: vendorName })}
          </Text>
        </View>
        {statusPage}
      </View>
      {problem.details.map((detail) => (
        <Text
          key={`${detail.kind}:${detail.name}`}
          variant="caption"
          color="foregroundMuted"
          style={styles.detail}
        >
          {detailText({ t, detail })}
        </Text>
      ))}
    </View>
  );
}

function detailText(input: {
  t: ReturnType<typeof useTranslation>["t"];
  detail: VendorNoticeDetail;
}): string {
  const { t, detail } = input;
  if (detail.kind === "incident") return detail.name;
  // 不认识的状态照页面原文。
  const state = t(`settings.apiEndpoints.vendorStatus.parts.${detail.status}`, {
    defaultValue: detail.status,
  });
  return t("settings.apiEndpoints.vendorStatus.partLine", { part: detail.name, state });
}

const styles = StyleSheet.create((theme) => ({
  notice: {
    marginTop: theme.spacing[1.5],
    gap: theme.spacing[0.5],
  },
  linkOnly: {
    flexDirection: "row",
    marginTop: theme.spacing[1.5],
  },
  headline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[1.5],
    rowGap: theme.spacing[1],
  },
  message: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: theme.spacing[1.5],
  },
  messageText: {
    flexShrink: 1,
  },
  // 与提示文字对齐：让过图标与间距。
  detail: {
    paddingLeft: ICON_SIZE.sm + theme.spacing[1.5],
  },
}));
