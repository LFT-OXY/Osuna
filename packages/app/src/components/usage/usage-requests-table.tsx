import type { UsageCli, UsageRequestAttempt } from "@getpaseo/protocol/usage/types";
import { ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { UsageSegmentedControl } from "@/components/usage/usage-segmented-control";
import { useUsageRequests } from "@/hooks/use-usage-requests";
import type { UsageHostInput } from "@/usage-stats/aggregated-usage";
import { formatGroupedNumber, formatSessionCost } from "@/usage-stats/format";
import type { UsageRange } from "@/usage-stats/period";
import {
  formatCooldownTime,
  formatOutputSpeed,
  formatRequestMs,
  formatRequestTime,
  INITIAL_USAGE_REQUESTS_FILTERS,
  isKnownUsageRequestFailure,
  toUsageRequestFilters,
  USAGE_REQUESTS_PAGE_SIZE,
  usageRequestStatus,
  type MergedUsageRequestRow,
  type MergedUsageRequests,
  type UsageRequestsFilterState,
} from "@/usage-stats/requests";
import { usageSourceLabel } from "@/usage-stats/sources";

/** A search waits this long after the last key before it asks the hosts. */
const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 6;

type ColumnId =
  | "time"
  | "agent"
  | "model"
  | "endpoint"
  | "input"
  | "output"
  | "cacheRead"
  | "cacheWrite"
  | "cost"
  | "duration"
  | "ttft"
  | "speed"
  | "status";

/**
 * Which columns the row shows; the rest open under it. The card's own width
 * decides, so a narrow window never slides sideways: at phone width only time,
 * model, endpoint, status and cost stay on the row.
 */
type TableTier = "narrow" | "medium" | "wide";

const TIER_COLUMNS: Record<TableTier, readonly ColumnId[]> = {
  narrow: ["time", "model", "endpoint", "status", "cost"],
  medium: ["time", "model", "endpoint", "input", "output", "status", "cost"],
  wide: [
    "time",
    "agent",
    "model",
    "endpoint",
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "cost",
    "duration",
    "ttft",
    "speed",
    "status",
  ],
};
/**
 * The status ("Failed (quota used up)") wraps rather than cuts; when narrow the
 * time folds to day and clock, and the model and endpoint take a second line.
 */
function linesOf(column: ColumnId, tier: TableTier): number {
  if (column === "status") return tier === "narrow" ? 3 : 2;
  if (tier !== "narrow") return 1;
  return column === "time" || column === "model" || column === "endpoint" ? 2 : 1;
}

/** The narrowest card each tier fits in. */
const MEDIUM_MIN_WIDTH = 540;
const WIDE_MIN_WIDTH = 1000;

const NUMBER_COLUMNS = new Set<ColumnId>([
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "cost",
  "duration",
  "ttft",
  "speed",
]);

function tierOf(width: number): TableTier {
  if (width >= WIDE_MIN_WIDTH) return "wide";
  if (width >= MEDIUM_MIN_WIDTH) return "medium";
  return "narrow";
}

interface UsageRequestsTableProps {
  hosts: readonly UsageHostInput[];
  range: UsageRange;
  timezone: string;
  /** Host names by id, worn by rows while more than one host is counted. */
  hostLabels: ReadonlyMap<string, string> | null;
}

/** The Requests tab: a filter bar, one page of requests, and the pager. */
export function UsageRequestsTable({
  hosts,
  range,
  timezone,
  hostLabels,
}: UsageRequestsTableProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<UsageRequestsFilterState>(INITIAL_USAGE_REQUESTS_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
  const wireFilters = useMemo(() => toUsageRequestFilters(filters), [filters]);
  // 换了筛选或时段就回到第一页。
  const pageKey = `${range.from ?? ""}|${range.to ?? ""}|${JSON.stringify(wireFilters)}`;
  const [pageState, setPageState] = useState({ key: pageKey, index: 0 });
  const pageIndex = pageState.key === pageKey ? pageState.index : 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) =>
        current.search === searchDraft ? current : { ...current, search: searchDraft },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const loadState = useUsageRequests({
    hosts,
    range,
    timezone,
    filters: wireFilters,
    offset: pageIndex * USAGE_REQUESTS_PAGE_SIZE,
    limit: USAGE_REQUESTS_PAGE_SIZE,
  });
  const data = loadState.status === "loaded" ? loadState.data : null;

  const [width, setWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0) setWidth(next);
  }, []);
  const tier = tierOf(width);

  const updateFilters = useCallback((patch: Partial<UsageRequestsFilterState>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);
  const handlePage = useCallback(
    (index: number) => setPageState({ key: pageKey, index }),
    [pageKey],
  );

  let body: ReactElement;
  if (loadState.status === "error") {
    body = (
      <Text
        variant="caption"
        color="foregroundMuted"
        style={styles.empty}
        testID="usage-requests-error"
      >
        {t("usage.requests.loadError")}
      </Text>
    );
  } else if (!data || width === 0) {
    body = <UsageRequestsSkeleton />;
  } else if (data.rows.length === 0) {
    body = (
      <Text
        variant="caption"
        color="foregroundMuted"
        style={styles.empty}
        testID="usage-requests-empty"
      >
        {t("usage.requests.empty")}
      </Text>
    );
  } else {
    body = (
      <UsageRequestsRows
        data={data}
        tier={tier}
        timezone={timezone}
        hostLabels={hostLabels}
        pageIndex={pageIndex}
        onPage={handlePage}
      />
    );
  }

  return (
    <View style={styles.container} onLayout={handleLayout} testID="usage-requests">
      <UsageRequestsFilterBar
        filters={filters}
        searchDraft={searchDraft}
        data={data}
        onSearchChange={setSearchDraft}
        onChange={updateFilters}
      />
      {loadState.status === "loaded" && loadState.hostErrors.length > 0 ? (
        <View style={styles.hostErrors} testID="usage-requests-host-errors">
          {loadState.hostErrors.map((error) => (
            <Text key={error.serverId} variant="caption" color="statusWarning">
              {t("usage.requests.hostLoadError", { host: error.serverName })}
            </Text>
          ))}
        </View>
      ) : null}
      {body}
    </View>
  );
}

function UsageRequestsFilterBar({
  filters,
  searchDraft,
  data,
  onSearchChange,
  onChange,
}: {
  filters: UsageRequestsFilterState;
  searchDraft: string;
  data: MergedUsageRequests | null;
  onSearchChange: (value: string) => void;
  onChange: (patch: Partial<UsageRequestsFilterState>) => void;
}) {
  const { t } = useTranslation();
  const statusOptions = useMemo(
    () =>
      (["all", "failed", "switched"] as const).map((value) => ({
        value,
        label: t(`usage.requests.status.${value}`),
        testID: `usage-requests-status-${value}`,
      })),
    [t],
  );
  const handleStatus = useCallback(
    (status: UsageRequestsFilterState["status"]) => onChange({ status }),
    [onChange],
  );
  const throughChoices = useMemo<FilterChoice[]>(
    () => [
      { key: "gateway", label: t("usage.requests.through.gateway") },
      { key: "direct", label: t("usage.requests.through.direct") },
    ],
    [t],
  );
  const agentChoices = useMemo<FilterChoice[]>(
    () =>
      (data?.clis ?? []).map((cli) => ({
        key: cli,
        label: usageSourceLabel({ cli, backend: null }),
      })),
    [data?.clis],
  );
  const endpointChoices = useMemo<FilterChoice[]>(
    () =>
      (data?.endpoints ?? []).map((option) => ({
        key: option.key,
        label: endpointLabel(option, t),
      })),
    [data?.endpoints, t],
  );
  const modelChoices = useMemo<FilterChoice[]>(
    () => (data?.models ?? []).map((model) => ({ key: model, label: model })),
    [data?.models],
  );
  const handleThrough = useCallback(
    (key: string | null) =>
      onChange({ through: key === "gateway" || key === "direct" ? key : "all" }),
    [onChange],
  );
  const handleAgent = useCallback(
    (key: string | null) => onChange({ cli: key as UsageCli | null }),
    [onChange],
  );
  const endpoints = data?.endpoints;
  const handleEndpoint = useCallback(
    (key: string | null) => {
      const option = endpoints?.find((candidate) => candidate.key === key);
      onChange({ endpoint: option ? { key: option.key, endpointIds: option.endpointIds } : null });
    },
    [endpoints, onChange],
  );
  const handleModel = useCallback((key: string | null) => onChange({ model: key }), [onChange]);

  return (
    <View style={styles.filterBar} testID="usage-requests-filters">
      <View style={styles.filterRow}>
        <UsageSegmentedControl
          options={statusOptions}
          value={filters.status}
          accessibilityLabel={t("usage.requests.status.label")}
          onChange={handleStatus}
          testID="usage-requests-status"
        />
        <View style={styles.search}>
          <SearchField
            value={searchDraft}
            onChangeText={onSearchChange}
            placeholder={t("usage.requests.searchPlaceholder")}
            clearAccessibilityLabel={t("usage.requests.searchClear")}
            clearsOnEscape
            testID="usage-requests-search"
            clearTestID="usage-requests-search-clear"
          />
        </View>
      </View>
      <View style={styles.filterRow}>
        <UsageRequestsFilterMenu
          label={t("usage.requests.filters.through")}
          allLabel={t("usage.requests.filters.all")}
          choices={throughChoices}
          selected={filters.through === "all" ? null : filters.through}
          onSelect={handleThrough}
          testID="usage-requests-filter-through"
        />
        <UsageRequestsFilterMenu
          label={t("usage.requests.filters.agent")}
          allLabel={t("usage.requests.filters.all")}
          choices={agentChoices}
          selected={filters.cli}
          onSelect={handleAgent}
          testID="usage-requests-filter-agent"
        />
        <UsageRequestsFilterMenu
          label={t("usage.requests.filters.endpoint")}
          allLabel={t("usage.requests.filters.all")}
          choices={endpointChoices}
          selected={filters.endpoint?.key ?? null}
          onSelect={handleEndpoint}
          testID="usage-requests-filter-endpoint"
        />
        <UsageRequestsFilterMenu
          label={t("usage.requests.filters.model")}
          allLabel={t("usage.requests.filters.all")}
          choices={modelChoices}
          selected={filters.model}
          onSelect={handleModel}
          testID="usage-requests-filter-model"
        />
      </View>
    </View>
  );
}

function endpointLabel(
  endpoint: { name: string | null; deleted: boolean },
  t: (key: string) => string,
): string {
  if (endpoint.name === null) return t("usage.overview.official");
  if (endpoint.deleted) return `${endpoint.name} ${t("usage.overview.deletedEndpoint")}`;
  return endpoint.name;
}

interface FilterChoice {
  key: string;
  label: string;
}

function filterTriggerStyle({ hovered, open }: MenuTriggerState): StyleProp<ViewStyle> {
  return [styles.filterTrigger, (hovered || open) && styles.filterTriggerHovered];
}

/** One filter: what it narrows by, and the chosen value or All. */
function UsageRequestsFilterMenu({
  label,
  allLabel,
  choices,
  selected,
  onSelect,
  testID,
}: {
  label: string;
  allLabel: string;
  choices: readonly FilterChoice[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  testID: string;
}) {
  const handleAll = useCallback(() => onSelect(null), [onSelect]);
  const selectedLabel = choices.find((choice) => choice.key === selected)?.label ?? allLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        style={filterTriggerStyle}
        testID={`${testID}-trigger`}
      >
        <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" weight="medium" numberOfLines={1} style={styles.filterValue}>
          {selectedLabel}
        </Text>
        <ChevronDown size={12} color={styles.filterGlyph.color} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={200} testID={`${testID}-menu`}>
        <DropdownMenuItem
          selected={selected === null}
          showSelectedCheck
          onSelect={handleAll}
          testID={`${testID}-item-all`}
        >
          {allLabel}
        </DropdownMenuItem>
        {choices.map((choice) => (
          <UsageRequestsFilterItem
            key={choice.key}
            choice={choice}
            isSelected={choice.key === selected}
            onSelect={onSelect}
            testID={`${testID}-item-${choice.key}`}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UsageRequestsFilterItem({
  choice,
  isSelected,
  onSelect,
  testID,
}: {
  choice: FilterChoice;
  isSelected: boolean;
  onSelect: (key: string | null) => void;
  testID: string;
}) {
  const handleSelect = useCallback(() => onSelect(choice.key), [choice.key, onSelect]);
  return (
    <DropdownMenuItem
      selected={isSelected}
      showSelectedCheck
      onSelect={handleSelect}
      testID={testID}
    >
      {choice.label}
    </DropdownMenuItem>
  );
}

function UsageRequestsRows({
  data,
  tier,
  timezone,
  hostLabels,
  pageIndex,
  onPage,
}: {
  data: MergedUsageRequests;
  tier: TableTier;
  timezone: string;
  hostLabels: ReadonlyMap<string, string> | null;
  pageIndex: number;
  onPage: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const handleToggle = useCallback((key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const columns = TIER_COLUMNS[tier];

  return (
    <View testID="usage-requests-table">
      <View style={styles.headRow}>
        {columns.map((column) => (
          <Text
            key={column}
            variant="micro"
            weight="medium"
            color="foregroundMuted"
            numberOfLines={2}
            style={[
              styles.cell,
              columnStyle(column, tier),
              NUMBER_COLUMNS.has(column) && styles.numberCell,
            ]}
          >
            {t(`usage.requests.columns.${column}`)}
          </Text>
        ))}
      </View>
      {data.rows.map((row) => (
        <UsageRequestRow
          key={row.key}
          row={row}
          columns={columns}
          tier={tier}
          timezone={timezone}
          hostLabel={hostLabels?.get(row.serverId) ?? null}
          isOpen={openKeys.has(row.key)}
          onToggle={handleToggle}
        />
      ))}
      <UsageRequestsPager total={data.total} pageIndex={pageIndex} onPage={onPage} />
    </View>
  );
}

function columnStyle(
  column: ColumnId,
  tier: TableTier,
): StyleProp<Omit<TextStyle, "color" | "fontSize" | "lineHeight" | "fontWeight">> {
  if (column === "time") return tier === "narrow" ? styles.timeColumnNarrow : styles.timeColumn;
  if (column === "model") return styles.modelColumn;
  if (column === "endpoint") return styles.endpointColumn;
  if (column === "agent") return styles.agentColumn;
  if (column === "status") return styles.statusColumn;
  return styles.numberColumn;
}

function UsageRequestRow({
  row,
  columns,
  tier,
  timezone,
  hostLabel,
  isOpen,
  onToggle,
}: {
  row: MergedUsageRequestRow;
  columns: readonly ColumnId[];
  tier: TableTier;
  timezone: string;
  hostLabel: string | null;
  isOpen: boolean;
  onToggle: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const handlePress = useCallback(() => onToggle(row.key), [onToggle, row.key]);
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);
  const cells = useRequestCells(row, timezone);
  const hidden = TIER_COLUMNS.wide.filter((column) => !columns.includes(column));

  return (
    <View style={styles.rowBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={handlePress}
        style={styles.row}
        testID={`usage-request-row-${row.key}`}
      >
        {columns.map((column) => (
          <RequestCell key={column} column={column} tier={tier} cell={cells[column]} />
        ))}
      </Pressable>
      {isOpen ? (
        <View style={styles.details} testID={`usage-request-details-${row.key}`}>
          <View style={styles.detailGrid}>
            {hidden.map((column) => (
              <DetailItem
                key={column}
                label={t(`usage.requests.columns.${column}`)}
                value={cells[column].text}
              />
            ))}
            {hostLabel ? (
              <DetailItem label={t("usage.requests.details.host")} value={hostLabel} />
            ) : null}
            <DetailItem
              label={t("usage.requests.details.project")}
              value={row.project?.displayName ?? t("usage.details.unknownProject")}
            />
            {row.sessionId ? (
              <DetailItem label={t("usage.requests.details.session")} value={row.sessionId} />
            ) : null}
          </View>
          {row.error ? (
            <Text variant="caption" color="statusDanger" testID={`usage-request-error-${row.key}`}>
              {row.error}
            </Text>
          ) : null}
          {row.through === "direct" ? (
            <Text variant="caption" color="foregroundMuted">
              {t("usage.requests.details.direct")}
            </Text>
          ) : (
            <View style={styles.attempts} testID={`usage-request-attempts-${row.key}`}>
              <Text variant="micro" weight="medium" color="foregroundMuted">
                {t("usage.requests.details.attempts")}
              </Text>
              {row.attempts.map((attempt) => (
                <AttemptLine
                  key={`${attempt.startedAt}:${attempt.endpointId ?? "official"}:${attempt.result}`}
                  attempt={attempt}
                  locale={i18n.language}
                  timezone={timezone}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

interface RequestCellValue {
  text: string;
  color: "foreground" | "foregroundMuted" | "statusDanger" | "statusWarning";
}

/** Every column's text for one row, whichever the row shows and whichever open under it. */
function useRequestCells(
  row: MergedUsageRequestRow,
  timezone: string,
): Record<ColumnId, RequestCellValue> {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const status = usageRequestStatus(row);
  let statusCell: RequestCellValue;
  if (status.kind === "failed") {
    const reason = status.failure ? failureLabel(status.failure, t) : null;
    statusCell = {
      text: reason
        ? t("usage.requests.statusCell.failedWith", { reason })
        : t("usage.requests.statusCell.failed"),
      color: "statusDanger",
    };
  } else if (status.kind === "switched") {
    statusCell = {
      text: t("usage.requests.statusCell.switched", { count: status.count }),
      color: "statusWarning",
    };
  } else {
    statusCell = { text: t("usage.requests.statusCell.ok"), color: "foregroundMuted" };
  }
  const endpoint = endpointLabel(
    {
      name: row.endpointId === null ? null : (row.endpointName ?? row.endpointId),
      deleted: row.endpointDeleted,
    },
    t,
  );
  const count = (value: number): RequestCellValue => ({
    text: formatGroupedNumber(value, locale),
    color: "foreground",
  });
  const muted = (text: string): RequestCellValue => ({ text, color: "foregroundMuted" });
  return {
    time: muted(formatRequestTime(row.at, locale, timezone)),
    agent: { text: usageSourceLabel({ cli: row.cli, backend: null }), color: "foreground" },
    model: { text: row.model, color: "foreground" },
    endpoint: { text: endpoint, color: row.endpointId === null ? "foregroundMuted" : "foreground" },
    input: count(row.totals.input),
    output: count(row.totals.output),
    cacheRead: count(row.totals.cachedInput),
    cacheWrite: count(row.totals.cacheWrite),
    cost: row.priced
      ? { text: formatSessionCost(row.estimatedCost), color: "foreground" }
      : muted("—"),
    duration: muted(formatRequestMs(row.durationMs)),
    ttft: muted(formatRequestMs(row.ttftMs)),
    speed: muted(formatOutputSpeed(row.outputSpeed)),
    status: statusCell,
  };
}

function failureLabel(failure: string, t: (key: string) => string): string {
  return isKnownUsageRequestFailure(failure) ? t(`usage.requests.failures.${failure}`) : failure;
}

function RequestCell({
  column,
  tier,
  cell,
}: {
  column: ColumnId;
  tier: TableTier;
  cell: RequestCellValue;
}) {
  // 窄时时间折成日期、时刻两行，状态折两行，其余一行截断。
  const lines = linesOf(column, tier);
  return (
    <Text
      variant="caption"
      color={cell.color}
      numberOfLines={lines}
      style={[
        styles.cell,
        columnStyle(column, tier),
        NUMBER_COLUMNS.has(column) && styles.numberCell,
      ]}
    >
      {cell.text}
    </Text>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Text variant="micro" color="foregroundMuted">
        {label}
      </Text>
      <Text variant="caption" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** One try: which endpoint and model, how it ended, why, and the cooldown it caused. */
function AttemptLine({
  attempt,
  locale,
  timezone,
}: {
  attempt: UsageRequestAttempt;
  locale: string;
  timezone: string;
}) {
  const { t } = useTranslation();
  const name =
    attempt.endpointId === null
      ? t("usage.overview.official")
      : (attempt.endpointName ?? attempt.endpointId);
  const parts = [`${name} · ${attempt.model}`, t(`usage.requests.result.${attempt.result}`)];
  if (attempt.failure) parts.push(failureLabel(attempt.failure, t));
  parts.push(formatRequestMs(attempt.durationMs));
  if (attempt.cooldownUntil) {
    parts.push(
      t("usage.requests.details.cooldownUntil", {
        time: formatCooldownTime(attempt.cooldownUntil, locale, timezone),
      }),
    );
  }
  return (
    <View style={styles.attempt}>
      <Text variant="caption" color={attempt.result === "answered" ? "foreground" : "statusDanger"}>
        {parts.join(" · ")}
      </Text>
      {attempt.reason ? (
        <Text variant="caption" color="foregroundMuted" numberOfLines={2}>
          {attempt.reason}
        </Text>
      ) : null}
    </View>
  );
}

function UsageRequestsPager({
  total,
  pageIndex,
  onPage,
}: {
  total: number;
  pageIndex: number;
  onPage: (index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const first = pageIndex * USAGE_REQUESTS_PAGE_SIZE + 1;
  const last = Math.min(total, (pageIndex + 1) * USAGE_REQUESTS_PAGE_SIZE);
  const handlePrevious = useCallback(() => onPage(pageIndex - 1), [onPage, pageIndex]);
  const handleNext = useCallback(() => onPage(pageIndex + 1), [onPage, pageIndex]);
  return (
    <View style={styles.pager}>
      <Text variant="caption" color="foregroundMuted" testID="usage-requests-range">
        {t("usage.requests.pager.range", {
          first: formatGroupedNumber(first, i18n.language),
          last: formatGroupedNumber(last, i18n.language),
          total: formatGroupedNumber(total, i18n.language),
        })}
      </Text>
      <View style={styles.pagerButtons}>
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onPress={handlePrevious}
          testID="usage-requests-previous"
        >
          {t("usage.requests.pager.previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={last >= total}
          onPress={handleNext}
          testID="usage-requests-next"
        >
          {t("usage.requests.pager.next")}
        </Button>
      </View>
    </View>
  );
}

/** Grey bars where rows will be, while the first page is on its way. */
function UsageRequestsSkeleton() {
  return (
    <View testID="usage-requests-loading" accessibilityRole="progressbar">
      {SKELETON_KEYS.map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <View style={[styles.skeletonBar, styles.skeletonTime]} />
          <View style={[styles.skeletonBar, styles.skeletonName]} />
          <View style={[styles.skeletonBar, styles.skeletonShort]} />
        </View>
      ))}
    </View>
  );
}

const SKELETON_KEYS = Array.from({ length: SKELETON_ROWS }, (_, index) => `skeleton-${index}`);

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    container: {
      gap: theme.spacing[3],
    },
    filterBar: {
      gap: theme.spacing[2],
    },
    filterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    search: {
      flexGrow: 1,
      flexBasis: 200,
      minWidth: 0,
    },
    filterTrigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      height: 28,
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: palette.controlBorder,
      backgroundColor: palette.card,
      maxWidth: 220,
    },
    filterTriggerHovered: {
      borderColor: palette.cardBorderHover,
      backgroundColor: palette.tile,
    },
    filterValue: {
      flexShrink: 1,
    },
    filterGlyph: {
      color: palette.inkMuted,
    },
    hostErrors: {
      gap: theme.spacing[1],
    },
    empty: {
      paddingVertical: theme.spacing[6],
      textAlign: "center",
    },
    headRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: theme.spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: palette.divider2,
    },
    rowBlock: {
      borderBottomWidth: 1,
      borderBottomColor: palette.divider,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: theme.spacing[2],
    },
    cell: {
      paddingRight: theme.spacing[2],
      minWidth: 0,
    },
    numberCell: {
      textAlign: "right",
    },
    timeColumn: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 108,
    },
    timeColumnNarrow: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 68,
    },
    modelColumn: {
      flexGrow: 2.4,
      flexShrink: 1,
      flexBasis: 0,
    },
    endpointColumn: {
      flexGrow: 1.8,
      flexShrink: 1,
      flexBasis: 0,
    },
    agentColumn: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
    },
    statusColumn: {
      flexGrow: 1.6,
      flexShrink: 1,
      flexBasis: 0,
    },
    numberColumn: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      textAlign: "right",
    },
    details: {
      gap: theme.spacing[2],
      paddingBottom: theme.spacing[3],
      paddingLeft: theme.spacing[3],
      marginLeft: theme.spacing[1],
      borderLeftWidth: 2,
      borderLeftColor: palette.divider2,
    },
    detailGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: theme.spacing[4],
      rowGap: theme.spacing[2],
    },
    detailItem: {
      minWidth: 96,
      maxWidth: "100%",
    },
    attempts: {
      gap: theme.spacing[1],
    },
    attempt: {
      gap: 2,
    },
    pager: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[2],
      paddingTop: theme.spacing[3],
    },
    pagerButtons: {
      flexDirection: "row",
      gap: theme.spacing[2],
    },
    skeletonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      paddingVertical: theme.spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: palette.divider,
    },
    skeletonBar: {
      height: 10,
      borderRadius: theme.borderRadius.full,
      backgroundColor: palette.track,
    },
    skeletonTime: {
      width: 88,
    },
    skeletonName: {
      flexGrow: 1,
      flexBasis: 0,
    },
    skeletonShort: {
      width: 56,
    },
  };
});
