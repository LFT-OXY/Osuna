/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ProviderInstallGuideSurface, resolveProviderInstallGuide } from "./index";

function requireGuide(hostPlatform: string | undefined) {
  const guide = resolveProviderInstallGuide({ provider: "claude", hostPlatform });
  if (!guide) throw new Error("Expected the Claude Code install guide");
  return guide;
}

function renderSurface(hostPlatform: string | undefined) {
  const onCopyCommand = vi.fn();
  const onOpenDocs = vi.fn();
  render(
    <ProviderInstallGuideSurface
      guide={requireGuide(hostPlatform)}
      cliLabel="Claude"
      onCopyCommand={onCopyCommand}
      onOpenDocs={onOpenDocs}
    />,
  );
  return { onCopyCommand, onOpenDocs };
}

function shownCommands(): string[] {
  return screen.queryAllByTestId("provider-install-command").map((node) => node.textContent ?? "");
}

describe("ProviderInstallGuideSurface", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens on the host's platform and switches to another", () => {
    renderSurface("darwin");

    expect(
      screen.getByText(i18n.t("settings.providers.install.title", { name: "Claude" })),
    ).toBeTruthy();
    expect(
      screen.getByTestId("provider-install-platform-macos").getAttribute("aria-selected"),
    ).toBe("true");
    expect(shownCommands()).toEqual(["curl -fsSL https://claude.ai/install.sh | bash"]);

    fireEvent.click(screen.getByTestId("provider-install-platform-windows"));

    expect(shownCommands()).toEqual([
      "irm https://claude.ai/install.ps1 | iex",
      "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
    ]);
    expect(screen.getByText("PowerShell")).toBeTruthy();
    expect(screen.getByText("CMD")).toBeTruthy();
  });

  it("selects no platform and shows no command when the host platform is unknown", () => {
    renderSurface(undefined);

    for (const platform of ["macos", "linux", "windows"]) {
      expect(
        screen.getByTestId(`provider-install-platform-${platform}`).getAttribute("aria-selected"),
      ).not.toBe("true");
    }
    expect(shownCommands()).toEqual([]);
    expect(screen.getByText(i18n.t("settings.providers.install.choosePlatform"))).toBeTruthy();

    fireEvent.click(screen.getByTestId("provider-install-platform-linux"));

    expect(shownCommands()).toEqual(["curl -fsSL https://claude.ai/install.sh | bash"]);
  });

  it("copies exactly the command it shows", () => {
    const { onCopyCommand } = renderSurface("win32");
    const command =
      "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd";

    fireEvent.click(
      screen.getByLabelText(i18n.t("settings.providers.install.copyAccessibility", { command })),
    );

    expect(onCopyCommand).toHaveBeenCalledTimes(1);
    expect(onCopyCommand).toHaveBeenCalledWith(command);
    expect(shownCommands()).toContain(command);
  });

  it("opens the official docs", () => {
    const { onOpenDocs } = renderSurface("linux");

    fireEvent.click(
      screen.getByRole("link", {
        name: i18n.t("settings.providers.install.docsFor", { name: "Claude" }),
      }),
    );

    expect(onOpenDocs).toHaveBeenCalledWith("https://code.claude.com/docs/en/setup");
    expect(screen.getByText(i18n.t("settings.providers.install.hostHint"))).toBeTruthy();
  });
});
