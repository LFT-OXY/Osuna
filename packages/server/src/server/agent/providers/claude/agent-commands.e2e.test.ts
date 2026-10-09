import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createDaemonTestContext, type DaemonTestContext } from "../../../test-utils/index.js";

// Fake-daemon plumbing coverage: validates manager/client command wiring without a real Claude binary.
describe("claude agent commands E2E", () => {
  let ctx: DaemonTestContext;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
  });

  afterEach(async () => {
    // Add timeout to prevent hanging on Claude SDK cleanup
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([ctx?.cleanup(), timeoutPromise]);
  }, 10000);

  test("lists available slash commands for a claude agent", async () => {
    // Create a Claude agent
    const agent = await ctx.client.createAgent({
      provider: "claude",
      cwd: "/tmp",
      title: "Commands Test Agent",
    });

    expect(agent.id).toBeTruthy();
    expect(agent.provider).toBe("claude");
    expect(agent.status).toBe("idle");

    // List commands
    const result = await ctx.client.listCommands({ agentId: agent.id });

    // Should have no error
    expect(result.error).toBeNull();
    expect(result.partial).toBe(false);

    // Should have commands
    expect(result.commands.length).toBeGreaterThan(0);

    // Each command should have required fields
    for (const cmd of result.commands) {
      expect(cmd.name).toBeTruthy();
      expect(typeof cmd.description).toBe("string");
      expect(typeof cmd.argumentHint).toBe("string");
    }

    // Should include some well-known commands
    const commandNames = result.commands.map((c) => c.name);
    // These are skills that come from CLAUDE.md configurations
    // At minimum we should have some commands available
    expect(commandNames.length).toBeGreaterThan(0);
    expect(commandNames).toContain("rewind");
  }, 60000);

  test("marks a draft list partial until a process has reported for that cwd", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "osuna-claude-commands-draft-"));
    try {
      const draftConfig = { provider: "claude" as const, cwd };

      const before = await ctx.client.listCommands({ agentId: "draft-agent", draftConfig });
      expect(before.error).toBeNull();
      expect(before.partial).toBe(true);

      const agent = await ctx.client.createAgent({ provider: "claude", cwd, title: "Reporter" });
      const reported = await ctx.client.listCommands({ agentId: agent.id });
      expect(reported.partial).toBe(false);

      const after = await ctx.client.listCommands({ agentId: "draft-agent", draftConfig });
      expect(after.partial).toBe(false);
      expect(after.commands).toEqual(reported.commands);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 60000);

  test("lists a stored agent's cached commands without loading the agent", async () => {
    const osunaHomeRoot = await mkdtemp(path.join(tmpdir(), "osuna-home-stored-commands-"));
    const osunaHome = path.join(osunaHomeRoot, ".osuna");
    const cwd = await mkdtemp(path.join(tmpdir(), "osuna-claude-commands-stored-"));
    const agentId = "22222222-2222-4222-8222-222222222222";
    const now = new Date("2026-09-28T00:00:00.000Z").toISOString();
    const cached = {
      name: "cached-skill",
      description: "From disk",
      argumentHint: "",
      kind: "skill",
    };
    await mkdir(path.join(osunaHome, "agents"), { recursive: true });
    await writeFile(
      path.join(osunaHome, "agents", `${agentId}.json`),
      JSON.stringify({
        id: agentId,
        provider: "claude",
        cwd,
        createdAt: now,
        updatedAt: now,
        lastStatus: "idle",
        config: {},
        persistence: { provider: "claude", sessionId: "claude-session-1", metadata: { cwd } },
      }),
    );
    await writeFile(
      path.join(osunaHome, "command-catalog.json"),
      JSON.stringify({
        entries: [{ provider: "claude", cwd, updatedAt: now, commands: [cached] }],
      }),
    );
    const stored = await createDaemonTestContext({ osunaHomeRoot });

    try {
      const result = await stored.client.listCommands({ agentId });

      expect(result.error).toBeNull();
      expect(result.partial).toBe(false);
      expect(result.commands).toEqual([cached]);
      expect(stored.daemon.daemon.agentManager.getAgent(agentId)).toBeNull();
    } finally {
      await stored.cleanup();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 60000);

  test("returns error for non-existent agent", async () => {
    const result = await ctx.client.listCommands({ agentId: "non-existent-agent-id" });

    expect(result.error).toBeTruthy();
    expect(result.error).toContain("Agent not found");
    expect(result.commands).toEqual([]);
  }, 30000);
});
