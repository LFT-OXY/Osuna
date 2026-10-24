/*
 * 把按节点改出来的 YAML 合回用户原来的文字（OMP 的 models.yml、config.yml）：YAML 库重新排版时会挪注释、改空格，
 * 这里按行三方合并——base 是原文不改直接重排的样子，edited 是改完重排的样子。Osuna 没改到的段落一律用原文，
 * 改到的段落用 edited，于是没碰的行逐字节不变。
 */

export interface LineMergeInput {
  // 用户文件的原文。
  original: string;
  // 原文解析后不做改动直接重排的结果。
  base: string;
  // 改完后重排的结果。
  edited: string;
}

export function mergeEdits(input: LineMergeInput): string {
  const original = splitLines(input.original);
  const base = splitLines(input.base);
  const edited = splitLines(input.edited);
  const toOriginal = matchLines(base, original);
  const toEdited = matchLines(base, edited);
  // 锚点：三份里都在、彼此对得上的行；两个锚点之间是一段。
  const anchors: Anchor[] = [];
  for (let index = 0; index < base.length; index += 1) {
    const atOriginal = toOriginal.get(index);
    const atEdited = toEdited.get(index);
    if (atOriginal !== undefined && atEdited !== undefined) {
      anchors.push({ base: index, original: atOriginal, edited: atEdited });
    }
  }
  anchors.push({ base: base.length, original: original.length, edited: edited.length });
  const out: string[] = [];
  let previous: Anchor = { base: -1, original: -1, edited: -1 };
  for (const anchor of anchors) {
    const baseSegment = base.slice(previous.base + 1, anchor.base);
    const editedSegment = edited.slice(previous.edited + 1, anchor.edited);
    const originalSegment = original.slice(previous.original + 1, anchor.original);
    const isUntouched = sameLines(baseSegment, editedSegment);
    out.push(...(isUntouched ? originalSegment : editedSegment));
    const line = original[anchor.original];
    if (line !== undefined) out.push(line);
    previous = anchor;
  }
  return out.join("");
}

interface Anchor {
  base: number;
  original: number;
  edited: number;
}

/** 按行切开，每行带着自己的换行符。 */
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

/** 最长公共子序列：from 的第几行对上 to 的第几行（不计行尾的 \r）。 */
function matchLines(from: readonly string[], to: readonly string[]): Map<number, number> {
  const rows = from.length;
  const columns = to.length;
  const lengths = new Uint32Array((rows + 1) * (columns + 1));
  const at = (row: number, column: number) => row * (columns + 1) + column;
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lengths[at(row, column)] = sameLine(from[row], to[column])
        ? (lengths[at(row + 1, column + 1)] ?? 0) + 1
        : Math.max(lengths[at(row + 1, column)] ?? 0, lengths[at(row, column + 1)] ?? 0);
    }
  }
  const matches = new Map<number, number>();
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (sameLine(from[row], to[column])) {
      matches.set(row, column);
      row += 1;
      column += 1;
    } else if ((lengths[at(row + 1, column)] ?? 0) >= (lengths[at(row, column + 1)] ?? 0)) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return matches;
}

function sameLine(left: string | undefined, right: string | undefined): boolean {
  return left?.replace(/\r?\n$/, "") === right?.replace(/\r?\n$/, "");
}
