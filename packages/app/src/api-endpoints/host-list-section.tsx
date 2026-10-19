import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  GripVertical,
  Plus,
} from "lucide-react-native";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenuTrigger } from "@/components/ui/row-actions-menu-trigger";
import { Shortcut } from "@/components/ui/shortcut";
import { Switch } from "@/components/ui/switch";
import { Text as UiText } from "@/components/ui/text";
import type { ProviderStatusDisplay } from "@/provider-detail/status";
import { ProviderStatusLine } from "@/screens/settings/provider-status-line";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  endpointMoves,
  endpointRowStatus,
  endpointSummary,
  groupHostEndpoints,
  type EndpointMoves,
  type EndpointPlace,
  type EndpointRowStatus,
  type HostEndpointsLoadState,
} from "./internal/host-list";
import { SortableEndpointRows } from "./sortable-endpoint-rows";
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
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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
  onArrange?: (endpoint: ApiEndpoint, place: EndpointPlace) => void;
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
}: ApiEndpointsListSectionProps) {
  const { t } = useTranslation();
  const groups = useMemo(
    () => groupHostEndpoints(state.status === "ready" ? state.endpoints : []),
    [state],
  );
  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Plus}
        onPress={onAdd}
        accessibilityLabel={t("settings.apiEndpoints.add")}
        testID="api-endpoints-add-button"
      />
    ),
    [onAdd, t],
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

  function renderRows(endpoints: ApiEndpoint[], hasRowAbove: boolean) {
    return (
      <EndpointGroupRows
        endpoints={endpoints}
        allEndpoints={state.status === "ready" ? state.endpoints : endpoints}
        hasRowAbove={hasRowAbove}
        now={now}
        pendingEndpointId={pendingEndpointId}
        onOpen={onOpen}
        onToggle={onToggle}
        onResume={onResume}
        onArrange={onArrange}
      />
    );
  }

  return (
    <View testID="api-endpoints-list">
      <SettingsSection
        title={t("settings.apiEndpoints.groups.enabled")}
        count={groups.enabled.length}
        info={t("settings.apiEndpoints.info")}
        trailing={addButton}
        testID="api-endpoints-enabled-group"
      >
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
          {groups.enabled.length === 0 ? (
            <EmptyEnabledGroup
              hasAny={groups.disabled.length > 0}
              hasRowAbove={hasErrorRow}
              onAdd={onAdd}
            />
          ) : (
            renderRows(groups.enabled, hasErrorRow)
          )}
        </View>
      </SettingsSection>
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
  hasRowAbove,
  now,
  pendingEndpointId,
  onOpen,
  onToggle,
  onResume,
  onArrange,
}: {
  endpoints: ApiEndpoint[];
  // 两组合起来的接口顺序，算菜单里哪几项能点。
  allEndpoints: ApiEndpoint[];
  hasRowAbove: boolean;
  now: Date;
  pendingEndpointId: string | null;
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
        moves={onArrange ? endpointMoves(allEndpoints, info.endpoint.id) : null}
        onOpen={onOpen}
        onToggle={onToggle}
        onResume={onResume}
        onArrange={onArrange}
      />
    ),
    [allEndpoints, hasRowAbove, now, onArrange, onOpen, onResume, onToggle, pendingEndpointId],
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
  const statusLine = useEndpointStatusLine(endpoint, status);

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
          <View style={[styles.rowInner, row.isPlaceholder && styles.hidden]}>
            <View style={styles.rowContent}>
              {/* 已关闭是状态不是禁用：只把头像调淡、名称调灰，开关和整行照常可点。 */}
              {row.wrapHandle(
                <View style={[settingsStyles.rowIconFrame, !enabled && styles.disabledIcon]}>
                  {/* 握把悬停才画；悬停只在网页有，窄屏与原生端一直画（docs/hover.md）。 */}
                  {row.hasHandle && (hovered || row.isDragging || isNative || isCompact) ? (
                    <ThemedGripVertical size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />
                  ) : (
                    <Text style={styles.initial}>{initialOf(endpoint.name)}</Text>
                  )}
                </View>,
              )}
              <View style={settingsStyles.rowContent}>
                <Text
                  style={[settingsStyles.rowTitle, !enabled && styles.disabledTitle]}
                  numberOfLines={1}
                >
                  {endpoint.name}
                </Text>
                <ProviderStatusLine status={statusLine}>
                  <RestingStateText status={status} />
                  {status.kind === "cooling" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onPress={handleResume}
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
              </View>
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
                <EndpointOrderMenu
                  endpoint={endpoint}
                  moves={moves}
                  isOpen={row.isMenuOpen}
                  onOpenChange={row.onMenuOpenChange}
                  onArrange={onArrange}
                />
              ) : null}
              <ThemedChevronRight
                size={ICON_SIZE.sm}
                uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            </View>
          </View>
        )}
      </Pressable>
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

/** 行菜单：上移、下移、移到最前、移到最后（照 magpie openProviderMenu）；窄屏是底部弹层。 */
function EndpointOrderMenu({
  endpoint,
  moves,
  isOpen,
  onOpenChange,
  onArrange,
}: {
  endpoint: ApiEndpoint;
  moves: EndpointMoves;
  // 受控：桌面端右键行也打开它（照 magpie 行的 oncontextmenu），锚在 ⋯ 按钮上。
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onArrange: (endpoint: ApiEndpoint, place: EndpointPlace) => void;
}) {
  const { t } = useTranslation();
  const label = t("settings.apiEndpoints.order.menu", { name: endpoint.name });
  return (
    <DropdownMenu compactMode="sheet" open={isOpen} onOpenChange={onOpenChange}>
      <RowActionsMenuTrigger
        accessibilityLabel={label}
        testID={`api-endpoint-order-menu-${endpoint.id}`}
      />
      <DropdownMenuContent align="end" width={240} sheetTitle={label}>
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
function useEndpointStatusLine(
  endpoint: ApiEndpoint,
  status: EndpointRowStatus,
): ProviderStatusDisplay {
  const { t } = useTranslation();
  const summary = endpointSummary(endpoint);
  const parts = [
    summary.formats
      .map((format) => t(`settings.apiEndpoints.formats.${format}`))
      .join(t("settings.apiEndpoints.listSeparator")),
    summary.host,
    t("settings.apiEndpoints.status.modelCount", { count: summary.modelCount }),
  ].filter((part): part is string => Boolean(part));
  if (status.kind === "disabled") parts.unshift(t("settings.apiEndpoints.status.disabled"));
  return {
    tone: status.tone,
    label: { key: "settings.apiEndpoints.status.summary", params: { summary: parts.join(" · ") } },
  };
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

const styles = StyleSheet.create((theme) => ({
  flex: {
    flex: 1,
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
  initial: {
    color: theme.colors.foreground,
    ...theme.typeScale.label,
  },
  disabledIcon: {
    opacity: theme.opacity[50],
  },
  disabledTitle: {
    color: theme.colors.foregroundMuted,
  },
  trailingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
