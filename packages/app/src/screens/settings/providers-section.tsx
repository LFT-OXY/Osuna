import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { resolveProviderGlyph } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Text as UiText } from "@/components/ui/text";
import {
  countSelectableModels,
  resolveProviderStatusLine,
  type ProviderStatusDisplay,
} from "@/provider-detail/status";
import { ProviderIconFrame } from "@/provider-detail/icon-frame";
import { ProviderCatalogDialog } from "./provider-catalog-dialog";
import { ChevronRight, Plus } from "lucide-react-native";

type ProviderDefinition = ReturnType<typeof buildProviderDefinitions>[number];
type ProviderEntry = NonNullable<ReturnType<typeof useProvidersSnapshot>["entries"]>[number];

interface ProviderRowProps {
  serverId: string;
  def: ProviderDefinition;
  entry: ProviderEntry;
  enabled: boolean;
  isToggling: boolean;
  isFirst: boolean;
  onPress: (providerId: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
}

const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function ProviderRow({
  serverId,
  def,
  entry,
  enabled,
  isToggling,
  isFirst,
  onPress,
  onToggleEnabled,
}: ProviderRowProps) {
  const { t } = useTranslation();
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
      testID={`provider-row-${def.id}`}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <View style={styles.rowContent}>
            <ProviderIconFrame glyph={glyph} size="sm" />
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                {def.label}
              </Text>
              <StatusLine status={statusLine} />
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

export interface ProvidersSectionProps {
  serverId: string;
  onSelectProvider: (providerId: string) => void;
}

export function ProvidersSection({ serverId, onSelectProvider }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  // 开关失败的原因，留在列表卡片顶部直到关闭或下一次开关。
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const hasServer = serverId.length > 0;

  const handleToggleEnabled = useCallback(
    async (providerId: string, enabled: boolean) => {
      setPendingProviderId(providerId);
      setToggleError(null);
      try {
        await patchConfig({ providers: { [providerId]: { enabled } } });
      } catch (error) {
        setToggleError(error instanceof Error ? error.message : String(error));
      } finally {
        setPendingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [patchConfig],
  );
  const handleDismissToggleError = useCallback(() => setToggleError(null), []);

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
  // 错误行占了卡片第一行，下面的提供方行都要带分隔线。
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
                  isFirst={index === 0 && !hasErrorRowAbove}
                  onPress={onSelectProvider}
                  onToggleEnabled={handleToggleEnabled}
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
  toggleError: {
    flex: 1,
  },
  trailingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

const statusDotStyles = StyleSheet.create((theme) => ({
  success: { backgroundColor: theme.colors.statusSuccess },
  warning: { backgroundColor: theme.colors.statusWarning },
  danger: { backgroundColor: theme.colors.statusDanger },
  muted: { backgroundColor: theme.colors.foregroundMuted },
  loading: { backgroundColor: theme.colors.foregroundMuted },
}));
