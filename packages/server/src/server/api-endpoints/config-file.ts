import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { PRIVATE_FILE_MODE } from "../private-files.js";

const CONFIG_WRITE_ATTEMPTS = 3;

export type ConfigFileChange =
  | { kind: "write"; text: string }
  | { kind: "delete" }
  // 文件本身不用动，但接管记录照样要更新（例如恢复时文件已经不在了）。
  | { kind: "keep" };

export interface ConfigFilePlan<T> {
  change: ConfigFileChange;
  value: T;
}

export type GuardedConfigWriteResult<T> = { kind: "written"; value: T } | { kind: "conflict" };

/**
 * 改写 CLI 自己的配置文件，不覆盖别人同时做的改动（ADR 0004）：记下文件的 hash 再算新内容，
 * 替换前一刻重读一次；变了就基于新内容重算，最多三次，仍在变就放弃，什么都不写。
 * `compute` 抛出的错误（例如无法解析）原样抛出。
 * `commit` 在重读之前调用，用来先落接管记录，这样比对通过后紧接着就是替换；
 * 比对不通过、commit 或替换失败时调用 `rollback`。
 */
export function writeConfigFileGuarded<T>(input: {
  filePath: string;
  compute: (current: Buffer | null) => ConfigFilePlan<T>;
  commit: (value: T) => void;
  rollback: () => void;
  // commit 之后、重读之前调用；只给测试模拟并发改动用。
  beforeRecheck?: (filePath: string) => void;
}): GuardedConfigWriteResult<T> {
  const { filePath } = input;
  for (let attempt = 0; attempt < CONFIG_WRITE_ATTEMPTS; attempt += 1) {
    const current = readOptionalFile(filePath);
    const { change, value } = input.compute(current);
    const staged = change.kind === "write" ? stageConfigFile(filePath, change.text) : null;
    try {
      try {
        input.commit(value);
        input.beforeRecheck?.(filePath);
        if (digest(readOptionalFile(filePath)) !== digest(current)) {
          input.rollback();
          continue;
        }
        if (staged) renameSync(staged, filePath);
        if (change.kind === "delete") rmSync(filePath, { force: true });
      } catch (error) {
        input.rollback();
        throw error;
      }
      return { kind: "written", value };
    } finally {
      // 替换成功后临时文件已经不在了；其余情况把它清掉。
      if (staged) rmSync(staged, { force: true });
    }
  }
  return { kind: "conflict" };
}

export function readOptionalFile(filePath: string): Buffer | null {
  try {
    return readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function digest(bytes: Buffer | null): string {
  return bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex");
}

/**
 * 在同一目录写好临时文件，等比对通过后再 rename，替换是原子的。
 * 保留原有权限位、不动所在目录的权限；新建的文件含 token，按 0600 创建。
 */
function stageConfigFile(filePath: string, text: string): string {
  const mode = readOptionalMode(filePath) ?? PRIVATE_FILE_MODE;
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}`,
  );
  try {
    writeFileSync(temporary, text, { mode });
    // writeFileSync 的 mode 会被 umask 削掉，显式再设一次。
    if (process.platform !== "win32") chmodSync(temporary, mode);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return temporary;
}

function readOptionalMode(filePath: string): number | null {
  try {
    return statSync(filePath).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
