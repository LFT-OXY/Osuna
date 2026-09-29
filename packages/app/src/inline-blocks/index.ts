import { getRasterImageMimeTypeFromPath } from "@/attachments/file-types";

export type FileEntryKind = "file" | "directory";

/**
 * 从 Command menu 或 `@` 列表选中的行内块。块以文本为准（ADR 0005），这里只是文本的结构化视图。
 * - skill：description 只用于悬停提示，不进文本。
 * - file：path 相对工作区 cwd，目录不带末尾 `/`。
 * - agent：target 是 provider 或 profile 标识，name 是显示名。
 */
export type InlineBlock =
  | { kind: "skill"; name: string; description?: string }
  | { kind: "file"; path: string; entryKind: FileEntryKind }
  | { kind: "agent"; target: string; name: string };

export type InlineSegment = { type: "text"; text: string } | { type: "block"; block: InlineBlock };

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
      return isNonEmptyString(value.target) && isNonEmptyString(value.name);
    default:
      return false;
  }
}

export function isInlineSegment(value: unknown): value is InlineSegment {
  if (!isRecord(value)) return false;
  if (value.type === "text") return typeof value.text === "string";
  return value.type === "block" && isInlineBlock(value.block);
}

const AGENT_LINK_PREFIX = "paseo://agent/";
// label 与目标里的转义只认会破坏链接结构的字符；目标用 `<…>` 包时可含空格与括号，
// 裸目标按 CommonMark 允许一层成对括号（如 `app/(tabs)/index.tsx`）。
const LINK_PATTERN =
  /\[((?:\\[\\[\]]|[^\\[\]\n])+)\]\((?:<((?:\\[<>]|[^<>\n])+)>|((?:[^\s()<>]|\([^\s()<>]*\))+))\)/g;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]+:/i;
// `![…](…)` 是图片，`\[` 是转义的方括号，按 CommonMark 都不是链接。
const NOT_A_LINK_PREFIXES = new Set(["!", "\\"]);
// Paseo 发给 Codex 的 skill 会改写成 `$name`，从 Codex 历史导入时原样回来，与 `/name` 同样对待。
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

function escapeLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}

function unescapeLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, "$1");
}

function formatLinkTarget(target: string): string {
  if (!/[\s()<>]/.test(target)) return target;
  return `<${target.replace(/[<>]/g, "\\$&")}>`;
}

/** 单个块发出时的文字；Skill block 在开头时由 serializeInlineSegments 负责拼接。 */
export function serializeInlineBlock(block: InlineBlock): string {
  switch (block.kind) {
    case "skill":
      return `/${block.name}`;
    case "file": {
      const path = stripTrailingSlashes(block.path);
      const target = block.entryKind === "directory" ? `${path}/` : path;
      return `[${escapeLabel(basename(path))}](${formatLinkTarget(target)})`;
    }
    case "agent":
      return `[@${escapeLabel(block.name)}](${AGENT_LINK_PREFIX}${encodeURIComponent(block.target)})`;
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

function decodeAgentTarget(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function resolveLinkBlock(label: string, target: string): InlineBlock | null {
  if (target.startsWith(AGENT_LINK_PREFIX)) {
    const encoded = target.slice(AGENT_LINK_PREFIX.length);
    const name = label.slice(1);
    if (!label.startsWith("@") || !name || !encoded || encoded.includes("/")) return null;
    const agentTarget = decodeAgentTarget(encoded);
    return agentTarget ? { kind: "agent", target: agentTarget, name } : null;
  }
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
  for (const match of text.matchAll(LINK_PATTERN)) {
    const [raw, rawLabel = "", angleTarget, bareTarget] = match;
    if (NOT_A_LINK_PREFIXES.has(text[match.index - 1] ?? "")) continue;
    const target =
      angleTarget !== undefined ? angleTarget.replace(/\\([<>])/g, "$1") : (bareTarget ?? "");
    const block = resolveLinkBlock(unescapeLabel(rawLabel), target);
    if (!block) continue;
    if (match.index > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({ type: "block", block });
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments;
}

export interface ParseInlineSegmentsOptions {
  skillNames: ReadonlySet<string> | null;
}

/**
 * 从已发出的文本认出块：`[basename](path)` 是 File mention，`[@名字](paseo://agent/…)` 是
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
