import path from "node:path";
import type { CodexAuthCommand } from "./codex-config-patch.js";

/*
 * Codex 用 model_providers.<id>.auth 执行一条命令拿 key：直接 exec、不经 shell、不展开 ~，
 * 读整段 stdout 再 trim，退出码非 0 或输出为空都算失败。需要 Codex 0.118.0+。
 */

const POSIX_TIMEOUT_MS = 5_000;
// PowerShell 冷启动可能超过 Codex 默认的 5 秒。
const WINDOWS_TIMEOUT_MS = 15_000;

export function buildCodexAuthCommand(input: {
  platform: NodeJS.Platform;
  keyFilePath: string;
  // Windows 的 %SystemRoot%；缺省 C:\Windows。
  systemRoot?: string;
}): CodexAuthCommand {
  if (input.platform !== "win32") {
    return { command: "/bin/cat", args: [input.keyFilePath], timeoutMs: POSIX_TIMEOUT_MS };
  }
  const systemRoot = input.systemRoot?.trim() || "C:\\Windows";
  // Write 不带换行、按文件原样输出；路径放进单引号字面量，里面的单引号要写两遍。
  const literalPath = `'${input.keyFilePath.replaceAll("'", "''")}'`;
  return {
    command: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `[Console]::Out.Write([System.IO.File]::ReadAllText(${literalPath}))`,
    ],
    timeoutMs: WINDOWS_TIMEOUT_MS,
  };
}
