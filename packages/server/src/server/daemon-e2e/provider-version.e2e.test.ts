import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

const tempRoots: string[] = [];

// 假 CLI 只认 --version，其余参数一律失败；真实 CLI 不在测试范围内。
// 它是 sh 脚本：Windows 上 execCommand 不经 shell 执行绝对路径，所以这组只在 POSIX 上跑。
describe.skipIf(process.platform === "win32")(
  "installed CLI version in the provider snapshot",
  () => {
    let root: string;
    let daemon: TestPaseoDaemon | undefined;
    let client: DaemonClient | undefined;
    // 桩 registry：按包名返回 latest；不在表里的包一律失败，于是意外的联网会变成可见的 error。
    const registry = new Map<string, string>();
    const fetchLatestVersion = async ({ npmPackage }: { npmPackage: string }) => {
      const latest = registry.get(npmPackage);
      if (!latest) throw new Error(`registry unreachable for ${npmPackage}`);
      return latest;
    };

    beforeEach(async () => {
      registry.clear();
      root = await mkdtemp(path.join(os.tmpdir(), "paseo-provider-version-"));
      tempRoots.push(root);
      await mkdir(path.join(root, "bin"));
    });

    afterEach(async () => {
      await client?.close();
      await daemon?.close();
      client = undefined;
      daemon = undefined;
      await Promise.all(
        tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
      );
    });

    async function writeFakeCli(name: string, versionOutput: string): Promise<string> {
      const file = path.join(root, "bin", name);
      await writeFile(
        file,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf '%s\\n' '${versionOutput}'\n  exit 0\nfi\nexit 1\n`,
      );
      await chmod(file, 0o755);
      return file;
    }

    // 用真实的提供方客户端（不注入假客户端），并关掉本机可能装着的其余内置提供方，避免探测真 CLI。
    async function startDaemon(
      providerOverrides: NonNullable<
        Parameters<typeof createTestPaseoDaemon>[0]
      >["providerOverrides"],
    ): Promise<void> {
      daemon = await createTestPaseoDaemon({
        agentClients: {},
        providerVersions: { fetchLatestVersion },
        providerOverrides: {
          codex: { enabled: false },
          pi: { enabled: false },
          omp: { enabled: false },
          ...providerOverrides,
        },
      });
      client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
      await client.connect();
    }

    // 等到这个提供方探测结束（不再是 loading），返回它的快照项。
    async function settledEntry(provider: string) {
      let entry:
        | Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>["entries"][number]
        | null = null;
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

    function claudeOverride(command: string) {
      return { command: [command], env: { CLAUDE_CONFIG_DIR: path.join(root, "claude") } };
    }

    test("an installed Claude Code reports its version", async () => {
      const claude = await writeFakeCli("claude", "2.1.280 (Claude Code)");
      await startDaemon({ claude: claudeOverride(claude) });

      expect(await settledEntry("claude")).toMatchObject({ status: "ready", version: "2.1.280" });
    });

    test("an unreadable version leaves the provider ready and omits the version", async () => {
      const claude = await writeFakeCli("claude", "Claude Code (dev build)");
      await startDaemon({ claude: claudeOverride(claude) });

      const entry = await settledEntry("claude");
      expect(entry.status).toBe("ready");
      expect(entry.version).toBeUndefined();
    });

    test("a built-in provider reports the version of the command configured for it", async () => {
      const copilot = await writeFakeCli(
        "copilot",
        "GitHub Copilot CLI 1.0.89.\nRun 'copilot update' to check for updates.",
      );
      // 配了 models 就不必启动 Copilot 拉模型，快照照样要带版本。
      await startDaemon({
        claude: { enabled: false },
        copilot: { enabled: true, command: [copilot], models: [{ id: "gpt-5", label: "GPT-5" }] },
      });

      expect(await settledEntry("copilot")).toMatchObject({ status: "ready", version: "1.0.89" });
    });

    test("an unreadable version from a built-in provider leaves it ready", async () => {
      const copilot = await writeFakeCli("copilot", "GitHub Copilot CLI (dev build)");
      await startDaemon({
        claude: { enabled: false },
        copilot: { enabled: true, command: [copilot], models: [{ id: "gpt-5", label: "GPT-5" }] },
      });

      const entry = await settledEntry("copilot");
      expect(entry.status).toBe("ready");
      expect(entry.version).toBeUndefined();
    });

    test("custom and disabled providers carry no version", async () => {
      const claude = await writeFakeCli("claude", "2.1.280 (Claude Code)");
      await startDaemon({
        claude: claudeOverride(claude),
        "work-claude": { extends: "claude", label: "Work Claude", ...claudeOverride(claude) },
      });

      const custom = await settledEntry("work-claude");
      expect(custom.status).toBe("ready");
      expect(custom.version).toBeUndefined();
      const disabled = await settledEntry("copilot");
      expect(disabled).toMatchObject({ enabled: false, status: "unavailable" });
      expect(disabled.version).toBeUndefined();
    });

    function copilotOverride(command: string) {
      return { enabled: true, command: [command], models: [{ id: "gpt-5", label: "GPT-5" }] };
    }

    test("reports the npm latest version and whether it is newer", async () => {
      registry.set("@anthropic-ai/claude-code", "2.1.285");
      const claude = await writeFakeCli("claude", "2.1.280 (Claude Code)");
      await startDaemon({ claude: claudeOverride(claude) });
      await settledEntry("claude");

      const { results } = await client!.checkProviderVersions({ providers: ["claude"] });

      expect(results).toEqual([
        {
          provider: "claude",
          installedVersion: "2.1.280",
          latestVersion: "2.1.285",
          updateAvailable: true,
        },
      ]);
    });

    test("an up-to-date CLI has no update", async () => {
      registry.set("@anthropic-ai/claude-code", "2.1.280");
      const claude = await writeFakeCli("claude", "2.1.280 (Claude Code)");
      await startDaemon({ claude: claudeOverride(claude) });
      await settledEntry("claude");

      const { results } = await client!.checkProviderVersions({ providers: ["claude"] });

      expect(results).toEqual([
        {
          provider: "claude",
          installedVersion: "2.1.280",
          latestVersion: "2.1.280",
          updateAvailable: false,
        },
      ]);
    });

    test("answers from the cache until force asks npm again", async () => {
      registry.set("@anthropic-ai/claude-code", "2.1.285");
      const claude = await writeFakeCli("claude", "2.1.280 (Claude Code)");
      await startDaemon({ claude: claudeOverride(claude) });
      await settledEntry("claude");
      await client!.checkProviderVersions({ providers: ["claude"] });

      // npm 上出了新版本；一小时内再查仍是缓存里的那个。
      registry.set("@anthropic-ai/claude-code", "2.1.290");
      const cached = await client!.checkProviderVersions({ providers: ["claude"] });
      expect(cached.results[0]?.latestVersion).toBe("2.1.285");

      const forced = await client!.checkProviderVersions({ providers: ["claude"], force: true });
      expect(forced.results[0]?.latestVersion).toBe("2.1.290");
    });

    test("a failed lookup only marks that provider", async () => {
      registry.set("@anthropic-ai/claude-code", "2.1.285");
      const claude = await writeFakeCli("claude", "2.1.280 (Claude Code)");
      const copilot = await writeFakeCli("copilot", "GitHub Copilot CLI 1.0.89.");
      await startDaemon({ claude: claudeOverride(claude), copilot: copilotOverride(copilot) });
      await settledEntry("claude");
      await settledEntry("copilot");

      const { results } = await client!.checkProviderVersions();
      const byProvider = new Map(results.map((result) => [result.provider, result]));

      expect(byProvider.get("claude")).toMatchObject({
        latestVersion: "2.1.285",
        updateAvailable: true,
      });
      expect(byProvider.get("copilot")).toMatchObject({
        installedVersion: "1.0.89",
        updateAvailable: false,
        error: "registry unreachable for @github/copilot",
      });
      expect(byProvider.get("copilot")?.latestVersion).toBeUndefined();
    });

    test("providers without an installed version are not looked up", async () => {
      const claude = await writeFakeCli("claude", "Claude Code (dev build)");
      await startDaemon({ claude: claudeOverride(claude) });
      await settledEntry("claude");

      const { results } = await client!.checkProviderVersions();

      // 读不出版本的 claude 和停用的 codex 都不去 registry，否则桩会给它们写上 error。
      expect(results.find((result) => result.provider === "claude")).toEqual({
        provider: "claude",
        updateAvailable: false,
      });
      expect(results.find((result) => result.provider === "codex")).toEqual({
        provider: "codex",
        updateAvailable: false,
      });
    });
  },
);
