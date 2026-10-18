// 关开关前预览的逐行比较移植自 magpie（https://github.com/yetone/magpie，internal/agent/preview.go 的
// FileChange、LineDiff、diffLines、sameLines（这里拆成 shortestEditKept、walkBack、inOrderKept）、splitLines、lineKey、indent 与 mask）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import path from "node:path";
import type {
  ApiEndpointSwitchOffFile,
  ApiEndpointSwitchOffLine,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ConfigFileChange } from "./config-file.js";

/*
 * magpie 在临时 home 里另起一个进程真跑一遍断开再逐文件比较；Osuna 的还原是纯函数（restoreClaudeOfficial、
 * restoreCodexOfficial），服务用真正关掉时同一份计划在当前内容上算出新内容，这里只把前后两份内容比成一行行。
 */

type SwitchOffLineOp = "removed" | "added" | "restored";

// 超过这么多处改动就不逐行求最短编辑，改按顺序找相同的行（magpie 的 4000）。
const MOST_EDITS = 4000;
// 两边行数之积超过它时整段算拿掉再放进（magpie 的 50,000,000）。
const MOST_PAIRS = 50_000_000;
const MASK = "••••";

export interface SwitchOffFileInput {
  path: string;
  homeDir: string;
  // 现在的内容；文件不在为 null。
  before: string | null;
  // 真正关掉时对这个文件的处理。
  after: ConfigFileChange;
}

/** 关掉后这个文件怎么变；不变为 null。 */
export function switchOffFileChange(input: SwitchOffFileInput): ApiEndpointSwitchOffFile | null {
  const { before, after } = input;
  const shown = shownPath({ filePath: input.path, homeDir: input.homeDir });
  if (after.kind === "keep") return null;
  if (after.kind === "delete") {
    if (before === null) return null;
    return { path: shown, change: "removed", lines: [] };
  }
  if (before === null) return { path: shown, change: "created", lines: diffLines("", after.text) };
  if (before === after.text) return null;
  const lines = diffLines(before, after.text);
  if (lines.length === 0) return null;
  return { path: shown, change: "edited", lines };
}

/** 用户认得的路径：家目录下的写成 `~/…`。 */
function shownPath(input: { filePath: string; homeDir: string }): string {
  const relative = path.relative(input.homeDir, input.filePath);
  const isUnderHome = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (!isUnderHome) return input.filePath;
  return `~/${relative.split(path.sep).join("/")}`;
}

/**
 * 两份内容不同的行，按新内容的顺序：拿掉的、放进的，以及同一个键、同样缩进只换了值的（改回，带现在那一行）。
 * 像密钥的值遮住。两头相同的行之间差得太多、没法逐行比（几千行的表整个拿掉）时，按顺序保留新内容在旧内容里找得到的行。
 */
export function diffLines(a: string, b: string): ApiEndpointSwitchOffLine[] {
  const oldLines = splitLines(a);
  const newLines = splitLines(b);
  const { keepOld, keepNew } = keptLines({ oldLines, newLines });
  const out: ApiEndpointSwitchOffLine[] = [];
  let gone: string[] = [];
  let came: string[] = [];
  const flush = () => {
    out.push(...pairedLines({ gone, came }));
    gone = [];
    came = [];
  };
  let oldAt = 0;
  let newAt = 0;
  while (oldAt < oldLines.length || newAt < newLines.length) {
    const oldLine = oldLines[oldAt];
    const newLine = newLines[newAt];
    const isBothKept = keepOld[oldAt] === true && keepNew[newAt] === true;
    const isOldLineDropped = oldLine !== undefined && keepOld[oldAt] !== true;
    if (isBothKept) {
      flush();
      oldAt += 1;
      newAt += 1;
    } else if (isOldLineDropped) {
      if (hasContent(oldLine)) gone.push(oldLine);
      oldAt += 1;
    } else {
      if (hasContent(newLine)) came.push(newLine);
      newAt += 1;
    }
  }
  flush();
  // 单独一行的括号什么都没说。
  return out.filter((line) => trimChars(line.text.trim(), "{}[](),") !== "");
}

function hasContent(line: string | undefined): line is string {
  return line !== undefined && line.trim() !== "";
}

interface KeptLines {
  keepOld: boolean[];
  keepNew: boolean[];
}

/** 两边留着不动的行：两头相同的，加上中间最短编辑（或按顺序找到）保留的。 */
function keptLines(input: { oldLines: string[]; newLines: string[] }): KeptLines {
  const { oldLines, newLines } = input;
  const shorter = Math.min(oldLines.length, newLines.length);
  let headSame = 0;
  while (headSame < shorter && oldLines[headSame] === newLines[headSame]) headSame += 1;
  const tailRoom = shorter - headSame;
  let tailSame = 0;
  const isTailSame = (back: number) =>
    oldLines[oldLines.length - 1 - back] === newLines[newLines.length - 1 - back];
  while (tailSame < tailRoom && isTailSame(tailSame)) tailSame += 1;
  const keepOld: boolean[] = Array.from({ length: oldLines.length }, () => false);
  const keepNew: boolean[] = Array.from({ length: newLines.length }, () => false);
  for (let at = 0; at < headSame; at += 1) {
    keepOld[at] = true;
    keepNew[at] = true;
  }
  for (let back = 1; back <= tailSame; back += 1) {
    keepOld[oldLines.length - back] = true;
    keepNew[newLines.length - back] = true;
  }
  const oldMiddle = oldLines.slice(headSame, oldLines.length - tailSame);
  const newMiddle = newLines.slice(headSame, newLines.length - tailSame);
  const middle =
    shortestEditKept({ oldLines: oldMiddle, newLines: newMiddle, most: MOST_EDITS }) ??
    inOrderKept({ oldLines: oldMiddle, newLines: newMiddle });
  middle.keepOld.forEach((kept, at) => {
    keepOld[headSame + at] = kept;
  });
  middle.keepNew.forEach((kept, at) => {
    keepNew[headSame + at] = kept;
  });
  return { keepOld, keepNew };
}

/**
 * 新内容的每一行按顺序在旧内容里找：一块拿掉之后剩下的样子。两边行数之积超过 MOST_PAIRS 时一行都不留
 * （整段拿掉再放进）。
 */
function inOrderKept(input: { oldLines: string[]; newLines: string[] }): KeptLines {
  const { oldLines, newLines } = input;
  const keepOld: boolean[] = Array.from({ length: oldLines.length }, () => false);
  const keepNew: boolean[] = Array.from({ length: newLines.length }, () => false);
  if (oldLines.length * newLines.length > MOST_PAIRS) return { keepOld, keepNew };
  let searchFrom = 0;
  newLines.forEach((line, newAt) => {
    const oldAt = oldLines.indexOf(line, searchFrom);
    if (oldAt === -1) return;
    keepOld[oldAt] = true;
    keepNew[newAt] = true;
    searchFrom = oldAt + 1;
  });
  return { keepOld, keepNew };
}

/**
 * 两段留着的行之间拿掉与放进的行：同一个键、同样深的一行拿掉又放进，算一行改回
 * （Claude 自己的 model，不是 modelPicker 里的）；其余照放进、拿掉列出。
 */
function pairedLines(input: { gone: string[]; came: string[] }): ApiEndpointSwitchOffLine[] {
  const gone = [...input.gone];
  const out: ApiEndpointSwitchOffLine[] = [];
  for (const line of input.came) {
    const key = lineKey(line);
    const paired = gone.find((old) => isSameSetting({ key, came: line, old }));
    if (paired === undefined) {
      out.push(lineDiff({ op: "added", text: line }));
      continue;
    }
    out.push({ op: "restored", text: maskSecret(line), was: maskSecret(paired) });
    gone.splice(gone.indexOf(paired), 1);
  }
  for (const line of gone) out.push(lineDiff({ op: "removed", text: line }));
  return out;
}

/** 拿掉的一行与放进的一行设的是同一个键、在同样深的地方。 */
function isSameSetting(input: { key: string; came: string; old: string }): boolean {
  if (input.key === "") return false;
  if (lineKey(input.old) !== input.key) return false;
  return indent(input.old) === indent(input.came);
}

function lineDiff(input: { op: SwitchOffLineOp; text: string }): ApiEndpointSwitchOffLine {
  return { op: input.op, text: maskSecret(input.text) };
}

/**
 * 最短编辑保留下来的行（Myers：时间与内存随改动多少增长，不随文件大小——CLI 配置可能有三万行，Osuna 只改几行）。
 * 改动超过 `most` 处时为 null。k 是对角线（旧行号减新行号），furthest[k] 是走了 edits 步时这条对角线上走到的旧行号。
 */
function shortestEditKept(input: {
  oldLines: string[];
  newLines: string[];
  most: number;
}): KeptLines | null {
  const { oldLines, newLines } = input;
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const most = Math.min(input.most, oldCount + newCount);
  const offset = most + 1;
  const furthest: number[] = Array.from({ length: 2 * offset + 1 }, () => 0);
  // history[edits] 是第 edits 步开始时 furthest 在 k = -edits-1..edits+1 上的值。
  const history: number[][] = [];
  const furthestAt = (k: number): number => furthest[offset + k] ?? 0;
  const historyAt = (edits: number, k: number): number => history[edits]?.[k + edits + 1] ?? 0;
  const isSameAt = (oldAt: number, newAt: number) =>
    oldAt < oldCount && newAt < newCount && oldLines[oldAt] === newLines[newAt];
  for (let edits = 0; edits <= most; edits += 1) {
    history.push(furthest.slice(offset - edits - 1, offset + edits + 2));
    for (let k = -edits; k <= edits; k += 2) {
      // 从上一条对角线插入一行（往下）还是删掉一行（往右）走到这里，取走得远的。
      const isLowestDiagonal = k === -edits;
      const isAboveFurther = k !== edits && furthestAt(k - 1) < furthestAt(k + 1);
      const comesByInsert = isLowestDiagonal || isAboveFurther;
      let oldAt = furthestAt(k - 1) + 1;
      if (comesByInsert) oldAt = furthestAt(k + 1);
      let newAt = oldAt - k;
      while (isSameAt(oldAt, newAt)) {
        oldAt += 1;
        newAt += 1;
      }
      furthest[offset + k] = oldAt;
      const hasReachedEnd = oldAt >= oldCount && newAt >= newCount;
      if (hasReachedEnd) return walkBack({ historyAt, oldCount, newCount, edits });
    }
  }
  return null;
}

/** 从尽头往回走，标出走过的对角线上的行：这些行两边都留着。 */
function walkBack(input: {
  historyAt: (edits: number, k: number) => number;
  oldCount: number;
  newCount: number;
  edits: number;
}): KeptLines {
  const { historyAt, oldCount, newCount } = input;
  const keepOld: boolean[] = Array.from({ length: oldCount }, () => false);
  const keepNew: boolean[] = Array.from({ length: newCount }, () => false);
  let oldAt = oldCount;
  let newAt = newCount;
  for (let edits = input.edits; edits >= 0; edits -= 1) {
    const k = oldAt - newAt;
    const isLowestDiagonal = k === -edits;
    const isAboveFurther = k !== edits && historyAt(edits, k - 1) < historyAt(edits, k + 1);
    const cameByInsert = isLowestDiagonal || isAboveFurther;
    let previousK = k - 1;
    if (cameByInsert) previousK = k + 1;
    const previousOldAt = historyAt(edits, previousK);
    const previousNewAt = previousOldAt - previousK;
    const isOnSnake = () =>
      oldAt > previousOldAt && newAt > previousNewAt && oldAt > 0 && newAt > 0;
    while (isOnSnake()) {
      keepOld[oldAt - 1] = true;
      keepNew[newAt - 1] = true;
      oldAt -= 1;
      newAt -= 1;
    }
    oldAt = previousOldAt;
    newAt = previousNewAt;
  }
  return { keepOld, keepNew };
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replaceAll("\r\n", "\n").replace(/\n+$/, "").split("\n");
}

// 这一行设的是什么：TOML 与 .env 的 = 前、JSON 与 YAML 的 : 前的键；什么都不设为 ""。
const KEY_PATTERN = /^\s*(?:export\s+)?"?([A-Za-z0-9_.-]+)"?\s*[:=]/;
const SECRET_KEY_PATTERN = /(key|token|secret|password|auth)/i;

function lineKey(line: string): string {
  const match = KEY_PATTERN.exec(line);
  if (match?.[1] !== undefined) return match[1];
  const trimmed = line.trim();
  const isTableHeader = trimmed.startsWith("[") && trimmed.endsWith("]");
  return isTableHeader ? trimmed : "";
}

function indent(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

/** 键像密钥的一行把值遮住；…_TOKENS 是个数（CLAUDE_CODE_MAX_CONTEXT_TOKENS），空值与 `$变量`、`{…}` 照原样。 */
export function maskSecret(line: string): string {
  const key = lineKey(line);
  // 空键不像密钥，也走这里。
  const isSecretKey = SECRET_KEY_PATTERN.test(key) && !key.toUpperCase().endsWith("TOKENS");
  if (!isSecretKey) return line;
  const match = KEY_PATTERN.exec(line);
  // 表头或一行写完的数组，不是键值行。
  if (!match) return line;
  const end = match[0].length;
  const bare = trimChars(line.slice(end).trim(), "\"', ");
  const isPlain = bare === "" || bare.startsWith("{") || bare.startsWith("$");
  if (isPlain) return line;
  return `${line.slice(0, end)} ${MASK}`;
}

function trimChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text.charAt(start))) start += 1;
  while (end > start && chars.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}
