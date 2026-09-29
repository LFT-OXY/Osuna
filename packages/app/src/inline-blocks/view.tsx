import { useMemo, type ComponentType } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Bot, Box, File, Folder, Image as ImageIcon } from "lucide-react-native";
import { getProviderIcon, type ProviderIconProps } from "@/components/provider-icons";
import { isNative, isWeb } from "@/constants/platform";
import { useAgentCommandsQuery } from "@/hooks/use-agent-commands-query";
import { useSessionStore } from "@/stores/session-store";
import { contentTypeStep, ICON_SIZE, type Theme } from "@/styles/theme";
import {
  inlineBlockName,
  parseInlineSegments,
  resolveInlineBlockVariant,
  type InlineBlock,
  type InlineBlockVariant,
} from "./index";

// 名字过长时截断，一行放得下。
const INLINE_BLOCK_MAX_WIDTH = 260;

interface AgentSkillNamesInput {
  serverId: string;
  agentId: string;
}

/**
 * 该 agent 当前命令列表里的 skill 名。列表未加载或拿不到时为 null，开头的 `/name` 按文字显示；
 * 加载后调用方随之重渲染。与 Composer 聚焦预取共用同一个查询。
 */
export function useAgentSkillNames(input: AgentSkillNamesInput): ReadonlySet<string> | null {
  // 草稿 tab 与 provider 子智能体面板的 id 不是 agent，不去请求命令列表。
  const isAgent = useSessionStore(
    (state) => state.sessions[input.serverId]?.agents.has(input.agentId) ?? false,
  );
  const commandsState = useAgentCommandsQuery({
    serverId: input.serverId,
    agentId: input.agentId,
    isMenuOpen: false,
    prefetch: isAgent,
  });
  const commands = commandsState.status === "ready" ? commandsState.commands : null;
  const skillNameList = commands
    ?.filter((command) => command.kind === "skill")
    .map((command) => command.name)
    .join("\n");
  // 以名字列表为依据：命令列表重新请求得到同样的 skill 时，气泡不必全部重渲染。
  return useMemo(
    () => (skillNameList === undefined ? null : new Set(skillNameList.split("\n").filter(Boolean))),
    [skillNameList],
  );
}

type KeyedPart = { key: string; text: string } | { key: string; block: InlineBlock };

function keyInlineParts(text: string, skillNames: ReadonlySet<string> | null): KeyedPart[] {
  const occurrences = new Map<string, number>();
  function nextKey(base: string): string {
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return `${base}:${occurrence}`;
  }
  const segments = parseInlineSegments(text, { skillNames });
  const parts: KeyedPart[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.type === "text") {
      parts.push({ key: nextKey(`text:${segment.text}`), text: segment.text });
      continue;
    }
    const { block } = segment;
    parts.push({
      key: nextKey(`${resolveInlineBlockVariant(block)}:${inlineBlockName(block)}`),
      block,
    });
    // 开头 skill 之间及与正文之间的分隔空格在解析时归为分隔符，显示时补回；
    // 后面紧跟换行或制表符时解析没有吃掉空格，不补。
    const next = segments[index + 1];
    const nextStartsWithOtherSpace = next?.type === "text" && /^[^\S ]/.test(next.text);
    if (block.kind === "skill" && next && !nextStartsWithOtherSpace) {
      parts.push({ key: nextKey("text: "), text: " " });
    }
  }
  return parts;
}

interface InlineBlockTextProps {
  text: string;
  skillNames: ReadonlySet<string> | null;
  /** Agent mention 的 provider 图标按 host 的 provider 快照解析。 */
  serverId: string | null;
  style?: StyleProp<TextStyle>;
  selectable?: boolean;
  numberOfLines?: number;
  ellipsizeMode?: "head" | "middle" | "tail" | "clip";
  dataSet?: Record<string, string>;
}

/** 已发出的文本：认出的块显示为图标 + accent 名字，其余照原样；整段仍可选中。 */
export function InlineBlockText({
  text,
  skillNames,
  serverId,
  ...textProps
}: InlineBlockTextProps) {
  const parts = useMemo(() => keyInlineParts(text, skillNames), [text, skillNames]);
  return (
    <Text {...textProps}>
      {parts.map((part) =>
        "text" in part ? (
          part.text
        ) : (
          <InlineBlockView key={part.key} block={part.block} serverId={serverId} />
        ),
      )}
    </Text>
  );
}

interface InlineBlockViewProps {
  block: InlineBlock;
  serverId: string | null;
}

function InlineBlockView({ block, serverId }: InlineBlockViewProps) {
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
  // 块名随 Content size 设置缩放，取 caption 一级，与气泡正文同一套字号。
  name: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.accentBright,
    fontWeight: theme.fontWeight.normal,
    ...contentTypeStep(theme.fontSize.content, "caption"),
  },
}));
