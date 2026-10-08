/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ProviderInstallGuideSurface, resolveProviderInstallGuide } from "./index";

interface GuideTarget {
  provider?: string;
  extendsProvider?: string;
  hostPlatform: string | undefined;
}

interface SurfaceInput extends GuideTarget {
  cliLabel?: string;
}

function requireGuide({ provider = "claude", extendsProvider, hostPlatform }: GuideTarget) {
  const guide = resolveProviderInstallGuide({ provider, extendsProvider, hostPlatform });
  if (!guide) throw new Error(`Expected install and upgrade data for ${provider}`);
  return guide;
}

function renderSurface({ cliLabel = "Claude Code", ...target }: SurfaceInput) {
  const onCopyCommand = vi.fn();
  const onOpenDocs = vi.fn();
  function surface(next: GuideTarget) {
    return (
      <ProviderInstallGuideSurface
        guide={requireGuide(next)}
        cliLabel={cliLabel}
        onCopyCommand={onCopyCommand}
        onOpenDocs={onOpenDocs}
      />
    );
  }
  const { rerender } = render(surface(target));
  return { onCopyCommand, onOpenDocs, rerender: (next: GuideTarget) => rerender(surface(next)) };
}

function shownCommands(testID: string): string[] {
  return screen.queryAllByTestId(testID).map((node) => node.textContent ?? "");
}

function installCommands(): string[] {
  return shownCommands("provider-install-command");
}

function upgradeCommands(): string[] {
  return shownCommands("provider-upgrade-command");
}

function methodTab(id: string) {
  return screen.getByTestId(`provider-install-method-${id}`);
}

// 按文档顺序列出一个区块里用户能读到的每段文字。
function shownTexts(testID: string): string[] {
  const walker = document.createTreeWalker(screen.getByTestId(testID), NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  while (walker.nextNode()) {
    texts.push(walker.currentNode.textContent ?? "");
  }
  return texts;
}

function selectedMethods(): string[] {
  return within(screen.getByTestId("provider-install-methods"))
    .getAllByRole("button")
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.textContent ?? "");
}

describe("ProviderInstallGuideSurface", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens on the host's install method with its install and upgrade commands", () => {
    renderSurface({ hostPlatform: "darwin" });

    expect(selectedMethods()).toEqual(["macOS/Linux"]);
    expect(shownTexts("provider-install-guide")).toEqual([
      "Install and upgrade",
      "macOS/Linux",
      "Windows",
      "Homebrew",
      "WinGet",
      "npm",
      "Install",
      "curl -fsSL https://claude.ai/install.sh | bash",
      "Copy",
      "Upgrade",
      "claude update",
      "Copy",
      "Run on the machine where the Osuna daemon runs",
      "Official docs",
    ]);
  });

  it("switches both command groups with the tab", () => {
    renderSurface({ hostPlatform: "darwin" });

    fireEvent.click(methodTab("windows"));

    expect(selectedMethods()).toEqual(["Windows"]);
    expect(installCommands()).toEqual([
      "irm https://claude.ai/install.ps1 | iex",
      "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
    ]);
    expect(shownTexts("provider-install-commands")).toEqual([
      "Install",
      "PowerShell",
      "irm https://claude.ai/install.ps1 | iex",
      "Copy",
      "CMD",
      "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
      "Copy",
    ]);
    expect(upgradeCommands()).toEqual(["claude update"]);

    fireEvent.click(methodTab("homebrew"));

    expect(installCommands()).toEqual(["brew install --cask claude-code"]);
    expect(upgradeCommands()).toEqual(["brew upgrade claude-code"]);
  });

  it("opens on the first method when the host platform is unknown", () => {
    renderSurface({ hostPlatform: undefined });

    expect(selectedMethods()).toEqual(["macOS/Linux"]);
    expect(installCommands()).toEqual(["curl -fsSL https://claude.ai/install.sh | bash"]);
    expect(upgradeCommands()).toEqual(["claude update"]);
  });

  it("moves to the host's install method when the host platform arrives late", () => {
    const { rerender } = renderSurface({ hostPlatform: undefined });

    rerender({ hostPlatform: "win32" });

    expect(selectedMethods()).toEqual(["Windows"]);
    expect(upgradeCommands()).toEqual(["claude update"]);
  });

  it("keeps the tab the user picked when the host platform arrives late", () => {
    const { rerender } = renderSurface({ hostPlatform: undefined });
    fireEvent.click(methodTab("npm"));

    rerender({ hostPlatform: "win32" });

    expect(selectedMethods()).toEqual(["npm"]);
    expect(upgradeCommands()).toEqual(["npm install -g @anthropic-ai/claude-code@latest"]);
  });

  it("offers every install method OpenCode documents as a tab", () => {
    renderSurface({ provider: "opencode", hostPlatform: "win32", cliLabel: "OpenCode" });

    const tabs = within(screen.getByTestId("provider-install-methods")).getAllByRole("button");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Install script",
      "npm",
      "Bun",
      "pnpm",
      "Homebrew",
      "Chocolatey",
      "Scoop",
    ]);
    expect(selectedMethods()).toEqual(["npm"]);
    expect(installCommands()).toEqual(["npm install -g opencode-ai"]);
    expect(upgradeCommands()).toEqual(["opencode upgrade"]);
  });

  it("copies exactly the install or upgrade command it shows", () => {
    const { onCopyCommand } = renderSurface({ hostPlatform: "darwin" });
    fireEvent.click(methodTab("npm"));

    const copyInstall = i18n.t("settings.providers.install.copyAccessibility", {
      command: "npm install -g @anthropic-ai/claude-code",
    });
    fireEvent.click(
      within(screen.getByTestId("provider-install-commands")).getByLabelText(copyInstall),
    );
    const copyUpgrade = i18n.t("settings.providers.install.copyAccessibility", {
      command: "npm install -g @anthropic-ai/claude-code@latest",
    });
    fireEvent.click(
      within(screen.getByTestId("provider-upgrade-commands")).getByLabelText(copyUpgrade),
    );

    expect(onCopyCommand.mock.calls).toEqual([
      ["npm install -g @anthropic-ai/claude-code"],
      ["npm install -g @anthropic-ai/claude-code@latest"],
    ]);
  });

  it("copies the upgrade command even when it repeats the install command", () => {
    const { onCopyCommand } = renderSurface({
      provider: "codex",
      hostPlatform: "linux",
      cliLabel: "Codex",
    });
    const command = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
    expect(installCommands()).toEqual([command]);
    expect(upgradeCommands()).toEqual([command]);

    fireEvent.click(
      within(screen.getByTestId("provider-upgrade-commands")).getByLabelText(
        i18n.t("settings.providers.install.copyAccessibility", { command }),
      ),
    );

    expect(onCopyCommand.mock.calls).toEqual([[command]]);
  });

  it("opens the official docs", () => {
    const { onOpenDocs } = renderSurface({ hostPlatform: "linux" });

    fireEvent.click(
      screen.getByRole("link", {
        name: i18n.t("settings.providers.install.docsFor", { name: "Claude Code" }),
      }),
    );

    expect(onOpenDocs.mock.calls).toEqual([["https://code.claude.com/docs/en/setup"]]);
  });

  it("names the CLI a custom provider installs in the title", () => {
    renderSurface({ provider: "work-claude", extendsProvider: "claude", hostPlatform: "darwin" });

    expect(shownTexts("provider-install-guide")[0]).toBe("Install and upgrade Claude Code");
  });
});
