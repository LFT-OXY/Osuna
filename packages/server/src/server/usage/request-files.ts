// 逐条记录的按天文件：过完的一天压成 .gz、之后又追加的明文段另成一个 gzip 成员并入、读 .gz 与旁边明文的文件当作一天、
// 坏掉的 .gz 只留完整的行重写、写到一半的 .gz.tmp 一小时后删，移植自 magpie
// （https://github.com/yetone/magpie，internal/gateway/history.go:99-262 的 pruneHistory、gzipFile、gzRoutes、historyFiles）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { promises as fs } from "node:fs";
import path from "node:path";
import { constants as zlibConstants, gunzipSync, gzipSync } from "node:zlib";

const PLAIN_SUFFIX = ".jsonl";
const GZ_SUFFIX = ".jsonl.gz";
const TEMP_SUFFIX = ".jsonl.gz.tmp";
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** A `.gz.tmp` younger than this may be another daemon's, still being written (magpie). */
const STALE_TEMP_MS = 60 * 60 * 1000;
const FILE_MODE = 0o600;

/** One file of a kept day: its plain appends, or its gzipped part. */
export interface RequestDayFile {
  day: string;
  path: string;
  size: number;
  gzipped: boolean;
}

/** The kept days' files, oldest day first, a day's `.gz` ahead of its plain file. */
export async function listRequestDayFiles(dir: string): Promise<RequestDayFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: RequestDayFile[] = [];
  for (const name of names) {
    const gzipped = name.endsWith(GZ_SUFFIX);
    if (!gzipped && !name.endsWith(PLAIN_SUFFIX)) continue;
    const day = name.slice(0, -(gzipped ? GZ_SUFFIX : PLAIN_SUFFIX).length);
    if (!DAY_PATTERN.test(day)) continue;
    const filePath = path.join(dir, name);
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats) continue;
    files.push({ day, path: filePath, size: stats.size, gzipped });
  }
  return files.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    return Number(b.gzipped) - Number(a.gzipped);
  });
}

/** A day file's lines in order; a `.gz` cut short gives the lines before the cut. */
export async function readRequestDayLines(file: RequestDayFile): Promise<string[]> {
  const bytes = await fs.readFile(file.path);
  const text = file.gzipped ? gunzipLines(bytes).lines : splitLines(bytes.toString("utf8"));
  return text;
}

/**
 * Gzip the plain files of every day before `today`, then remove a `.gz.tmp`
 * left over an hour ago by a daemon stopped before its rename.
 */
export async function gzipFinishedDays(input: {
  dir: string;
  today: string;
  now: number;
}): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(input.dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith(TEMP_SUFFIX)) continue;
    const filePath = path.join(input.dir, name);
    const stats = await fs.stat(filePath).catch(() => null);
    if (stats && input.now - stats.mtimeMs > STALE_TEMP_MS) await fs.rm(filePath, { force: true });
  }
  for (const file of await listRequestDayFiles(input.dir)) {
    if (file.gzipped || file.day >= input.today) continue;
    await gzipDayFile(file.path);
  }
}

/**
 * Fold a day's plain file into its `.gz`. A day already gzipped keeps its
 * `.gz` and the file's lines go after it as a gzip member of their own (read
 * back as one stream): a late record is written to its day's plain file
 * again. A `.gz` cut short, or ending in a line cut short, is written anew
 * from its whole lines and the file's. The `.gz` is replaced whole, never seen
 * half written, and the plain file goes once its lines are in.
 *
 * magpie skips a file line the `.gz` already holds; records here are read
 * last-wins, so only a file whose whole text already ends the `.gz` (a daemon
 * stopped between the rename and the remove) is skipped.
 */
async function gzipDayFile(plainPath: string): Promise<void> {
  const gzPath = plainPath.slice(0, -PLAIN_SUFFIX.length) + GZ_SUFFIX;
  const plain = await fs.readFile(plainPath, "utf8").catch(() => null);
  if (plain === null) return;
  let old: Buffer | null;
  try {
    old = await fs.readFile(gzPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
    old = null;
  }
  const added = splitLines(plain);
  let body: Buffer | null = null;
  if (old === null) {
    if (added.length > 0) body = gzipSync(joinLines(added));
  } else {
    const read = gunzipLines(old);
    const alreadyIn = read.whole && read.text.endsWith(joinLines(added));
    if (!alreadyIn && added.length > 0) {
      body = read.whole
        ? Buffer.concat([old, gzipSync(joinLines(added))])
        : gzipSync(joinLines([...read.lines, ...added]));
    }
  }
  if (body) {
    const tempPath = `${gzPath}.tmp`;
    try {
      await fs.writeFile(tempPath, body, { mode: FILE_MODE });
      await fs.rename(tempPath, gzPath);
    } catch {
      await fs.rm(tempPath, { force: true });
      return;
    }
  }
  await fs.rm(plainPath, { force: true });
}

/**
 * A `.gz`'s whole lines, a last one whole but for its newline among them and
 * one cut short left out, and whether it read to its end on a newline: what a
 * gzip member added after it needs.
 */
function gunzipLines(bytes: Buffer): { lines: string[]; text: string; whole: boolean } {
  try {
    const text = gunzipSync(bytes).toString("utf8");
    return { lines: splitLines(text), text, whole: text.length === 0 || text.endsWith("\n") };
  } catch {
    let text = "";
    try {
      text = gunzipSync(bytes, { finishFlush: zlibConstants.Z_SYNC_FLUSH }).toString("utf8");
    } catch {
      text = "";
    }
    return { lines: splitLines(text), text, whole: false };
  }
}

/** Non-empty lines; a last line with no newline is kept only when it parses. */
function splitLines(text: string): string[] {
  const parts = text.split("\n");
  const tail = parts.pop() ?? "";
  const lines = parts.map((line) => line.trim()).filter((line) => line.length > 0);
  if (tail.trim().length > 0 && parsesAsJson(tail)) lines.push(tail.trim());
  return lines;
}

function joinLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
