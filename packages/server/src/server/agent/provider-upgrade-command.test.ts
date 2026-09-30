import { describe, expect, test } from "vitest";
import type { ProviderCliLaunch } from "./provider-cli-version.js";
import {
  clipUpgradeOutput,
  detectCodexInstallMethod,
  resolveProviderUpgradeCommand,
  type CodexInstallMethod,
  type ProviderUpgradeCommand,
} from "./provider-upgrade-command.js";

describe("resolveProviderUpgradeCommand", () => {
  test.each([
    ["claude", "/usr/local/bin/claude", ["update"]],
    ["copilot", "/Users/me/.local/bin/copilot", ["update"]],
    ["opencode", "/Users/me/.opencode/bin/opencode", ["upgrade"]],
    ["pi", "/opt/homebrew/bin/pi", ["update"]],
    ["omp", "/Users/me/.bun/bin/omp", ["update"]],
  ])("runs the %s CLI's own upgrade subcommand", (provider, executable, args) => {
    expect(
      resolveProviderUpgradeCommand({
        provider,
        launch: { executable, args: [], source: "default" },
        executableRealPath: executable,
        platform: "darwin",
      }),
    ).toEqual({ kind: "run", command: executable, args });
  });

  test("keeps the argv of a replaced command in front of the subcommand", () => {
    expect(
      resolveProviderUpgradeCommand({
        provider: "pi",
        launch: { executable: "/usr/bin/node", args: ["/opt/pi/cli.js"], source: "override" },
        executableRealPath: "/usr/bin/node",
        platform: "linux",
      }),
    ).toEqual({ kind: "run", command: "/usr/bin/node", args: ["/opt/pi/cli.js", "update"] });
  });

  test("drops appended session arguments so the subcommand is not read as a prompt", () => {
    expect(
      resolveProviderUpgradeCommand({
        provider: "claude",
        launch: {
          executable: "/usr/local/bin/claude",
          args: ["--dangerously-skip-permissions"],
          source: "append",
        },
        executableRealPath: "/usr/local/bin/claude",
        platform: "darwin",
      }),
    ).toEqual({ kind: "run", command: "/usr/local/bin/claude", args: ["update"] });
  });

  test.each(["work-claude", "minimax-code"])("has no upgrade command for %s", (provider) => {
    const expected: ProviderUpgradeCommand = { kind: "unsupported" };
    expect(
      resolveProviderUpgradeCommand({
        provider,
        launch: { executable: "/usr/local/bin/cli", args: [], source: "default" },
        executableRealPath: "/usr/local/bin/cli",
        platform: "darwin",
      }),
    ).toEqual(expected);
  });
});

describe("detectCodexInstallMethod", () => {
  test.each<[string, NodeJS.Platform, string, CodexInstallMethod]>([
    [
      "the standalone installer on macOS",
      "darwin",
      "/Users/me/.codex/packages/standalone/releases/0.130.0-aarch64-apple-darwin/bin/codex",
      { method: "standalone", codexHome: "/Users/me/.codex" },
    ],
    [
      "the standalone installer with a custom CODEX_HOME",
      "linux",
      "/srv/codex-home/packages/standalone/releases/0.130.0-x86_64-unknown-linux-musl/codex",
      { method: "standalone", codexHome: "/srv/codex-home" },
    ],
    [
      "the standalone installer on Windows",
      "win32",
      "C:\\Users\\me\\.codex\\packages\\standalone\\releases\\0.130.0-x86_64-pc-windows-msvc\\bin\\codex.exe",
      { method: "standalone", codexHome: "C:\\Users\\me\\.codex" },
    ],
    [
      "the Homebrew cask on Apple Silicon",
      "darwin",
      "/opt/homebrew/Caskroom/codex/0.130.0/codex-aarch64-apple-darwin",
      { method: "homebrew", prefix: "/opt/homebrew" },
    ],
    [
      "the Homebrew cask on Intel",
      "darwin",
      "/usr/local/Caskroom/codex/0.130.0/codex-x86_64-apple-darwin",
      { method: "homebrew", prefix: "/usr/local" },
    ],
    // 只有 cask 能用 `brew upgrade --cask codex`；手放的和 formula 版都交给用户自己升级。
    [
      "a binary put in /usr/local/bin by hand",
      "darwin",
      "/usr/local/bin/codex",
      { method: "unknown" },
    ],
    [
      "the Homebrew formula",
      "darwin",
      "/opt/homebrew/Cellar/codex/0.130.0/bin/codex",
      { method: "unknown" },
    ],
    [
      "npm under a Homebrew node, not the Homebrew cask",
      "darwin",
      "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js",
      { method: "npm", prefix: "/opt/homebrew" },
    ],
    [
      "npm under the official node installer",
      "darwin",
      "/usr/local/lib/node_modules/@openai/codex/bin/codex.js",
      { method: "npm", prefix: "/usr/local" },
    ],
    [
      "npm under nvm",
      "linux",
      "/home/me/.nvm/versions/node/v22.12.0/lib/node_modules/@openai/codex/bin/codex.js",
      { method: "npm", prefix: "/home/me/.nvm/versions/node/v22.12.0" },
    ],
    [
      "npm on Windows, through its package",
      "win32",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
      { method: "npm", prefix: "C:\\Users\\me\\AppData\\Roaming\\npm" },
    ],
    [
      "npm on Windows, through its command shim",
      "win32",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
      { method: "npm", prefix: "C:\\Users\\me\\AppData\\Roaming\\npm" },
    ],
    [
      "the Microsoft Store app",
      "win32",
      "C:\\Users\\me\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\OpenAI\\Codex\\bin\\codex.exe",
      { method: "unknown" },
    ],
    [
      "bun, whose global directory is not npm's",
      "darwin",
      "/Users/me/.bun/install/global/node_modules/@openai/codex/bin/codex.js",
      { method: "unknown" },
    ],
    [
      "pnpm, whose global directory is not npm's",
      "darwin",
      "/Users/me/Library/pnpm/global/5/.pnpm/@openai+codex@0.130.0/node_modules/@openai/codex/bin/codex.js",
      { method: "unknown" },
    ],
    ["a binary copied by hand", "linux", "/home/me/bin/codex", { method: "unknown" }],
    // Linux 上的 Homebrew 不在这两个前缀下；上游也只在 macOS 上认 Homebrew。
    ["a /usr/local binary on Linux", "linux", "/usr/local/bin/codex", { method: "unknown" }],
  ])("recognizes %s", (_name, platform, realPath, expected) => {
    expect(detectCodexInstallMethod({ realPath, platform })).toEqual(expected);
  });
});

describe("resolveProviderUpgradeCommand for codex", () => {
  function resolveCodex(input: {
    realPath: string;
    platform: NodeJS.Platform;
    launch?: Pick<ProviderCliLaunch, "executable" | "args" | "source">;
  }): ProviderUpgradeCommand {
    return resolveProviderUpgradeCommand({
      provider: "codex",
      launch: input.launch ?? { executable: "/somewhere/codex", args: [], source: "default" },
      executableRealPath: input.realPath,
      platform: input.platform,
    });
  }

  test("reruns the official install script without prompts for a standalone install", () => {
    expect(
      resolveCodex({
        realPath:
          "/Users/me/.codex/packages/standalone/releases/0.130.0-aarch64-apple-darwin/codex",
        platform: "darwin",
      }),
    ).toEqual({
      kind: "run",
      command: "sh",
      args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh"],
      env: { CODEX_HOME: "/Users/me/.codex" },
    });
  });

  test("reinstalls into the CODEX_HOME the install already uses", () => {
    // CODEX_HOME 改过时，脚本的缺省值会把新版装到 ~/.codex，留下第二份。
    expect(
      resolveCodex({
        realPath:
          "/srv/codex-home/packages/standalone/releases/0.130.0-x86_64-unknown-linux-musl/codex",
        platform: "linux",
      }),
    ).toEqual({
      kind: "run",
      command: "sh",
      args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh"],
      env: { CODEX_HOME: "/srv/codex-home" },
    });
  });

  test("reruns the official PowerShell install script for a standalone install on Windows", () => {
    expect(
      resolveCodex({
        realPath:
          "C:\\Users\\me\\.codex\\packages\\standalone\\releases\\0.130.0-x86_64-pc-windows-msvc\\codex.exe",
        platform: "win32",
      }),
    ).toEqual({
      kind: "run",
      command: "powershell",
      args: [
        "-ExecutionPolicy",
        "Bypass",
        "-c",
        "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex",
      ],
      env: { CODEX_HOME: "C:\\Users\\me\\.codex" },
    });
  });

  test.each([
    ["/opt/homebrew/Caskroom/codex/0.130.0/codex-aarch64-apple-darwin", "/opt/homebrew/bin/brew"],
    ["/usr/local/Caskroom/codex/0.130.0/codex-x86_64-apple-darwin", "/usr/local/bin/brew"],
  ])("upgrades the Homebrew cask with the brew of its prefix (%s)", (realPath, brew) => {
    expect(resolveCodex({ realPath, platform: "darwin" })).toEqual({
      kind: "run",
      command: brew,
      args: ["upgrade", "--cask", "codex"],
    });
  });

  test("reinstalls the latest npm package into the prefix codex was installed in", () => {
    // PATH 上的 npm 可能属于另一个 node；指定前缀才不会装出第二份。
    expect(
      resolveCodex({
        realPath:
          "/Users/me/.nvm/versions/node/v22.12.0/lib/node_modules/@openai/codex/bin/codex.js",
        platform: "darwin",
      }),
    ).toEqual({
      kind: "run",
      command: "npm",
      args: [
        "install",
        "-g",
        "--prefix",
        "/Users/me/.nvm/versions/node/v22.12.0",
        "@openai/codex@latest",
      ],
    });
  });

  test("gives up when it cannot tell how codex was installed", () => {
    expect(resolveCodex({ realPath: "/home/me/bin/codex", platform: "linux" })).toEqual({
      kind: "install_method_unknown",
    });
  });

  test("gives up when a replaced command runs codex through an interpreter", () => {
    // 可执行文件是 node 这类解释器，看它的路径判断不出 codex 是怎么装的。
    expect(
      resolveCodex({
        realPath: "/opt/homebrew/Cellar/node/22.12.0/bin/node",
        platform: "darwin",
        launch: {
          executable: "/opt/homebrew/bin/node",
          args: ["/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"],
          source: "override",
        },
      }),
    ).toEqual({ kind: "install_method_unknown" });
  });
});

describe("clipUpgradeOutput", () => {
  test("keeps short output as is", () => {
    expect(clipUpgradeOutput("updated to 1.2.3\n", 100)).toBe("updated to 1.2.3\n");
  });

  test("keeps the end of long output behind a marker", () => {
    expect(clipUpgradeOutput("0123456789", 4)).toBe("…\n6789");
  });
});
