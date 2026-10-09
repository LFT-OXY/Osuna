// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { migrateLegacyHome } from "../legacy-home-migration.js";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

const cleanupContexts = new Set<DaemonTestContext>();
const cleanupPaths = new Set<string>();

afterEach(async () => {
  await Promise.all(Array.from(cleanupContexts, (ctx) => ctx.cleanup().catch(() => undefined)));
  cleanupContexts.clear();
  await Promise.all(
    Array.from(cleanupPaths, (target) => rm(target, { recursive: true, force: true })),
  );
  cleanupPaths.clear();
}, 60_000);

function tempDir(prefix: string): string {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  cleanupPaths.add(directory);
  return directory;
}

async function startDaemon(osunaHomeRoot: string): Promise<DaemonTestContext> {
  const ctx = await createDaemonTestContext({ osunaHomeRoot, cleanup: false });
  cleanupContexts.add(ctx);
  return ctx;
}

async function stopDaemon(ctx: DaemonTestContext): Promise<void> {
  cleanupContexts.delete(ctx);
  await ctx.cleanup();
}

test("a daemon started on the moved home serves the agents and workspaces written under the old path", async () => {
  const userHome = tempDir("legacy-home-e2e-");
  const legacyHome = path.join(userHome, ".paseo");
  const home = path.join(userHome, ".osuna");
  const cwd = path.join(legacyHome, "worktrees", "repo", "feature");
  mkdirSync(cwd, { recursive: true });

  // 0.14.x 把数据写在 .paseo 下。测试 daemon 的 home 固定叫 .osuna，所以播种时借一个指向旧目录的链接。
  const seedRoot = tempDir("legacy-home-e2e-seed-");
  symlinkSync(legacyHome, path.join(seedRoot, ".osuna"), "dir");
  const legacy = await startDaemon(seedRoot);
  const agent = await legacy.client.createAgent({
    provider: "codex",
    cwd,
    title: "Written before the move",
    modeId: "full-access",
  });
  await legacy.client.sendMessage(agent.id, "Respond with exactly: still here");
  expect((await legacy.client.waitForFinish(agent.id, 5_000)).status).toBe("idle");
  const workspacesBefore = await legacy.client.fetchWorkspaces();
  await stopDaemon(legacy);
  expect(workspacesBefore.entries).toHaveLength(1);

  expect(await migrateLegacyHome({ legacyHome, home })).toEqual({
    outcome: "migrated",
    method: "rename",
  });
  expect(lstatSync(legacyHome).isSymbolicLink()).toBe(true);

  const migrated = await startDaemon(userHome);
  expect(migrated.daemon.osunaHome).toBe(home);

  const agents = await migrated.client.fetchAgents();
  expect(agents.entries.map((entry) => entry.agent)).toEqual([
    expect.objectContaining({ id: agent.id, cwd, title: "Written before the move" }),
  ]);

  const workspaces = await migrated.client.fetchWorkspaces();
  expect(workspaces.entries).toEqual(workspacesBefore.entries);

  const timeline = await migrated.client.fetchAgentTimeline(agent.id, {
    direction: "tail",
    limit: 0,
  });
  const assistantText = timeline.entries
    .map((entry) => entry.item)
    .filter((item) => item.type === "assistant_message")
    .map((item) => item.text)
    .join("");
  expect(assistantText).toBe("still here");
}, 60_000);
