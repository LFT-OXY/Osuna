import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, Plus } from "lucide-react-native";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text as UiText } from "@/components/ui/text";
import type { ProviderStatusDisplay } from "@/provider-detail/status";
import { ProviderStatusLine } from "@/screens/settings/provider-status-line";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  endpointRowStatus,
  endpointSummary,
  groupHostEndpoints,
  type EndpointRowStatus,
  type HostEndpointsLoadState,
} from "./internal/host-list";

/*
 * 「第三方接口」列表：照 Providers 列表页（screens/settings/providers-section.tsx）的分组、行与密度。
 * 纯 props，运行时接线在 view.tsx。
 */

const ThemedChevronRight = withUnistyles(ChevronRight);
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
}

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
    return endpoints.map((endpoint, index) => (
      <EndpointRow
        key={endpoint.id}
        endpoint={endpoint}
        status={endpointRowStatus(endpoint, now)}
        isPending={pendingEndpointId === endpoint.id}
        isFirst={index === 0 && !hasRowAbove}
        onOpen={onOpen}
        onToggle={onToggle}
        onResume={onResume}
      />
    ));
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
  onOpen: (endpoint: ApiEndpoint) => void;
  onToggle: (endpoint: ApiEndpoint, enabled: boolean) => void;
  onResume: (endpoint: ApiEndpoint) => void;
}

function EndpointRow({
  endpoint,
  status,
  isPending,
  isFirst,
  onOpen,
  onToggle,
  onResume,
}: EndpointRowProps) {
  const { t } = useTranslation();
  const enabled = endpoint.enabled !== false;
  const handlePress = useCallback(() => onOpen(endpoint), [endpoint, onOpen]);
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
    <View style={isFirst ? null : settingsStyles.rowBorder}>
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
          <>
            <View style={styles.rowContent}>
              {/* 已关闭是状态不是禁用：只把头像调淡、名称调灰，开关和整行照常可点。 */}
              <View style={[settingsStyles.rowIconFrame, !enabled && styles.disabledIcon]}>
                <Text style={styles.initial}>{initialOf(endpoint.name)}</Text>
              </View>
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
              <ThemedChevronRight
                size={ICON_SIZE.sm}
                uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            </View>
          </>
        )}
      </Pressable>
    </View>
  );
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
