import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isErrnoException } from "../../utils/errno.js";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { LogicMapDirectoryMissingError, LogicMapNameUnavailableError } from "./logic-map-errors.js";
import { EMPTY_LOGIC_MAP_SKELETON } from "./logic-map-skeleton.js";

/** 逻辑图跟着 workspace 的 cwd 走，随代码进版本记录。 */
export const LOGIC_MAPS_DIRECTORY = "docs/logic-maps";
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
