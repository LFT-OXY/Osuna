import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import pino from "pino";

import {
  canRunRealProvider,
  createRealProviderClient,
} from "../../../daemon-e2e/real-provider-test-config.js";
import { CLAUDE_ROOT_ONLY_BUILTIN_COMMANDS } from "./commands.js";

// Real-Claude contract coverage: validates slash command shape from a live Claude CLI session.
describe("claude agent commands contract (real)", () => {
  let canRun = false;

  beforeAll(async () => {
    canRun = await canRunRealProvider("claude");
  });

  beforeEach((context) => {
    if (!canRun) {
      context.skip();
    }
  });

  test("reports slash commands once a turn starts the CLI, including every built-in", async () => {
    const client = createRealProviderClient("claude", pino({ level: "silent" }));
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
      modeId: "plan",
    });

    try {
      expect(typeof session.listCommands).toBe("function");
      await expect(session.listCommands!()).resolves.toBeNull();

      // Claude reports its list from the init message, which only a turn produces.
      await session.run("Reply with exactly OK and nothing else.");
      const commands = await vi.waitFor(async () => {
        const reported = await session.listCommands!();
        if (reported === null) {
          throw new Error("Expected the running CLI to report its commands");
        }
        return reported;
      });

      // Every built-in survives the terminal-only filter and is classified as a command.
      for (const builtin of CLAUDE_ROOT_ONLY_BUILTIN_COMMANDS) {
        expect(commands).toContainEqual(
          expect.objectContaining({ name: builtin.name, kind: "command" }),
        );
      }

      for (const command of commands) {
        expect(command.name.length).toBeGreaterThan(0);
        expect(command.name.startsWith("/")).toBe(false);
        expect(typeof command.description).toBe("string");
        expect(typeof command.argumentHint).toBe("string");
        expect(["skill", "command"]).toContain(command.kind);
      }
    } finally {
      await session.close();
    }
  }, 60_000);
});
