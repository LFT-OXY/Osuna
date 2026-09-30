import { createContext, useContext, type ComponentType } from "react";
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
  return (
    // Web 读屏不念无 role 元素的 aria-label，标签挂在 group 上；原生由名字 Text 承载。
    <View
      testID="inline-block"
      dataSet={INLINE_BLOCK_DATASETS[variant]}
      role={isWeb ? "group" : undefined}
      accessibilityLabel={isWeb ? label : undefined}
      style={styles.block}
    >
      <InlineBlockIcon block={block} serverId={serverId} />
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

// agent 按 provider 或 profile 取图标，Bot 是两者都认不出时的回退，与 getProviderIcon 一致。
const VARIANT_ICONS: Record<InlineBlockVariant, ComponentType<ProviderIconProps>> = {
  skill: Box,
  file: File,
  directory: Folder,
  image: ImageIcon,
  agent: Bot,
};

function InlineBlockIcon({ block, serverId }: InlineBlockViewProps) {
  if (block.kind !== "agent")
    return <AccentIcon Icon={VARIANT_ICONS[resolveInlineBlockVariant(block)]} />;
  if (block.target.kind === "profile") {
    return <AgentProfileMentionIcon profileId={block.target.id} />;
  }
  return <AccentIcon Icon={getProviderIcon(block.target.id, serverId)} />;
}

/** 按 profile id 取图标；profile 不在（已删除或配置未到）时返回 null。 */
export type AgentProfileIconResolver = (
  profileId: string,
) => ComponentType<ProviderIconProps> | null;

// 块在 browser 项目里也要能渲染，不能读 store，profile 图标由上层（view.tsx 的 Provider）解析好传下来。
export const AgentProfileIconContext = createContext<AgentProfileIconResolver>(() => null);

function AgentProfileMentionIcon({ profileId }: { profileId: string }) {
  const resolveProfileIcon = useContext(AgentProfileIconContext);
  return <AccentIcon Icon={resolveProfileIcon(profileId) ?? VARIANT_ICONS.agent} />;
}

function AccentIcon({ Icon }: { Icon: ComponentType<ProviderIconProps> }) {
  return (
    <ThemedInlineBlockIcon Icon={Icon} size={ICON_SIZE.xs} uniProps={accentBrightIconMapping} />
  );
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
