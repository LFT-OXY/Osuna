import type { UsageSpeedGroupBy } from "@getpaseo/protocol/usage/types";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { UsageCard } from "@/components/usage/usage-card";
import {
  UsageSegmentedControl,
  type UsageSegmentedOption,
} from "@/components/usage/usage-segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useUsageReport, type UseUsageReportInput } from "@/hooks/use-usage-report";
import {
  formatOutputSpeed,
  formatRequestMs,
  usageRequestEndpointLabel,
} from "@/usage-stats/requests";
import { usageSourceLabel } from "@/usage-stats/sources";
import { usageGroupSpeed, usageGroupWaitMs, type MergedUsageSpeedGroup } from "@/usage-stats/speed";

/** What the card asks: the hosts with the gateway ledger, and the page's range and endpoint filter. */
export type UsageSpeedRequests = Pick<
  UseUsageReportInput,
  "hosts" | "range" | "timezone" | "endpoints"
>;

const GROUPINGS: readonly UsageSpeedGroupBy[] = ["endpoint", "model", "model_endpoint", "agent"];
const GROUPING_LABEL_KEYS = {
  endpoint: "usage.speed.groupBy.endpoint",
  model: "usage.speed.groupBy.model",
  model_endpoint: "usage.speed.groupBy.modelEndpoint",
  agent: "usage.speed.groupBy.agent",
} as const satisfies Record<UsageSpeedGroupBy, string>;
const SKELETON_KEYS = ["skeleton-0", "skeleton-1", "skeleton-2"];

/**
 * How fast each endpoint, model or agent wrote and how long its first token
 * took, over the gateway's streamed requests in the page's range. Each row
 * says how many replies its speed is of; a group of one is shown too.
 */
export function UsageSpeedCard({ requests }: { requests: UsageSpeedRequests }): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [groupBy, setGroupBy] = useState<UsageSpeedGroupBy>("endpoint");
  const { loadState, isError, refetch } = useUsageReport({
    hosts: requests.hosts,
    range: requests.range,
    timezone: requests.timezone,
    endpoints: requests.endpoints,
    speedGroupBy: groupBy,
  });
  const options = useMemo<UsageSegmentedOption<UsageSpeedGroupBy>[]>(
    () =>
      GROUPINGS.map((value) => ({
        value,
        label: t(GROUPING_LABEL_KEYS[value]),
        testID: `usage-speed-group-${value}`,
      })),
    [t],
  );
  const renderGroupPicker = useCallback(
    () => (
      <UsageSegmentedControl
        options={options}
        value={groupBy}
        accessibilityLabel={t("usage.speed.groupBy.label")}
        onChange={setGroupBy}
        testID="usage-speed-group-by"
      />
    ),
    [groupBy, options, t],
  );

  let body: ReactElement;
  if (loadState.status === "loaded") {
    const groups = loadState.data.speed?.groups ?? [];
    body =
      groups.length === 0 ? (
        <View style={[styles.body, styles.empty]}>
          <Text variant="caption" color="foregroundMuted" testID="usage-speed-empty">
            {t("usage.speed.empty")}
          </Text>
        </View>
      ) : (
        <View style={styles.body} testID="usage-speed-rows">
          <UsageSpeedHead />
          {groups.map((group, index) => (
            <UsageSpeedRow key={group.key} group={group} divided={index > 0} />
          ))}
        </View>
      );
  } else if (isError) {
    body = (
      <View style={[styles.body, styles.empty]}>
        <Text variant="caption" color="statusDanger" testID="usage-speed-error">
          {t("usage.speed.loadError")}
        </Text>
        <Button variant="ghost" size="sm" onPress={refetch}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  } else {
    body = (
      <View style={styles.body} testID="usage-speed-loading" accessibilityRole="progressbar">
        <UsageSpeedHead />
        {SKELETON_KEYS.map((key, index) => (
          <View key={key} style={[styles.row, index > 0 && styles.rowDivided]}>
            <View style={styles.nameColumn}>
              <View style={styles.skeletonBar} />
            </View>
            <View style={styles.speedColumn}>
              <View style={[styles.skeletonBar, styles.skeletonShort]} />
              <View style={[styles.skeletonBar, styles.skeletonShort]} />
            </View>
            <View style={styles.waitColumn}>
              <View style={[styles.skeletonBar, styles.skeletonShort]} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <UsageCard
      title={t("usage.speed.title")}
      renderHeaderRight={isCompact ? undefined : renderGroupPicker}
      testID="usage-speed-card"
    >
      {isCompact ? <View style={styles.compactPicker}>{renderGroupPicker()}</View> : null}
      {body}
    </UsageCard>
  );
}

/** The column names over the rows (and their skeleton). */
function UsageSpeedHead() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  // 窄窗口用短名，表头各占一行。
  const labels = isCompact ? "usage.speed.columnsCompact" : "usage.speed.columns";
  return (
    <View style={styles.head}>
      <View style={styles.nameColumn} />
      <Text
        variant="caption"
        color="foregroundMuted"
        numberOfLines={1}
        style={[styles.speedColumn, styles.number]}
      >
        {t(`${labels}.speed`)}
      </Text>
      <Text
        variant="caption"
        color="foregroundMuted"
        numberOfLines={1}
        style={[styles.waitColumn, styles.number]}
      >
        {t(`${labels}.ttft`)}
      </Text>
    </View>
  );
}

/**
 * One group: its name, its speed with how many replies that is of under it, and its mean wait.
 * On a narrow window a model's endpoint goes on a muted line of its own under the model.
 */
function UsageSpeedRow({ group, divided }: { group: MergedUsageSpeedGroup; divided: boolean }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { name, endpoint } = speedGroupLabel(group, t);
  const splitsEndpoint = isCompact && endpoint !== null;
  const oneLine = endpoint === null ? name : `${name} · ${endpoint}`;
  return (
    <View style={[styles.row, divided && styles.rowDivided]} testID="usage-speed-row">
      <View style={styles.nameColumn}>
        <Text variant="label" numberOfLines={splitsEndpoint ? 1 : 2}>
          {splitsEndpoint ? name : oneLine}
        </Text>
        {splitsEndpoint ? (
          <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
            {endpoint}
          </Text>
        ) : null}
      </View>
      <View style={styles.speedColumn}>
        <Text variant="label" weight="medium" style={styles.number}>
          {formatOutputSpeed(usageGroupSpeed(group))}
        </Text>
        <Text variant="caption" color="foregroundMuted" style={styles.number}>
          {t("usage.speed.samples", { count: group.speedCount })}
        </Text>
      </View>
      <Text variant="label" style={[styles.waitColumn, styles.number]}>
        {formatRequestMs(usageGroupWaitMs(group))}
      </Text>
    </View>
  );
}

/** A speed group's name, and the endpoint apart when the group is a model at an endpoint. */
interface SpeedGroupLabel {
  name: string;
  endpoint: string | null;
}

/** A group's name in the grouping it is of: the endpoint (Official), the model, both, or the agent. */
function speedGroupLabel(
  group: MergedUsageSpeedGroup,
  t: (key: string, options?: Record<string, unknown>) => string,
): SpeedGroupLabel {
  const endpoint =
    group.endpoint === null
      ? null
      : usageRequestEndpointLabel(
          { name: group.endpoint.name, deleted: group.endpoint.deleted },
          t,
        );
  if (group.cli !== null) {
    const agent = usageSourceLabel({ cli: group.cli, backend: null });
    return { name: agent, endpoint: null };
  }
  if (group.model !== null) return { name: group.model, endpoint };
  return { name: endpoint ?? "", endpoint: null };
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  // 一行：名字一行或两行，速度那一列总是两行（速度与「基于 N 条」）；上下留白加分隔线。
  const rowHeight =
    theme.typeScale.label.lineHeight +
    theme.typeScale.caption.lineHeight +
    theme.spacing[2] * 2 +
    1;
  const headHeight = theme.typeScale.caption.lineHeight + theme.spacing[2] + 1;
  return {
    compactPicker: {
      flexDirection: "row",
      marginBottom: theme.spacing[3],
    },
    head: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: theme.spacing[3],
      paddingBottom: theme.spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: palette.divider2,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      // 骨架与真实行同高。
      minHeight: rowHeight,
    },
    // 行与行之间的线；表头下已有一条，最后一行下面不画。
    rowDivided: {
      borderTopWidth: 1,
      borderTopColor: palette.divider,
    },
    // 有数据、加载中、空、出错都占表头加三行的高度：换时段时卡片不跳。
    body: {
      minHeight: headHeight + 3 * rowHeight,
    },
    nameColumn: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
    },
    speedColumn: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: { xs: 96, md: 128 },
      alignItems: "flex-end",
      gap: 0,
    },
    waitColumn: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: { xs: 80, md: 128 },
      alignItems: "flex-end",
    },
    number: {
      textAlign: "right",
      fontVariant: ["tabular-nums"],
    },
    empty: {
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[2],
    },
    skeletonBar: {
      height: 8,
      width: "60%",
      marginVertical: 5,
      borderRadius: theme.borderRadius.full,
      backgroundColor: palette.track,
    },
    skeletonShort: {
      width: 56,
    },
  };
});
