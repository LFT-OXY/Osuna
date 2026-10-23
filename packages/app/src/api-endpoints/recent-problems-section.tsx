import { useRouter } from "expo-router";
import type { TFunction } from "i18next";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ApiEndpointRecentProblem } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import {
  formatCooldownTime,
  formatRequestTime,
  usageRequestFailureLabel,
} from "@/usage-stats/requests";
import { getDeviceTimeZone } from "@/utils/device-timezone";
import { buildUsageRequestsRoute } from "@/utils/host-routes";
import type { EndpointRecentProblems } from "./use-endpoint-recent-problems";

/**
 * 接口详情页的「最近异常」：这家最近 20 次失败、被换走或进入冷却的请求，每行事由在上、时间与模型在下，
 * 上游原话淡色跟在后面；读不到时就地写原因并给「重试」。底部「在请求列表里看全部」进用量页按这家筛好的请求列表。
 */
export function ApiEndpointRecentProblemsSection({
  endpointId,
  endpointName,
  problems,
}: {
  endpointId: string;
  endpointName: string;
  problems: Exclude<EndpointRecentProblems, { status: "off" }>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const handleViewAll = useCallback(() => {
    router.push(buildUsageRequestsRoute({ endpointId, endpointName }));
  }, [endpointId, endpointName, router]);
  const count =
    problems.status === "ready" && problems.problems.length > 0
      ? problems.problems.length
      : undefined;
  return (
    <SettingsSection
      title={t("settings.apiEndpoints.recentProblems.title")}
      info={t("settings.apiEndpoints.recentProblems.info")}
      count={count}
      testID="api-endpoint-recent-problems"
    >
      <View style={settingsStyles.card}>
        <RecentProblemsBody problems={problems} />
        <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.footer]}>
          <Button
            variant="outline"
            size="xs"
            onPress={handleViewAll}
            testID="api-endpoint-recent-problems-view-all"
          >
            {t("settings.apiEndpoints.recentProblems.viewAll")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

function RecentProblemsBody({
  problems,
}: {
  problems: Exclude<EndpointRecentProblems, { status: "off" }>;
}) {
  const { t } = useTranslation();
  if (problems.status === "loading") {
    return (
      <Notice
        text={t("settings.apiEndpoints.recentProblems.loading")}
        testID="api-endpoint-recent-problems-loading"
      />
    );
  }
  if (problems.status === "error") {
    // 原因与原话在左，「重试」在这一行右侧（同余额分区的「填写余额查询地址」），不和底部按钮叠在一起。
    return (
      <View style={settingsStyles.row} testID="api-endpoint-recent-problems-error">
        <View style={styles.failure}>
          <Text variant="caption" color="statusDanger">
            {t("settings.apiEndpoints.recentProblems.loadFailed")}
          </Text>
          <Text variant="caption" color="foregroundMuted" selectable numberOfLines={3}>
            {problems.message}
          </Text>
        </View>
        <Button
          variant="outline"
          size="xs"
          loading={problems.isRetrying}
          disabled={problems.isRetrying}
          onPress={problems.retry}
          testID="api-endpoint-recent-problems-retry"
        >
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }
  if (problems.problems.length === 0) {
    return (
      <Notice
        text={t("settings.apiEndpoints.recentProblems.empty")}
        testID="api-endpoint-recent-problems-empty"
      />
    );
  }
  return (
    <>
      {problems.problems.map((problem, index) => (
        <RecentProblemRow key={problem.id} problem={problem} isFirst={index === 0} />
      ))}
    </>
  );
}

function RecentProblemRow({
  problem,
  isFirst,
}: {
  problem: ApiEndpointRecentProblem;
  isFirst: boolean;
}) {
  const { t, i18n } = useTranslation();
  const timezone = useMemo(() => getDeviceTimeZone(), []);
  const locale = i18n.language;
  const failure = problem.failure
    ? usageRequestFailureLabel(problem.failure, t)
    : t("settings.apiEndpoints.recentProblems.failed");
  const after = afterFailure({ problem, t, locale, timezone });
  return (
    <View
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder, styles.problem]}
      testID="api-endpoint-recent-problem"
    >
      <Text numberOfLines={2}>
        {/* 只有失败分类用状态色，冷却与去向是说明。 */}
        <Text color="statusDanger">{failure}</Text>
        {after.length > 0 ? ` · ${after.join(" · ")}` : ""}
      </Text>
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {`${formatRequestTime(problem.at, locale, timezone)} · ${modelOf(problem)}`}
      </Text>
      {problem.reason ? (
        <Text variant="caption" color="foregroundMuted" selectable numberOfLines={2}>
          {problem.reason}
        </Text>
      ) : null}
    </View>
  );
}

/** CLI 请求的模型与问这家时用的模型；不同时写「请求的 → 这家的」（照 magpie 路由页的行标题）。 */
function modelOf(problem: ApiEndpointRecentProblem): string {
  if (problem.requestedModel === problem.model) return problem.model;
  return `${problem.requestedModel} → ${problem.model}`;
}

/** 失败之后的事：冷却到几点、换到了哪家；没换且请求失败时写 Agent 收到了报错。 */
function afterFailure(input: {
  problem: ApiEndpointRecentProblem;
  t: TFunction;
  locale: string;
  timezone: string;
}): string[] {
  const { problem, t, locale, timezone } = input;
  const parts: string[] = [];
  if (problem.cooldownUntil) {
    parts.push(
      t("usage.requests.details.cooldownUntil", {
        time: formatCooldownTime(problem.cooldownUntil, locale, timezone),
      }),
    );
  }
  if (problem.switchedTo) {
    const name =
      problem.switchedTo.endpointId === null
        ? t("usage.overview.official")
        : (problem.switchedTo.endpointName ?? problem.switchedTo.endpointId);
    parts.push(t("settings.apiEndpoints.recentProblems.switchedTo", { name }));
  } else if (problem.status === "failed") {
    parts.push(t("settings.apiEndpoints.recentProblems.agentGotError"));
  }
  return parts;
}

function Notice({ text, testID }: { text: string; testID: string }) {
  return (
    <View style={settingsStyles.row} testID={testID}>
      <Text variant="caption" color="foregroundMuted">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  problem: {
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: theme.spacing[0.5],
  },
  failure: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  footer: {
    justifyContent: "flex-start",
  },
}));
