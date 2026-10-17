// 上一份好的（.bak）与坏文件另存（.bad-<时间>）移植自 magpie（https://github.com/yetone/magpie，internal/lastgood/lastgood.go 的 Read、Fallback、Keep、KeepBad），Windows 上占用时短暂重试移植自 internal/steady/steady.go 的 retry
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import type pino from "pino";
import { writePrivateFileAtomicSync } from "../private-files.js";

/*
 * daemon 自己的 JSON 状态文件（接口清单、key、中转站口令）写坏时用上一份好的：
 * - 每次写入前，把现在那份（读得懂时）存成 <文件>.bak；
 * - 读到坏文件而 .bak 读得懂时，坏的那份另存为 <文件>.bad-<时间>，用 .bak 的内容放回原处继续服务，记一行警告；
 * - .bak 也坏（或没有）时照旧抛出原来的错误，什么都不写也不删。
 * 文件不存在就是没有，不看 .bak：原子改名只会留下旧的或新的，不会留下空缺，不在了就是被有意删掉的。
 * 只有 daemon 写这些文件，不加跨进程锁。
 */

/** 读文件与改名；Windows 上被别的程序占用时两者都会暂时失败。测试换成假的来模拟占用。 */
export interface DataFileSystem {
  readFile(filePath: string): Buffer;
  rename(from: string, to: string): void;
  // 同步等一会儿再试：存储是同步的，最多等 0.5 秒。
  pause(ms: number): void;
  platform: NodeJS.Platform;
}

const pauseCell = new Int32Array(new SharedArrayBuffer(4));

export const NODE_DATA_FILE_SYSTEM: DataFileSystem = {
  readFile: (filePath) => readFileSync(filePath),
  rename: (from, to) => renameSync(from, to),
  pause: (ms) => {
    Atomics.wait(pauseCell, 0, 0, ms);
  },
  platform: process.platform,
};

// 占着文件的多是别的读或改名，几毫秒就完：每 10 毫秒再试，最多 50 回，合计 0.5 秒（magpie 的 tries、pause）。
const BUSY_TRIES = 50;
const BUSY_PAUSE_MS = 10;

export interface LastGoodFileOptions<T> {
  filePath: string;
  // 读得懂就返回内容，读不懂就抛错；.bak 与 .bad 的取舍只看它。
  parse: (raw: unknown) => T;
  logger: pino.Logger;
  now: () => Date;
  fileSystem: DataFileSystem;
}

export class LastGoodFile<T> {
  private readonly filePath: string;
  private readonly parse: (raw: unknown) => T;
  private readonly logger: pino.Logger;
  private readonly now: () => Date;
  private readonly fileSystem: DataFileSystem;

  constructor(options: LastGoodFileOptions<T>) {
    this.filePath = options.filePath;
    this.parse = options.parse;
    this.logger = options.logger;
    this.now = options.now;
    this.fileSystem = options.fileSystem;
  }

  private get bakPath(): string {
    return `${this.filePath}.bak`;
  }

  /** 文件不存在时返回 null。 */
  read(): T | null {
    const bytes = this.readBytes(this.filePath);
    if (bytes === null) return null;
    const current = this.tryParse(bytes);
    if (current.ok) return current.value;
    const bak = this.readBytes(this.bakPath);
    if (bak === null) throw current.error;
    const lastGood = this.tryParse(bak);
    if (!lastGood.ok) throw current.error;
    const badPath = this.keepBad(bytes);
    this.writeBytes(this.filePath, bak);
    // 不带解析错误：JSON 的报错会引用一段原文，keys.json 里是 key。
    this.logger.warn(
      { filePath: this.filePath, badPath },
      "API endpoint data file could not be parsed; its last good copy was put back",
    );
    return lastGood.value;
  }

  /** 先把现在那份存成 .bak（读不懂的另存为 .bad-<时间>），再整份替换；json 由调用方按自己的 schema 校验过。 */
  write(json: unknown): void {
    const previous = this.readBytes(this.filePath);
    if (previous !== null) this.keepPrevious(previous);
    this.writeBytes(this.filePath, Buffer.from(`${JSON.stringify(json, null, 2)}\n`));
  }

  /** 连同 .bak 一起删掉：删掉的内容（比如作废的口令）不该在文件写坏时回来。 */
  remove(): void {
    rmSync(this.filePath, { force: true });
    rmSync(this.bakPath, { force: true });
  }

  private keepPrevious(previous: Buffer): void {
    if (!this.tryParse(previous).ok) {
      this.keepBad(previous);
      return;
    }
    const bak = this.readBytes(this.bakPath);
    if (bak?.equals(previous)) return;
    this.writeBytes(this.bakPath, previous);
  }

  /** 同一毫秒里坏了两回，两份都留（-2、-3…）。 */
  private keepBad(bytes: Buffer): string {
    const stamp = this.now().toISOString().replaceAll(":", "-");
    const base = `${this.filePath}.bad-${stamp}`;
    let badPath = base;
    for (let suffix = 2; existsSync(badPath); suffix += 1) badPath = `${base}-${suffix}`;
    this.writeBytes(badPath, bytes);
    return badPath;
  }

  private tryParse(bytes: Buffer): ParseOutcome<T> {
    try {
      return { ok: true, value: this.parse(JSON.parse(bytes.toString("utf8")) as unknown) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  private readBytes(filePath: string): Buffer | null {
    try {
      return whileBusy(this.fileSystem, () => this.fileSystem.readFile(filePath));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  private writeBytes(filePath: string, bytes: Buffer): void {
    writePrivateFileAtomicSync(filePath, bytes, {
      rename: (from, to) => whileBusy(this.fileSystem, () => this.fileSystem.rename(from, to)),
    });
  }
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Windows 上除了「不存在」以外的失败都当作被占用，隔一会儿再试；别的系统上改名是原子的，不重试。 */
function whileBusy<T>(fileSystem: DataFileSystem, attempt: () => T): T {
  for (let tries = 0; ; tries += 1) {
    try {
      return attempt();
    } catch (error) {
      const mayBeBusy = fileSystem.platform === "win32" && errorCode(error) !== "ENOENT";
      if (!mayBeBusy || tries >= BUSY_TRIES) throw error;
      fileSystem.pause(BUSY_PAUSE_MS);
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
