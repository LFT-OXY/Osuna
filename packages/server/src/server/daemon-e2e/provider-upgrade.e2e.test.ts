import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

const tempRoots: string[] = [];

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// 假 Claude CLI：`--version` 读版本文件，`update` 记下参数后执行测试给的脚本片段，其余参数一律失败。
// 真实的升级命令不在测试范围内。它是 sh 脚本，所以这组只在 POSIX 上跑。
describe.skipIf(process.platform === "win32")("one-click provider CLI upgrade", () => {
  let root: string;
  let daemon: TestPaseoDaemon | undefined;
  let client: DaemonClient | undefined;
  // 桩 registry：按包名返回 latest，不真的联网。
  const registry = new Map<string, string>();
  const fetchLatestVersion = async ({ npmPackage }: { npmPackage: string }) => {
    const latest = registry.get(npmPackage);
    if (!latest) throw new Error(`registry unreachable for ${npmPackage}`);
    return latest;
  };

  beforeEach(async () => {
    registry.clear();
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-provider-upgrade-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "bin"));
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    client = undefined;
    daemon = undefined;
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function file(name: string): string {
    return path.join(root, name);
  }

  async function writeFakeClaude(input: { version: string; onUpdate: string }): Promise<string> {
    await writeFile(file("claude.version"), input.version);
    const cli = path.join(root, "bin", "claude");
    await writeFile(
      cli,
      [
        "#!/bin/sh",
        `VERSION_FILE='${file("claude.version")}'`,
        'if [ "$1" = "--version" ]; then',
        '  printf \'%s (Claude Code)\\n\' "$(cat "$VERSION_FILE")"',
        "  exit 0",
        "fi",
        'if [ "$1" = "update" ]; then',
        `  printf '%s\\n' "$*" >> '${file("claude.calls")}'`,
        input.onUpdate,
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    await chmod(cli, 0o755);
    return cli;
  }

  // 用真实的提供方客户端，并关掉本机可能装着的其余内置提供方，避免探测真 CLI。
  async function startDaemon(input: {
    claude: string;
    upgradeTimeoutMs?: number;
    extraProviders?: NonNullable<
      NonNullable<Parameters<typeof createTestPaseoDaemon>[0]>["providerOverrides"]
    >;
  }): Promise<void> {
    daemon = await createTestPaseoDaemon({
      agentClients: {},
      providerVersions: { fetchLatestVersion, upgradeTimeoutMs: input.upgradeTimeoutMs },
      providerOverrides: {
        codex: { enabled: false },
        pi: { enabled: false },
        omp: { enabled: false },
        claude: { command: [input.claude], env: { CLAUDE_CONFIG_DIR: file("claude-config") } },
        ...input.extraProviders,
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
  }

  async function settledEntry(provider: string) {
    let entry: Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>["entries"][number] | null =
      null;
    await expect
      .poll(
        async () => {
          const snapshot = await client!.getProvidersSnapshot();
          entry = snapshot.entries.find((candidate) => candidate.provider === provider) ?? null;
          return entry?.status;
        },
        { timeout: 15_000 },
      )
      .not.toBe("loading");
    return entry!;
  }

  async function snapshotVersion(provider: string): Promise<string | undefined> {
    const snapshot = await client!.getProvidersSnapshot();
    return snapshot.entries.find((entry) => entry.provider === provider)?.version;
  }

  test("runs the CLI's own update and reports the new version", async () => {
    registry.set("@anthropic-ai/claude-code", "2.1.285");
    const claude = await writeFakeClaude({
      version: "2.1.280",
      onUpdate: [
        "  echo 'Checking for updates...'",
        `  printf '2.1.285' > "$VERSION_FILE"`,
        "  echo 'Successfully updated to 2.1.285'",
      ].join("\n"),
    });
    await startDaemon({ claude });
    await settledEntry("claude");
    const before = await client!.checkProviderVersions({ providers: ["claude"] });
    expect(before.results[0]).toMatchObject({ installedVersion: "2.1.280", updateAvailable: true });

    const result = await client!.upgradeProvider({ provider: "claude" });

    expect(result).toMatchObject({ provider: "claude", ok: true, version: "2.1.285" });
    expect(result.output).toContain("Successfully updated to 2.1.285");
    expect(await readFile(file("claude.calls"), "utf8")).toBe("update\n");
    expect(await snapshotVersion("claude")).toBe("2.1.285");
  });

  test("forgets the cached latest version once the upgrade finishes", async () => {
    registry.set("@anthropic-ai/claude-code", "2.1.285");
    const claude = await writeFakeClaude({
      version: "2.1.280",
      onUpdate: `  printf '2.1.285' > "$VERSION_FILE"`,
    });
    await startDaemon({ claude });
    await settledEntry("claude");
    await client!.checkProviderVersions({ providers: ["claude"] });

    // npm 上又出了新版本；升级前的缓存不该再用，不带 force 也要重新查。
    registry.set("@anthropic-ai/claude-code", "2.1.290");
    await client!.upgradeProvider({ provider: "claude" });
    const after = await client!.checkProviderVersions({ providers: ["claude"] });

    expect(after.results).toEqual([
      {
        provider: "claude",
        installedVersion: "2.1.285",
        latestVersion: "2.1.290",
        updateAvailable: true,
      },
    ]);
  });

  test("returns the raw output when the command fails", async () => {
    const claude = await writeFakeClaude({
      version: "2.1.280",
      onUpdate: [
        "  echo 'Checking for updates...'",
        "  echo 'EACCES: permission denied, open /usr/local/lib' >&2",
        "  exit 1",
      ].join("\n"),
    });
    await startDaemon({ claude });
    await settledEntry("claude");

    const result = await client!.upgradeProvider({ provider: "claude" });

    expect(result).toMatchObject({
      provider: "claude",
      ok: false,
      errorCode: "command_failed",
      version: "2.1.280",
    });
    expect(result.output).toBe(
      "Checking for updates...\nEACCES: permission denied, open /usr/local/lib\n",
    );
    expect(await snapshotVersion("claude")).toBe("2.1.280");
  });

  test("refuses a second upgrade of the same provider while one is running", async () => {
    const claude = await writeFakeClaude({
      version: "2.1.280",
      onUpdate: [
        `  touch '${file("started")}'`,
        `  while [ ! -f '${file("release")}' ]; do sleep 0.05; done`,
        `  printf '2.1.285' > "$VERSION_FILE"`,
      ].join("\n"),
    });
    await startDaemon({ claude });
    await settledEntry("claude");

    const first = client!.upgradeProvider({ provider: "claude" });
    await expect.poll(() => exists(file("started")), { timeout: 10_000 }).toBe(true);
    const second = await client!.upgradeProvider({ provider: "claude" });
    await writeFile(file("release"), "");

    expect(second).toMatchObject({ provider: "claude", ok: false, errorCode: "in_progress" });
    expect(second.output).toBeUndefined();
    expect(await first).toMatchObject({ ok: true, version: "2.1.285" });
    expect(await readFile(file("claude.calls"), "utf8")).toBe("update\n");
  });

  test("stops a command that runs past the timeout and keeps what it printed", async () => {
    const claude = await writeFakeClaude({
      version: "2.1.280",
      onUpdate: ["  echo 'Downloading 2.1.285...'", "  sleep 30"].join("\n"),
    });
    await startDaemon({ claude, upgradeTimeoutMs: 1_000 });
    await settledEntry("claude");

    const result = await client!.upgradeProvider({ provider: "claude" });

    expect(result).toMatchObject({ provider: "claude", ok: false, errorCode: "timeout" });
    expect(result.output).toBe("Downloading 2.1.285...\n");
  });

  test("answers once the CLI exits even if a process it left behind holds the output open", async () => {
    // 自更新常见的做法：留一个后台进程收尾，它继承了 stdout，管道要等它退出才关。
    const claude = await writeFakeClaude({
      version: "2.1.280",
      onUpdate: [
        `  printf '2.1.285' > "$VERSION_FILE"`,
        "  echo 'Updated; cleaning up in the background'",
        "  sleep 30 &",
      ].join("\n"),
    });
    await startDaemon({ claude });
    await settledEntry("claude");

    const result = await client!.upgradeProvider({ provider: "claude" });

    expect(result).toMatchObject({ provider: "claude", ok: true, version: "2.1.285" });
    expect(result.output).toContain("Updated; cleaning up in the background");
  }, 20_000);

  test("codex has no upgrade command yet", async () => {
    // Codex 没有自带的升级命令，要按安装方式选；在支持之前一律回"不支持"。
    const claude = await writeFakeClaude({ version: "2.1.280", onUpdate: "  exit 0" });
    await startDaemon({ claude });
    await settledEntry("codex");

    const result = await client!.upgradeProvider({ provider: "codex" });

    expect(result).toMatchObject({ provider: "codex", ok: false, errorCode: "unsupported" });
  });

  test("a custom provider cannot be upgraded", async () => {
    const claude = await writeFakeClaude({ version: "2.1.280", onUpdate: "  exit 0" });
    await startDaemon({
      claude,
      extraProviders: {
        "work-claude": { extends: "claude", label: "Work Claude", command: [claude] },
      },
    });
    await settledEntry("work-claude");

    const result = await client!.upgradeProvider({ provider: "work-claude" });

    expect(result).toMatchObject({ provider: "work-claude", ok: false, errorCode: "unsupported" });
    await expect(readFile(file("claude.calls"), "utf8")).rejects.toThrow();
  });
});
