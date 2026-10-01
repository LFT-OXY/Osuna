import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ApiEndpointRef } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useTranslation } from "react-i18next";
import {
  Text as RNText,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { Text } from "@/components/ui/text";
import type { Theme } from "@/styles/theme";
import { renderUsageText } from "@/usage/text";
import {
  describeBalanceAmount,
  describeFetchedAt,
  describeReset,
  describeStatus,
  resolveWindowRow,
  type ProviderUsageWindowRow,
} from "./format";
import { TONE_COLOR_TOKEN } from "./tone";
import type { ProviderUsage, ProviderUsageBalance, ProviderUsageTone } from "./types";

interface ProviderUsageIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

export function ProviderUsageIcon({ iconKey, size, color = "" }: ProviderUsageIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedProviderUsageIcon = withUnistyles(ProviderUsageIcon);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type TableColumn = "name" | "percent" | "trailing";

type MeasureTableCell = (column: TableColumn, rowKey: string, width: number) => void;

function tableRowKey(providerId: string, windowId: string): string {
  return `${providerId}/${windowId}`;
}

/** 这些提供方的窗口在表格里的行键；同一张列表里的卡片用它共用一套列宽。 */
export function providerUsageTableRowKeys(usages: readonly ProviderUsage[]): string[] {
  return usages.flatMap((usage) =>
    usage.windows.map((window) => tableRowKey(usage.providerId, window.id)),
  );
}

/**
 * 表格的名称、百分比、尾部三列按各行最宽的那格对齐。每格量的是文字自身的宽度（外层
 * 按列宽撑开，文字不被拉伸），所以列宽只跟内容走，不会越量越宽。
 */
export function useProviderUsageTableColumns(rowKeys: readonly string[]) {
  const [widths, setWidths] = useState<Readonly<Record<TableColumn, Record<string, number>>>>({
    name: {},
    percent: {},
    trailing: {},
  });
  const handleMeasure = useCallback<MeasureTableCell>((column, rowKey, width) => {
    if (width <= 0) return;
    setWidths((current) =>
      current[column][rowKey] === width
        ? current
        : { ...current, [column]: { ...current[column], [rowKey]: width } },
    );
  }, []);
  const columnWidth = (column: TableColumn): number => {
    let widest = 0;
    for (const rowKey of rowKeys) widest = Math.max(widest, widths[column][rowKey] ?? 0);
    return widest;
  };
  return {
    handleMeasure,
    columnWidths: {
      name: columnWidth("name"),
      percent: columnWidth("percent"),
      trailing: columnWidth("trailing"),
    },
  };
}

export type ProviderUsageTableColumns = ReturnType<typeof useProviderUsageTableColumns>;
type ColumnWidths = ProviderUsageTableColumns["columnWidths"];

interface ProviderUsageCardProps {
  usage: ProviderUsage;
  // 该提供方当前启用的第三方接口；套餐额度这时不代表实际消耗。
  activeApiEndpoint: ApiEndpointRef | null;
  /** 列表里几张卡片共用的列宽（`useProviderUsageTableColumns`）；不传时卡片自己对齐。 */
  tableColumns?: ProviderUsageTableColumns;
}

/**
 * 表格式的套餐用量卡片：头部是提供方、套餐徽标和更新时间，表格每行一个限额窗口，
 * 余额和明细列在表格下方。外壳由调用方给（「用量」页的 `UsageCard`、窄栏悬停卡片、
 * 环形表弹层），卡片自己不带内边距。
 */
export function ProviderUsageCard({
  usage,
  activeApiEndpoint,
  tableColumns,
}: ProviderUsageCardProps) {
  const { t } = useTranslation();
  const now = Date.now();
  const updated = describeFetchedAt(usage.fetchedAt, now);
  const rows = usage.windows.map((window) => resolveWindowRow(window, now));
  const balances = usage.balances ?? [];
  const details = usage.details ?? [];
  const ownRowKeys = useMemo(() => providerUsageTableRowKeys([usage]), [usage]);
  const ownColumns = useProviderUsageTableColumns(ownRowKeys);
  const { handleMeasure, columnWidths } = tableColumns ?? ownColumns;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedProviderUsageIcon iconKey={usage.providerId} size={14} uniProps={mutedIconColor} />
        <Text variant="label" weight="medium" numberOfLines={1} style={styles.name}>
          {usage.displayName}
        </Text>
        {usage.planLabel ? <StatusBadge label={usage.planLabel} variant="muted" /> : null}
        <StatusBadgeForStatus status={usage.status} />
        <View style={styles.headerSpacer} />
        {updated ? (
          <Text variant="micro" color="foregroundExtraMuted" numberOfLines={1}>
            {renderUsageText(t, updated)}
          </Text>
        ) : null}
      </View>

      {activeApiEndpoint ? (
        <Text variant="label" color="foregroundMuted">
          {t("usage.planUsage.apiEndpointNote", { name: activeApiEndpoint.name })}
        </Text>
      ) : null}

      {usage.error ? (
        <RNText style={styles.error} numberOfLines={3}>
          {usage.error}
        </RNText>
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.table}>
          {rows.map((row) => (
            <WindowRow
              key={row.id}
              row={row}
              rowKey={tableRowKey(usage.providerId, row.id)}
              columnWidths={columnWidths}
              onMeasure={handleMeasure}
            />
          ))}
        </View>
      ) : null}

      {balances.length > 0 || details.length > 0 ? (
        <View style={styles.keyValues}>
          {balances.map((balance) => (
            <BalanceRow key={balance.id} balance={balance} now={now} />
          ))}
          {details.map((detail) => (
            <KeyValueRow key={detail.id} label={detail.label}>
              <Text variant="caption" numberOfLines={1}>
                {detail.value}
              </Text>
            </KeyValueRow>
          ))}
        </View>
      ) : null}

      {usage.sourceLabel ? (
        <Text variant="micro" color="foregroundExtraMuted" numberOfLines={1}>
          {usage.sourceLabel}
        </Text>
      ) : null}
    </View>
  );
}

/** 可用时不出徽标：只有出问题的提供方带状态。 */
function StatusBadgeForStatus({ status }: { status: ProviderUsage["status"] }) {
  const { t } = useTranslation();
  const description = describeStatus(status);
  if (!description) return null;
  return (
    <StatusBadge
      label={renderUsageText(t, description)}
      variant={status === "error" ? "error" : "muted"}
    />
  );
}

function WindowRow({
  row,
  rowKey,
  columnWidths,
  onMeasure,
}: {
  row: ProviderUsageWindowRow;
  rowKey: string;
  columnWidths: ColumnWidths;
  onMeasure: MeasureTableCell;
}) {
  const { t } = useTranslation();
  const fillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.fill, styles.fillTone(row.tone), { width: `${row.fillPct}%` }],
    [row.fillPct, row.tone],
  );
  const trailing = row.trailing;
  return (
    <View style={styles.row} testID={`provider-usage-window-${row.id}`}>
      <TableCell
        column="name"
        rowKey={rowKey}
        minWidth={columnWidths.name}
        align="start"
        onMeasure={onMeasure}
      >
        <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
          {row.label}
        </Text>
      </TableCell>
      <View style={styles.track}>
        <View style={fillStyle} />
      </View>
      <TableCell
        column="percent"
        rowKey={rowKey}
        minWidth={columnWidths.percent}
        align="end"
        onMeasure={onMeasure}
      >
        <Text variant="caption" numberOfLines={1} style={styles.number}>
          {row.percentText}
        </Text>
      </TableCell>
      <TableCell
        column="trailing"
        rowKey={rowKey}
        minWidth={columnWidths.trailing}
        align="end"
        onMeasure={onMeasure}
      >
        {trailing ? (
          <Text
            variant="caption"
            color={trailing.atRisk ? "statusDanger" : "foregroundMuted"}
            numberOfLines={1}
          >
            {renderUsageText(t, trailing.text)}
          </Text>
        ) : null}
      </TableCell>
    </View>
  );
}

function TableCell({
  column,
  rowKey,
  minWidth,
  align,
  onMeasure,
  children,
}: {
  column: TableColumn;
  rowKey: string;
  minWidth: number;
  align: "start" | "end";
  onMeasure: MeasureTableCell;
  children: ReactNode;
}) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) =>
      onMeasure(column, rowKey, Math.ceil(event.nativeEvent.layout.width)),
    [column, onMeasure, rowKey],
  );
  return (
    <View style={styles.cell(minWidth, align)}>
      <View onLayout={handleLayout}>{children}</View>
    </View>
  );
}

function BalanceRow({ balance, now }: { balance: ProviderUsageBalance; now: number }) {
  const { t } = useTranslation();
  const amount = describeBalanceAmount(balance);
  const reset = describeReset(balance.resetsAt, now);
  return (
    <KeyValueRow label={balance.label}>
      <Text variant="caption" numberOfLines={1} style={styles.number}>
        {renderUsageText(t, amount)}
      </Text>
      {reset ? (
        <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
          {renderUsageText(t, reset)}
        </Text>
      ) : null}
    </KeyValueRow>
  );
}

function KeyValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.keyValueRow}>
      <Text variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.keyLabel}>
        {label}
      </Text>
      <View style={styles.keyValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  name: {
    flexShrink: 1,
  },
  headerSpacer: {
    flex: 1,
  },
  table: {
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // 文字按自身宽度排，量出来的才是内容宽度；外层用同列最宽的那格撑齐。
  cell: (minWidth: number, align: "start" | "end") => ({
    flexShrink: 0,
    minWidth,
    alignItems: align === "start" ? ("flex-start" as const) : ("flex-end" as const),
  }),
  track: {
    flex: 1,
    minWidth: theme.spacing[8],
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  fillTone: (tone: ProviderUsageTone) => ({
    backgroundColor: theme.colors[TONE_COLOR_TOKEN[tone]],
  }),
  number: {
    fontVariant: ["tabular-nums"],
  },
  keyValues: {
    gap: theme.spacing[1],
  },
  keyValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  keyLabel: {
    flexShrink: 1,
  },
  // docs/design.md：卡片内的内联错误是一句 red-300 的 caption。
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.typeScale.caption.fontSize,
    lineHeight: theme.typeScale.caption.lineHeight,
  },
  keyValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
}));
