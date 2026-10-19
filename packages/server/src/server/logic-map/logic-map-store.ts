import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { LOGIC_MAPS_DIRECTORY, markdownHeadings } from "@getpaseo/protocol/logic-map-docs";
import type { LogicMapSkeleton, WorkspaceLogicMapSummary } from "@getpaseo/protocol/messages";
import { z } from "zod";

import { isErrnoException } from "../../utils/errno.js";
import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import {
  LogicMapCorruptError,
  LogicMapDirectoryMissingError,
  LogicMapNameUnavailableError,
  LogicMapNotFoundError,
  LogicMapUpdateRejectedError,
} from "./logic-map-errors.js";
import {
  applyLogicMapOperations,
  type ExternalDocLink,
  type LogicMapOperation,
} from "./logic-map-operations.js";
import { EMPTY_LOGIC_MAP_SKELETON, parseLogicMapSkeleton } from "./logic-map-skeleton.js";

export const LOGIC_MAP_SKELETON_FILE = "map.json";

const MAX_NAME_ATTEMPTS = 5;

function temporaryMapName(): string {
  return `untitled-${randomBytes(4).toString("hex")}`;
}

async function assertDirectory(cwd: string): Promise<void> {
  const stat = await fs.stat(cwd).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new LogicMapDirectoryMissingError(cwd);
  }
}

/**
 * 在 cwd 下新建一张带临时名字的空图，返回图名。Agent 第一次写入时再定正式标题。
 */
export async function createEmptyLogicMap(cwd: string): Promise<string> {
  await assertDirectory(cwd);
  const mapsDir = path.join(cwd, LOGIC_MAPS_DIRECTORY);
  await fs.mkdir(mapsDir, { recursive: true });
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const mapName = temporaryMapName();
    const mapDir = path.join(mapsDir, mapName);
    try {
      // 不带 recursive：同名文件夹已存在时失败，换一个名字。
      await fs.mkdir(mapDir);
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") continue;
      throw error;
    }
    await writeJsonFileAtomic(path.join(mapDir, LOGIC_MAP_SKELETON_FILE), EMPTY_LOGIC_MAP_SKELETON);
    return mapName;
  }
  throw new LogicMapNameUnavailableError(mapsDir);
}

/** 某张图被改过；推送给客户端，让它重新读取。 */
export interface LogicMapChangedEvent {
  workspaceId: string;
  mapName: string;
}

export interface LogicMapLocation {
  /** workspace 目录。 */
  cwd: string;
  mapName: string;
}

export interface LogicMapUpdateResult {
  skeleton: LogicMapSkeleton;
  /** 照常写入了，但提醒 Agent 的事（某层节点太多）。 */
  warnings: string[];
}

function mapDirectory(location: LogicMapLocation): string {
  // 图名来自客户端或 Agent 标签，只认 docs/logic-maps 下的一级文件夹。
  const { mapName } = location;
  if (mapName === "." || mapName === ".." || /[/\\]/.test(mapName) || mapName.length === 0) {
    throw new LogicMapNotFoundError(mapName);
  }
  return path.join(location.cwd, LOGIC_MAPS_DIRECTORY, mapName);
}

function skeletonFileForDisplay(mapName: string): string {
  return `${LOGIC_MAPS_DIRECTORY}/${mapName}/${LOGIC_MAP_SKELETON_FILE}`;
}

function describeSchemaProblem(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

/** 读一张图的骨架；文件不在报 LogicMapNotFoundError，被改坏报 LogicMapCorruptError。 */
export async function readLogicMap(location: LogicMapLocation): Promise<LogicMapSkeleton> {
  const file = path.join(mapDirectory(location), LOGIC_MAP_SKELETON_FILE);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new LogicMapNotFoundError(location.mapName);
    }
    throw error;
  }
  const displayFile = skeletonFileForDisplay(location.mapName);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new LogicMapCorruptError(
      location.mapName,
      displayFile,
      `not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    return parseLogicMapSkeleton(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new LogicMapCorruptError(location.mapName, displayFile, describeSchemaProblem(error));
    }
    throw error;
  }
}

/** 确认图在（有骨架文件）；不在报 LogicMapNotFoundError。不校验内容，坏掉的图由读取时报告。 */
export async function assertLogicMapExists(location: LogicMapLocation): Promise<void> {
  const file = path.join(mapDirectory(location), LOGIC_MAP_SKELETON_FILE);
  try {
    await fs.access(file);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new LogicMapNotFoundError(location.mapName);
    }
    throw error;
  }
}

/** 列出 workspace 里的逻辑图（有骨架文件的文件夹），按图名排序；读不出来的图标题为 null。 */
export async function listLogicMaps(cwd: string): Promise<WorkspaceLogicMapSummary[]> {
  const mapsDir = path.join(cwd, LOGIC_MAPS_DIRECTORY);
  const entries = await fs.readdir(mapsDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  });
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<WorkspaceLogicMapSummary | null> => {
        try {
          const skeleton = await readLogicMap({ cwd, mapName: entry.name });
          return { name: entry.name, title: skeleton.title };
        } catch (error) {
          if (error instanceof LogicMapNotFoundError) return null;
          if (error instanceof LogicMapCorruptError) return { name: entry.name, title: null };
          throw error;
        }
      }),
  );
  return summaries
    .filter((summary): summary is WorkspaceLogicMapSummary => summary !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function checkExternalDoc(cwd: string, link: ExternalDocLink): Promise<string | null> {
  const where = `node "${link.nodeId}"`;
  const resolved = path.resolve(cwd, link.path);
  if (path.isAbsolute(link.path) || !isSameOrDescendantPath(path.resolve(cwd), resolved)) {
    return `${where}: ${link.path} is outside the workspace; use a path relative to the workspace root`;
  }
  let text: string;
  try {
    text = await fs.readFile(resolved, "utf8");
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return `${where}: ${link.path} does not exist`;
    }
    if (isErrnoException(error) && error.code === "EISDIR") {
      return `${where}: ${link.path} is a folder, not a file`;
    }
    throw error;
  }
  if (!markdownHeadings(text).includes(link.heading)) {
    return `${where}: ${link.path} has no heading "${link.heading}"`;
  }
  return null;
}

// 同一张图的更新排队执行：每次都在锁里读最新骨架再套增量，两个对话的改动都保留。
const mapUpdateQueues = new Map<string, Promise<unknown>>();

async function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = mapUpdateQueues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.catch(() => undefined);
  mapUpdateQueues.set(key, settled);
  try {
    return await run;
  } finally {
    if (mapUpdateQueues.get(key) === settled) mapUpdateQueues.delete(key);
  }
}

/** 文件写入前的样子：原内容，或 null 表示原来没有这个文件。 */
type FileSnapshot = Map<string, string | null>;

async function snapshotFiles(files: Iterable<string>): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = new Map();
  for (const file of new Set(files)) {
    try {
      snapshot.set(file, await fs.readFile(file, "utf8"));
    } catch (error) {
      if (!(isErrnoException(error) && error.code === "ENOENT")) throw error;
      snapshot.set(file, null);
    }
  }
  return snapshot;
}

async function restoreFiles(snapshot: FileSnapshot): Promise<void> {
  for (const [file, content] of snapshot) {
    if (content === null) {
      await fs.rm(file, { force: true });
    } else {
      await writeFileAtomic(file, content);
    }
  }
}

/**
 * 把一组增量操作套到图上：全部合格才写入，任何一条不合格整组拒绝（LogicMapUpdateRejectedError），磁盘不动。
 * 先写节点文档，再原子写骨架，最后删掉不再被引用的自有文档；中途写盘失败时把涉及的文件恢复原样再抛出。
 */
export async function updateLogicMap(
  location: LogicMapLocation,
  operations: readonly LogicMapOperation[],
): Promise<LogicMapUpdateResult> {
  const directory = mapDirectory(location);
  return runExclusive(path.resolve(directory), async () => {
    const current = await readLogicMap(location);
    const applied = applyLogicMapOperations(current, operations);
    const linkProblems = await Promise.all(
      applied.externalLinks.map((link) => checkExternalDoc(location.cwd, link)),
    );
    const problems = [
      ...applied.problems,
      ...linkProblems.filter((problem): problem is string => problem !== null),
    ];
    if (problems.length > 0) {
      throw new LogicMapUpdateRejectedError(problems);
    }
    const skeletonFile = path.join(directory, LOGIC_MAP_SKELETON_FILE);
    const docWrites = [...applied.docWrites].map(
      ([file, content]) => [path.join(directory, file), content] as const,
    );
    const docDeletes = applied.docDeletes.map((file) => path.join(directory, file));
    const snapshot = await snapshotFiles([
      ...docWrites.map(([file]) => file),
      skeletonFile,
      ...docDeletes,
    ]);
    try {
      for (const [file, content] of docWrites) {
        await writeFileAtomic(file, content);
      }
      await writeJsonFileAtomic(skeletonFile, applied.skeleton);
      for (const file of docDeletes) {
        await fs.rm(file, { force: true });
      }
    } catch (error) {
      await restoreFiles(snapshot);
      throw error;
    }
    return { skeleton: applied.skeleton, warnings: applied.warnings };
  });
}
