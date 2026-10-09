import {
  findMarkdownLinks,
  formatAgentMentionLink,
  formatMarkdownLink,
  isAgentMentionTarget,
  parseAgentMentionLink,
  type AgentMentionTarget,
  type MarkdownLink,
} from "@osuna/protocol/message-links";
import { getRasterImageMimeTypeFromPath } from "@/attachments/file-types";

export type FileEntryKind = "file" | "directory";

/**
 * 从 Command menu 或 `@` 列表选中的行内块。块以文本为准（ADR 0005），这里只是文本的结构化视图。
 * - skill：description 只用于悬停提示，不进文本。
 * - file：path 相对工作区 cwd，目录不带末尾 `/`。
 * - agent：target 指向 provider 或 Agent profile，name 是发送时的显示名。
 */
export type InlineBlock =
  | { kind: "skill"; name: string; description?: string }
  | { kind: "file"; path: string; entryKind: FileEntryKind }
  | { kind: "agent"; target: AgentMentionTarget; name: string };

export type SkillBlock = Extract<InlineBlock, { kind: "skill" }>;

export type InlineSegment = { type: "text"; text: string } | { type: "block"; block: InlineBlock };

export function hasInlineBlock(segments: readonly InlineSegment[]): boolean {
  return segments.some((segment) => segment.type === "block");
}

/** 有 Skill block 时整条是普通消息，正文里的 `/clear` 之类不能被当作客户端命令执行。 */
export function hasSkillBlock(segments: readonly InlineSegment[] | null | undefined): boolean {
  return (
    segments?.some((segment) => segment.type === "block" && segment.block.kind === "skill") ?? false
  );
}

export type InlineBlockVariant = "skill" | "file" | "directory" | "image" | "agent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 来自编辑器属性或剪贴板 JSON 的块，逐字段确认后才当块用。 */
export function isInlineBlock(value: unknown): value is InlineBlock {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "skill":
      return (
        isNonEmptyString(value.name) &&
        (value.description === undefined || typeof value.description === "string")
      );
    case "file":
      return (
        isNonEmptyString(value.path) &&
        (value.entryKind === "file" || value.entryKind === "directory")
      );
    case "agent":
      return isAgentMentionTarget(value.target) && isNonEmptyString(value.name);
    default:
      return false;
  }
}

export function isInlineSegment(value: unknown): value is InlineSegment {
  if (!isRecord(value)) return false;
  if (value.type === "text") return typeof value.text === "string";
  return value.type === "block" && isInlineBlock(value.block);
}

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]+:/i;
// Osuna 发给 Codex 的 skill 会改写成 `$name`，从 Codex 历史导入时原样回来，与 `/name` 同样对待。
const LEADING_SKILL_TOKEN_PATTERN = /^[/$](\S+)/;

function stripTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

function basename(path: string): string {
  const segments = stripTrailingSlashes(path).split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

export function inlineBlockName(block: InlineBlock): string {
  switch (block.kind) {
    case "skill":
      return block.name;
    case "file":
      return basename(block.path);
    case "agent":
      return block.name;
  }
}

export function resolveInlineBlockVariant(block: InlineBlock): InlineBlockVariant {
  if (block.kind !== "file") return block.kind;
  if (block.entryKind === "directory") return "directory";
  return getRasterImageMimeTypeFromPath(block.path) ? "image" : "file";
}

/** 单个块发出时的文字；Skill block 在开头时由 serializeInlineSegments 负责拼接。 */
export function serializeInlineBlock(block: InlineBlock): string {
  switch (block.kind) {
    case "skill":
      return `/${block.name}`;
    case "file": {
      const path = stripTrailingSlashes(block.path);
      const target = block.entryKind === "directory" ? `${path}/` : path;
      return formatMarkdownLink(basename(path), target);
    }
    case "agent":
      return formatAgentMentionLink({ target: block.target, name: block.name });
  }
}

/**
 * 开头连续的 Skill block 拼成 `/a /b`，与正文之间一个空格；其余块原位变成链接文字。
 * 正文开头的换行保留，只去掉开头的空格与末尾空白。
 */
export function serializeInlineSegments(segments: readonly InlineSegment[]): string {
  let skillCount = 0;
  while (skillCount < segments.length) {
    const segment = segments[skillCount];
    if (segment?.type !== "block" || segment.block.kind !== "skill") break;
    skillCount += 1;
  }
  const body = segments
    .slice(skillCount)
    .map((segment) =>
      segment.type === "text" ? segment.text : serializeInlineBlock(segment.block),
    )
    .join("");
  if (skillCount === 0) return body;
  const prefix = segments
    .slice(0, skillCount)
    .map((segment) => (segment.type === "block" ? serializeInlineBlock(segment.block) : ""))
    .join(" ");
  if (!body.trim()) return prefix;
  return `${prefix} ${body.replace(/^[ \t]+/, "").trimEnd()}`;
}

/** 分段结构在输入框里的文字：逐段相接，块按链接写法。 */
export function inlineSegmentsText(segments: readonly InlineSegment[]): string {
  return segments
    .map((segment) =>
      segment.type === "text" ? segment.text : serializeInlineBlock(segment.block),
    )
    .join("");
}

/** 与对文字 trim 对应：去掉开头与末尾文字段的空白，只剩空白的文字段整段去掉。 */
export function trimInlineSegments(segments: readonly InlineSegment[]): InlineSegment[] {
  const trimmed = [...segments];
  const first = trimmed[0];
  if (first?.type === "text") trimmed[0] = { type: "text", text: first.text.trimStart() };
  const lastIndex = trimmed.length - 1;
  const last = trimmed[lastIndex];
  if (last?.type === "text") trimmed[lastIndex] = { type: "text", text: last.text.trimEnd() };
  return trimmed.filter((segment) => segment.type === "block" || segment.text.length > 0);
}

/** 文字偏移表示的范围，end 不含。 */
export interface TextRange {
  start: number;
  end: number;
}

export interface InlineBlockTextInsertion {
  text: string;
  cursor: number;
}

/** 选中块后块后面要跟一个空格；range 后面已经是空格时沿用它，不补第二个。 */
export function needsSpaceAfterInlineBlock(textAfter: string): boolean {
  return !textAfter.startsWith(" ");
}

export interface InlineBlockTextInsertInput {
  text: string;
  range: TextRange;
  block: InlineBlock;
}

/**
 * 输入框只有纯文字时（原生端）选中块：把 range 换成块的链接文字，后面跟一个空格，光标停在空格后。
 */
export function insertInlineBlockText(input: InlineBlockTextInsertInput): InlineBlockTextInsertion {
  const before = input.text.slice(0, input.range.start);
  const after = input.text.slice(input.range.end);
  const blockText = serializeInlineBlock(input.block);
  const space = needsSpaceAfterInlineBlock(after) ? " " : "";
  return {
    text: `${before}${blockText}${space}${after}`,
    cursor: before.length + blockText.length + 1,
  };
}

/** 相邻文字段合并，空文字段去掉。 */
function mergeTextSegments(segments: readonly InlineSegment[]): InlineSegment[] {
  const merged: InlineSegment[] = [];
  for (const segment of segments) {
    if (segment.type === "block") {
      merged.push(segment);
      continue;
    }
    if (!segment.text) continue;
    const last = merged[merged.length - 1];
    if (last?.type === "text")
      merged[merged.length - 1] = { type: "text", text: last.text + segment.text };
    else merged.push(segment);
  }
  return merged;
}

/** 去掉 range 覆盖的文字；range 只落在文字里（`/query` 的识别不越过块），块不动。 */
function removeTextRange(segments: readonly InlineSegment[], range: TextRange): InlineSegment[] {
  let offset = 0;
  const kept = segments.map((segment): InlineSegment => {
    const start = offset;
    if (segment.type === "block") {
      offset += serializeInlineBlock(segment.block).length;
      return segment;
    }
    offset += segment.text.length;
    const cutStart = Math.max(range.start, start) - start;
    const cutEnd = Math.min(range.end, offset) - start;
    if (cutStart >= cutEnd) return segment;
    return { type: "text", text: segment.text.slice(0, cutStart) + segment.text.slice(cutEnd) };
  });
  return mergeTextSegments(kept);
}

/** 拆出的 Skill block 与其余内容；每个块后面那一个分隔空格已从其余内容里去掉。 */
export interface SplitSkillBlocks {
  blocks: SkillBlock[];
  rest: InlineSegment[];
}

/** 拆出开头连续的 Skill block；块与块、块与正文之间的那一个空格是分隔符，一并拆掉。 */
export function splitLeadingSkillBlocks(segments: readonly InlineSegment[]): SplitSkillBlocks {
  const blocks: SkillBlock[] = [];
  const rest = [...segments];
  for (;;) {
    const first = rest[0];
    if (first?.type !== "block" || first.block.kind !== "skill") break;
    blocks.push(first.block);
    rest.shift();
    const next = rest[0];
    if (next?.type !== "text" || !next.text.startsWith(" ")) continue;
    if (next.text.length === 1) rest.shift();
    else rest[0] = { type: "text", text: next.text.slice(1) };
  }
  return { blocks, rest: mergeTextSegments(rest) };
}

/**
 * 输入框里的开头 Skill block：每个块后跟一个空格，输入框的文字因此与发出的 `/a /b 正文` 一致。
 */
export function leadingSkillSegments(
  blocks: readonly SkillBlock[],
  rest: readonly InlineSegment[],
): InlineSegment[] {
  return mergeTextSegments([
    ...blocks.flatMap((block): InlineSegment[] => [
      { type: "block", block },
      { type: "text", text: " " },
    ]),
    ...rest,
  ]);
}

export interface SkillBlocksEdit {
  segments: InlineSegment[];
  /** 文字偏移表示的光标。 */
  cursor: number;
}

export interface AddLeadingSkillBlocksInput extends SkillBlocksEdit {
  blocks: readonly SkillBlock[];
}

/** 块按顺序追加到开头块串末尾（同名不重复）；光标在正文里的位置不变。 */
export function addLeadingSkillBlocks(input: AddLeadingSkillBlocksInput): SkillBlocksEdit {
  const { blocks, rest } = splitLeadingSkillBlocks(input.segments);
  const leadingLength = inlineSegmentsText(input.segments).length - inlineSegmentsText(rest).length;
  const nextBlocks = [...blocks];
  for (const block of input.blocks) {
    if (!nextBlocks.some((picked) => picked.name === block.name)) nextBlocks.push(block);
  }
  const nextLeadingLength = inlineSegmentsText(leadingSkillSegments(nextBlocks, [])).length;
  return {
    segments: leadingSkillSegments(nextBlocks, rest),
    cursor: nextLeadingLength + Math.max(0, input.cursor - leadingLength),
  };
}

/**
 * 从一段内容（输入框内部粘贴）里取出 Skill block，连同每个块后面那一个分隔空格；Skill block
 * 只能在开头，粘贴进来的由调用方交给 addLeadingSkillBlocks。
 */
export function extractSkillBlocks(segments: readonly InlineSegment[]): SplitSkillBlocks {
  const blocks: SkillBlock[] = [];
  const rest: InlineSegment[] = [];
  let dropSeparator = false;
  for (const segment of segments) {
    if (segment.type === "block" && segment.block.kind === "skill") {
      blocks.push(segment.block);
      dropSeparator = true;
      continue;
    }
    if (dropSeparator && segment.type === "text" && segment.text.startsWith(" ")) {
      rest.push({ type: "text", text: segment.text.slice(1) });
    } else {
      rest.push(segment);
    }
    dropSeparator = false;
  }
  return { blocks, rest: mergeTextSegments(rest) };
}

export interface PickSkillBlockInput {
  segments: readonly InlineSegment[];
  /** 正在输入的 `/query`；没有时块照样放到开头。 */
  command: TextRange | null;
  block: SkillBlock;
}

/** 只有 `/query` 非空时连同紧随的一个空格去掉。 */
function commandRemovalRange(text: string, command: TextRange | null): TextRange | null {
  if (!command || command.end <= command.start) return null;
  const end = text[command.end] === " " ? command.end + 1 : command.end;
  return { start: command.start, end };
}

/**
 * 选中 skill：去掉 `/query`（连同紧随的一个空格），块追加到开头块串末尾（同名不重复），
 * 光标回到原 `/query` 所在处。
 */
export function pickSkillBlock(input: PickSkillBlockInput): SkillBlocksEdit {
  const removal = commandRemovalRange(inlineSegmentsText(input.segments), input.command);
  return addLeadingSkillBlocks({
    segments: removal ? removeTextRange(input.segments, removal) : [...input.segments],
    blocks: [input.block],
    cursor: input.command?.start ?? 0,
  });
}

export interface PickSkillTextInput {
  text: string;
  command: TextRange | null;
  name: string;
  /** 该 agent 的 skill 名；开头的 `/x` 只有是 skill 时才算开头块串。 */
  skillNames: ReadonlySet<string>;
}

// `/x` 到空白或结尾为止，后面的一个空格算分隔符；紧跟换行时不吃换行。
const LEADING_SLASH_TOKEN_PATTERN = /^\/(\S+) ?/;

interface LeadingSkillText {
  names: string[];
  /** 开头 skill 串（含每个后面的空格）的长度。 */
  length: number;
}

function leadingSkillText(text: string, skillNames: ReadonlySet<string>): LeadingSkillText {
  const names: string[] = [];
  let length = 0;
  for (;;) {
    const match = LEADING_SLASH_TOKEN_PATTERN.exec(text.slice(length));
    if (!match?.[1] || !skillNames.has(match[1])) return { names, length };
    names.push(match[1]);
    length += match[0].length;
  }
}

/**
 * 输入框只有纯文字时（原生端）选中 skill：去掉 `/query`，`/name ` 追加到开头已知 skill 的 `/x `
 * 之后，与 Web 端开头块串的顺序一致；已在其中时不重复。
 */
export function pickSkillText(input: PickSkillTextInput): InlineBlockTextInsertion {
  const removal = commandRemovalRange(input.text, input.command);
  const text = removal
    ? input.text.slice(0, removal.start) + input.text.slice(removal.end)
    : input.text;
  const cursor = input.command?.start ?? 0;
  const leading = leadingSkillText(text, input.skillNames);
  if (leading.names.includes(input.name)) return { text, cursor };
  const prefix = text.slice(0, leading.length);
  const inserted = `${prefix && !prefix.endsWith(" ") ? " " : ""}/${input.name} `;
  return {
    text: prefix + inserted + text.slice(leading.length),
    cursor: cursor >= leading.length ? cursor + inserted.length : cursor,
  };
}

function resolveLinkBlock(link: MarkdownLink): InlineBlock | null {
  const mention = parseAgentMentionLink(link);
  if (mention) return { kind: "agent", ...mention };
  const { label, target } = link;
  if (URL_SCHEME_PATTERN.test(target)) return null;
  const path = stripTrailingSlashes(target);
  if (!path || basename(path) !== label) return null;
  return { kind: "file", path, entryKind: target.endsWith("/") ? "directory" : "file" };
}

interface LeadingSkills {
  skills: InlineSegment[];
  rest: string;
}

function parseLeadingSkills(text: string, skillNames: ReadonlySet<string>): LeadingSkills {
  const skills: InlineSegment[] = [];
  let rest = text;
  for (;;) {
    const name = LEADING_SKILL_TOKEN_PATTERN.exec(rest)?.[1];
    if (!name || !skillNames.has(name)) break;
    skills.push({ type: "block", block: { kind: "skill", name } });
    rest = rest.slice(name.length + 1);
    // `/a /b 正文` 里块与块、块与正文之间的那一个空格是分隔符，不属于正文。
    if (rest.startsWith(" ")) rest = rest.slice(1);
  }
  return { skills, rest };
}

function parseLinks(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;
  for (const link of findMarkdownLinks(text)) {
    const block = resolveLinkBlock(link);
    if (!block) continue;
    if (link.index > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, link.index) });
    }
    segments.push({ type: "block", block });
    cursor = link.index + link.raw.length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments;
}

export interface ParseInlineSegmentsOptions {
  skillNames: ReadonlySet<string> | null;
}

/**
 * 从已发出的文本认出块：`[basename](path)` 是 File mention，`[@名字](osuna://agent/…)` 是
 * Agent mention，开头连续的已知 skill `/name`（或 Codex 的 `$name`）是 Skill block。skillNames
 * 为 null（列表拿不到）时开头的 `/name`、`$name` 保持文字；其余写法一律保持文字。
 */
export function parseInlineSegments(
  text: string,
  options: ParseInlineSegmentsOptions,
): InlineSegment[] {
  const { skills, rest }: LeadingSkills = options.skillNames
    ? parseLeadingSkills(text, options.skillNames)
    : { skills: [], rest: text };
  return [...skills, ...parseLinks(rest)];
}
