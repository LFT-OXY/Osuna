import { useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useAgentCommandsQuery } from "@/hooks/use-agent-commands-query";
import { useSessionStore } from "@/stores/session-store";
import { InlineBlockView } from "./block-view";
import {
  inlineBlockName,
  parseInlineSegments,
  resolveInlineBlockVariant,
  type InlineBlock,
  type InlineSegment,
} from "./index";

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

function keyInlineParts(segments: readonly InlineSegment[]): KeyedPart[] {
  const occurrences = new Map<string, number>();
  function nextKey(base: string): string {
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return `${base}:${occurrence}`;
  }
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
  /** 排队项保存的分段结构，有时按它显示，不再从 text 解析。 */
  segments?: readonly InlineSegment[];
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
  segments,
  skillNames,
  serverId,
  ...textProps
}: InlineBlockTextProps) {
  const parts = useMemo(
    () => keyInlineParts(segments ?? parseInlineSegments(text, { skillNames })),
    [segments, text, skillNames],
  );
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
