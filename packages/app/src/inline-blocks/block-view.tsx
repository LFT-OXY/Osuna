import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Bot, Box, File, Folder, Image as ImageIcon } from "lucide-react-native";
import { getProviderIcon, type ProviderIconProps } from "@/components/provider-icons";
import { isNative, isWeb } from "@/constants/platform";
import { contentTypeStep, ICON_SIZE, type Theme } from "@/styles/theme";
import {
  inlineBlockName,
  resolveInlineBlockVariant,
  type InlineBlock,
  type InlineBlockVariant,
} from "./index";

// 名字过长时截断，一行放得下。
const INLINE_BLOCK_MAX_WIDTH = 260;

interface InlineBlockViewProps {
  block: InlineBlock;
  serverId: string | null;
}

/** 单个块：图标 + accent 名字。气泡与输入框共用。 */
export function InlineBlockView({ block, serverId }: InlineBlockViewProps) {
  const { t } = useTranslation();
  const variant = resolveInlineBlockVariant(block);
  const name = inlineBlockName(block);
  const label = t(`composer.inlineBlocks.${variant}`, { name });
  const Icon = resolveInlineBlockIcon(block, serverId);
  return (
    // Web 读屏不念无 role 元素的 aria-label，标签挂在 group 上；原生由名字 Text 承载。
    <View
      testID="inline-block"
      dataSet={INLINE_BLOCK_DATASETS[variant]}
      role={isWeb ? "group" : undefined}
      accessibilityLabel={isWeb ? label : undefined}
      style={styles.block}
    >
      <ThemedInlineBlockIcon Icon={Icon} size={ICON_SIZE.xs} uniProps={accentBrightIconMapping} />
      <Text numberOfLines={1} accessibilityLabel={isNative ? label : undefined} style={styles.name}>
        {name}
      </Text>
    </View>
  );
}

const INLINE_BLOCK_DATASETS: Record<InlineBlockVariant, { inlineBlock: InlineBlockVariant }> = {
  skill: { inlineBlock: "skill" },
  file: { inlineBlock: "file" },
  directory: { inlineBlock: "directory" },
  image: { inlineBlock: "image" },
  agent: { inlineBlock: "agent" },
};

// agent 按 provider 或 profile 取图标，Bot 与 getProviderIcon 认不出时的回退一致。
const VARIANT_ICONS: Record<InlineBlockVariant, ComponentType<ProviderIconProps>> = {
  skill: Box,
  file: File,
  directory: Folder,
  image: ImageIcon,
  agent: Bot,
};

function resolveInlineBlockIcon(
  block: InlineBlock,
  serverId: string | null,
): ComponentType<ProviderIconProps> {
  if (block.kind === "agent") return getProviderIcon(block.target, serverId);
  return VARIANT_ICONS[resolveInlineBlockVariant(block)];
}

interface InlineBlockIconSlotProps {
  Icon: ComponentType<ProviderIconProps>;
  size: number;
  color?: string;
}

function InlineBlockIconSlot({ Icon, size, color = "" }: InlineBlockIconSlotProps) {
  return <Icon size={size} color={color} />;
}

const ThemedInlineBlockIcon = withUnistyles(InlineBlockIconSlot);
const accentBrightIconMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

const styles = StyleSheet.create((theme) => ({
  block: {
    maxWidth: INLINE_BLOCK_MAX_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // 块名与输入框、气泡正文同字号（Content size 的 body 一级），随设置缩放。
  name: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.accentBright,
    fontWeight: theme.fontWeight.normal,
    ...contentTypeStep(theme.fontSize.content, "body"),
  },
}));
