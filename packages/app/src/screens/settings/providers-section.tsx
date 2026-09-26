import { useCallback, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
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
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import {
  buildAcpProviderConfigPatch,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { ProviderCatalogList } from "@/components/provider-catalog-list";
import { getProviderIcon } from "@/components/provider-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { ChevronRight, MoreHorizontal, Trash2 } from "lucide-react-native";

type ProviderDefinition = ReturnType<typeof buildProviderDefinitions>[number];
type ProviderEntry = NonNullable<ReturnType<typeof useProvidersSnapshot>["entries"]>[number];

type StatusTone = "success" | "warning" | "danger" | "muted" | "loading";

interface ProviderStatus {
  tone: StatusTone;
  label: string;
  modelCount: number | null;
}

function getProviderStatus(
  status: string,
  enabled: boolean,
  modelCount: number,
  t: TFunction,
): ProviderStatus {
  if (!enabled)
    return { tone: "muted", label: t("settings.providers.statuses.disabled"), modelCount: null };
  if (status === "loading") {
    return { tone: "loading", label: t("settings.providers.statuses.loading"), modelCount: null };
  }
  if (status === "error") {
    return { tone: "danger", label: t("settings.providers.statuses.error"), modelCount: null };
  }
  if (status === "ready") {
    return {
      tone: "success",
      label: t("settings.providers.statuses.available"),
      modelCount: modelCount > 0 ? modelCount : null,
    };
  }
  return {
    tone: "warning",
    label: t("settings.providers.statuses.notInstalled"),
    modelCount: null,
  };
}

interface ProviderRowProps {
  serverId: string;
  def: ProviderDefinition;
  entry: ProviderEntry;
  enabled: boolean;
  isToggling: boolean;
  isRemoving: boolean;
  canRemove: boolean;
  isFirst: boolean;
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
  isFirst,
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
  const modelCount = filterSelectableModels(entry.models ?? null)?.length ?? 0;
  const providerStatus = getProviderStatus(entry.status, enabled, modelCount, t);
  let modelCountLabel: string | null = null;
  if (providerStatus.modelCount === 1) {
    modelCountLabel = t("settings.providers.models.one");
  } else if (providerStatus.modelCount !== null) {
    modelCountLabel = t("settings.providers.models.many", { count: providerStatus.modelCount });
  }

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
      !isFirst && settingsStyles.rowBorder,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("settings.providers.providerDetails", { name: def.label })}
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
              {providerError && !isCompact ? (
                <Text style={styles.errorText} numberOfLines={3}>
                  {providerError}
                </Text>
              ) : null}
              {!providerError && modelCountLabel ? (
                <Text style={settingsStyles.rowHint} numberOfLines={1}>
                  {modelCountLabel}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.trailingControls}>
            <StatusIndicator status={providerStatus} compact={isCompact} />
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
            <ThemedChevronRight
              size={ICON_SIZE.sm}
              uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          </View>
        </>
      )}
    </Pressable>
  );
}

function StatusIndicator({ status, compact }: { status: ProviderStatus; compact: boolean }) {
  return (
    <View style={styles.statusRow}>
      {status.tone === "loading" ? (
        <ThemedLoadingSpinner size={10} uniProps={foregroundMutedColorMapping} />
      ) : (
        <View style={[styles.statusDot, statusDotStyles[status.tone]]} />
      )}
      {!compact ? <Text style={styles.statusLabel}>{status.label}</Text> : null}
    </View>
  );
}

export interface ProvidersSectionProps {
  serverId: string;
}

export function ProvidersSection({ serverId }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsProviderRemoval = useHostFeature(serverId, "providerRemoval");
  const { entries, isLoading, refresh } = useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const openProviderSettings = useProviderSettingsStore((state) => state.open);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [removingProviderId, setRemovingProviderId] = useState<string | null>(null);
  const removingProviderIdRef = useRef<string | null>(null);
  const [installingProviderId, setInstallingProviderId] = useState<string | null>(null);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const hasServer = serverId.length > 0;

  const handleOpenProviderSettings = useCallback(
    (providerId: string) => {
      openProviderSettings({ serverId, provider: providerId });
    },
    [openProviderSettings, serverId],
  );

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

  const handleInstall = useCallback(
    async (entry: AcpProviderCatalogItem) => {
      if (installingProviderId) return;
      setInstallingProviderId(entry.id);
      try {
        await patchConfig(buildAcpProviderConfigPatch(entry));
        await refresh([entry.id]);
      } catch (error) {
        Alert.alert(
          t("settings.providers.addErrorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setInstallingProviderId((current) => (current === entry.id ? null : current));
      }
    },
    [installingProviderId, patchConfig, refresh, t],
  );

  return (
    <>
      <SettingsSection
        title={t("settings.providers.title")}
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
                  isFirst={index === 0}
                  onPress={handleOpenProviderSettings}
                  onToggleEnabled={handleToggleEnabled}
                  onRemove={handleRemoveProvider}
                />
              );
            })}
          </View>
        ) : null}
      </SettingsSection>

      {hasServer && isConnected ? (
        <SettingsSection
          title={t("settings.providers.addProvider")}
          testID="host-page-add-provider-card"
          style={styles.addProviderSection}
        >
          <ProviderCatalogList
            serverId={serverId}
            installingProviderId={installingProviderId}
            onInstall={handleInstall}
          />
        </SettingsSection>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  addProviderSection: {
    marginTop: theme.spacing[4],
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
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
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
