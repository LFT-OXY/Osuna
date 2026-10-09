import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";
import { OpenCodeAgentClient } from "./opencode-agent.js";
import {
  idleEvent,
  TestOpenCodeClient,
  TestOpenCodeHarness,
} from "./opencode/test-utils/test-opencode-harness.js";

describe("OpenCodeAgentSession slash command timeout handling", () => {
  test("lists only OpenCode built-in slash commands Osuna can execute", async () => {
    const runtime = new TestOpenCodeHarness();
    const openCodeClient = createOpenCodeClientWithConnectedProvider();
    runtime.enqueueClient(openCodeClient);

    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp" });

    await expect(session.listCommands?.()).resolves.toEqual(
      expect.arrayContaining([
        {
          name: "compact",
          description: "Compact the current session",
          argumentHint: "",
          kind: "command",
        },
      ]),
    );
    await expect(session.listCommands?.()).resolves.not.toEqual(
      expect.arrayContaining([
        { name: "models", description: expect.any(String), argumentHint: "" },
      ]),
    );
  });

  test("discovers OpenCode built-in commands without acquiring a server", async () => {
    const runtime = new TestOpenCodeHarness();
    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });

    await expect(client.discoverCommands("/tmp")).resolves.toEqual([
      {
        name: "compact",
        description: "Compact the current session",
        argumentHint: "",
        kind: "command",
      },
      {
        name: "summarize",
        description: "Compact the current session",
        argumentHint: "",
        kind: "command",
      },
    ]);
    expect(runtime.acquisitions).toEqual([]);
  });

  test("reports the running server's command list when a turn starts", async () => {
    const runtime = new TestOpenCodeHarness();
    const openCodeClient = createOpenCodeClientWithConnectedProvider();
    openCodeClient.commandListResponse = {
      data: [{ name: "review", description: "Review the diff", hints: [], source: "skill" }],
    };
    runtime.enqueueClient(openCodeClient);
    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp" });
    const reports: AgentStreamEvent[] = [];
    session.subscribe((event) => {
      if (event.type === "commands_changed") reports.push(event);
    });

    await session.startTurn("hello");

    await expect
      .poll(() => reports)
      .toEqual([
        {
          type: "commands_changed",
          provider: "opencode",
          commands: expect.arrayContaining([
            { name: "review", description: "Review the diff", argumentHint: "", kind: "skill" },
          ]),
        },
      ]);
  });

  test("does not ask an exited OpenCode server for its command list", async () => {
    const runtime = new TestOpenCodeHarness();
    const openCodeClient = createOpenCodeClientWithConnectedProvider();
    runtime.enqueueClient(openCodeClient);
    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp" });
    const acquisitionCount = runtime.acquisitions.length;

    openCodeClient.emitEvent({ type: "server-exited", error: new Error("OpenCode exited") });

    await expect(session.listCommands?.()).resolves.toBeNull();
    expect(openCodeClient.calls.commandList).toEqual([]);
    expect(runtime.acquisitions).toHaveLength(acquisitionCount);
  });

  test("returns no command list when OpenCode fails to list commands", async () => {
    const runtime = new TestOpenCodeHarness();
    const openCodeClient = createOpenCodeClientWithConnectedProvider();
    openCodeClient.commandListResponse = { error: { message: "boom" } };
    runtime.enqueueClient(openCodeClient);
    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp" });

    await expect(session.listCommands?.()).resolves.toBeNull();
  });

  test("executes compact through the OpenCode summarize endpoint", async () => {
    const runtime = new TestOpenCodeHarness();
    const openCodeClient = createOpenCodeClientWithConnectedProvider();
    runtime.enqueueClient(openCodeClient);

    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp" });

    await expect(session.run("/compact")).resolves.toMatchObject({
      sessionId: "session-1",
      finalText: "",
      timeline: [],
      usage: undefined,
    });
    expect(openCodeClient.calls.sessionSummarize).toEqual([
      { sessionID: "session-1", directory: "/tmp" },
    ]);
    expect(openCodeClient.calls.sessionCommand).toEqual([]);
  });

  test("waits for SSE completion when slash commands hit a header timeout", async () => {
    const runtime = new TestOpenCodeHarness();
    const openCodeClient = createOpenCodeClientWithConnectedProvider();
    openCodeClient.sessionCommandError = new Error("fetch failed: Headers Timeout Error");
    openCodeClient.commandListResponse = {
      data: [{ name: "help", description: "Show help", hints: [] }],
    };
    runtime.enqueueClient(openCodeClient);

    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp" });

    const runPromise = session.run("/help");
    await nextTick();
    expect(openCodeClient.calls.sessionCommand).toHaveLength(1);
    let settled = false;
    void runPromise.then(() => {
      settled = true;
      return undefined;
    });
    await nextTick();
    expect(settled).toBe(false);

    openCodeClient.emitEvent(idleEvent());

    await expect(runPromise).resolves.toMatchObject({
      sessionId: "session-1",
      finalText: "",
      timeline: [],
      usage: undefined,
    });
  });

  test("leaves successful slash command turns open until OpenCode emits idle", async () => {
    const runtime = new TestOpenCodeHarness();
    const openCodeClient = createOpenCodeClientWithConnectedProvider();
    openCodeClient.sessionCommandEvents = [];
    openCodeClient.commandListResponse = {
      data: [{ name: "help", description: "Show help", hints: [] }],
    };
    runtime.enqueueClient(openCodeClient);

    const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp" });

    const runPromise = session.run("/help");
    await nextTick();
    await nextTick();

    expect(openCodeClient.calls.sessionCommand).toHaveLength(1);
    let settled = false;
    void runPromise.then(() => {
      settled = true;
      return undefined;
    });
    await nextTick();
    expect(settled).toBe(false);

    openCodeClient.emitEvent(idleEvent());

    await expect(runPromise).resolves.toMatchObject({
      sessionId: "session-1",
      finalText: "",
      timeline: [],
      usage: undefined,
    });
  });
});

function createOpenCodeClientWithConnectedProvider(): TestOpenCodeClient {
  const openCodeClient = new TestOpenCodeClient();
  openCodeClient.providerListResponse = {
    data: {
      connected: ["openai"],
      all: [{ id: "openai", name: "OpenAI", models: {} }],
    },
  };
  return openCodeClient;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
