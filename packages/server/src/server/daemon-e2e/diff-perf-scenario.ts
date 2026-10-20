import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/*
 * Diff 面板性能的固定场景。daemon 侧 git-diff-bottleneck.local.e2e.test.ts 直接 import，
 * 浏览器侧 diff-performance.spec.ts 和桌面版手测经 diff-perf-scenario-cli.ts 调用。
 * 内容只由下标决定，不用随机数，同样的输入得到逐字节相同的仓库。
 */

export const DIFF_PERF_SCENARIO = {
  moduleCount: 200,
  linesPerFile: 2_000,
  changedBlocks: 5,
  linesPerBlock: 10,
  newFileCount: 50,
  linesPerNewFile: 200,
  lockEntries: 7_500,
  /** 每种扩展名的文件数，用来单独量 StreamLanguage 高亮。 */
  streamLanguageFiles: 3,
  agentIntervalMs: 500,
  agentDurationMs: 60_000,
} as const;

const STREAM_LANGUAGE_EXTENSIONS = ["sql", "sh", "toml"] as const;

type StreamLanguageExtension = (typeof STREAM_LANGUAGE_EXTENSIONS)[number];

interface ScenarioLine {
  fileIndex: number;
  lineIndex: number;
  revision: number;
}

export interface DiffPerfScenarioSummary {
  trackedModifiedFiles: number;
  untrackedFiles: number;
  /** 一个文件上 additions + deletions 的大致值，lock 文件单列。 */
  changedLinesPerModule: number;
  lockChangedLines: number;
}

export interface SimulatedAgentEdit {
  path: string;
  writtenAtMs: number;
}

function hex(seed: number): string {
  return (Math.imul(seed + 1, 2654435761) >>> 0).toString(16).padStart(8, "0").slice(-8);
}

function isChangedLine(lineIndex: number): boolean {
  const { linesPerFile, changedBlocks, linesPerBlock } = DIFF_PERF_SCENARIO;
  const stride = linesPerFile / changedBlocks;
  return lineIndex % stride >= stride / 2 && lineIndex % stride < stride / 2 + linesPerBlock;
}

function moduleLine({ fileIndex, lineIndex, revision }: ScenarioLine): string {
  return `export const value_${fileIndex}_${lineIndex} = "${hex(fileIndex * 7919 + lineIndex + revision)}";`;
}

function streamLanguageLine({
  extension,
  fileIndex,
  lineIndex,
  revision,
}: ScenarioLine & { extension: StreamLanguageExtension }): string {
  const value = hex(fileIndex * 104729 + lineIndex + revision);
  switch (extension) {
    case "sql":
      return `INSERT INTO events (id, kind, payload) VALUES (${lineIndex}, 'k${fileIndex}', '${value}');`;
    case "sh":
      return `export STEP_${lineIndex}="${value}" && echo "step ${lineIndex}: $STEP_${lineIndex}"`;
    case "toml":
      return `key_${lineIndex} = { name = "n${fileIndex}", value = "${value}", enabled = true }`;
  }
}

function fileText(lineCount: number, line: (lineIndex: number) => string): string {
  return `${Array.from({ length: lineCount }, (_, lineIndex) => line(lineIndex)).join("\n")}\n`;
}

function lockText(revision: number): string {
  const entries = Array.from({ length: DIFF_PERF_SCENARIO.lockEntries }, (_, index) =>
    [
      `    "node_modules/pkg-${index}": {`,
      `      "version": "1.${index % 97}.${revision}",`,
      `      "integrity": "sha512-${hex(index + revision * 1_000_003)}${hex(index)}"`,
      `    },`,
    ].join("\n"),
  );
  return `{\n  "name": "diff-perf",\n  "lockfileVersion": 3,\n  "packages": {\n${entries.join("\n")}\n  }\n}\n`;
}

function modulePath(fileIndex: number): string {
  return `src/modules/module-${String(fileIndex).padStart(3, "0")}.ts`;
}

function moduleText(fileIndex: number, revision: (lineIndex: number) => number): string {
  return fileText(DIFF_PERF_SCENARIO.linesPerFile, (lineIndex) =>
    moduleLine({ fileIndex, lineIndex, revision: revision(lineIndex) }),
  );
}

function streamText(
  file: { extension: StreamLanguageExtension; index: number },
  revision: (lineIndex: number) => number,
): string {
  return fileText(DIFF_PERF_SCENARIO.linesPerFile, (lineIndex) =>
    streamLanguageLine({
      extension: file.extension,
      fileIndex: file.index,
      lineIndex,
      revision: revision(lineIndex),
    }),
  );
}

function changedRevision(lineIndex: number): number {
  return isChangedLine(lineIndex) ? 1 : 0;
}

function writeRepoFile(input: { root: string; relativePath: string; content: string }): void {
  const absolute = path.join(input.root, input.relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, input.content);
}

function git(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

/** 在空目录里建出改前快照、提交，再写出未提交的改动。 */
export function createDiffPerfScenario(root: string): DiffPerfScenarioSummary {
  const { moduleCount, newFileCount, linesPerNewFile, streamLanguageFiles, lockEntries } =
    DIFF_PERF_SCENARIO;
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "perf@paseo.test"]);
  git(root, ["config", "user.name", "Paseo Perf"]);
  git(root, ["config", "commit.gpgsign", "false"]);

  const modulePaths = Array.from({ length: moduleCount }, (_, index) => modulePath(index));
  const streamPaths = STREAM_LANGUAGE_EXTENSIONS.flatMap((extension) =>
    Array.from({ length: streamLanguageFiles }, (_, index) => ({
      extension,
      index,
      path: `scripts/${extension}/file-${index}.${extension}`,
    })),
  );

  for (const [index, filePath] of modulePaths.entries()) {
    writeRepoFile({ root, relativePath: filePath, content: moduleText(index, () => 0) });
  }
  for (const file of streamPaths) {
    writeRepoFile({ root, relativePath: file.path, content: streamText(file, () => 0) });
  }
  writeRepoFile({ root, relativePath: "package-lock.json", content: lockText(0) });
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "baseline"]);

  for (const [index, filePath] of modulePaths.entries()) {
    writeRepoFile({ root, relativePath: filePath, content: moduleText(index, changedRevision) });
  }
  for (const file of streamPaths) {
    writeRepoFile({ root, relativePath: file.path, content: streamText(file, changedRevision) });
  }
  writeRepoFile({ root, relativePath: "package-lock.json", content: lockText(1) });
  for (let index = 0; index < newFileCount; index += 1) {
    writeRepoFile({
      root,
      relativePath: `src/new/new-${String(index).padStart(2, "0")}.ts`,
      content: fileText(linesPerNewFile, (lineIndex) =>
        moduleLine({ fileIndex: 10_000 + index, lineIndex, revision: 0 }),
      ),
    });
  }

  const { changedBlocks, linesPerBlock } = DIFF_PERF_SCENARIO;
  return {
    trackedModifiedFiles: modulePaths.length + streamPaths.length + 1,
    untrackedFiles: newFileCount,
    changedLinesPerModule: changedBlocks * linesPerBlock * 2,
    // 每条 entry 的 version 与 integrity 两行都变。
    lockChangedLines: lockEntries * 2 * 2,
  };
}

/**
 * 模拟 Agent 的第 edit 次改动：落在第 edit % moduleCount 个模块，比改前快照多改一行，结果可重复。
 */
export function editScenarioModule(input: { cwd: string; edit: number }): string {
  const fileIndex = input.edit % DIFF_PERF_SCENARIO.moduleCount;
  const editedLine = (input.edit * 37) % DIFF_PERF_SCENARIO.linesPerFile;
  const relativePath = modulePath(fileIndex);
  writeRepoFile({
    root: input.cwd,
    relativePath,
    content: moduleText(fileIndex, (line) =>
      line === editedLine ? 2 + input.edit : changedRevision(line),
    ),
  });
  return relativePath;
}

/** 模拟 Agent：按固定间隔轮流改一个已有模块。 */
export async function runSimulatedAgent(input: {
  cwd: string;
  durationMs?: number;
  intervalMs?: number;
}): Promise<SimulatedAgentEdit[]> {
  const durationMs = input.durationMs ?? DIFF_PERF_SCENARIO.agentDurationMs;
  const intervalMs = input.intervalMs ?? DIFF_PERF_SCENARIO.agentIntervalMs;
  const editCount = Math.floor(durationMs / intervalMs);
  const edits: SimulatedAgentEdit[] = [];
  const startedAt = performance.now();
  for (let edit = 0; edit < editCount; edit += 1) {
    const filePath = editScenarioModule({ cwd: input.cwd, edit });
    edits.push({ path: filePath, writtenAtMs: performance.now() });
    const nextAt = startedAt + (edit + 1) * intervalMs;
    await delay(Math.max(0, nextAt - performance.now()));
  }
  return edits;
}
