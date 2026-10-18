// 关开关前预览的逐行比较移植自 magpie（https://github.com/yetone/magpie，internal/agent/preview.go 的
// FileChange、LineDiff、diffLines、sameLines、splitLines、lineKey、indent 与 mask）。
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
  const x = splitLines(a);
  const y = splitLines(b);
  const { keepX, keepY } = keptLines({ x, y });
  const out: ApiEndpointSwitchOffLine[] = [];
  let gone: string[] = [];
  let came: string[] = [];
  const flush = () => {
    out.push(...pairedLines({ gone, came }));
    gone = [];
    came = [];
  };
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    const oldLine = x[i];
    const newLine = y[j];
    const isBothKept = keepX[i] === true && keepY[j] === true;
    if (isBothKept) {
      flush();
      i += 1;
      j += 1;
    } else if (oldLine !== undefined && keepX[i] !== true) {
      if (oldLine.trim() !== "") gone.push(oldLine);
      i += 1;
    } else {
      if (newLine !== undefined && newLine.trim() !== "") came.push(newLine);
      j += 1;
    }
  }
  flush();
  // 单独一行的括号什么都没说。
  return out.filter((line) => trimChars(line.text.trim(), "{}[](),") !== "");
}

/** 两边留着不动的行：两头相同的，加上中间最短编辑（或按顺序找到）保留的。 */
function keptLines(input: { x: string[]; y: string[] }): SameLines {
  const { x, y } = input;
  let pre = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre += 1;
  let suf = 0;
  while (
    suf < x.length - pre &&
    suf < y.length - pre &&
    x[x.length - 1 - suf] === y[y.length - 1 - suf]
  ) {
    suf += 1;
  }
  const keepX: boolean[] = Array.from({ length: x.length }, () => false);
  const keepY: boolean[] = Array.from({ length: y.length }, () => false);
  for (let i = 0; i < pre; i += 1) {
    keepX[i] = true;
    keepY[i] = true;
  }
  for (let i = 1; i <= suf; i += 1) {
    keepX[x.length - i] = true;
    keepY[y.length - i] = true;
  }
  const mx = x.slice(pre, x.length - suf);
  const my = y.slice(pre, y.length - suf);
  const same = sameLines({ x: mx, y: my, most: MOST_EDITS });
  if (same) {
    same.keepX.forEach((kept, i) => {
      keepX[pre + i] = kept;
    });
    same.keepY.forEach((kept, j) => {
      keepY[pre + j] = kept;
    });
  } else if (mx.length * my.length <= MOST_PAIRS) {
    // 新内容的每一行按顺序在旧内容里找：一块拿掉之后剩下的样子（再多就整段拿掉再放进）。
    let i = 0;
    for (let j = 0; j < my.length; j += 1) {
      for (let k = i; k < mx.length; k += 1) {
        if (mx[k] === my[j]) {
          keepX[pre + k] = true;
          keepY[pre + j] = true;
          i = k + 1;
          break;
        }
      }
    }
  }
  return { keepX, keepY };
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
    const pairedAt = gone.findIndex(
      (old) => key !== "" && lineKey(old) === key && indent(old) === indent(line),
    );
    const paired = gone[pairedAt];
    if (pairedAt === -1 || paired === undefined) {
      out.push(lineDiff({ op: "added", text: line }));
      continue;
    }
    out.push({ op: "restored", text: maskSecret(line), was: maskSecret(paired) });
    gone.splice(pairedAt, 1);
  }
  for (const line of gone) out.push(lineDiff({ op: "removed", text: line }));
  return out;
}

function lineDiff(input: { op: SwitchOffLineOp; text: string }): ApiEndpointSwitchOffLine {
  return { op: input.op, text: maskSecret(input.text) };
}

interface SameLines {
  keepX: boolean[];
  keepY: boolean[];
}

/**
 * 最短编辑保留下来的行（Myers：时间与内存随改动多少增长，不随文件大小——CLI 配置可能有三万行，Osuna 只改几行）。
 * 改动超过 `most` 处时为 null。
 */
function sameLines(input: { x: string[]; y: string[]; most: number }): SameLines | null {
  const { x, y } = input;
  const n = x.length;
  const m = y.length;
  const most = Math.min(input.most, n + m);
  const off = most + 1;
  const v: number[] = Array.from({ length: 2 * off + 1 }, () => 0);
  // trace[d] 是第 d 步开始时 v 在 k = -d-1..d+1 上的值。
  const trace: number[][] = [];
  const at = (d: number, k: number): number => trace[d]?.[k + d + 1] ?? 0;
  const vAt = (k: number): number => v[off + k] ?? 0;
  for (let d = 0; d <= most; d += 1) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const goesDown = k === -d || (k !== d && vAt(k - 1) < vAt(k + 1));
      let xi = vAt(k - 1) + 1;
      if (goesDown) xi = vAt(k + 1);
      let yi = xi - k;
      while (xi < n && yi < m && x[xi] === y[yi]) {
        xi += 1;
        yi += 1;
      }
      v[off + k] = xi;
      if (xi < n || yi < m) continue;
      // 从尽头往回走，标出走过的对角线。
      const keepX: boolean[] = Array.from({ length: n }, () => false);
      const keepY: boolean[] = Array.from({ length: m }, () => false);
      xi = n;
      yi = m;
      for (let e = d; e >= 0; e -= 1) {
        const ke = xi - yi;
        const cameDown = ke === -e || (ke !== e && at(e, ke - 1) < at(e, ke + 1));
        let pk = ke - 1;
        if (cameDown) pk = ke + 1;
        const px = at(e, pk);
        const py = px - pk;
        while (xi > px && yi > py && xi > 0 && yi > 0) {
          keepX[xi - 1] = true;
          keepY[yi - 1] = true;
          xi -= 1;
          yi -= 1;
        }
        xi = px;
        yi = py;
      }
      return { keepX, keepY };
    }
  }
  return null;
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
  const isSecretKey = SECRET_KEY_PATTERN.test(key) && !key.toUpperCase().endsWith("TOKENS");
  if (key === "" || !isSecretKey) return line;
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
