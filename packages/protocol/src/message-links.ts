import { PROVIDER_ID_PATTERN } from "./provider-config.js";

/**
 * 消息正文里的链接：Markdown 链接的匹配与写法，以及 Agent mention 链接
 * `[@名字](osuna://agent/<kind>/<id>)`。app 行内块与 daemon 共用这一份，格式写进历史后不再改（ADR 0005）。
 */

export type AgentMentionKind = "provider" | "profile";

/** id 是解码后的 provider id（满足 PROVIDER_ID_PATTERN）或 Agent profile id（不含 `/`）。 */
export interface AgentMentionTarget {
  kind: AgentMentionKind;
  id: string;
}

/** name 是显示名，不带 `@`。 */
export interface AgentMention {
  target: AgentMentionTarget;
  name: string;
}

/** label 与 target 都已去掉转义。 */
export interface MarkdownLink {
  index: number;
  raw: string;
  label: string;
  target: string;
}

const AGENT_MENTION_HREF_PREFIX = "osuna://agent/";
// label 与目标里的转义只认会破坏链接结构的字符；目标用 `<…>` 包时可含空格与括号，
// 裸目标按 CommonMark 允许一层成对括号（如 `app/(tabs)/index.tsx`）。
const LINK_PATTERN =
  /\[((?:\\[\\[\]]|[^\\[\]\n])+)\]\((?:<((?:\\[<>]|[^<>\n])+)>|((?:[^\s()<>]|\([^\s()<>]*\))+))\)/g;
// `![…](…)` 是图片，`\[` 是转义的方括号，按 CommonMark 都不是链接。
const NOT_A_LINK_PREFIXES = new Set(["!", "\\"]);

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

export function formatMarkdownLink(label: string, target: string): string {
  return `[${escapeLabel(label)}](${formatLinkTarget(target)})`;
}

/** 正文里所有 Markdown 链接，按出现顺序；代码块里的也算。 */
export function findMarkdownLinks(text: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const [raw, rawLabel = "", angleTarget, bareTarget] = match;
    if (NOT_A_LINK_PREFIXES.has(text[match.index - 1] ?? "")) continue;
    const target =
      angleTarget !== undefined ? angleTarget.replace(/\\([<>])/g, "$1") : (bareTarget ?? "");
    links.push({ index: match.index, raw, label: unescapeLabel(rawLabel), target });
  }
  return links;
}

export function isAgentMentionTarget(value: unknown): value is AgentMentionTarget {
  if (typeof value !== "object" || value === null || !("kind" in value) || !("id" in value)) {
    return false;
  }
  const { kind, id } = value;
  if (typeof id !== "string") return false;
  if (kind === "provider") return PROVIDER_ID_PATTERN.test(id);
  return kind === "profile" && id.length > 0 && !id.includes("/");
}

export function formatAgentMentionHref(target: AgentMentionTarget): string {
  return `${AGENT_MENTION_HREF_PREFIX}${target.kind}/${encodeURIComponent(target.id)}`;
}

function decodeAgentMentionId(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
// 0.14.x 写进历史消息的 mention 链接用的是旧 scheme。读的时候两种前缀都认，
// 旧消息里的 mention 才会照样显示成行内块；写出去的永远是新 scheme。
const LEGACY_AGENT_MENTION_HREF_PREFIX = "paseo://agent/";
const READABLE_AGENT_MENTION_HREF_PREFIXES = [
  AGENT_MENTION_HREF_PREFIX,
  LEGACY_AGENT_MENTION_HREF_PREFIX,
];

export function parseAgentMentionHref(href: string): AgentMentionTarget | null {
  const prefix = READABLE_AGENT_MENTION_HREF_PREFIXES.find((candidate) =>
    href.startsWith(candidate),
  );
  if (prefix === undefined) return null;
  const [kind, encoded, ...extra] = href.slice(prefix.length).split("/");
  if (extra.length > 0 || !encoded) return null;
  const target = { kind, id: decodeAgentMentionId(encoded) };
  return isAgentMentionTarget(target) ? target : null;
}

export function formatAgentMentionLink(mention: AgentMention): string {
  return formatMarkdownLink(`@${mention.name}`, formatAgentMentionHref(mention.target));
}

/** label 必须是 `@名字`；其余链接返回 null。 */
export function parseAgentMentionLink(
  link: Pick<MarkdownLink, "label" | "target">,
): AgentMention | null {
  const name = link.label.slice(1);
  if (!link.label.startsWith("@") || !name) return null;
  const target = parseAgentMentionHref(link.target);
  return target ? { target, name } : null;
}
