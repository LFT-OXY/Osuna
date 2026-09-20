import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ScrollView } from "@/components/ui/scroll-view";
import { UsageCard } from "@/components/usage/usage-card";
import { UsageSegmentedControl } from "@/components/usage/usage-segmented-control";
import { UsageSessionList } from "@/components/usage/usage-session-list";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  topUsageProjects,
  USAGE_DETAILS_TABS,
  USAGE_PROJECT_LIMITS,
  type UsageDetailsTab,
  type UsageHostsView,
  type UsageProjectLimit,
} from "@/usage/details";
import { formatGroupedNumber, formatUsageCost, formatUsageTokensCompact } from "@/usage/format";
import type { MergedUsageProject, MergedUsageReport } from "@/usage/merge";
import { formatUsageDay, formatUsageMonth } from "@/usage/range-label";
import { usageSourceColor, usageSourceLabel } from "@/usage/sources";
import { totalUsageTokens } from "@/usage/totals";

/** Below this the table scrolls sideways rather than squeezing its columns. */
const TABLE_MIN_WIDTH = 672;

/**
 * The rows scroll inside the card instead of growing it: a month of days would
 * otherwise push the page several screens long and drag the side column with it.
 * The cap follows the viewport so a tall window still fills, with a floor for
 * short ones.
 */
const DETAILS_VIEWPORT_FRACTION = 0.55;
const DETAILS_MIN_HEIGHT = 320;

/**
 * Lets the table stretch past its minimum to fill the card. Plain, not a
 * Unistyles style: `contentContainerStyle` never reaches the DOM on web
 * (docs/unistyles.md).
 */
const TABLE_CONTENT_STYLE: ViewStyle = { flexGrow: 1 };

/**
 * Keeps the last column clear of the vertical scrollbar, which sits hard against
 * it otherwise. Plain for the same reason as `TABLE_CONTENT_STYLE`.
 */
const SCROLL_CONTENT_STYLE: ViewStyle = { paddingRight: 12 };

/** Shared empty set so a card that has expanded nothing keeps one identity. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

/** Rows expand independently: opening a second day does not fold the first. */
function toggleKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current);
  if (!next.delete(key)) next.add(key);
  return next;
}

interface UsageDetailsCardProps {
  report: MergedUsageReport;
  hosts: UsageHostsView;
}

export function UsageDetailsCard({ report, hosts }: UsageDetailsCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const isCompact = useIsCompactFormFactor();
  const { height: viewportHeight } = useWindowDimensions();
  const scrollStyle = useMemo(
    () => ({
      maxHeight: Math.max(
        DETAILS_MIN_HEIGHT,
        Math.round(viewportHeight * DETAILS_VIEWPORT_FRACTION),
      ),
    }),
    [viewportHeight],
  );
  const [tab, setTab] = useState<UsageDetailsTab>("daily");
  const [projectLimit, setProjectLimit] = useState<UsageProjectLimit>(10);
  const [openDays, setOpenDays] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [openProjects, setOpenProjects] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const handleToggleDay = useCallback((day: string) => {
    setOpenDays((current) => toggleKey(current, day));
  }, []);
  const handleToggleProject = useCallback((key: string) => {
    setOpenProjects((current) => toggleKey(current, key));
  }, []);

  const tabOptions = useMemo(
    () =>
      USAGE_DETAILS_TABS.map((value) => ({
        value,
        label: t(`usage.details.tabs.${value}`),
        testID: `usage-details-tab-${value}`,
      })),
    [t],
  );
  const limitOptions = useMemo(
    () =>
      USAGE_PROJECT_LIMITS.map((value) => ({
        value: String(value) as `${UsageProjectLimit}`,
        label: t("usage.details.topProjects", { count: value }),
        testID: `usage-details-projects-top-${value}`,
      })),
    [t],
  );
  const handleLimitChange = useCallback((value: string) => {
    setProjectLimit(Number(value) as UsageProjectLimit);
  }, []);
  const renderHeaderLeft = useCallback(
    () => (
      <UsageSegmentedControl
        options={tabOptions}
        value={tab}
        accessibilityLabel={t("usage.details.title")}
        onChange={setTab}
        testID="usage-details-tabs"
      />
    ),
    [t, tab, tabOptions],
  );
  const renderHeaderRight = useCallback(
    () =>
      tab === "projects" ? (
        <UsageSegmentedControl
          options={limitOptions}
          value={String(projectLimit) as `${UsageProjectLimit}`}
          accessibilityLabel={t("usage.details.projectLimit")}
          onChange={handleLimitChange}
          testID="usage-details-projects-limit"
        />
      ) : null,
    [handleLimitChange, limitOptions, projectLimit, t, tab],
  );

  let body: ReactNode;
  if (tab === "daily") {
    body = (
      <UsageDailyTable
        report={report}
        locale={locale}
        openDays={openDays}
        onToggleDay={handleToggleDay}
        hosts={hosts}
      />
    );
  } else if (tab === "monthly") {
    body = <UsageMonthlyTable report={report} locale={locale} />;
  } else {
    body = (
      <UsageProjectsList
        projects={report.projects}
        limit={projectLimit}
        hosts={hosts}
        openProjects={openProjects}
        onToggleProject={handleToggleProject}
      />
    );
  }

  return (
    <UsageCard
      renderHeaderLeft={renderHeaderLeft}
      renderHeaderRight={renderHeaderRight}
      testID="usage-details-card"
    >
      {isCompact ? (
        body
      ) : (
        <ScrollView
          style={scrollStyle}
          contentContainerStyle={SCROLL_CONTENT_STYLE}
          nestedScrollEnabled
          testID="usage-details-scroll"
        >
          {body}
        </ScrollView>
      )}
    </UsageCard>
  );
}

function UsageDailyTable({
  report,
  locale,
  openDays,
  onToggleDay,
  hosts,
}: {
  report: MergedUsageReport;
  locale: string;
  openDays: ReadonlySet<string>;
  onToggleDay: (day: string) => void;
  hosts: UsageHostsView;
}) {
  const { t } = useTranslation();
  const days = useMemo(() => report.days.toReversed(), [report.days]);

  if (days.length === 0) return <UsageDetailsEmpty testID="usage-details-daily-empty" />;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={TABLE_CONTENT_STYLE}
    >
      <View style={styles.table} testID="usage-details-daily">
        <View style={styles.headRow}>
          <Text style={[styles.headCell, styles.firstColumn]}>{t("usage.columns.date")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.total")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.input")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.output")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.cache")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.reasoning")}</Text>
          <Text style={[styles.headCell, styles.smallColumn]}>{t("usage.columns.sessions")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.cost")}</Text>
        </View>
        {days.map((day) => (
          <View key={day.day}>
            <UsageDayRow
              day={day.day}
              label={formatUsageDay(day.day, locale)}
              isOpen={openDays.has(day.day)}
              locale={locale}
              total={totalUsageTokens(day.totals)}
              cells={[
                day.totals.input,
                day.totals.output,
                day.totals.cachedInput + day.totals.cacheWrite,
                day.totals.reasoning,
              ]}
              sessionCount={day.sessionCount}
              estimatedCost={day.estimatedCost}
              onToggle={onToggleDay}
            />
            {openDays.has(day.day) ? <UsageSessionList day={day.day} hosts={hosts} /> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function UsageDayRow({
  day,
  label,
  isOpen,
  locale,
  total,
  cells,
  sessionCount,
  estimatedCost,
  onToggle,
}: {
  day: string;
  label: string;
  isOpen: boolean;
  locale: string;
  total: number;
  cells: readonly number[];
  sessionCount: number;
  estimatedCost: number;
  onToggle: (day: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(day), [day, onToggle]);
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={styles.row}
      testID={`usage-details-day-${day}`}
    >
      <Text style={[styles.dateCell, styles.firstColumn]}>{`${isOpen ? "▾" : "▸"} ${label}`}</Text>
      <Text style={[styles.totalCell, styles.numberColumn]}>
        {formatGroupedNumber(total, locale)}
      </Text>
      {cells.map((value, index) => (
        // The column list is fixed, so its position is its identity.
        <Text key={DAILY_CELL_IDS[index]} style={[styles.cell, styles.numberColumn]}>
          {formatGroupedNumber(value, locale)}
        </Text>
      ))}
      <Text style={[styles.cell, styles.smallColumn]}>
        {formatGroupedNumber(sessionCount, locale)}
      </Text>
      <Text style={[styles.cell, styles.numberColumn]}>{formatUsageCost(estimatedCost)}</Text>
    </Pressable>
  );
}

const DAILY_CELL_IDS = ["input", "output", "cache", "reasoning"] as const;

function UsageMonthlyTable({ report, locale }: { report: MergedUsageReport; locale: string }) {
  const { t } = useTranslation();
  const months = useMemo(() => report.months.toReversed(), [report.months]);

  if (months.length === 0) return <UsageDetailsEmpty testID="usage-details-monthly-empty" />;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={TABLE_CONTENT_STYLE}
    >
      <View style={styles.table} testID="usage-details-monthly">
        <View style={styles.headRow}>
          <Text style={[styles.headCell, styles.firstColumn]}>{t("usage.columns.month")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.total")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.input")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.output")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.cache")}</Text>
          <Text style={[styles.headCell, styles.smallColumn]}>{t("usage.columns.sessions")}</Text>
          <Text style={[styles.headCell, styles.numberColumn]}>{t("usage.columns.cost")}</Text>
        </View>
        {months.map((month) => (
          <View key={month.month} style={styles.row} testID={`usage-details-month-${month.month}`}>
            <Text style={[styles.dateCell, styles.firstColumn]}>
              {formatUsageMonth(month.month, locale)}
            </Text>
            <Text style={[styles.totalCell, styles.numberColumn]}>
              {formatGroupedNumber(totalUsageTokens(month.totals), locale)}
            </Text>
            <Text style={[styles.cell, styles.numberColumn]}>
              {formatGroupedNumber(month.totals.input, locale)}
            </Text>
            <Text style={[styles.cell, styles.numberColumn]}>
              {formatGroupedNumber(month.totals.output, locale)}
            </Text>
            <Text style={[styles.cell, styles.numberColumn]}>
              {formatGroupedNumber(month.totals.cachedInput + month.totals.cacheWrite, locale)}
            </Text>
            <Text style={[styles.cell, styles.smallColumn]}>
              {formatGroupedNumber(month.sessionCount, locale)}
            </Text>
            <Text style={[styles.cell, styles.numberColumn]}>
              {formatUsageCost(month.estimatedCost)}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function UsageProjectsList({
  projects,
  limit,
  hosts,
  openProjects,
  onToggleProject,
}: {
  projects: readonly MergedUsageProject[];
  limit: UsageProjectLimit;
  hosts: UsageHostsView;
  openProjects: ReadonlySet<string>;
  onToggleProject: (key: string) => void;
}) {
  const top = useMemo(() => topUsageProjects(projects, limit), [limit, projects]);

  if (top.projects.length === 0) return <UsageDetailsEmpty testID="usage-details-projects-empty" />;

  return (
    <View style={styles.projects} testID="usage-details-projects">
      {top.projects.map((project) => {
        const key = `${project.serverId}:${project.rootPath}`;
        return (
          <View key={key}>
            <UsageProjectRow
              projectKey={key}
              project={project}
              maxTokens={top.maxTokens}
              hostLabel={hosts.isMultiHost ? (hosts.labels.get(project.serverId) ?? null) : null}
              isOpen={openProjects.has(key)}
              onToggle={onToggleProject}
            />
            {openProjects.has(key) ? (
              <View style={styles.cwds} testID={`usage-details-cwds-${key}`}>
                {project.cwds.map((cwd) => (
                  <View key={cwd.cwd} style={styles.cwdRow}>
                    <Text style={styles.cwdPath} numberOfLines={1}>
                      {cwd.cwd}
                    </Text>
                    <Text style={styles.cwdAmount}>
                      {`${formatUsageTokensCompact(totalUsageTokens(cwd.totals))} · ${formatUsageCost(cwd.estimatedCost)}`}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function UsageProjectRow({
  projectKey,
  project,
  maxTokens,
  hostLabel,
  isOpen,
  onToggle,
}: {
  projectKey: string;
  project: MergedUsageProject;
  maxTokens: number;
  hostLabel: string | null;
  isOpen: boolean;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onToggle(projectKey), [onToggle, projectKey]);
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);
  const tokens = totalUsageTokens(project.totals);
  const width = maxTokens > 0 ? Math.max(2, (tokens / maxTokens) * 100) : 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={styles.projectRow}
      testID={`usage-details-project-${projectKey}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>{(project.displayName.at(0) ?? "?").toUpperCase()}</Text>
      </View>
      <View style={styles.projectBody}>
        <View style={styles.projectTitle}>
          <Text style={styles.projectName} numberOfLines={1}>
            {project.displayName}
          </Text>
          {hostLabel ? <Text style={styles.projectBadge}>{hostLabel}</Text> : null}
          {project.kind === "git" ? null : (
            <Text style={styles.projectBadge}>
              {t(`usage.details.projectKind.${project.kind}`)}
            </Text>
          )}
        </View>
        <View style={styles.projectSources}>
          {project.sources.map((source) => (
            <View
              key={usageSourceLabel(source)}
              accessibilityLabel={usageSourceLabel(source)}
              style={[styles.sourceDot, { backgroundColor: usageSourceColor(source) }]}
            />
          ))}
          <Text style={styles.projectPath} numberOfLines={1}>
            {project.rootPath}
          </Text>
        </View>
      </View>
      <View style={styles.projectAmount}>
        <Text style={styles.projectTokens}>{formatUsageTokensCompact(tokens)}</Text>
        <View style={styles.projectTrack}>
          <View style={[styles.projectBar, { width: `${width}%` }]} />
        </View>
      </View>
    </Pressable>
  );
}

function UsageDetailsEmpty({ testID }: { testID: string }) {
  const { t } = useTranslation();
  return (
    <Text style={styles.empty} testID={testID}>
      {t("usage.details.empty")}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    table: {
      minWidth: TABLE_MIN_WIDTH,
      flexGrow: 1,
    },
    headRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: theme.spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: palette.divider2,
    },
    headCell: {
      fontSize: 11,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink2,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: theme.spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: palette.divider,
    },
    firstColumn: {
      flexGrow: 2,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 120,
      textAlign: "left",
    },
    numberColumn: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      // A nine-digit grouped count is ~76px at this size; below that it wraps
      // onto a second line instead of letting the table scroll sideways.
      minWidth: 84,
      textAlign: "right",
    },
    smallColumn: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 48,
      textAlign: "right",
    },
    dateCell: {
      fontSize: 12,
      color: palette.inkMuted,
    },
    totalCell: {
      fontSize: 12,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
    },
    cell: {
      fontSize: 12,
      color: palette.ink2,
    },
    empty: {
      fontSize: 13,
      color: palette.inkFaint,
      paddingVertical: theme.spacing[4],
      textAlign: "center",
    },
    projects: {
      gap: 2,
    },
    projectRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      paddingVertical: theme.spacing[2],
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.rankBadge,
    },
    avatarLetter: {
      fontSize: 13,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink2,
    },
    projectBody: {
      flex: 1,
      minWidth: 0,
    },
    projectTitle: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    projectName: {
      fontSize: 13,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
      flexShrink: 1,
    },
    projectBadge: {
      fontSize: 10,
      color: palette.inkFaint,
    },
    projectSources: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    sourceDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    projectPath: {
      flexShrink: 1,
      fontSize: 11,
      color: palette.inkFaint,
    },
    projectAmount: {
      width: 104,
      alignItems: "flex-end",
      gap: 3,
    },
    projectTokens: {
      fontSize: 13,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
    },
    projectTrack: {
      width: "100%",
      height: 4,
      borderRadius: 999,
      backgroundColor: palette.track,
      overflow: "hidden",
    },
    projectBar: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: palette.brand,
    },
    cwds: {
      marginLeft: 44,
      paddingLeft: theme.spacing[3],
      borderLeftWidth: 2,
      borderLeftColor: palette.divider2,
      paddingBottom: theme.spacing[2],
    },
    cwdRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[3],
      paddingVertical: 2,
    },
    cwdPath: {
      flex: 1,
      minWidth: 0,
      fontSize: 11,
      color: palette.inkMuted,
    },
    cwdAmount: {
      fontSize: 11,
      color: palette.inkFaint,
    },
  };
});
