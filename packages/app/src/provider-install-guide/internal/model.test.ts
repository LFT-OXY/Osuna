import { describe, expect, it } from "vitest";
import { resolveProviderInstallGuide, type ProviderInstallGuide } from "./model";

function requireGuide(guide: ProviderInstallGuide | null): ProviderInstallGuide {
  if (!guide) throw new Error("Expected install and upgrade data");
  return guide;
}

function builtinGuide(provider: string, hostPlatform: string | undefined): ProviderInstallGuide {
  return requireGuide(resolveProviderInstallGuide({ provider, hostPlatform }));
}

function methodLabels(guide: ProviderInstallGuide): string[] {
  return guide.methods.map((method) => method.label);
}

function methodCommands(method: ProviderInstallGuide["methods"][number]): string[] {
  return [...method.install, ...method.upgrade].map((entry) => entry.command);
}

// 空命令，或首尾带空白的命令，复制出去不能直接执行。
function isNotPasteReady(command: string): boolean {
  return command.trim() !== command || command.length === 0;
}

function upgradeCommands(method: ProviderInstallGuide["methods"][number]): string[] {
  return method.upgrade.map((entry) => entry.command);
}

describe("resolveProviderInstallGuide", () => {
  it.each([
    [
      "claude",
      ["macOS/Linux", "Windows", "Homebrew", "WinGet", "npm"],
      "https://code.claude.com/docs/en/setup",
    ],
    [
      "codex",
      ["macOS/Linux", "Windows", "npm", "Homebrew"],
      "https://learn.chatgpt.com/docs/codex/cli",
    ],
    [
      "copilot",
      ["npm", "WinGet", "Homebrew", "Install script"],
      "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
    ],
    [
      "opencode",
      ["Install script", "npm", "Bun", "pnpm", "Homebrew", "Chocolatey", "Scoop"],
      "https://opencode.ai/docs/#install",
    ],
    [
      "pi",
      ["curl", "PowerShell", "npm", "pnpm", "bun", "Nix"],
      "https://github.com/earendil-works/pi",
    ],
    [
      "omp",
      ["macOS · Linux", "Windows (PowerShell)", "Homebrew", "Bun", "mise"],
      "https://github.com/can1357/oh-my-pi#install",
    ],
  ])("lists the official install methods and docs for %s", (provider, labels, docsUrl) => {
    const guide = builtinGuide(provider, "linux");

    expect(methodLabels(guide)).toEqual(labels);
    expect(guide.docsUrl).toBe(docsUrl);
    expect(guide.provider).toBe(provider);
  });

  it.each(["claude", "codex", "copilot", "opencode", "pi", "omp"])(
    "gives every %s install method a distinct tab with install and upgrade commands",
    (provider) => {
      const guide = builtinGuide(provider, "linux");

      const ids = guide.methods.map((method) => method.id);
      const commands = guide.methods.flatMap(methodCommands);

      expect(ids).toEqual([...new Set(ids)]);
      expect(commands.filter(isNotPasteReady)).toEqual([]);
    },
  );

  it.each([
    ["claude", "darwin", "macOS/Linux"],
    ["claude", "linux", "macOS/Linux"],
    ["claude", "win32", "Windows"],
    ["codex", "win32", "Windows"],
    ["copilot", "darwin", "npm"],
    ["copilot", "win32", "npm"],
    ["opencode", "linux", "Install script"],
    ["opencode", "win32", "npm"],
    ["pi", "darwin", "curl"],
    ["pi", "win32", "PowerShell"],
    ["omp", "win32", "Windows (PowerShell)"],
  ])(
    "opens %s on a %s host at the first method that applies: %s",
    (provider, hostPlatform, label) => {
      expect(builtinGuide(provider, hostPlatform).defaultMethod.label).toBe(label);
    },
  );

  it.each([undefined, "freebsd", "aix", ""])(
    "opens at the first method when the host reports %s",
    (hostPlatform) => {
      expect(builtinGuide("claude", hostPlatform).defaultMethod.label).toBe("macOS/Linux");
      expect(builtinGuide("copilot", hostPlatform).defaultMethod.label).toBe("npm");
      expect(builtinGuide("pi", hostPlatform).defaultMethod.label).toBe("curl");
    },
  );

  it("installs Pi on Windows with the official PowerShell script", () => {
    const method = builtinGuide("pi", "win32").defaultMethod;

    expect(method.install).toEqual([
      { label: null, command: 'powershell -c "irm https://pi.dev/install.ps1 | iex"' },
    ]);
    expect(method.upgrade).toEqual([{ label: null, command: "pi update" }]);
  });

  it("upgrades a Nix-installed Pi through Nix", () => {
    const nix = builtinGuide("pi", "linux").methods.find((method) => method.label === "Nix");

    expect(nix?.upgrade).toEqual([{ label: null, command: "nix profile upgrade pi" }]);
  });

  it("offers Claude Code on Windows as PowerShell and CMD, upgraded by the CLI itself", () => {
    const method = builtinGuide("claude", "win32").defaultMethod;

    expect(method.install).toEqual([
      { label: "PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
      {
        label: "CMD",
        command:
          "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
      },
    ]);
    expect(method.upgrade).toEqual([{ label: null, command: "claude update" }]);
  });

  it("pairs each Claude Code install method with the upgrade command for that method", () => {
    const upgrades = builtinGuide("claude", "darwin").methods.map((method) => [
      method.label,
      upgradeCommands(method),
    ]);

    expect(upgrades).toEqual([
      ["macOS/Linux", ["claude update"]],
      ["Windows", ["claude update"]],
      ["Homebrew", ["brew upgrade claude-code"]],
      ["WinGet", ["winget upgrade Anthropic.ClaudeCode"]],
      ["npm", ["npm install -g @anthropic-ai/claude-code@latest"]],
    ]);
  });

  it("upgrades Codex with the commands from the official Update tabs", () => {
    const upgrades = builtinGuide("codex", "darwin").methods.map(upgradeCommands);

    expect(upgrades).toEqual([
      ["curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
      ['powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'],
      ["npm install -g @openai/codex"],
      ["brew upgrade --cask codex"],
    ]);
  });

  it.each([
    ["copilot", "copilot update"],
    ["opencode", "opencode upgrade"],
    ["omp", "omp update"],
  ])("upgrades every %s install method with %s", (provider, command) => {
    for (const method of builtinGuide(provider, "linux").methods) {
      expect(method.upgrade).toEqual([{ label: null, command }]);
    }
  });

  it("uses the extended built-in provider's guide for a custom provider", () => {
    const custom = requireGuide(
      resolveProviderInstallGuide({
        provider: "my-claude",
        extendsProvider: "claude",
        hostPlatform: "win32",
      }),
    );
    const builtin = builtinGuide("claude", "win32");

    expect(custom.provider).toBe("claude");
    expect(custom.isInherited).toBe(true);
    expect(builtin.isInherited).toBe(false);
    expect(custom.methods).toEqual(builtin.methods);
    expect(custom.docsUrl).toBe(builtin.docsUrl);
    expect(custom.defaultMethod).toEqual(builtin.defaultMethod);
  });

  it.each([
    ["acp", "acp"],
    ["an unknown id", "not-a-provider"],
    ["an object key", "constructor"],
    ["nothing", undefined],
  ])(
    "has no install and upgrade data for a custom provider extending %s",
    (_name, extendsProvider) => {
      expect(
        resolveProviderInstallGuide({
          provider: "my-agent",
          extendsProvider,
          hostPlatform: "linux",
        }),
      ).toBeNull();
    },
  );

  it.each(["acp", "unknown-provider", "constructor", "toString"])(
    "has no install and upgrade data for the provider id %s",
    (provider) => {
      expect(resolveProviderInstallGuide({ provider, hostPlatform: "darwin" })).toBeNull();
    },
  );

  it("ignores extends on a built-in provider", () => {
    const guide = requireGuide(
      resolveProviderInstallGuide({
        provider: "codex",
        extendsProvider: "claude",
        hostPlatform: "linux",
      }),
    );

    expect(guide).toEqual(builtinGuide("codex", "linux"));
  });
});
