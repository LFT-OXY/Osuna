import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodexAuthCommand } from "./codex-auth-command.js";

const execFileAsync = promisify(execFile);

describe("buildCodexAuthCommand", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  // Codex 不经 shell 直接执行这条命令；这里同样用 execFile，在 CI 的 Windows 任务上跑 PowerShell 版本。
  it("prints the key file exactly on this platform, even with a space and a quote in the path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo codex-auth '"));
    roots.push(root);
    const keyFilePath = path.join(root, "codex-api-key");
    const key = "sk-or-v1-0123456789abcdef";
    await writeFile(keyFilePath, key);

    const auth = buildCodexAuthCommand({
      platform: process.platform,
      keyFilePath,
      systemRoot: process.env.SystemRoot,
    });
    const { stdout } = await execFileAsync(auth.command, auth.args, {
      timeout: auth.timeoutMs,
      windowsHide: true,
    });

    expect(stdout).toBe(key);
  });

  it("uses the system cat on macOS and Linux", () => {
    expect(buildCodexAuthCommand({ platform: "linux", keyFilePath: "/home/me/key" })).toEqual({
      command: "/bin/cat",
      args: ["/home/me/key"],
      timeoutMs: 5000,
    });
  });

  it("uses PowerShell by absolute path on Windows with a longer timeout", () => {
    expect(
      buildCodexAuthCommand({
        platform: "win32",
        keyFilePath: "C:\\Users\\O'Brien\\.paseo\\api-endpoints\\codex-api-key",
        systemRoot: "D:\\Win",
      }),
    ).toEqual({
      command: "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::Out.Write([System.IO.File]::ReadAllText('C:\\Users\\O''Brien\\.paseo\\api-endpoints\\codex-api-key'))",
      ],
      timeoutMs: 15000,
    });
  });
});
