import { realpathSync } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { ParsedDiffFile } from "../server/utils/diff-highlighter.js";
import { runGitCommand } from "./run-git-command.js";

// 记号超过这个数就整体清空，换一次全量重算，防止长时间订阅时无限增长
const MAX_CHANGE_MARKS = 4096;
const ALL_PATHS_MARK = "";

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
  private roots: string[] = [];
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
    this.roots = resolveRoots(input.cwd);
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
    for (const root of this.roots) {
      const relativePath = relative(root, absolutePath);
      if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        continue;
      }
      if (isAbsolute(relativePath)) {
        continue;
      }
      return relativePath.split(sep).join("/");
    }
    return null;
  }
}

/** 一次 getCheckoutDiff 里用的视图：身份在开算前定好，之后的读写都按这份身份。 */
export class CheckoutDiffReuseRun {
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

  private read(path: string): FileEntry | null {
    const identity = this.identities.get(path);
    return identity === undefined ? null : this.store.readEntry(path, identity);
  }

  private write(path: string): FileEntry | null {
    const identity = this.identities.get(path);
    return identity === undefined ? null : this.store.writableEntry(path, identity, this.startSeq);
  }
}

function resolveRoots(cwd: string): string[] {
  const roots = [resolve(cwd)];
  try {
    const realRoot = realpathSync(cwd);
    if (realRoot !== roots[0]) roots.push(realRoot);
  } catch {
    // 目录读不到时只按原路径匹配提示
  }
  return roots;
}

interface BlobIds {
  oldBlob: string;
  newBlob: string;
}

/** `git diff --raw` 给出每个路径两侧的 blob id；改名按新路径记。 */
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
    const [, , oldBlob = "", newBlob = "", status = ""] = header.slice(1).split(" ");
    const hasTwoPaths = status.startsWith("R") || status.startsWith("C");
    const path = tokens[index + (hasTwoPaths ? 1 : 0)];
    index += hasTwoPaths ? 2 : 1;
    if (path) {
      blobs.set(path, { oldBlob, newBlob });
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

/** 大小 + mtime + inode + mode；符号链接再带上指向文件的签名。读不到返回 null（不复用）。 */
async function readStatSignature(absolutePath: string): Promise<string | null> {
  try {
    const link = await lstat(absolutePath, { bigint: true });
    const own = `${link.size}:${link.mtimeNs}:${link.ino}:${link.mode}`;
    if (!link.isSymbolicLink()) {
      return own;
    }
    const target = await stat(absolutePath, { bigint: true }).catch(() => null);
    return target ? `${own}>${target.size}:${target.mtimeNs}:${target.ino}` : `${own}>missing`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    return null;
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
  if (!blobs) {
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
