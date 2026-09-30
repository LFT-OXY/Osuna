import { describe, expect, test } from "vitest";
import {
  clipUpgradeOutput,
  resolveProviderUpgradeCommand,
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
      }),
    ).toEqual({ kind: "run", command: executable, args });
  });

  test("keeps the argv of a replaced command in front of the subcommand", () => {
    expect(
      resolveProviderUpgradeCommand({
        provider: "pi",
        launch: { executable: "/usr/bin/node", args: ["/opt/pi/cli.js"], source: "override" },
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
      }),
    ).toEqual({ kind: "run", command: "/usr/local/bin/claude", args: ["update"] });
  });

  test.each(["codex", "work-claude", "minimax-code"])(
    "has no upgrade command for %s",
    (provider) => {
      const expected: ProviderUpgradeCommand = { kind: "unsupported" };
      expect(
        resolveProviderUpgradeCommand({
          provider,
          launch: { executable: "/usr/local/bin/cli", args: [], source: "default" },
        }),
      ).toEqual(expected);
    },
  );
});

describe("clipUpgradeOutput", () => {
  test("keeps short output as is", () => {
    expect(clipUpgradeOutput("updated to 1.2.3\n", 100)).toBe("updated to 1.2.3\n");
  });

  test("keeps the end of long output behind a marker", () => {
    expect(clipUpgradeOutput("0123456789", 4)).toBe("…\n6789");
  });
});
