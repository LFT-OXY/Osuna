import { beforeAll, beforeEach, describe, expect, test } from "vitest";
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

  test("lists slash commands only from a running CLI, including every built-in", async () => {
    const client = createRealProviderClient("claude", pino({ level: "silent" }));
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
      modeId: "plan",
    });

    try {
      expect(typeof session.listCommands).toBe("function");
      await expect(session.listCommands!()).resolves.toBeNull();

      await session.setMode("plan");
      const commands = await session.listCommands!();

      if (commands === null) {
        throw new Error("Expected the running CLI to report its commands");
      }
      const names = commands.map((command) => command.name);
      for (const builtin of CLAUDE_ROOT_ONLY_BUILTIN_COMMANDS) {
        expect(names).toContain(builtin.name);
      }

      for (const command of commands) {
        const typed = command;
        expect(typeof typed.name).toBe("string");
        expect(typed.name.length).toBeGreaterThan(0);
        expect(typed.name.startsWith("/")).toBe(false);
        expect(typeof typed.description).toBe("string");
        expect(typeof typed.argumentHint).toBe("string");
      }
    } finally {
      await session.close();
    }
  }, 60_000);
});
