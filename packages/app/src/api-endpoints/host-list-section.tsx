import React, { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  Copy,
  Download,
  GripVertical,
  Plus,
  ShieldAlert,
} from "lucide-react-native";
import type {
  ApiEndpoint,
  ApiEndpointBalanceReading,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenuTrigger } from "@/components/ui/row-actions-menu-trigger";
import { SearchField } from "@/components/ui/search-field";
import { Shortcut } from "@/components/ui/shortcut";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Text as UiText } from "@/components/ui/text";
import { useAppSettings } from "@/hooks/use-settings";
import type { ProviderStatusDisplay } from "@/provider-detail/status";
import { formatPct } from "@/usage/format";
import { ProviderStatusLine } from "@/screens/settings/provider-status-line";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  endpointMoves,
  endpointRowStatus,
  endpointSummary,
  findEndpoints,
  groupHostEndpoints,
  type EndpointArrangement,
  type EndpointMoves,
  type EndpointPlace,
  type EndpointRowStatus,
  type HostEndpointsLoadState,
} from "./internal/host-list";
import { windowLabel } from "./balance-copy";
import { EndpointIcon } from "./endpoint-icon";
import { tightestWindow } from "./internal/balance-windows";
import { SortableEndpointRows } from "./sortable-endpoint-rows";
import type { VendorNotice } from "./internal/vendor-status";
import { VendorNoticeLine } from "./vendor-notice";
import type { SortableEndpointRowInfo } from "./sortable-endpoint-rows.types";

/*
 * 「第三方接口」列表：照 Providers 列表页（screens/settings/providers-section.tsx）的分组、行与密度。
 * 纯 props，运行时接线在 view.tsx。
 */

const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedGripVertical = withUnistyles(GripVertical);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedArrowUpToLine = withUnistyles(ArrowUpToLine);
const ThemedArrowDownToLine = withUnistyles(ArrowDownToLine);
const ThemedCopy = withUnistyles(Copy);
const ThemedShieldAlert = withUnistyles(ShieldAlert);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

export interface ApiEndpointsListSectionProps {
  state: HostEndpointsLoadState;
  now: Date;
  pendingEndpointId: string | null;
  actionError: string | null;
  onDismissError: () => void;
  onAdd: () => void;
  onOpen: (endpoint: ApiEndpoint) => void;
  onToggle: (endpoint: ApiEndpoint, enabled: boolean) => void;
  onResume: (endpoint: ApiEndpoint) => void;
  // 主机支持改接口顺序（apiEndpointManagement）时才有：拖动、行菜单与 Alt+↑/↓。
  // 搜索时挪动只在显示着的行之间进行（照 magpie shownToOn）。
  onArrange?: (arrangement: EndpointArrangement) => void;
  // 主机声明 apiEndpointManagement 时才有：列表顶上的搜索框与行上的 key 打码、模型数、默认模型落在这家的提供方。
  management?: ListManagement;
}

export interface ListManagement {
  providerLabel: (provider: string) => string;
  onOpenProvider: (provider: string) => void;
  // 行菜单「复制」：和详情页 ⋯ 菜单里的是同一个入口。
  onDuplicate: (endpoint: ApiEndpoint) => void;
  // 接口对上的厂商的官方状态页提示；没有提示的接口不在里面。
  vendorNotices: ReadonlyMap<string, VendorNotice>;
  // 各接口的余额读数；主机没声明 apiEndpointBalance、还没读到或认不出查法的接口不在里面。
  balances: ReadonlyMap<string, ApiEndpointBalanceReading>;
  // 「导入」：打开从别的软件导入的窗口。
  onImport: () => void;
}

const noArrange = () => {};

export function ApiEndpointsListSection({
  state,
  now,
  pendingEndpointId,
  actionError,
  onDismissError,
  onAdd,
  onOpen,
  onToggle,
  onResume,
  onArrange,
  management,
}: ApiEndpointsListSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const allEndpoints = useMemo(() => (state.status === "ready" ? state.endpoints : []), [state]);
  const isSearching = management !== undefined && query.trim() !== "";
  const shownEndpoints = useMemo(
    () => (isSearching ? findEndpoints(allEndpoints, query) : allEndpoints),
    [allEndpoints, isSearching, query],
  );
  const shownIds = useMemo(
    () => (isSearching ? new Set(shownEndpoints.map((endpoint) => endpoint.id)) : null),
    [isSearching, shownEndpoints],
  );
  const groups = useMemo(() => groupHostEndpoints(shownEndpoints), [shownEndpoints]);
  const hasDisabled = useMemo(
    () => allEndpoints.some((endpoint) => endpoint.enabled === false),
    [allEndpoints],
  );
  const arrangeShown = useMemo(
    () =>
      onArrange
        ? (endpoint: ApiEndpoint, place: EndpointPlace) =>
            onArrange({ endpoint, place, shown: shownIds })
        : undefined,
    [onArrange, shownIds],
  );
  const onImport = management?.onImport ?? null;
  const addButton = useMemo(
    () => (
      <View style={styles.groupActions}>
        {onImport ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Download}
            onPress={onImport}
            testID="api-endpoints-import-button"
          >
            {t("settings.apiEndpoints.import.open")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Plus}
          onPress={onAdd}
          accessibilityLabel={t("settings.apiEndpoints.add")}
          testID="api-endpoints-add-button"
        />
      </View>
    ),
    [onAdd, onImport, t],
  );

  if (state.status === "loading") {
    return <NoticeCard text={t("settings.apiEndpoints.loading")} testID="api-endpoints-loading" />;
  }
  if (state.status === "error") {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]} testID="api-endpoints-load-error">
        <UiText variant="body" color="statusDanger" selectable>
          {state.message}
        </UiText>
      </View>
    );
  }

  const hasErrorRow = actionError !== null;
  const hasNoMatch = isSearching && shownEndpoints.length === 0;
  // 搜索时只有已关闭的有命中：已开启组只留标题（和「+」），不画空卡片。
  const hidesEnabledCard = isSearching && groups.enabled.length === 0 && !hasErrorRow;

  function renderRows(endpoints: ApiEndpoint[], hasRowAbove: boolean) {
    return (
      <EndpointGroupRows
        endpoints={endpoints}
        allEndpoints={allEndpoints}
        shownIds={shownIds}
        hasRowAbove={hasRowAbove}
        now={now}
        pendingEndpointId={pendingEndpointId}
        management={management}
        onOpen={onOpen}
        onToggle={onToggle}
        onResume={onResume}
        onArrange={arrangeShown}
      />
    );
  }

  function renderEnabledContent() {
    if (groups.enabled.length > 0) return renderRows(groups.enabled, hasErrorRow);
    if (isSearching) return null;
    return <EmptyEnabledGroup hasAny={hasDisabled} hasRowAbove={hasErrorRow} onAdd={onAdd} />;
  }

  return (
    <View testID="api-endpoints-list">
      {management && allEndpoints.length > 0 ? (
        <View style={styles.searchRow}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder={t("settings.apiEndpoints.search.placeholder")}
            clearAccessibilityLabel={t("settings.apiEndpoints.search.clear")}
            clearsOnEscape
            testID="api-endpoints-search"
            clearTestID="api-endpoints-search-clear"
          />
        </View>
      ) : null}
      {/* 一个都没搜到：不画分组标题，空状态直接接在搜索框下面。 */}
      {hasNoMatch ? <NoMatch query={query.trim()} /> : null}
      {hasNoMatch ? null : (
        <SettingsSection
          title={t("settings.apiEndpoints.groups.enabled")}
          count={groups.enabled.length}
          info={t("settings.apiEndpoints.info")}
          trailing={addButton}
          testID="api-endpoints-enabled-group"
        >
          {hidesEnabledCard ? null : (
            <View style={settingsStyles.card}>
              {actionError ? (
                <View style={settingsStyles.row} testID="api-endpoints-action-error">
                  <UiText variant="caption" color="statusDanger" selectable style={styles.flex}>
                    {actionError}
                  </UiText>
                  <Button variant="ghost" size="sm" onPress={onDismissError}>
                    {t("common.actions.dismiss")}
                  </Button>
                </View>
              ) : null}
              {renderEnabledContent()}
            </View>
          )}
        </SettingsSection>
      )}
      {groups.disabled.length > 0 ? (
        <SettingsSection
          title={t("settings.apiEndpoints.groups.disabled")}
          count={groups.disabled.length}
          testID="api-endpoints-disabled-group"
        >
          <View style={settingsStyles.card}>{renderRows(groups.disabled, false)}</View>
        </SettingsSection>
      ) : null}
    </View>
  );
}

/** 一组的行；主机支持改顺序时可拖动、按 Alt+↑/↓，行上有排序菜单。 */
function EndpointGroupRows({
  endpoints,
  allEndpoints,
  shownIds,
  hasRowAbove,
  now,
  pendingEndpointId,
  management,
  onOpen,
  onToggle,
  onResume,
  onArrange,
}: {
  endpoints: ApiEndpoint[];
  // 两组合起来的接口顺序，算菜单里哪几项能点。
  allEndpoints: ApiEndpoint[];
  // 搜索时显示着的行；没在搜索时为 null。
  shownIds: ReadonlySet<string> | null;
  hasRowAbove: boolean;
  now: Date;
  pendingEndpointId: string | null;
  management: ListManagement | undefined;
  onOpen: (endpoint: ApiEndpoint) => void;
  onToggle: (endpoint: ApiEndpoint, enabled: boolean) => void;
  onResume: (endpoint: ApiEndpoint) => void;
  onArrange?: (endpoint: ApiEndpoint, place: EndpointPlace) => void;
}) {
  const renderRow = useCallback(
    (info: SortableEndpointRowInfo) => (
      <EndpointRow
        endpoint={info.endpoint}
        status={endpointRowStatus(info.endpoint, now)}
        isPending={pendingEndpointId === info.endpoint.id}
        isFirst={info.index === 0 && !hasRowAbove}
        row={info}
        moves={
          onArrange
            ? endpointMoves({ endpoints: allEndpoints, id: info.endpoint.id, shown: shownIds })
            : null
        }
        management={management}
        onOpen={onOpen}
        onToggle={onToggle}
        onResume={onResume}
        onArrange={onArrange}
      />
    ),
    [
      allEndpoints,
      hasRowAbove,
      management,
      now,
      onArrange,
      onOpen,
      onResume,
      onToggle,
      pendingEndpointId,
      shownIds,
    ],
  );
  return (
    <SortableEndpointRows
      endpoints={endpoints}
      isSortable={onArrange !== undefined}
      onMove={onArrange ?? noArrange}
      renderRow={renderRow}
    />
  );
}

// 一家都没有时把说明写在卡片里，加一个添加入口；只是全关着时说一句。
function EmptyEnabledGroup({
  hasAny,
  hasRowAbove,
  onAdd,
}: {
  hasAny: boolean;
  hasRowAbove: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.emptyCard, hasRowAbove && settingsStyles.rowBorder]}
      testID="api-endpoints-empty"
    >
      {hasAny ? (
        <Text style={styles.emptyText}>{t("settings.apiEndpoints.allOff")}</Text>
      ) : (
        <>
          <Text style={styles.emptyTitle}>{t("settings.apiEndpoints.empty")}</Text>
          <Text style={[styles.emptyText, styles.emptyParagraph]}>
            {t("settings.apiEndpoints.info")}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Plus}
            onPress={onAdd}
            testID="api-endpoints-empty-add"
          >
            {t("settings.apiEndpoints.add")}
          </Button>
        </>
      )}
    </View>
  );
}

/**
 * 搜索没有命中（照 magpie「No provider matches」），再说一句搜的是哪几样。
 * 屏幕级空状态：居中的灰色短语，不带卡片（docs/design.md §11）。
 */
function NoMatch({ query }: { query: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.noMatch} testID="api-endpoints-no-match">
      <Text style={styles.noMatchText}>{t("settings.apiEndpoints.search.noMatch", { query })}</Text>
      <Text style={[styles.emptyText, styles.emptyParagraph]}>
        {t("settings.apiEndpoints.search.noMatchHint")}
      </Text>
    </View>
  );
}

export function NoticeCard({ text, testID }: { text: string; testID: string }) {
  return (
    <View style={[settingsStyles.card, styles.emptyCard]} testID={testID}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

interface EndpointRowProps {
  endpoint: ApiEndpoint;
  status: EndpointRowStatus;
  isPending: boolean;
  isFirst: boolean;
  row: SortableEndpointRowInfo;
  // 行菜单里四个排序项能不能点；主机不支持改顺序时为 null，不出菜单。
  moves: EndpointMoves | null;
  management: ListManagement | undefined;
  onOpen: (endpoint: ApiEndpoint) => void;
  onToggle: (endpoint: ApiEndpoint, enabled: boolean) => void;
  onResume: (endpoint: ApiEndpoint) => void;
  onArrange?: (endpoint: ApiEndpoint, place: EndpointPlace) => void;
}

function EndpointRow({
  endpoint,
  status,
  isPending,
  isFirst,
  row,
  moves,
  management,
  onOpen,
  onToggle,
  onResume,
  onArrange,
}: EndpointRowProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const enabled = endpoint.enabled !== false;
  const { isPressSuppressed } = row;
  const handlePress = useCallback(() => {
    if (isPressSuppressed()) return;
    onOpen(endpoint);
  }, [endpoint, isPressSuppressed, onOpen]);
  const handleToggle = useCallback(
    (value: boolean) => onToggle(endpoint, value),
    [endpoint, onToggle],
  );
  const handleResume = useCallback(() => onResume(endpoint), [endpoint, onResume]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );
  // 有行信息时模型数挪到下一行，和 key 打码、默认模型写在一起。
  const statusLine = useEndpointStatusLine({
    endpoint,
    status,
    includesModelCount: management === undefined,
  });
  const vendorNotice = management?.vendorNotices.get(endpoint.id) ?? null;

  return (
    <View
      style={[!isFirst && settingsStyles.rowBorder, row.isDragging && styles.rowDragging]}
      testID={rowTestId(row)}
    >
      {row.isPlaceholder ? <View style={styles.dropSlot} pointerEvents="none" /> : null}
      <Pressable
        style={rowStyle}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t("settings.apiEndpoints.endpointDetails", {
          name: endpoint.name,
          status: t(STATUS_WORD_KEYS[status.kind]),
        })}
        testID={`api-endpoint-row-${endpoint.id}`}
      >
        {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
          <View style={[styles.rowBody, row.isPlaceholder && styles.hidden]}>
            <View style={styles.rowInner}>
              <View style={styles.rowContent}>
                {/* 已关闭是状态不是禁用：只把头像调淡、名称调灰，开关和整行照常可点。 */}
                {row.wrapHandle(
                  <View style={[settingsStyles.rowIconFrame, !enabled && styles.disabledIcon]}>
                    {/* 握把悬停才画；悬停只在网页有，窄屏与原生端一直画（docs/hover.md）。 */}
                    {row.hasHandle && (hovered || row.isDragging || isNative || isCompact) ? (
                      <ThemedGripVertical size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />
                    ) : (
                      <EndpointIcon
                        icon={endpoint.icon ?? null}
                        templateId={endpoint.templateId ?? null}
                        name={endpoint.name}
                        size={ICON_SIZE.md}
                        initialVariant="label"
                      />
                    )}
                  </View>,
                )}
                <EndpointRowText
                  endpoint={endpoint}
                  enabled={enabled}
                  status={status}
                  statusLine={statusLine}
                  isPending={isPending}
                  management={management}
                  onResume={handleResume}
                />
              </View>
              <View style={styles.trailingControls}>
                <Switch
                  value={enabled}
                  onValueChange={handleToggle}
                  disabled={isPending}
                  accessibilityLabel={t("settings.apiEndpoints.endpointSwitch", {
                    name: endpoint.name,
                  })}
                  testID={`api-endpoint-switch-${endpoint.id}`}
                />
                {moves && onArrange ? (
                  <EndpointRowMenu
                    endpoint={endpoint}
                    moves={moves}
                    isOpen={row.isMenuOpen}
                    onOpenChange={row.onMenuOpenChange}
                    onArrange={onArrange}
                    onDuplicate={management ? management.onDuplicate : null}
                  />
                ) : null}
                <ThemedChevronRight
                  size={ICON_SIZE.sm}
                  uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
                />
              </View>
            </View>
            {/* 官方状态页的提示占满整行宽度（不挤在开关旁边），左边与名称对齐。 */}
            {vendorNotice ? (
              <View style={styles.vendorNotice}>
                <VendorNoticeLine notice={vendorNotice} testID="api-endpoint-row-vendor-status" />
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** 行上的文字列：名称（与不校验证书的标记）、状态行，有行信息时再加 key 打码、模型数与默认模型。 */
function EndpointRowText({
  endpoint,
  enabled,
  status,
  statusLine,
  isPending,
  management,
  onResume,
}: {
  endpoint: ApiEndpoint;
  enabled: boolean;
  status: EndpointRowStatus;
  statusLine: ProviderStatusDisplay;
  isPending: boolean;
  management: ListManagement | undefined;
  onResume: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.rowContent}>
      {/* 名称不截断，窄屏上换行；不校验证书的一直挂着标记，放不下时挪到下一行。 */}
      <View style={styles.titleLine}>
        <Text style={[settingsStyles.rowTitle, !enabled && styles.disabledTitle]}>
          {endpoint.name}
        </Text>
        {endpoint.insecureTls === true ? <InsecureTlsMark /> : null}
      </View>
      <ProviderStatusLine status={statusLine}>
        <RestingStateText status={status} />
        {status.kind === "cooling" ? (
          <Button
            variant="outline"
            size="xs"
            onPress={onResume}
            loading={isPending}
            accessibilityLabel={t("settings.apiEndpoints.resumeNowLabel", {
              name: endpoint.name,
            })}
            testID="api-endpoint-resume"
          >
            {t("settings.apiEndpoints.resumeNow")}
          </Button>
        ) : null}
      </ProviderStatusLine>
      {management ? <EndpointFacts endpoint={endpoint} management={management} /> : null}
    </View>
  );
}

const ORDER_ITEMS: {
  place: Exclude<EndpointPlace, { index: number }>;
  labelKey: string;
  keys: string[];
}[] = [
  { place: "up", labelKey: "settings.apiEndpoints.order.moveUp", keys: ["alt", "Up"] },
  { place: "down", labelKey: "settings.apiEndpoints.order.moveDown", keys: ["alt", "Down"] },
  {
    place: "top",
    labelKey: "settings.apiEndpoints.order.moveToTop",
    keys: ["alt", "shift", "Up"],
  },
  {
    place: "bottom",
    labelKey: "settings.apiEndpoints.order.moveToBottom",
    keys: ["alt", "shift", "Down"],
  },
];

const ORDER_ICONS = {
  up: ThemedArrowUp,
  down: ThemedArrowDown,
  top: ThemedArrowUpToLine,
  bottom: ThemedArrowDownToLine,
};

/**
 * 行菜单：「复制」，然后上移、下移、移到最前、移到最后（照 magpie openProviderMenu）；窄屏是底部弹层。
 */
function EndpointRowMenu({
  endpoint,
  moves,
  isOpen,
  onOpenChange,
  onArrange,
  onDuplicate,
}: {
  endpoint: ApiEndpoint;
  moves: EndpointMoves;
  // 受控：桌面端右键行也打开它（照 magpie 行的 oncontextmenu），锚在 ⋯ 按钮上。
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onArrange: (endpoint: ApiEndpoint, place: EndpointPlace) => void;
  onDuplicate: ((endpoint: ApiEndpoint) => void) | null;
}) {
  const { t } = useTranslation();
  const label = t("settings.apiEndpoints.detail.menu", { name: endpoint.name });
  const duplicateLeading = useMemo(
    () => <ThemedCopy size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const handleDuplicate = useCallback(() => onDuplicate?.(endpoint), [endpoint, onDuplicate]);
  return (
    <DropdownMenu compactMode="sheet" open={isOpen} onOpenChange={onOpenChange}>
      <RowActionsMenuTrigger
        accessibilityLabel={label}
        testID={`api-endpoint-order-menu-${endpoint.id}`}
      />
      <DropdownMenuContent align="end" width={240} sheetTitle={label}>
        {onDuplicate ? (
          <>
            <DropdownMenuItem
              leading={duplicateLeading}
              onSelect={handleDuplicate}
              testID={`api-endpoint-row-duplicate-${endpoint.id}`}
            >
              {t("settings.apiEndpoints.detail.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {ORDER_ITEMS.map((item) => (
          <OrderMenuItem
            key={item.place}
            item={item}
            endpoint={endpoint}
            isEnabled={moves[item.place]}
            onArrange={onArrange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrderMenuItem({
  item,
  endpoint,
  isEnabled,
  onArrange,
}: {
  item: (typeof ORDER_ITEMS)[number];
  endpoint: ApiEndpoint;
  isEnabled: boolean;
  onArrange: (endpoint: ApiEndpoint, place: EndpointPlace) => void;
}) {
  const { t } = useTranslation();
  const { place, labelKey, keys } = item;
  const Icon = ORDER_ICONS[place];
  const leading = useMemo(
    () => <Icon size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />,
    [Icon],
  );
  const trailing = useMemo(() => <Shortcut keys={keys} />, [keys]);
  const handleSelect = useCallback(() => onArrange(endpoint, place), [endpoint, onArrange, place]);
  return (
    <DropdownMenuItem
      leading={leading}
      trailing={trailing}
      disabled={!isEnabled}
      onSelect={handleSelect}
      testID={`api-endpoint-order-${place}`}
    >
      {t(labelKey)}
    </DropdownMenuItem>
  );
}

function rowTestId(row: SortableEndpointRowInfo): string | undefined {
  if (row.isDragging) return "api-endpoint-row-dragging";
  if (row.isPlaceholder) return "api-endpoint-row-drop-slot";
  return undefined;
}

// 整行的无障碍名称里读出的状态词。
const STATUS_WORD_KEYS: Record<EndpointRowStatus["kind"], string> = {
  available: "settings.apiEndpoints.status.available",
  cooling: "settings.apiEndpoints.status.coolingWord",
  needsCheck: "settings.apiEndpoints.status.needsCheckWord",
  disabled: "settings.apiEndpoints.status.disabled",
};

const INSECURE_TLS_ICON = <ThemedShieldAlert size={ICON_SIZE.xs} uniProps={warningColorMapping} />;

/** 不校验证书的接口行上一直挂着的标记（警示色），提醒它关着证书校验。 */
function InsecureTlsMark() {
  const { t } = useTranslation();
  return (
    <View testID="api-endpoint-row-insecure-tls">
      <StatusBadge
        variant="warning"
        size="xs"
        label={t("settings.apiEndpoints.form.insecureTls.rowMark")}
        leading={INSECURE_TLS_ICON}
      />
    </View>
  );
}

/** 冷却中与需要检查时接在摘要后面的状态色文字；可用与已关闭不接。 */
function RestingStateText({ status }: { status: EndpointRowStatus }) {
  const { t } = useTranslation();
  if (status.kind !== "cooling" && status.kind !== "needsCheck") return null;
  const isCooling = status.kind === "cooling";
  const text = isCooling
    ? t(`settings.apiEndpoints.status.cooling_${status.remaining.unit}`, {
        count: status.remaining.value,
      })
    : t("settings.apiEndpoints.status.needsCheck");
  return (
    <>
      <Text style={styles.separator}>·</Text>
      <UiText
        variant="caption"
        color={isCooling ? "statusWarning" : "statusDanger"}
        numberOfLines={1}
        testID="api-endpoint-row-state"
      >
        {text}
      </UiText>
    </>
  );
}

/** 状态点加「格式 · 主机 · 已选数」；已关闭的前面加「已关闭」。冷却与需要检查的状态色文字由调用方接在后面。 */
function useEndpointStatusLine({
  endpoint,
  status,
  includesModelCount,
}: {
  endpoint: ApiEndpoint;
  status: EndpointRowStatus;
  includesModelCount: boolean;
}): ProviderStatusDisplay {
  const { t } = useTranslation();
  const summary = endpointSummary(endpoint);
  const parts = [
    summary.formats
      .map((format) => t(`settings.apiEndpoints.formats.${format}`))
      .join(t("settings.apiEndpoints.listSeparator")),
    summary.host,
    includesModelCount
      ? t("settings.apiEndpoints.status.modelCount", { count: summary.modelCount })
      : null,
  ].filter((part): part is string => Boolean(part));
  if (status.kind === "disabled") parts.unshift(t("settings.apiEndpoints.status.disabled"));
  return {
    tone: status.tone,
    label: { key: "settings.apiEndpoints.status.summary", params: { summary: parts.join(" · ") } },
  };
}

// 译文里给提供方名留的位置：先整句翻译，再把这里换成能点的提供方名。
const PROVIDERS_SLOT = "%%providers%%";

/**
 * 行上第三行：key 打码（没有 key 时不写）、模型数，以及默认模型先去这家的提供方（照 magpie 行上的 uses）。
 * 一项一块，窄屏放不下时整块换行。
 */
function EndpointFacts({
  endpoint,
  management,
}: {
  endpoint: ApiEndpoint;
  management: ListManagement;
}) {
  const { t } = useTranslation();
  const providers = endpoint.defaultModelProviders ?? [];
  const facts: { key: string; node: React.ReactNode }[] = [];
  if (endpoint.apiKeyMask) {
    facts.push({
      key: "apiKey",
      node: (
        <Text
          style={styles.fact}
          accessibilityLabel={t("settings.apiEndpoints.rowFacts.apiKey", {
            mask: endpoint.apiKeyMask,
          })}
          testID="api-endpoint-row-key"
        >
          {endpoint.apiKeyMask}
        </Text>
      ),
    });
  }
  facts.push({
    key: "models",
    node: (
      <Text style={styles.fact} testID="api-endpoint-row-model-count">
        {t("settings.apiEndpoints.status.modelCount", {
          count: endpointSummary(endpoint).modelCount,
        })}
      </Text>
    ),
  });
  if (providers.length > 0) {
    facts.push({
      key: "defaultModel",
      node: <DefaultModelOf providers={providers} management={management} />,
    });
  }
  const balance = management.balances.get(endpoint.id);
  // 读到了却没有单独余额、也没有窗口的（如 Ollama Cloud 没买过 credits）行上不出这一段。
  const hasNothingToShow =
    balance?.status === "ok" &&
    balance.items.length === 0 &&
    tightestWindow(balance.windows ?? []) === null;
  if (balance && balance.status !== "unsupported" && !hasNothingToShow) {
    facts.push({ key: "balance", node: <BalanceFact reading={balance} /> });
  }
  return (
    <View style={styles.facts} testID="api-endpoint-row-facts">
      {/* 每条连同它前面的 · 是一块，换行时整块挪到下一行，行尾不挂分隔点。 */}
      {facts.map((fact, index) => (
        <View key={fact.key} style={styles.factUnit}>
          {index > 0 ? <Text style={styles.separator}>·</Text> : null}
          {fact.node}
        </View>
      ))}
    </View>
  );
}

/**
 * 行上的一小段余额：有套餐窗口时写剩得最少的那个（同时有余额也是它，最紧的限制先看到），否则写金额；
 * 查不到只写「余额查不到」，原因留给详情页。
 */
function BalanceFact({ reading }: { reading: ApiEndpointBalanceReading }) {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const tightest = reading.status === "ok" ? tightestWindow(reading.windows ?? []) : null;
  if (tightest !== null) {
    const displayAs = settings.usage.displayAs;
    const usedPct = tightest.usedPct ?? 0;
    const shownPct = displayAs === "remaining" ? 100 - usedPct : usedPct;
    return (
      <Text style={styles.fact} numberOfLines={1} testID="api-endpoint-row-balance">
        {t(
          displayAs === "remaining"
            ? "settings.apiEndpoints.balance.rowWindowLeft"
            : "settings.apiEndpoints.balance.rowWindowUsed",
          {
            window: windowLabel({ t, window: tightest }),
            percent: formatPct(shownPct),
          },
        )}
      </Text>
    );
  }
  const first = reading.status === "ok" ? reading.items[0] : undefined;
  if (!first) {
    return (
      <Text style={[styles.fact, styles.balanceFailed]} testID="api-endpoint-row-balance">
        {t("settings.apiEndpoints.balance.rowUnavailable")}
      </Text>
    );
  }
  return (
    <Text style={styles.fact} testID="api-endpoint-row-balance">
      {t("settings.apiEndpoints.balance.rowAmount", { amount: first.text })}
    </Text>
  );
}

function DefaultModelOf({
  providers,
  management,
}: {
  providers: string[];
  management: ListManagement;
}) {
  const { t } = useTranslation();
  const [before = "", after = ""] = t("settings.apiEndpoints.rowFacts.defaultModelOf", {
    providers: PROVIDERS_SLOT,
  }).split(PROVIDERS_SLOT);
  return (
    <View style={styles.defaultModelOf} testID="api-endpoint-row-default-model">
      {before ? <Text style={styles.fact}>{before}</Text> : null}
      {providers.map((provider, index) => (
        <Fragment key={provider}>
          {index > 0 ? (
            <Text style={styles.fact}>{t("settings.apiEndpoints.listSeparator")}</Text>
          ) : null}
          <ProviderLink provider={provider} management={management} />
        </Fragment>
      ))}
      {after ? <Text style={styles.fact}>{after}</Text> : null}
    </View>
  );
}

/** 点了去这个提供方的设置页改默认模型；悬停加下划线（Pressable 只给自己上样式，docs/hover.md）。 */
function ProviderLink({ provider, management }: { provider: string; management: ListManagement }) {
  const { t } = useTranslation();
  const label = management.providerLabel(provider);
  const { onOpenProvider } = management;
  const handlePress = useCallback(() => onOpenProvider(provider), [onOpenProvider, provider]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={t("settings.apiEndpoints.rowFacts.openProvider", { provider: label })}
      testID={`api-endpoint-row-provider-${provider}`}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <Text style={[styles.providerLink, hovered && styles.providerLinkHovered]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: {
    flex: 1,
  },
  groupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  emptyCard: {
    padding: theme.spacing[6],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    ...theme.typeScale.body,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    ...theme.typeScale.body,
  },
  // 说明段落限宽，宽卡片里不拉成一长行。
  emptyParagraph: {
    maxWidth: 480,
  },
  titleLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[1],
  },
  separator: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  // 拖着走的那一份浮在占位上：实底、强调色描边与阴影。
  // 被拖的行在列表里留下的等高占位：强调色虚线框，后面的行让开，停在哪儿就落在哪儿。
  dropSlot: {
    ...StyleSheet.absoluteFillObject,
    margin: theme.spacing[1],
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.accent,
    borderStyle: "dashed",
    borderWidth: 2,
    borderRadius: theme.radius.md,
  },
  rowInner: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
  },
  hidden: {
    opacity: 0,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  // 让过行图标（28）与它后面的间距，和名称对齐。
  vendorNotice: {
    paddingLeft: 28 + theme.spacing[3],
  },
  rowDragging: {
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.accent,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    ...theme.shadow.md,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  disabledIcon: {
    opacity: theme.opacity[50],
  },
  disabledTitle: {
    color: theme.colors.foregroundMuted,
  },
  searchRow: {
    flexDirection: "row",
    marginBottom: theme.spacing[4],
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[1.5],
    marginTop: theme.spacing[0.5],
  },
  factUnit: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  noMatch: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
  },
  noMatchText: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    fontSize: theme.fontSize.base,
  },
  fact: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  balanceFailed: {
    color: theme.colors.statusWarning,
  },
  defaultModelOf: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  providerLink: {
    color: theme.colors.foreground,
    ...theme.typeScale.caption,
    fontWeight: theme.fontWeight.medium,
  },
  providerLinkHovered: {
    textDecorationLine: "underline",
  },
  trailingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
