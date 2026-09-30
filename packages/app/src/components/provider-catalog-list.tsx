import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExternalLink, PackagePlus } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import {
  useAcpProviderCatalog,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";

interface ProviderCatalogListProps {
  serverId: string;
  // 搜索框在弹窗头部，列表只按它的查询过滤。
  query: string;
  installingProviderId: string | null;
  onInstall: (entry: AcpProviderCatalogItem) => Promise<void> | void;
}

const PROVIDER_REMOTE_ICON_SIZE = ICON_SIZE.lg;

const ThemedPackagePlus = withUnistyles(PackagePlus);
const ThemedSvgXml = withUnistyles(SvgXml);
const ThemedExternalLink = withUnistyles(ExternalLink);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function matchesSearch(entry: AcpProviderCatalogItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [entry.title, entry.id, entry.description].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

interface CatalogRowProps {
  entry: AcpProviderCatalogItem;
  installing: boolean;
  isFirst: boolean;
  onInstall: (entry: AcpProviderCatalogItem) => void;
}

function CatalogRow({ entry, installing, isFirst, onInstall }: CatalogRowProps) {
  const { t } = useTranslation();
  const actionLabel = installing
    ? t("providerCatalog.actions.adding")
    : t("providerCatalog.actions.add");
  const handleInstall = useCallback(() => {
    onInstall(entry);
  }, [entry, onInstall]);

  const handleOpenInstallLink = useCallback(() => {
    void openExternalUrl(entry.installLink);
  }, [entry.installLink]);

  return (
    <View style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowIconFrame}>
        {entry.iconSvg ? (
          <ThemedSvgXml
            xml={entry.iconSvg}
            width={PROVIDER_REMOTE_ICON_SIZE}
            height={PROVIDER_REMOTE_ICON_SIZE}
            uniProps={foregroundColorMapping}
          />
        ) : (
          <ThemedPackagePlus size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
        )}
      </View>
      <View style={styles.textColumn}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={styles.version} numberOfLines={1}>
            {entry.version}
          </Text>
        </View>
        <Text style={styles.description} numberOfLines={1}>
          {entry.description || entry.id}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("providerCatalog.actions.installInstructionsFor", {
            provider: entry.title,
          })}
          onPress={handleOpenInstallLink}
          style={styles.installLink}
        >
          <Text style={styles.installLinkText} numberOfLines={1}>
            {t("providerCatalog.actions.installInstructions")}
          </Text>
          <ThemedExternalLink size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
        </Pressable>
      </View>
      <Button
        size="sm"
        variant="default"
        disabled={installing}
        loading={installing}
        onPress={handleInstall}
        style={styles.actionButton}
        testID={`install-provider-${entry.id}`}
      >
        {actionLabel}
      </Button>
    </View>
  );
}

export function ProviderCatalogList({
  serverId,
  query,
  installingProviderId,
  onInstall,
}: ProviderCatalogListProps) {
  const { t } = useTranslation();
  const { entries: catalogEntries } = useAcpProviderCatalog();
  const { entries: providerEntries } = useProvidersSnapshot(serverId);

  const installedIds = useMemo(
    () => new Set(providerEntries?.map((entry) => entry.provider) ?? []),
    [providerEntries],
  );

  const availableEntries = useMemo(
    () =>
      catalogEntries
        .filter((entry) => !installedIds.has(entry.id))
        .filter((entry) => matchesSearch(entry, query)),
    [catalogEntries, installedIds, query],
  );

  return (
    <View>
      {availableEntries.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{t("providerCatalog.noProviders")}</Text>
        </View>
      ) : (
        <View style={settingsStyles.card}>
          {availableEntries.map((entry, index) => (
            <CatalogRow
              key={entry.id}
              entry={entry}
              installing={installingProviderId === entry.id}
              isFirst={index === 0}
              onInstall={onInstall}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  name: {
    color: theme.colors.foreground,
    ...theme.typeScale.body,
    flexShrink: 1,
  },
  version: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
    flexShrink: 0,
  },
  description: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
    marginTop: theme.spacing[0.5],
  },
  installLink: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: "100%",
    marginTop: theme.spacing[0.5],
  },
  installLinkText: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  actionButton: {
    width: 92,
    flexShrink: 0,
  },
  stateBox: {
    minHeight: 96,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceCard,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.body,
  },
}));
