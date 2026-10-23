import type { UsageRequestAttempt } from "@getpaseo/protocol/usage/types";
import { ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  View,
  type LayoutChangeEvent,
  type StyleProp,
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
import { useUsageRequestsExport } from "@/hooks/use-usage-requests-export";
import { UsageRequestsExportBar } from "@/components/usage/usage-requests-export-bar";
import type { UsageHostInput } from "@/usage-stats/aggregated-usage";
import {
  formatGroupedNumber,
  formatGroupedTokens,
  formatSessionCost,
  type UsageMoney,
  type UsageTokenUnits,
} from "@/usage-stats/format";
import { useUsageMoney, useUsageTokenUnits } from "@/usage-stats/use-usage-money";
import type { UsageRange } from "@/usage-stats/period";
import {
  formatCooldownTime,
  formatOutputSpeed,
  formatRequestClock,
  formatRequestMs,
  formatRequestTime,
  INITIAL_USAGE_REQUESTS_FILTERS,
  toUsageRequestFilters,
  USAGE_REQUESTS_PAGE_SIZE,
  usageRequestEndpointLabel,
  usageRequestFailureLabel,
  usageRequestModelLabel,
  usageRequestStatus,
  usageRequestsFiltersFor,
  type MergedUsageRequestRow,
  type MergedUsageRequests,
  type UsageRequestsEndpointIntent,
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
 * decides, so a narrow window never slides sideways: below a 960-wide card the
 * row keeps time, model, endpoint, status and cost (at phone width the time
 * without its day); from 960 all thirteen. Every cell is one line, cut with an
 * ellipsis; the expanded row holds the full time and status.
 */
type TableTier = "narrow" | "medium" | "wide";

const TIER_COLUMNS: Record<TableTier, readonly ColumnId[]> = {
  narrow: ["time", "model", "endpoint", "status", "cost"],
  medium: ["time", "model", "endpoint", "status", "cost"],
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
/** The fixed columns, so the names and the status take what is left. */
const FIXED_COLUMN_WIDTH: Partial<Record<ColumnId, number>> = {
  agent: 84,
  input: 56,
  output: 56,
  cacheRead: 64,
  cacheWrite: 64,
  cost: 68,
  duration: 60,
  ttft: 64,
  speed: 64,
};

/** The narrowest card each tier fits in. */
const MEDIUM_MIN_WIDTH = 540;
const WIDE_MIN_WIDTH = 960;

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
  /** Starts with this endpoint chosen; null starts with every filter at all. */
  endpointIntent: UsageRequestsEndpointIntent | null;
}

/** The Requests tab: a filter bar, one page of requests, and the pager. */
export function UsageRequestsTable({
  hosts,
  range,
  timezone,
  hostLabels,
  endpointIntent,
}: UsageRequestsTableProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<UsageRequestsFilterState>(() =>
    endpointIntent ? usageRequestsFiltersFor(endpointIntent) : INITIAL_USAGE_REQUESTS_FILTERS,
  );
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
  const exporter = useUsageRequestsExport({ hosts, range, timezone, filters: wireFilters });

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
    body = <UsageRequestsSkeleton tier={tier} />;
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
      {data ? <UsageRequestsExportBar exporter={exporter} /> : null}
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
        label: usageRequestEndpointLabel(option, t),
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
  const clis = data?.clis;
  const handleAgent = useCallback(
    (key: string | null) => {
      const cli = clis?.find((candidate) => candidate === key) ?? null;
      onChange({ cli });
    },
    [clis, onChange],
  );
  const endpoints = data?.endpoints;
  const handleEndpoint = useCallback(
    (key: string | null) => {
      const option = endpoints?.find((candidate) => candidate.key === key);
      onChange({ endpoint: option ?? null });
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
          selectedFallbackLabel={
            filters.endpoint ? usageRequestEndpointLabel(filters.endpoint, t) : null
          }
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
  selectedFallbackLabel = null,
  onSelect,
  testID,
}: {
  label: string;
  allLabel: string;
  choices: readonly FilterChoice[];
  selected: string | null;
  /** What the trigger says for a choice the period no longer offers; null says All. */
  selectedFallbackLabel?: string | null;
  onSelect: (key: string | null) => void;
  testID: string;
}) {
  const handleAll = useCallback(() => onSelect(null), [onSelect]);
  const selectedLabel =
    choices.find((choice) => choice.key === selected)?.label ?? selectedFallbackLabel ?? allLabel;
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
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const handleToggle = useCallback((key: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const columns = TIER_COLUMNS[tier];
  const money = useUsageMoney();
  const units = useUsageTokenUnits();

  return (
    <View testID="usage-requests-table">
      <UsageRequestsHead tier={tier} />
      {data.rows.map((row) => (
        <UsageRequestRow
          key={row.key}
          row={row}
          columns={columns}
          tier={tier}
          timezone={timezone}
          money={money}
          units={units}
          hostLabel={hostLabels?.get(row.serverId) ?? null}
          isOpen={openKeys.has(row.key)}
          onToggle={handleToggle}
        />
      ))}
      <UsageRequestsPager total={data.total} pageIndex={pageIndex} onPage={onPage} />
    </View>
  );
}

/** The column's place in the row; the same for a header, a cell and a skeleton bar. */
function columnStyle(column: ColumnId, tier: TableTier): StyleProp<ViewStyle> {
  const fixed = FIXED_COLUMN_WIDTH[column];
  if (fixed !== undefined) return [styles.fixedColumn, { flexBasis: fixed }];
  if (column === "time") return tier === "narrow" ? styles.timeColumnNarrow : styles.timeColumn;
  if (column === "model") return styles.modelColumn;
  if (column === "endpoint") return styles.endpointColumn;
  return styles.statusColumn;
}

function UsageRequestsHead({ tier }: { tier: TableTier }) {
  const { t } = useTranslation();
  return (
    <View style={styles.headRow}>
      {TIER_COLUMNS[tier].map((column) => (
        <View key={column} style={[styles.cell, columnStyle(column, tier)]}>
          <Text
            variant="micro"
            weight="medium"
            color="foregroundMuted"
            numberOfLines={tier === "wide" ? 2 : 1}
            style={NUMBER_COLUMNS.has(column) && styles.numberCell}
          >
            {t(`usage.requests.columns.${column}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function UsageRequestRow({
  row,
  columns,
  tier,
  timezone,
  money,
  units,
  hostLabel,
  isOpen,
  onToggle,
}: {
  row: MergedUsageRequestRow;
  columns: readonly ColumnId[];
  tier: TableTier;
  timezone: string;
  money: UsageMoney;
  units: UsageTokenUnits;
  hostLabel: string | null;
  isOpen: boolean;
  onToggle: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const handlePress = useCallback(() => onToggle(row.key), [onToggle, row.key]);
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);
  const cells = useRequestCells({ row, timezone, tier, money, units });
  const hidden = TIER_COLUMNS.wide.filter((column) => !columns.includes(column));
  // 窄时行上只有时刻、状态可能被截断：日期与完整状态在展开行里。
  const isNarrow = tier === "narrow";
  // 宽度不到 13 列时模型与接口在行上会被截断：完整的写在展开行里。
  const isCut = tier !== "wide";

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
          <RequestCell key={column} column={column} tier={tier} cell={cells.byColumn[column]} />
        ))}
      </Pressable>
      {isOpen ? (
        <View style={styles.details} testID={`usage-request-details-${row.key}`}>
          <View style={styles.detailGrid}>
            {isNarrow ? (
              <DetailItem label={t("usage.requests.columns.time")} value={cells.fullTime} />
            ) : null}
            {isNarrow ? (
              <DetailItem label={t("usage.requests.columns.status")} value={cells.fullStatus} />
            ) : null}
            {isCut ? (
              <DetailItem label={t("usage.requests.columns.model")} value={cells.fullModel} />
            ) : null}
            {isCut ? (
              <DetailItem
                label={t("usage.requests.columns.endpoint")}
                value={cells.byColumn.endpoint.text}
              />
            ) : null}
            {hidden.map((column) => (
              <DetailItem
                key={column}
                label={t(`usage.requests.columns.${column}`)}
                value={cells.byColumn[column].text}
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
            <Text
              variant="caption"
              color="foregroundMuted"
              testID={`usage-request-error-${row.key}`}
            >
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

interface RequestCells {
  byColumn: Record<ColumnId, RequestCellValue>;
  /** Day and clock, which the narrow row leaves to its expanded part. */
  fullTime: string;
  /** "Failed (reason)", which the narrow row shortens to its first word. */
  fullStatus: string;
  /** The model asked, and the one the answering endpoint was asked when it differs. */
  fullModel: string;
}

/** Every column's text for one row, whichever the row shows and whichever open under it. */
function useRequestCells({
  row,
  timezone,
  tier,
  money,
  units,
}: {
  row: MergedUsageRequestRow;
  timezone: string;
  tier: TableTier;
  money: UsageMoney;
  units: UsageTokenUnits;
}): RequestCells {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const isNarrow = tier === "narrow";
  const status = usageRequestStatus(row);
  let statusColor: RequestCellValue["color"];
  let fullStatus: string;
  if (status.kind === "failed") {
    const reason = status.failure ? usageRequestFailureLabel(status.failure, t) : null;
    statusColor = "statusDanger";
    fullStatus = reason
      ? t("usage.requests.statusCell.failedWith", { reason })
      : t("usage.requests.statusCell.failed");
  } else if (status.kind === "switched") {
    statusColor = "statusWarning";
    fullStatus = t("usage.requests.statusCell.switched", { count: status.count });
  } else {
    statusColor = "foregroundMuted";
    fullStatus = t("usage.requests.statusCell.ok");
  }
  const endpointName = row.endpointId === null ? null : (row.endpointName ?? row.endpointId);
  const endpoint = usageRequestEndpointLabel(
    { name: endpointName, deleted: row.endpointDeleted },
    t,
  );
  const endpointColor = row.endpointId === null ? "foregroundMuted" : "foreground";
  const fullTime = formatRequestTime(row.at, locale, timezone);
  const shownTime = isNarrow ? formatRequestClock(row.at, locale, timezone) : fullTime;
  const count = (value: number): RequestCellValue => ({
    text: formatGroupedTokens({ value, locale, units }),
    color: "foreground",
  });
  const muted = (text: string): RequestCellValue => ({ text, color: "foregroundMuted" });
  const costText = row.priced ? formatSessionCost(row.estimatedCost, money) : "—";
  const costColor = row.priced ? "foreground" : "foregroundMuted";
  return {
    fullTime,
    fullStatus,
    fullModel: usageRequestModelLabel(row),
    byColumn: {
      time: muted(shownTime),
      agent: { text: usageSourceLabel({ cli: row.cli, backend: null }), color: "foreground" },
      model: { text: row.model, color: "foreground" },
      endpoint: { text: endpoint, color: endpointColor },
      input: count(row.totals.input),
      output: count(row.totals.output),
      cacheRead: count(row.totals.cachedInput),
      cacheWrite: count(row.totals.cacheWrite),
      cost: { text: costText, color: costColor },
      duration: muted(formatRequestMs(row.durationMs)),
      ttft: muted(formatRequestMs(row.ttftMs)),
      speed: muted(formatOutputSpeed(row.outputSpeed)),
      status: { text: fullStatus, color: statusColor },
    },
  };
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
  return (
    <View style={[styles.cell, columnStyle(column, tier)]}>
      <Text
        variant="caption"
        color={cell.color}
        numberOfLines={1}
        style={NUMBER_COLUMNS.has(column) && styles.numberCell}
      >
        {cell.text}
      </Text>
    </View>
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
  const isFailure = attempt.result !== "answered";
  // 只有结果与失败原因用状态色，其余是说明。
  const outcome = [t(`usage.requests.result.${attempt.result}`)];
  if (attempt.failure) outcome.push(usageRequestFailureLabel(attempt.failure, t));
  const after = [formatRequestMs(attempt.durationMs)];
  if (attempt.cooldownUntil) {
    after.push(
      t("usage.requests.details.cooldownUntil", {
        time: formatCooldownTime(attempt.cooldownUntil, locale, timezone),
      }),
    );
  }
  return (
    <View style={styles.attempt}>
      <Text variant="caption" color="foregroundMuted">
        {`${name} · ${attempt.model} · `}
        <Text variant="caption" color={isFailure ? "statusDanger" : "foreground"}>
          {outcome.join(" · ")}
        </Text>
        {` · ${after.join(" · ")}`}
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

/**
 * The table's own head and rows, a grey bar in each cell, while the first page
 * is on its way: the rows that replace it are the same height and columns.
 */
function UsageRequestsSkeleton({ tier }: { tier: TableTier }) {
  return (
    <View testID="usage-requests-loading" accessibilityRole="progressbar">
      <UsageRequestsHead tier={tier} />
      {SKELETON_KEYS.map((key) => (
        <View key={key} style={[styles.rowBlock, styles.row]}>
          {TIER_COLUMNS[tier].map((column) => (
            <View key={column} style={[styles.cell, columnStyle(column, tier)]}>
              <View style={styles.skeletonLine}>
                <View style={styles.skeletonBar} />
              </View>
            </View>
          ))}
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
      flexBasis: 64,
    },
    fixedColumn: {
      flexGrow: 0,
      flexShrink: 0,
    },
    modelColumn: {
      flexGrow: 2,
      flexShrink: 1,
      flexBasis: 0,
    },
    endpointColumn: {
      flexGrow: 1.8,
      flexShrink: 1,
      flexBasis: 0,
    },
    statusColumn: {
      flexGrow: 1.6,
      flexShrink: 1,
      flexBasis: 0,
      // 「换过 N 家」里的次数不被截掉；失败原因放不下就省略。
      minWidth: 92,
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
    skeletonLine: {
      height: theme.typeScale.caption.lineHeight,
      justifyContent: "center",
    },
    skeletonBar: {
      height: 8,
      width: "80%",
      borderRadius: theme.borderRadius.full,
      backgroundColor: palette.track,
    },
  };
});
