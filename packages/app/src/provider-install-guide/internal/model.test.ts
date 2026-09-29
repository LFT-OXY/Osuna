import { describe, expect, it } from "vitest";
import { INSTALL_PLATFORMS } from "./commands";
import {
  hasProviderInstallGuide,
  resolveProviderInstallGuide,
  type ProviderInstallGuide,
} from "./model";

function requireGuide(guide: ProviderInstallGuide | null): ProviderInstallGuide {
  if (!guide) throw new Error("Expected an install guide");
  return guide;
}

describe("resolveProviderInstallGuide", () => {
  it.each(["claude", "codex", "pi", "omp"])(
    "returns commands for every platform and an https docs URL for %s",
    (provider) => {
      const guide = requireGuide(resolveProviderInstallGuide({ provider, hostPlatform: "linux" }));

      expect(new URL(guide.docsUrl).protocol).toBe("https:");
      for (const platform of INSTALL_PLATFORMS) {
        expect(guide.commands[platform].length).toBeGreaterThan(0);
        for (const entry of guide.commands[platform]) {
          expect(entry.command.trim()).toBe(entry.command);
          expect(entry.command.length).toBeGreaterThan(0);
        }
      }
    },
  );

  it.each(["opencode", "copilot", "acp", "unknown-provider", "constructor", "toString"])(
    "returns no guide for %s",
    (provider) => {
      expect(resolveProviderInstallGuide({ provider, hostPlatform: "darwin" })).toBeNull();
    },
  );

  it.each([
    ["darwin", "macos"],
    ["linux", "linux"],
    ["win32", "windows"],
  ] as const)("selects the host platform %s as %s", (hostPlatform, expected) => {
    const guide = requireGuide(resolveProviderInstallGuide({ provider: "claude", hostPlatform }));
    expect(guide.defaultPlatform).toBe(expected);
  });

  it.each([undefined, "freebsd", "aix", ""])(
    "selects no platform when the host reports %s",
    (hostPlatform) => {
      const guide = requireGuide(resolveProviderInstallGuide({ provider: "codex", hostPlatform }));
      expect(guide.defaultPlatform).toBeNull();
    },
  );

  it("installs Pi on Windows through npm with the renamed package", () => {
    const guide = requireGuide(
      resolveProviderInstallGuide({ provider: "pi", hostPlatform: "win32" }),
    );

    expect(guide.commands.windows).toEqual([
      {
        label: "npm",
        command: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
      },
    ]);
  });

  it("offers Claude Code on Windows as PowerShell and CMD", () => {
    const guide = requireGuide(
      resolveProviderInstallGuide({ provider: "claude", hostPlatform: "win32" }),
    );

    expect(guide.commands.windows.map((entry) => entry.label)).toEqual(["PowerShell", "CMD"]);
  });

  it("names the built-in provider the guide installs", () => {
    const custom = requireGuide(
      resolveProviderInstallGuide({
        provider: "work-claude",
        extendsProvider: "claude",
        hostPlatform: undefined,
      }),
    );

    expect(custom.provider).toBe("claude");
  });

  it("reports whether a provider has a guide without a host platform", () => {
    expect(hasProviderInstallGuide({ provider: "omp" })).toBe(true);
    expect(hasProviderInstallGuide({ provider: "work-codex", extendsProvider: "codex" })).toBe(
      true,
    );
    expect(hasProviderInstallGuide({ provider: "opencode" })).toBe(false);
    expect(hasProviderInstallGuide({ provider: "my-acp", extendsProvider: "acp" })).toBe(false);
    expect(hasProviderInstallGuide({ provider: "odd", extendsProvider: "constructor" })).toBe(
      false,
    );
  });

  it("uses the extended built-in provider's guide for a custom provider", () => {
    const custom = resolveProviderInstallGuide({
      provider: "my-claude",
      extendsProvider: "claude",
      hostPlatform: "darwin",
    });

    expect(custom).toEqual(
      resolveProviderInstallGuide({ provider: "claude", hostPlatform: "darwin" }),
    );
  });

  it.each([
    ["acp", "acp"],
    ["opencode", "opencode"],
    ["unknown config", undefined],
  ])("returns no guide for a custom provider extending %s", (_name, extendsProvider) => {
    expect(
      resolveProviderInstallGuide({ provider: "my-agent", extendsProvider, hostPlatform: "linux" }),
    ).toBeNull();
  });

  it("ignores extends on a built-in provider", () => {
    const guide = requireGuide(
      resolveProviderInstallGuide({
        provider: "codex",
        extendsProvider: "claude",
        hostPlatform: "linux",
      }),
    );

    expect(guide).toEqual(
      resolveProviderInstallGuide({ provider: "codex", hostPlatform: "linux" }),
    );
  });
});
