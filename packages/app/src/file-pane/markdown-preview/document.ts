import { parseDocument, stringify } from "yaml";

export interface MarkdownFrontMatterRow {
  key: string;
  value: string;
}

export interface MarkdownPreviewDocument {
  frontMatter: MarkdownFrontMatterRow[];
  body: string;
  /** 正文第一行在原文件里的行号（从 1 起）：去掉的 front matter 有几行，就往后推几行。 */
  bodyStartLine: number;
}

const FRONT_MATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseMarkdownPreviewDocument(source: string): MarkdownPreviewDocument {
  const match = FRONT_MATTER_PATTERN.exec(source);
  if (!match) {
    return wholeDocument(source);
  }

  try {
    return parseFrontMatter(match, source);
  } catch {
    return wholeDocument(source);
  }
}

function parseFrontMatter(match: RegExpExecArray, source: string): MarkdownPreviewDocument {
  const document = parseDocument(match[1], { schema: "core" });
  if (document.errors.length > 0) {
    return wholeDocument(source);
  }

  const metadata = document.toJS({ maxAliasCount: 100 });
  if (!isMetadataRecord(metadata)) {
    return wholeDocument(source);
  }

  const frontMatter = Object.entries(metadata).map(([key, value]) => ({
    key,
    value: formatFrontMatterValue(value),
  }));

  return {
    frontMatter,
    body: source.slice(match[0].length),
    bodyStartLine: 1 + (match[0].match(/\n/g)?.length ?? 0),
  };
}

function wholeDocument(source: string): MarkdownPreviewDocument {
  return { frontMatter: [], body: source, bodyStartLine: 1 };
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatFrontMatterValue(value: unknown): string {
  if (Array.isArray(value) && value.every(isScalar)) {
    return value.map(formatScalar).join(", ");
  }
  if (isScalar(value)) {
    return formatScalar(value);
  }
  return stringify(value).trim();
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function formatScalar(value: string | number | boolean | null): string {
  return value === null ? "null" : String(value);
}
