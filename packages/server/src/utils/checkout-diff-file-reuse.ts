import type { BigIntStats } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import type { ParsedDiffFile } from "../server/utils/diff-highlighter.js";
import { getRealpathAwareRelativePath } from "./path.js";
import { runGitCommand } from "./run-git-command.js";

// 记号超过这个数就整体清空，换一次全量重算，防止长时间订阅时无限增长
const MAX_CHANGE_MARKS = 4096;
const ALL_PATHS_MARK = "";
// 子模块（gitlink）的 patch 取决于子仓库 HEAD 与其内部改动，目录自身的 stat 看不出来
const GITLINK_MODE = "160000";
// 路径不存在：签名记为 missing，删除也是一种身份
const ABSENT_PATH_CODES = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);
// 无权读取：这个文件不复用，交给原流程照常处理
const UNREADABLE_PATH_CODES = new Set(["EACCES", "EPERM"]);

export interface CheckoutDiffReuseChange {
  path: string;
  oldPath?: string;
  status: string;
  isUntracked?: boolean;
}

export interface CheckoutDiffReuseRefs {
  baseRef: string;
  targetRef?: string;
}

export interface CheckoutDiffPatchText {
  path: string;
  text: string;
  truncated: boolean;
}

export interface CheckoutDiffUntrackedText {
  text: string;
  truncated: boolean;
  stat: { additions: number; deletions: number; isBinary: boolean } | null;
}

interface FileEntry {
  identity: string;
  writtenAtSeq: number;
  patch?: CheckoutDiffPatchText;
  untrackedText?: CheckoutDiffUntrackedText;
  highlighted?: ParsedDiffFile;
  untrackedParsed?: ParsedDiffFile[];
}

interface BeginInput {
  cwd: string;
  refs: CheckoutDiffReuseRefs;
  changes: readonly CheckoutDiffReuseChange[];
  ignoreWhitespace: boolean;
}

/**
 * 一个 diff 订阅（cwd + compare）的按文件结果缓存。文件身份 = compare 参数 + 路径 +
 * 旧侧 blob + 新侧（工作区 stat 签名或目标提交的 blob）；身份没变就复用 patch 与高亮。
 * 监听到的变动路径只是额外的失效提示，正确性靠身份比对兜底。
 */
export class CheckoutDiffFileReuse {
  private readonly entries = new Map<string, FileEntry>();
  private readonly changeMarks = new Map<string, number>();
  private root: string | null = null;
  private seq = 0;

  markChanged(absolutePaths: readonly string[]): void {
    if (absolutePaths.length === 0) {
      return;
    }
    this.seq += 1;
    for (const absolutePath of absolutePaths) {
      const relativePath = this.toRelativePath(absolutePath);
      // 根目录与目录本身的元数据变化不代表其下文件变了，只按确切路径记；身份比对兜底其余情况
      if (!relativePath) {
        continue;
      }
      // .gitattributes 会改变 diff 驱动与二进制判定，身份比对看不出来
      const mark = basename(relativePath) === ".gitattributes" ? ALL_PATHS_MARK : relativePath;
      this.changeMarks.set(mark, this.seq);
    }
    if (this.changeMarks.size > MAX_CHANGE_MARKS) {
      this.clear();
    }
  }

  clear(): void {
    this.entries.clear();
    this.changeMarks.clear();
    this.seq += 1;
    this.changeMarks.set(ALL_PATHS_MARK, this.seq);
  }

  async begin(input: BeginInput): Promise<CheckoutDiffReuseRun> {
    this.root = input.cwd;
    const startSeq = this.seq;
    const [blobsByPath, signatures] = await Promise.all([
      readBlobIdsByPath(input.cwd, input.refs),
      readWorktreeSignatures(input),
    ]);
    const identities = new Map<string, string>();
    for (const change of input.changes) {
      const identity = buildIdentity({
        change,
        ignoreWhitespace: input.ignoreWhitespace,
        hasTargetRef: input.refs.targetRef !== undefined,
        blobs: blobsByPath.get(change.path),
        signature: signatures.get(change.path),
      });
      if (identity !== null) {
        identities.set(change.path, identity);
      }
    }
    for (const path of this.entries.keys()) {
      if (!identities.has(path)) {
        this.entries.delete(path);
      }
    }
    return new CheckoutDiffReuseRun(this, identities, startSeq);
  }

  /** @internal 供 CheckoutDiffReuseRun 读写 */
  readEntry(path: string, identity: string): FileEntry | null {
    const entry = this.entries.get(path);
    if (!entry || entry.identity !== identity || entry.writtenAtSeq < this.latestMark(path)) {
      return null;
    }
    return entry;
  }

  /** @internal 供 CheckoutDiffReuseRun 读写 */
  writableEntry(path: string, identity: string, startSeq: number): FileEntry | null {
    // 开算之后又收到这个路径的变动提示：这次读到的内容可能已过时，不写进缓存
    if (startSeq < this.latestMark(path)) {
      return null;
    }
    const existing = this.readEntry(path, identity);
    if (existing) {
      return existing;
    }
    const entry: FileEntry = { identity, writtenAtSeq: startSeq };
    this.entries.set(path, entry);
    return entry;
  }

  private latestMark(path: string): number {
    return Math.max(this.changeMarks.get(ALL_PATHS_MARK) ?? 0, this.changeMarks.get(path) ?? 0);
  }

  private toRelativePath(absolutePath: string): string | null {
    if (this.root === null) {
      return null;
    }
    const relativePath = getRealpathAwareRelativePath(this.root, absolutePath);
    return relativePath === null ? null : relativePath.split(sep).join("/");
  }
}

/** 一次 getCheckoutDiff 里用的视图：身份在开算前定好，之后的读写都按这份身份。 */
export class CheckoutDiffReuseRun {
  // 每个路径第一次读到的缓存值固定到本次结束：开算后才到的变动提示不会让同一次计算
  // 前面按「已有高亮」跳过读全文、后面又重做高亮却缺全文
  private readonly snapshots = new Map<string, Readonly<FileEntry> | null>();

  constructor(
    private readonly store: CheckoutDiffFileReuse,
    private readonly identities: ReadonlyMap<string, string>,
    private readonly startSeq: number,
  ) {}

  async trackedPatches(
    paths: readonly string[],
    load: (paths: string[]) => Promise<CheckoutDiffPatchText[]>,
  ): Promise<CheckoutDiffPatchText[]> {
    const reused = new Map<string, CheckoutDiffPatchText>();
    const missing: string[] = [];
    for (const path of paths) {
      const patch = this.read(path)?.patch;
      if (patch) {
        reused.set(path, patch);
      } else {
        missing.push(path);
      }
    }
    const loaded = missing.length > 0 ? await load(missing) : [];
    for (const patch of loaded) {
      const entry = this.write(patch.path);
      if (entry && entry.patch?.text !== patch.text) {
        entry.patch = patch;
        entry.highlighted = undefined;
      }
      reused.set(patch.path, patch);
    }
    return paths.map((path) => reused.get(path)!);
  }

  hasHighlighted(path: string): boolean {
    return this.read(path)?.highlighted !== undefined;
  }

  async highlighted(path: string, load: () => Promise<ParsedDiffFile>): Promise<ParsedDiffFile> {
    const cached = this.read(path)?.highlighted;
    if (cached) {
      return cached;
    }
    const file = await load();
    const entry = this.write(path);
    if (entry) {
      entry.highlighted = file;
    }
    return file;
  }

  async untrackedText(
    path: string,
    load: () => Promise<CheckoutDiffUntrackedText>,
  ): Promise<CheckoutDiffUntrackedText> {
    const cached = this.read(path)?.untrackedText;
    if (cached) {
      return cached;
    }
    const text = await load();
    const entry = this.write(path);
    if (entry && entry.untrackedText?.text !== text.text) {
      entry.untrackedText = text;
      entry.untrackedParsed = undefined;
    }
    return text;
  }

  async untrackedParsed(
    path: string,
    load: () => Promise<ParsedDiffFile[]>,
  ): Promise<ParsedDiffFile[]> {
    const cached = this.read(path)?.untrackedParsed;
    if (cached) {
      return cached;
    }
    const parsed = await load();
    const entry = this.write(path);
    if (entry) {
      entry.untrackedParsed = parsed;
    }
    return parsed;
  }

  private read(path: string): Readonly<FileEntry> | null {
    const frozen = this.snapshots.get(path);
    if (frozen !== undefined) {
      return frozen;
    }
    const identity = this.identities.get(path);
    const entry = identity === undefined ? null : this.store.readEntry(path, identity);
    const snapshot = entry ? { ...entry } : null;
    this.snapshots.set(path, snapshot);
    return snapshot;
  }

  private write(path: string): FileEntry | null {
    const identity = this.identities.get(path);
    return identity === undefined ? null : this.store.writableEntry(path, identity, this.startSeq);
  }
}

interface BlobIds {
  oldBlob: string;
  newBlob: string;
  isGitlink: boolean;
}

/**
 * `git diff --raw` 给出每个路径两侧的 blob id；改名按新路径记。
 * All changes 不带私有 index 也对：私有 index 恢复的路径在真实 index 下报为 D，旧侧 blob 相同。
 */
async function readBlobIdsByPath(
  cwd: string,
  refs: CheckoutDiffReuseRefs,
): Promise<Map<string, BlobIds>> {
  const { stdout } = await runGitCommand(
    [
      "diff",
      "--raw",
      "-z",
      "--no-abbrev",
      refs.baseRef,
      ...(refs.targetRef ? [refs.targetRef] : []),
    ],
    { cwd, envOverlay: { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } },
  );
  const blobs = new Map<string, BlobIds>();
  const tokens = stdout.split("\u0000");
  let index = 0;
  while (index < tokens.length) {
    const header = tokens[index] ?? "";
    index += 1;
    if (!header.startsWith(":")) {
      continue;
    }
    const [oldMode = "", newMode = "", oldBlob = "", newBlob = "", status = ""] = header
      .slice(1)
      .split(" ");
    const isGitlink = oldMode === GITLINK_MODE || newMode === GITLINK_MODE;
    const hasTwoPaths = status.startsWith("R") || status.startsWith("C");
    const path = tokens[index + (hasTwoPaths ? 1 : 0)];
    index += hasTwoPaths ? 2 : 1;
    if (path) {
      blobs.set(path, { oldBlob, newBlob, isGitlink });
    }
  }
  return blobs;
}

async function readWorktreeSignatures(input: BeginInput): Promise<Map<string, string | null>> {
  const signatures = new Map<string, string | null>();
  const worktreePaths = input.changes
    .filter((change) => change.isUntracked === true || input.refs.targetRef === undefined)
    .map((change) => change.path);
  const results = await Promise.all(
    worktreePaths.map((path) => readStatSignature(resolve(input.cwd, path))),
  );
  for (const [index, path] of worktreePaths.entries()) {
    signatures.set(path, results[index] ?? null);
  }
  return signatures;
}

/**
 * 大小 + mtime + inode + mode；符号链接再带上指向文件的签名。
 * 目录（嵌套仓库等）与无权读取的路径返回 null，不复用。
 */
async function readStatSignature(absolutePath: string): Promise<string | null> {
  const link = await readPathStats(() => lstat(absolutePath, { bigint: true }));
  if (link === "absent") {
    return "missing";
  }
  if (link === "unreadable" || link.isDirectory()) {
    return null;
  }
  const own = formatStats(link);
  if (!link.isSymbolicLink()) {
    return own;
  }
  const target = await readPathStats(() => stat(absolutePath, { bigint: true }));
  if (target === "unreadable") {
    return null;
  }
  return target === "absent" ? `${own}>missing` : `${own}>${formatStats(target)}`;
}

function formatStats(stats: BigIntStats): string {
  return `${stats.size}:${stats.mtimeNs}:${stats.ino}:${stats.mode}`;
}

async function readPathStats(
  load: () => Promise<BigIntStats>,
): Promise<BigIntStats | "absent" | "unreadable"> {
  try {
    return await load();
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== undefined && ABSENT_PATH_CODES.has(code)) {
      return "absent";
    }
    if (code !== undefined && UNREADABLE_PATH_CODES.has(code)) {
      return "unreadable";
    }
    throw error;
  }
}

function buildIdentity(input: {
  change: CheckoutDiffReuseChange;
  ignoreWhitespace: boolean;
  hasTargetRef: boolean;
  blobs: BlobIds | undefined;
  signature: string | null | undefined;
}): string | null {
  const { change, ignoreWhitespace, hasTargetRef, blobs, signature } = input;
  if (change.isUntracked === true) {
    return signature ? JSON.stringify(["untracked", ignoreWhitespace, signature]) : null;
  }
  if (!blobs || blobs.isGitlink) {
    return null;
  }
  const newSide = hasTargetRef ? blobs.newBlob : signature;
  if (!newSide) {
    return null;
  }
  return JSON.stringify([
    "tracked",
    ignoreWhitespace,
    change.status,
    change.oldPath ?? null,
    blobs.oldBlob,
    newSide,
  ]);
}
