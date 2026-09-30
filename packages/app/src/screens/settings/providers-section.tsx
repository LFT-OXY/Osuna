import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import type { ApiEndpointRef } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { selectInheritedApiEndpoint } from "@/api-endpoints";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { getProviderIcon } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { confirmDialog } from "@/utils/confirm-dialog";
import { Text as UiText } from "@/components/ui/text";
import { hasProviderInstallGuide } from "@/provider-install-guide";
import {
  countSelectableModels,
  resolveProviderStatusLine,
  type ProviderStatusDisplay,
} from "@/provider-detail/status";
import { ProviderCatalogDialog } from "./provider-catalog-dialog";
import type { ProvidersLayout } from "./providers-layout";
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react-native";

type ProviderDefinition = ReturnType<typeof buildProviderDefinitions>[number];
type ProviderEntry = NonNullable<ReturnType<typeof useProvidersSnapshot>["entries"]>[number];

interface ProviderRowProps {
  serverId: string;
  def: ProviderDefinition;
  entry: ProviderEntry;
  enabled: boolean;
  isToggling: boolean;
  isRemoving: boolean;
  canRemove: boolean;
  hasInstallGuide: boolean;
  // 继承 claude 的自定义提供方在 Claude 启用第三方接口时也走这个接口。
  inheritedApiEndpoint: ApiEndpointRef | null;
  isFirst: boolean;
  isSelected: boolean;
  showChevron: boolean;
  onPress: (providerId: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
  onRemove: (providerId: string, providerLabel: string) => void;
}

function stopPressInPropagation(event: GestureResponderEvent) {
  event.stopPropagation();
}

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

interface ProviderActionsMenuProps {
  providerId: string;
  providerLabel: string;
  isRemoving: boolean;
  onRemove: (providerId: string, providerLabel: string) => void;
}

function ProviderActionsMenu({
  providerId,
  providerLabel,
  isRemoving,
  onRemove,
}: ProviderActionsMenuProps) {
  const { t } = useTranslation();
  const handleRemove = useCallback(() => {
    onRemove(providerId, providerLabel);
  }, [onRemove, providerId, providerLabel]);
  const triggerStyle = useCallback(
    ({
      pressed,
      hovered,
      open,
    }: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) => [
      styles.menuButton,
      (hovered || open) && styles.menuButtonHovered,
      pressed && styles.menuButtonPressed,
    ],
    [],
  );
  const trashLeading = useMemo(
    () => <ThemedTrash2 size={ICON_SIZE.md} uniProps={dangerColorMapping} />,
    [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isRemoving}
        hitSlop={8}
        onPressIn={stopPressInPropagation}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.actions.menu", { name: providerLabel })}
        testID={`provider-actions-${providerId}`}
      >
        {({ hovered, open }) => (
          <ThemedMoreHorizontal
            size={ICON_SIZE.sm}
            uniProps={hovered || open ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          destructive
          leading={trashLeading}
          onSelect={handleRemove}
          status={isRemoving ? "pending" : "idle"}
          pendingLabel={t("settings.providers.actions.removing")}
          testID={`provider-remove-${providerId}`}
        >
          {t("settings.providers.actions.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderRow({
  serverId,
  def,
  entry,
  enabled,
  isToggling,
  isRemoving,
  canRemove,
  hasInstallGuide,
  inheritedApiEndpoint,
  isFirst,
  isSelected,
  showChevron,
  onPress,
  onToggleEnabled,
  onRemove,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const providerIcon = getProviderIcon(def.id, serverId);
  const ThemedProviderIcon = useMemo(() => withUnistyles(providerIcon), [providerIcon]);
  const providerError =
    enabled &&
    entry.status === "error" &&
    typeof entry.error === "string" &&
    entry.error.trim().length > 0
      ? entry.error.trim()
      : null;
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
  const handleInstallPress = useCallback(
    (event: GestureResponderEvent) => {
      // 外层整行也会打开详情面板，这里拦住冒泡，避免打开两次。
      event.stopPropagation();
      onPress(def.id);
    },
    [def.id, onPress],
  );
  const showInstallEntry = hasInstallGuide && enabled && entry.status === "unavailable";
  const handleToggleValueChange = useCallback(
    (value: boolean) => {
      onToggleEnabled(def.id, value);
    },
    [def.id, onToggleEnabled],
  );
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      (hovered || isSelected) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst, isSelected],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("settings.providers.providerDetails", { name: def.label })}
      accessibilityState={accessibilityState}
      aria-selected={isSelected}
      testID={`provider-row-${def.id}`}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <View style={styles.rowContent}>
            <View style={settingsStyles.rowIconFrame}>
              <ThemedProviderIcon size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
            </View>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                {def.label}
              </Text>
              <StatusLine status={statusLine} />
              {providerError && !isCompact ? (
                <Text style={styles.errorText} numberOfLines={3}>
                  {providerError}
                </Text>
              ) : null}
              {inheritedApiEndpoint ? (
                <Text style={settingsStyles.rowHint} numberOfLines={2}>
                  {t("settings.providers.apiEndpoints.inheritedNote", {
                    name: inheritedApiEndpoint.name,
                  })}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.trailingControls}>
            {showInstallEntry ? (
              <InstallEntry providerLabel={def.label} onPress={handleInstallPress} />
            ) : null}
            <Switch
              value={enabled}
              onValueChange={handleToggleValueChange}
              disabled={isToggling || isRemoving}
              accessibilityLabel={t("settings.providers.enableProvider", { name: def.label })}
            />
            <View style={styles.menuSlot}>
              {canRemove ? (
                <ProviderActionsMenu
                  providerId={def.id}
                  providerLabel={def.label}
                  isRemoving={isRemoving}
                  onRemove={onRemove}
                />
              ) : null}
            </View>
            {showChevron ? (
              <ThemedChevronRight
                size={ICON_SIZE.sm}
                uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  );
}

function StatusLine({ status }: { status: ProviderStatusDisplay }) {
  const { t } = useTranslation();
  return (
    <View style={styles.statusLine}>
      {status.tone === "loading" ? (
        <ThemedLoadingSpinner size={10} uniProps={foregroundMutedColorMapping} />
      ) : (
        <View
          style={[styles.statusDot, statusDotStyles[status.tone]]}
          testID={`provider-status-dot-${status.tone}`}
        />
      )}
      <Text style={styles.statusLabel} numberOfLines={1}>
        {t(status.label.key, status.label.params)}
      </Text>
    </View>
  );
}

function InstallEntry({
  providerLabel,
  onPress,
}: {
  providerLabel: string;
  onPress: (event: GestureResponderEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, statusDotStyles.warning]} />
      <UiText
        variant="caption"
        accessibilityRole="link"
        accessibilityLabel={t("settings.providers.install.howToFor", { name: providerLabel })}
        onPress={onPress}
        style={styles.installEntryLabel}
      >
        {t("settings.providers.install.howTo")}
      </UiText>
    </View>
  );
}

export interface ProvidersSectionProps {
  serverId: string;
  layout: ProvidersLayout;
  // 两列布局下右侧详情对应的提供方，栈式不高亮。
  selectedProvider: string | null;
  onSelectProvider: (providerId: string) => void;
}

export function ProvidersSection({
  serverId,
  layout,
  selectedProvider,
  onSelectProvider,
}: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsProviderRemoval = useHostFeature(serverId, "providerRemoval");
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [removingProviderId, setRemovingProviderId] = useState<string | null>(null);
  const removingProviderIdRef = useRef<string | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const highlightedProvider = layout === "split" ? selectedProvider : null;
  const hasServer = serverId.length > 0;

  const handleToggleEnabled = useCallback(
    async (providerId: string, enabled: boolean) => {
      setPendingProviderId(providerId);
      try {
        await patchConfig({ providers: { [providerId]: { enabled } } });
      } catch (error) {
        Alert.alert(
          t("settings.providers.updateErrorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setPendingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [patchConfig, t],
  );

  const handleRemoveProvider = useCallback(
    async (providerId: string, providerLabel: string) => {
      if (removingProviderIdRef.current) return;
      removingProviderIdRef.current = providerId;
      setRemovingProviderId(providerId);
      try {
        const confirmed = await confirmDialog({
          title: t("settings.providers.remove.confirmTitle", { name: providerLabel }),
          message: t("settings.providers.remove.confirmMessage"),
          confirmLabel: t("settings.providers.remove.confirm"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }

        await patchConfig({ removeProviders: [providerId] });
      } catch (error) {
        Alert.alert(
          t("settings.providers.remove.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (removingProviderIdRef.current === providerId) {
          removingProviderIdRef.current = null;
        }
        setRemovingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [patchConfig, t],
  );

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

  return (
    <>
      <SettingsSection
        title={t("settings.providers.title")}
        trailing={addProviderButton}
        testID="host-page-providers-card"
        style={styles.sectionSpacing}
      >
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
        {hasServer && isConnected && !isLoading && providerDefinitions.length > 0 ? (
          <View style={settingsStyles.card}>
            {providerDefinitions.map((def, index) => {
              const entry = entries?.find((candidate) => candidate.provider === def.id);
              if (!entry) return null;
              const extendsProvider = config?.providers?.[def.id]?.extends;
              const hasInstallGuide = hasProviderInstallGuide({
                provider: def.id,
                extendsProvider,
              });
              const inheritedApiEndpoint = selectInheritedApiEndpoint({
                provider: def.id,
                extendsProvider,
                entries,
              });
              return (
                <ProviderRow
                  key={def.id}
                  serverId={serverId}
                  def={def}
                  entry={entry}
                  enabled={entry.enabled ?? true}
                  isToggling={pendingProviderId === def.id}
                  isRemoving={removingProviderId === def.id}
                  canRemove={supportsProviderRemoval && entry.source === "custom"}
                  hasInstallGuide={hasInstallGuide}
                  inheritedApiEndpoint={inheritedApiEndpoint}
                  isFirst={index === 0}
                  isSelected={highlightedProvider === def.id}
                  showChevron={layout === "stacked"}
                  onPress={onSelectProvider}
                  onToggleEnabled={handleToggleEnabled}
                  onRemove={handleRemoveProvider}
                />
              );
            })}
          </View>
        ) : null}
      </SettingsSection>

      {canAddProvider ? (
        <ProviderCatalogDialog
          serverId={serverId}
          visible={isCatalogOpen}
          onClose={handleCloseCatalog}
          onAdded={handleProviderAdded}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.body,
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
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    marginTop: theme.spacing[0.5],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  installEntryLabel: {
    textDecorationLine: "underline",
  },
  errorText: {
    color: theme.colors.palette.red[300],
    ...theme.typeScale.caption,
    marginTop: theme.spacing[0.5],
  },
  trailingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  menuButton: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  menuSlot: {
    width: 28,
    height: 28,
  },
  menuButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  menuButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
}));

const statusDotStyles = StyleSheet.create((theme) => ({
  success: { backgroundColor: theme.colors.statusSuccess },
  warning: { backgroundColor: theme.colors.statusWarning },
  danger: { backgroundColor: theme.colors.statusDanger },
  muted: { backgroundColor: theme.colors.foregroundMuted },
  loading: { backgroundColor: theme.colors.foregroundMuted },
}));
