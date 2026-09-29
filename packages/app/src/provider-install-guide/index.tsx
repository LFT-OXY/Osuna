import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Copy, ExternalLink } from "lucide-react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  INSTALL_PLATFORMS,
  type InstallPlatform,
  type ProviderInstallCommand,
} from "./internal/commands";
import type { ProviderInstallGuide } from "./internal/model";

export {
  hasProviderInstallGuide,
  resolveProviderInstallGuide,
  type ProviderInstallGuide,
} from "./internal/model";

// 主机系统未知时没有默认标签；分段控件需要一个值，用不对应任何选项的哨兵。
type PlatformTab = InstallPlatform | "none";

// 系统名是专有名词，不翻译。
const PLATFORM_LABELS: Readonly<Record<InstallPlatform, string>> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
};

const PLATFORM_OPTIONS: SegmentedControlOption<PlatformTab>[] = INSTALL_PLATFORMS.map(
  (platform) => ({
    value: platform,
    label: PLATFORM_LABELS[platform],
    testID: `provider-install-platform-${platform}`,
  }),
);

const ThemedExternalLink = withUnistyles(ExternalLink);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function InstallCommandRow({
  entry,
  isFirst,
  onCopy,
}: {
  entry: ProviderInstallCommand;
  isFirst: boolean;
  onCopy: (command: string) => void;
}) {
  const { t } = useTranslation();
  const handleCopy = useCallback(() => onCopy(entry.command), [entry.command, onCopy]);

  return (
    <View style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        {entry.label ? (
          <Text variant="caption" color="foregroundMuted" style={styles.commandLabel}>
            {entry.label}
          </Text>
        ) : null}
        <Text
          variant="caption"
          style={styles.command}
          selectable
          dataSet={CODE_SURFACE_DATASET}
          testID="provider-install-command"
        >
          {entry.command}
        </Text>
      </View>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Copy}
        onPress={handleCopy}
        accessibilityLabel={t("settings.providers.install.copyAccessibility", {
          command: entry.command,
        })}
      >
        {t("settings.providers.install.copy")}
      </Button>
    </View>
  );
}

export interface ProviderInstallGuideSurfaceProps {
  guide: ProviderInstallGuide;
  // 所装 CLI 的名称；自定义提供方传它继承的内置提供方的名称。
  cliLabel: string;
  onCopyCommand: (command: string) => void;
  onOpenDocs: (url: string) => void;
}

export function ProviderInstallGuideSurface({
  guide,
  cliLabel,
  onCopyCommand,
  onOpenDocs,
}: ProviderInstallGuideSurfaceProps) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<PlatformTab>(guide.defaultPlatform ?? "none");
  const commands = platform === "none" ? null : guide.commands[platform];

  const handleOpenDocs = useCallback(() => onOpenDocs(guide.docsUrl), [guide.docsUrl, onOpenDocs]);

  const platformTabs = useMemo(
    () => (
      <SegmentedControl
        options={PLATFORM_OPTIONS}
        value={platform}
        onValueChange={setPlatform}
        size="sm"
        testID="provider-install-platforms"
      />
    ),
    [platform],
  );

  return (
    <SettingsSection
      title={t("settings.providers.install.title", { name: cliLabel })}
      trailing={platformTabs}
      testID="provider-install-guide"
    >
      <View style={settingsStyles.card}>
        {commands ? (
          commands.map((entry, index) => (
            <InstallCommandRow
              key={entry.command}
              entry={entry}
              isFirst={index === 0}
              onCopy={onCopyCommand}
            />
          ))
        ) : (
          <View style={settingsStyles.row}>
            <Text variant="caption" color="foregroundMuted">
              {t("settings.providers.install.choosePlatform")}
            </Text>
          </View>
        )}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text variant="caption" color="foregroundMuted" style={styles.hostHint}>
            {t("settings.providers.install.hostHint")}
          </Text>
          <View style={styles.docsLink}>
            <Text
              variant="caption"
              color="foregroundMuted"
              accessibilityRole="link"
              accessibilityLabel={t("settings.providers.install.docsFor", { name: cliLabel })}
              onPress={handleOpenDocs}
              numberOfLines={1}
            >
              {t("settings.providers.install.docs")}
            </Text>
            <ThemedExternalLink size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
          </View>
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  commandLabel: {
    marginBottom: theme.spacing[0.5],
  },
  command: {
    fontFamily: theme.fontFamily.mono,
  },
  hostHint: {
    flex: 1,
  },
  docsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
}));
