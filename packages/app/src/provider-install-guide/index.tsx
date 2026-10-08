import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Copy, ExternalLink } from "lucide-react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { ScrollView } from "@/components/ui/scroll-view";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { ProviderInstallCommand, ProviderInstallMethod } from "./internal/commands";
import type { ProviderInstallGuide } from "./internal/model";

export { resolveProviderInstallGuide, type ProviderInstallGuide } from "./internal/model";

const ThemedExternalLink = withUnistyles(ExternalLink);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type CommandGroupKind = "install" | "upgrade";

interface CommandGroupSpec {
  headingKey: string;
  testID: string;
  commandTestID: string;
}

const COMMAND_GROUPS: Readonly<Record<CommandGroupKind, CommandGroupSpec>> = {
  install: {
    headingKey: "settings.providers.install.installHeading",
    testID: "provider-install-commands",
    commandTestID: "provider-install-command",
  },
  upgrade: {
    headingKey: "settings.providers.install.upgradeHeading",
    testID: "provider-upgrade-commands",
    commandTestID: "provider-upgrade-command",
  },
};

function InstallCommandRow({
  entry,
  commandTestID,
  onCopy,
}: {
  entry: ProviderInstallCommand;
  commandTestID: string;
  onCopy: (command: string) => void;
}) {
  const { t } = useTranslation();
  const handleCopy = useCallback(() => onCopy(entry.command), [entry.command, onCopy]);

  return (
    <View style={styles.commandEntry}>
      {entry.label ? (
        <Text variant="caption" color="foregroundMuted" style={styles.commandLabel}>
          {entry.label}
        </Text>
      ) : null}
      {/* 说明放在这一行外面：复制按钮只跟命令对齐，不跟"说明加命令"的整块对齐。 */}
      <View style={styles.commandLine}>
        <Text
          variant="caption"
          style={styles.command}
          selectable
          dataSet={CODE_SURFACE_DATASET}
          testID={commandTestID}
        >
          {entry.command}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Copy}
          onPress={handleCopy}
          style={styles.copyButton}
          accessibilityLabel={t("settings.providers.install.copyAccessibility", {
            command: entry.command,
          })}
        >
          {t("settings.providers.install.copy")}
        </Button>
      </View>
    </View>
  );
}

// 一种安装方式下的一组命令："安装"或"升级"小标题，下面一行或多行命令。
function InstallCommandGroup({
  kind,
  commands,
  onCopy,
}: {
  kind: CommandGroupKind;
  commands: readonly ProviderInstallCommand[];
  onCopy: (command: string) => void;
}) {
  const { t } = useTranslation();
  const group = COMMAND_GROUPS[kind];
  return (
    <View style={[settingsStyles.rowBorder, styles.commandGroup]} testID={group.testID}>
      <Text
        variant="caption"
        color="foregroundMuted"
        weight="medium"
        style={styles.commandGroupHeading}
      >
        {t(group.headingKey)}
      </Text>
      {commands.map((entry) => (
        <InstallCommandRow
          key={entry.command}
          entry={entry}
          commandTestID={group.commandTestID}
          onCopy={onCopy}
        />
      ))}
    </View>
  );
}

function toMethodOption(method: ProviderInstallMethod): SegmentedControlOption<string> {
  return {
    value: method.id,
    label: method.label,
    testID: `provider-install-method-${method.id}`,
  };
}

// 标签最多 7 个（OpenCode），放不下时横向滚动，不截断标签文字。
// 滚动视口收在卡片的左右内边距以内，滚出去的标签在内容对齐线上被裁掉，不贴卡片边框。
function InstallMethodTabs({
  methods,
  selectedMethodId,
  onSelect,
}: {
  methods: readonly ProviderInstallMethod[];
  selectedMethodId: string;
  onSelect: (methodId: string) => void;
}) {
  const options = useMemo(() => methods.map(toMethodOption), [methods]);
  return (
    <View style={[settingsStyles.row, styles.methodsRow]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <SegmentedControl
          options={options}
          value={selectedMethodId}
          onValueChange={onSelect}
          size="sm"
          style={styles.methodsTrack}
          testID="provider-install-methods"
        />
      </ScrollView>
    </View>
  );
}

// 用户点过标签就用他选的；没点过就跟着默认标签走（主机系统可能晚于首次渲染才上报）。
function selectShownMethod(
  guide: ProviderInstallGuide,
  pickedMethodId: string | null,
): ProviderInstallMethod {
  const picked = guide.methods.find((method) => method.id === pickedMethodId);
  return picked ?? guide.defaultMethod;
}

export interface ProviderInstallGuideSurfaceProps {
  guide: ProviderInstallGuide;
  // 所装 CLI 的名称；自定义提供方传它继承的内置提供方的名称。
  cliLabel: string;
  onCopyCommand: (command: string) => void;
  onOpenDocs: (url: string) => void;
}

/*
 * 提供方详情里常驻的"安装与升级"区块：卡片顶部是按官方文档分的安装方式标签，
 * 选中的那种下面分"安装""升级"两组命令，底部是主机提示和官方文档链接。
 */
export function ProviderInstallGuideSurface({
  guide,
  cliLabel,
  onCopyCommand,
  onOpenDocs,
}: ProviderInstallGuideSurfaceProps) {
  const { t } = useTranslation();
  const [pickedMethodId, setPickedMethodId] = useState<string | null>(null);
  const method = selectShownMethod(guide, pickedMethodId);

  const handleOpenDocs = useCallback(() => onOpenDocs(guide.docsUrl), [guide.docsUrl, onOpenDocs]);

  let title = t("settings.providers.install.title");
  if (guide.isInherited) {
    title = t("settings.providers.install.titleFor", { name: cliLabel });
  }

  return (
    <SettingsSection title={title} testID="provider-install-guide">
      <View style={settingsStyles.card}>
        <InstallMethodTabs
          methods={guide.methods}
          selectedMethodId={method.id}
          onSelect={setPickedMethodId}
        />
        <InstallCommandGroup kind="install" commands={method.install} onCopy={onCopyCommand} />
        <InstallCommandGroup kind="upgrade" commands={method.upgrade} onCopy={onCopyCommand} />
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
  // 沿用设置行的最小高和左右内边距，改成纵向排，让滚动视口撑满行宽。
  methodsRow: {
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
  },
  // 横向滚动的内容容器会把子项拉到和行一样高，轨道要保持自身高度。
  methodsTrack: {
    alignSelf: "center",
  },
  commandGroup: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1.5],
  },
  commandGroupHeading: {
    paddingHorizontal: theme.spacing[4],
  },
  commandEntry: {
    paddingHorizontal: theme.spacing[4],
  },
  // 说明贴着自己的命令：离上面（小标题或上一条命令）比离下面远。
  commandLabel: {
    marginTop: theme.spacing[3],
  },
  commandLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
  },
  // 上下留白放在命令文字上：单行命令和折成多行的命令，离小标题的距离一样。
  command: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[1.5],
    fontFamily: theme.fontFamily.mono,
  },
  // 抵掉 sm 按钮的水平内边距：「复制」的字落在卡片的右对齐线上，点击区向外长。
  copyButton: {
    marginRight: -theme.spacing[3],
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
