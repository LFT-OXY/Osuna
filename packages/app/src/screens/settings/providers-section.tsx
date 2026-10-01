import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useReduceMotionEnabled } from "@/hooks/use-reduce-motion-enabled";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { resolveProviderGlyph } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Text as UiText } from "@/components/ui/text";
import { countSelectableModels, resolveProviderStatusLine } from "@/provider-detail/status";
import { ProviderIconFrame } from "@/provider-detail/icon-frame";
import { useProviderUpgrade } from "@/provider-detail/use-upgrade";
import { ProviderUpgradeButton, ProviderUpgradeFailure } from "@/provider-detail/upgrade-view";
import { useProviderVersionCheck } from "@/provider-detail/use-version-check";
import { selectNewerVersion } from "@/provider-detail/version-check";
import { ProviderCatalogDialog } from "./provider-catalog-dialog";
import { groupProvidersByEnabled } from "./provider-placement";
import { ProviderStatusLine } from "./provider-status-line";
import { ChevronRight, Plus } from "lucide-react-native";

type ProviderDefinition = ReturnType<typeof buildProviderDefinitions>[number];
type ProviderEntry = NonNullable<ReturnType<typeof useProvidersSnapshot>["entries"]>[number];

interface ProviderRowProps {
  serverId: string;
  def: ProviderDefinition;
  entry: ProviderEntry;
  // 已装版本；daemon 不支持 providerVersions 时不传。
  version: string | undefined;
  // 有新版本时的最新版本。
  latestVersion: string | undefined;
  enabled: boolean;
  isToggling: boolean;
  // 开关后刚移到这一组，背景短暂高亮。
  isHighlighted: boolean;
  isFirst: boolean;
  onPress: (providerId: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
}

const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function ProviderRow({
  serverId,
  def,
  entry,
  version,
  latestVersion,
  enabled,
  isToggling,
  isHighlighted,
  isFirst,
  onPress,
  onToggleEnabled,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const upgrade = useProviderUpgrade(serverId, def.id);
  const glyph = resolveProviderGlyph({ provider: def.id, serverId, tone: "brand" });
  const modelCount = countSelectableModels(entry.models);
  const activeApiEndpointName = entry.activeApiEndpoint?.name ?? null;
  const statusLine = resolveProviderStatusLine({
    status: entry.status,
    enabled,
    modelCount,
    activeApiEndpointName,
  });

  const handlePress = useCallback(() => {
    onPress(def.id);
  }, [def.id, onPress]);
  const handleToggleValueChange = useCallback(
    (value: boolean) => {
      onToggleEnabled(def.id, value);
    },
    [def.id, onToggleEnabled],
  );
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      isHighlighted && styles.rowHighlighted,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isHighlighted],
  );

  // 升级失败的输出挂在这一行下面，分隔线放在行和失败块的外层。
  return (
    <View style={isFirst ? null : settingsStyles.rowBorder}>
      <Pressable
        style={rowStyle}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.providerDetails", { name: def.label })}
        testID={`provider-row-${def.id}`}
      >
        {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
          <>
            <View style={styles.rowContent}>
              {/* 已停用是状态不是禁用：只把图标调淡、标题调灰，开关和整行照常可点。 */}
              <View style={enabled ? null : styles.disabledIcon}>
                <ProviderIconFrame glyph={glyph} size="sm" />
              </View>
              <View style={settingsStyles.rowContent}>
                <Text
                  style={[settingsStyles.rowTitle, !enabled && styles.disabledTitle]}
                  numberOfLines={1}
                >
                  {def.label}
                </Text>
                <ProviderStatusLine status={statusLine} version={version}>
                  {version && latestVersion ? (
                    <ProviderUpgradeButton
                      providerLabel={def.label}
                      installedVersion={version}
                      latestVersion={latestVersion}
                      isUpgrading={upgrade.state.status === "upgrading"}
                      onUpgrade={upgrade.upgrade}
                      placement="statusLine"
                    />
                  ) : null}
                </ProviderStatusLine>
              </View>
            </View>
            <View style={styles.trailingControls}>
              <Switch
                value={enabled}
                onValueChange={handleToggleValueChange}
                disabled={isToggling}
                accessibilityLabel={t("settings.providers.enableProvider", { name: def.label })}
              />
              <ThemedChevronRight
                size={ICON_SIZE.sm}
                uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            </View>
          </>
        )}
      </Pressable>
      {upgrade.state.status === "failed" ? (
        <View style={styles.upgradeFailure}>
          <ProviderUpgradeFailure
            provider={def.id}
            providerLabel={def.label}
            state={upgrade.state}
            onDismiss={upgrade.dismiss}
            onOpenDocs={upgrade.openDocs}
          />
        </View>
      ) : null}
    </View>
  );
}

export interface ProvidersSectionProps {
  serverId: string;
  onSelectProvider: (providerId: string) => void;
}

// 开关后移到另一组的那一行，背景高亮的时长。
const MOVED_ROW_HIGHLIGHT_MS = 1500;

interface MovedProvider {
  providerId: string;
  enabled: boolean;
}

interface ToggleState {
  pendingProviderId: string | null;
  // 开关失败的原因，留在"已启用"卡片顶部直到关闭或下一次开关。
  error: string | null;
  // 开关写入成功的那一项；快照把它移到另一组后高亮一下，不提前移动。
  moved: MovedProvider | null;
}

type ToggleAction =
  | { type: "started"; providerId: string }
  | { type: "succeeded"; moved: MovedProvider }
  | { type: "failed"; providerId: string; message: string }
  | { type: "errorDismissed" }
  | { type: "highlightEnded" };

const IDLE_TOGGLE: ToggleState = { pendingProviderId: null, error: null, moved: null };

function settlePending(state: ToggleState, providerId: string): string | null {
  return state.pendingProviderId === providerId ? null : state.pendingProviderId;
}

function toggleReducer(state: ToggleState, action: ToggleAction): ToggleState {
  switch (action.type) {
    case "started":
      return { pendingProviderId: action.providerId, error: null, moved: null };
    case "succeeded":
      return {
        ...state,
        pendingProviderId: settlePending(state, action.moved.providerId),
        moved: action.moved,
      };
    case "failed":
      return {
        ...state,
        pendingProviderId: settlePending(state, action.providerId),
        error: action.message,
      };
    case "errorDismissed":
      return { ...state, error: null };
    case "highlightEnded":
      return { ...state, moved: null };
  }
}

// 列表行的开关：写入 enabled，失败留下原因，成功后等快照把这一行移到另一组再短暂高亮；
// 系统要求减少动态效果时不高亮。
function useProviderToggle(serverId: string, entries: ProviderEntry[] | undefined) {
  const { patchConfig } = useDaemonConfig(serverId);
  const reduceMotion = useReduceMotionEnabled();
  const [state, dispatch] = useReducer(toggleReducer, IDLE_TOGGLE);
  const { moved } = state;
  const hasMovedRowArrived =
    moved !== null &&
    (entries?.some(
      (entry) => entry.provider === moved.providerId && entry.enabled === moved.enabled,
    ) ??
      false);
  useEffect(() => {
    if (!hasMovedRowArrived) return;
    const timer = setTimeout(() => dispatch({ type: "highlightEnded" }), MOVED_ROW_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [hasMovedRowArrived]);

  const toggle = useCallback(
    async (providerId: string, enabled: boolean) => {
      dispatch({ type: "started", providerId });
      try {
        await patchConfig({ providers: { [providerId]: { enabled } } });
        dispatch({ type: "succeeded", moved: { providerId, enabled } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: "failed", providerId, message });
      }
    },
    [patchConfig],
  );
  const dismissError = useCallback(() => dispatch({ type: "errorDismissed" }), []);

  return {
    pendingProviderId: state.pendingProviderId,
    error: state.error,
    highlightedProviderId: moved && hasMovedRowArrived && !reduceMotion ? moved.providerId : null,
    toggle,
    dismissError,
  };
}

export function ProvidersSection({ serverId, onSelectProvider }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(providerVersions): added in v0.14.0, remove gate after 2027-04-01.
  const hostSupportsProviderVersions = useHostFeature(serverId, "providerVersions");
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  // 检查由 Providers 页发起，这里只读结果。
  const { results: versionCheckResults } = useProviderVersionCheck(serverId, {
    checkOnMount: false,
  });
  const {
    pendingProviderId,
    error: toggleError,
    highlightedProviderId,
    toggle: handleToggleEnabled,
    dismissError: handleDismissToggleError,
  } = useProviderToggle(serverId, entries);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);

  const groups = useMemo(() => groupProvidersByEnabled(entries ?? []), [entries]);
  const enabledDefinitions = useMemo(
    () => buildProviderDefinitions(groups.enabled),
    [groups.enabled],
  );
  const disabledDefinitions = useMemo(
    () => buildProviderDefinitions(groups.disabled),
    [groups.disabled],
  );
  const hasServer = serverId.length > 0;

  const handleOpenCatalog = useCallback(() => setIsCatalogOpen(true), []);
  const handleCloseCatalog = useCallback(() => setIsCatalogOpen(false), []);
  const handleProviderAdded = useCallback(
    (providerId: string) => {
      setIsCatalogOpen(false);
      onSelectProvider(providerId);
    },
    [onSelectProvider],
  );

  const canAddProvider = hasServer && isConnected;
  const isListLoaded = canAddProvider && !isLoading;
  // 错误行占了"已启用"卡片第一行，下面的行都要带分隔线。
  const hasErrorRowAbove = toggleError !== null;
  const addProviderButton = useMemo(
    () =>
      canAddProvider ? (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Plus}
          onPress={handleOpenCatalog}
          accessibilityLabel={t("settings.providers.addProvider")}
          testID="providers-add-button"
        />
      ) : null,
    [canAddProvider, handleOpenCatalog, t],
  );

  // hasRowAbove：卡片里这一组上面还有一行（开关失败的错误行），第一行也要带分隔线。
  function renderRows(
    definitions: ProviderDefinition[],
    groupEntries: ProviderEntry[],
    hasRowAbove: boolean,
  ) {
    return definitions.map((def, index) => {
      const entry = groupEntries.find((candidate) => candidate.provider === def.id);
      if (!entry) return null;
      const version = hostSupportsProviderVersions ? entry.version : undefined;
      const latestVersion = selectNewerVersion({
        provider: def.id,
        installedVersion: version,
        results: versionCheckResults,
      });
      return (
        <ProviderRow
          key={def.id}
          serverId={serverId}
          def={def}
          entry={entry}
          version={version}
          latestVersion={latestVersion ?? undefined}
          enabled={entry.enabled}
          isToggling={pendingProviderId === def.id}
          isHighlighted={highlightedProviderId === def.id}
          isFirst={index === 0 && !hasRowAbove}
          onPress={onSelectProvider}
          onToggleEnabled={handleToggleEnabled}
        />
      );
    });
  }

  return (
    <View testID="host-page-providers-card">
      {!hasServer || !isConnected ? (
        <View style={[settingsStyles.card, styles.emptyCard]}>
          <Text style={styles.emptyText}>{t("settings.providers.unavailable")}</Text>
        </View>
      ) : null}
      {hasServer && isConnected && isLoading ? (
        <View style={[settingsStyles.card, styles.emptyCard]}>
          <Text style={styles.emptyText}>{t("settings.providers.loading")}</Text>
        </View>
      ) : null}
      {isListLoaded ? (
        <SettingsSection
          title={t("settings.providers.groups.enabled")}
          count={groups.enabled.length}
          trailing={addProviderButton}
          testID="providers-enabled-group"
        >
          <View style={settingsStyles.card}>
            {toggleError ? (
              <View style={settingsStyles.row} testID="providers-toggle-error">
                <UiText
                  variant="caption"
                  color="statusDanger"
                  selectable
                  style={styles.toggleError}
                >
                  {toggleError}
                </UiText>
                <Button variant="ghost" size="sm" onPress={handleDismissToggleError}>
                  {t("common.actions.dismiss")}
                </Button>
              </View>
            ) : null}
            {enabledDefinitions.length === 0 ? (
              <View
                style={[styles.emptyCard, hasErrorRowAbove && settingsStyles.rowBorder]}
                testID="providers-empty"
              >
                <Text style={styles.emptyText}>{t("settings.providers.empty")}</Text>
              </View>
            ) : (
              renderRows(enabledDefinitions, groups.enabled, hasErrorRowAbove)
            )}
          </View>
        </SettingsSection>
      ) : null}
      {isListLoaded && disabledDefinitions.length > 0 ? (
        <SettingsSection
          title={t("settings.providers.groups.disabled")}
          count={groups.disabled.length}
          testID="providers-disabled-group"
        >
          <View style={settingsStyles.card}>
            {renderRows(disabledDefinitions, groups.disabled, false)}
          </View>
        </SettingsSection>
      ) : null}

      {canAddProvider ? (
        <ProviderCatalogDialog
          serverId={serverId}
          visible={isCatalogOpen}
          onClose={handleCloseCatalog}
          onAdded={handleProviderAdded}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.body,
  },
  rowHighlighted: {
    backgroundColor: theme.colors.surface2,
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
  disabledIcon: {
    opacity: theme.opacity[50],
  },
  disabledTitle: {
    color: theme.colors.foregroundMuted,
  },
  toggleError: {
    flex: 1,
  },
  upgradeFailure: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  trailingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
