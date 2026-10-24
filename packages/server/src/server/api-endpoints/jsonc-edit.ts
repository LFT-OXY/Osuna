import {
  applyEdits,
  format,
  modify,
  parse as parseJsonc,
  type Edit,
  type FormattingOptions,
  type JSONPath,
} from "jsonc-parser";
import { z } from "zod";

/*
 * 按 JSONC 改 CLI 配置的通用办法（Claude Code 的 settings.json、Pi 的 models.json 与 settings.json 共用）：
 * 只替换被改的那个属性，开头的 BOM 读时摘下、写回时放回，行尾注释留在原来那一行。
 */

const BOM = "\uFEFF";

const JSONC_OPTIONS = { allowTrailingComma: true, disallowComments: false };

/** 接管前一个负责的键的值：有（原样记下）或没有。 */
export const OriginalValueSchema = z.discriminatedUnion("present", [
  z.object({ present: z.literal(true), value: z.unknown() }),
  z.object({ present: z.literal(false) }),
]);
export type OriginalValue = z.infer<typeof OriginalValueSchema>;

// 接管前整个文件的样子：不存在、空对象（留原文，恢复成空时逐字节还原）、或有内容。
export const OriginalFileSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }),
  z.object({ kind: z.literal("empty"), text: z.string() }),
  z.object({ kind: z.literal("content") }),
]);
export type OriginalFile = z.infer<typeof OriginalFileSchema>;

export function classifyOriginalFile(text: string | null): OriginalFile {
  if (text === null) return { kind: "absent" };
  const { body } = splitBom(text);
  if (body.trim() === "") return { kind: "empty", text };
  const parsed: unknown = parseJsonc(body, [], JSONC_OPTIONS);
  const isEmptyObject =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === 0;
  return isEmptyObject ? { kind: "empty", text } : { kind: "content" };
}

/** 开头的 BOM 读时摘下、写回时放回。 */
export interface BomSplit {
  // 开头的 BOM，没有时为空串。
  bom: string;
  body: string;
}

export function splitBom(text: string): BomSplit {
  if (!text.startsWith(BOM)) return { bom: "", body: text };
  return { bom: BOM, body: text.slice(BOM.length) };
}

export function edit(
  text: string,
  path: JSONPath,
  value: unknown,
  formatting: FormattingOptions,
): string {
  const [change, ...others] = modify(text, path, value, {});
  if (change !== undefined && others.length === 0) {
    const commented = besideTrailingComment(text, change);
    if (commented) return editBesideComment({ text, change, commented, formatting });
  }
  return applyEdits(text, modify(text, path, value, { formattingOptions: formatting }));
}

// 上一个值后面、同一行只剩（逗号加）注释：这条注释属于上一行。
const TRAILING_COMMENT = /^([ \t]*,)?(?:[ \t]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/))+[ \t]*$/;

interface TrailingComment {
  // 注释那一行的行尾（换行符之前）。
  lineEnd: number;
  hasComma: boolean;
}

/**
 * jsonc-parser 在容器末尾加键时插在上一个值的紧后面，删末尾的键时从上一个值的紧后面删起；
 * 上一行末尾有注释时，前者把注释挤到新键那一行，后者把注释一起删掉。认出这种情况交给 editBesideComment。
 */
function besideTrailingComment(text: string, change: Edit): TrailingComment | null {
  const isAppend = change.length === 0 && change.content.startsWith(",");
  const isRemoveLast = change.content === "" && /^[ \t]*,/.test(text.slice(change.offset));
  if (!isAppend && !isRemoveLast) return null;
  const lineBreak = text.slice(change.offset).search(/\r?\n/);
  if (lineBreak === -1) return null;
  const lineEnd = change.offset + lineBreak;
  if (isRemoveLast && lineEnd >= change.offset + change.length) return null;
  const rest = TRAILING_COMMENT.exec(text.slice(change.offset, lineEnd));
  if (!rest) return null;
  return { lineEnd, hasComma: rest[1] !== undefined };
}

/**
 * 注释留在原来那一行，两个方向互为还原：
 * - 加键：新键另起一行放在注释之后；上一个值原本带尾随逗号，新键也带，没有就在上一个值后补逗号。
 * - 删键：只删被删的那几行；被删的键带尾随逗号就连它一起删，不带就把上一个值后的逗号也拿掉。
 */
interface BesideCommentEdit {
  text: string;
  // jsonc-parser 不带格式算出的那一处改动。
  change: Edit;
  commented: TrailingComment;
  formatting: FormattingOptions;
}

function editBesideComment(input: BesideCommentEdit): string {
  const { text, change, formatting } = input;
  const { lineEnd, hasComma } = input.commented;
  const valueEnd = change.offset;
  const separator = text.slice(valueEnd, lineEnd).replace(/^[ \t]*,/, "");
  if (change.content === "") {
    const removedEnd = change.offset + change.length;
    const trailingComma = /^[ \t]*,/.exec(text.slice(removedEnd));
    if (trailingComma) {
      return `${text.slice(0, lineEnd)}${text.slice(removedEnd + trailingComma[0].length)}`;
    }
    return `${text.slice(0, valueEnd)}${separator}${text.slice(removedEnd)}`;
  }
  // 上一个值带尾随逗号就整行留着；不带就在值后补上逗号。
  let head = text.slice(0, lineEnd);
  if (!hasComma) head = `${text.slice(0, valueEnd)},${separator}`;
  // 新键与上一个键同样缩进；值里的对象、数组再按文件格式展开。
  const lineStart = text.lastIndexOf("\n", valueEnd) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
  const begin = head.length + (formatting.eol ?? "\n").length;
  const property = `${indent}${change.content.slice(1)}${hasComma ? "," : ""}`;
  const next = `${head}${formatting.eol ?? "\n"}${property}${text.slice(lineEnd)}`;
  const range = { offset: begin, length: property.length };
  return applyEdits(next, format(next, range, { ...formatting, keepLines: false }));
}

/** 按文件自身的缩进和换行写入新键；被插入的那一行会按该缩进重新排版。 */
export function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indent?.startsWith("\t")) {
    return { insertSpaces: false, tabSize: 1, eol };
  }
  return { insertSpaces: true, tabSize: indent ? indent.length : 2, eol };
}
