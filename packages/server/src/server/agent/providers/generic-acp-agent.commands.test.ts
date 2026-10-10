import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentSession } from "../agent-sdk-types.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

// Osuna 取指令列表不等程序报回（ADR 0003）：报回之前是 null，报回之后才是那份列表。
describe("GenericACPAgentClient slash commands", () => {
  test("lists commands an agent advertises after session/new once they arrive", async () => {
    await withFakeACPAgent("commands-after-session-new", async (command, cwd) => {
      const client = new GenericACPAgentClient({ logger: createTestLogger(), command });
      const session = await client.createSession({ provider: "acp", cwd });
      try {
        await waitForAdvertisedCommands(session);
      } finally {
        await session.close();
      }
    });
  });

  test("answers null without waiting for an agent that never advertises any", async () => {
    await withFakeACPAgent("silent", async (command, cwd) => {
      const client = new GenericACPAgentClient({ logger: createTestLogger(), command });
      const session = await client.createSession({ provider: "acp", cwd });
      try {
        await expect(session.listCommands?.()).resolves.toBeNull();
      } finally {
        await session.close();
      }
    });
  });
});

async function waitForAdvertisedCommands(session: AgentSession): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await session.listCommands?.()).toEqual([
        { name: "review", description: "Review the diff", argumentHint: "", kind: "command" },
      ]);
    },
    { timeout: 10_000 },
  );
}

async function withFakeACPAgent(
  mode: "commands-after-session-new" | "silent",
  run: (command: [string, ...string[]], cwd: string) => Promise<void>,
): Promise<void> {
  const testDir = await mkdtemp(path.join(tmpdir(), "paseo-acp-commands-"));
  try {
    const scriptPath = path.join(testDir, "fake-acp-agent.cjs");
    await writeFile(scriptPath, fakeACPAgentScript, "utf8");
    await run([process.execPath, scriptPath, mode], testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

const fakeACPAgentScript = `
const readline = require("node:readline");

const mode = process.argv[2];
const rl = readline.createInterface({ input: process.stdin });

function write(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    write({
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
      },
    });
    return;
  }

  if (message.method === "session/new") {
    write({ id: message.id, result: { sessionId: "session-1" } });
    if (mode === "commands-after-session-new") {
      setTimeout(() => {
        write({
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "review", description: "Review the diff" }],
            },
          },
        });
      }, 0);
    }
    return;
  }

  if (message.id !== undefined) {
    write({ id: message.id, result: {} });
  }
});
`;
