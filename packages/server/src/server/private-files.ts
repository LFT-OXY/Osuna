import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

function applyPrivateMode(target: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(target, mode);
  } catch {
    // Permissions are not portable; creation must still work on such filesystems.
  }
}

export function ensurePrivateDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  applyPrivateMode(directoryPath, PRIVATE_DIRECTORY_MODE);
}

export function ensurePrivateFile(filePath: string): void {
  applyPrivateMode(filePath, PRIVATE_FILE_MODE);
}

export interface PrivateFileWriteOptions {
  // 把临时文件改名成目标；调用方可换成遇到占用会重试的（api-endpoints/last-good.ts）。
  rename?: (from: string, to: string) => void;
}

export function writePrivateFileAtomicSync(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  options: PrivateFileWriteOptions = {},
): void {
  const rename = options.rename ?? renameSync;
  ensurePrivateDirectory(path.dirname(filePath));
  const parent = path.dirname(filePath);
  const temporary = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}`);
  try {
    writeFileSync(temporary, data, { mode: PRIVATE_FILE_MODE });
    rename(temporary, filePath);
    ensurePrivateFile(filePath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
