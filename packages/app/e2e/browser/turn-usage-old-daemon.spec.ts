import { randomUUID } from "node:crypto";
import { metroTest as test, expect } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import type { MockAgentWorkspace } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentTimeline } from "../support/helpers/timeline-pagination";

/** The last version published without `features.usage`. */
const PRE_USAGE_DAEMON_VERSION = "0.8.0";

test("a host without the usage feature keeps the plain footer and asks to be updated", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const serverId = `srv_turn_usage_old_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId, {
    publishedVersion: PRE_USAGE_DAEMON_VERSION,
  });
  const workspace = await seedWorkspace({
    repoPrefix: "turn-usage-old-daemon-",
    port: daemon.port,
  });
  const createdAgent = await workspace.client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: "Turn usage on an outdated host",
    modeId: "load-test",
    model: "e2e-fast-stream",
  });
  const agent: MockAgentWorkspace = {
    agentId: createdAgent.id,
    workspaceId: workspace.workspaceId,
    cwd: workspace.repoPath,
    client: workspace.client,
    cleanup: workspace.cleanup,
  };

  try {
    await agent.client.sendAgentMessage(
      agent.agentId,
      "turn-usage-old-daemon: emit 1 coalesced agent stream updates",
    );
    await agent.client.waitForFinish(agent.agentId, 30_000);

    await page.addInitScript(
      ({ seededHost, preferences }) => {
        localStorage.setItem("@osuna:e2e", "1");
        localStorage.setItem("@osuna:daemon-registry", JSON.stringify([seededHost]));
        localStorage.setItem("@osuna:create-agent-preferences", JSON.stringify(preferences));
      },
      {
        seededHost: buildSeededHost({
          serverId,
          endpoint: `127.0.0.1:${daemon.port}`,
          nowIso: new Date().toISOString(),
        }),
        preferences: buildCreateAgentPreferences(),
      },
    );
    await openAgentTimeline(page, agent, serverId);
    await expectComposerVisible(page);

    await test.step("the finished turn's footer is exactly what it was before usage existed", async () => {
      await expect(page.getByRole("button", { name: /^Worked for/ })).toHaveCount(1);
      await expect(page.getByTestId("turn-usage-segment")).toHaveCount(0);
    });

    await test.step("the context popover names the reason instead of showing zeroes", async () => {
      await expect(page.getByTestId("context-window-meter")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("context-window-meter").hover();
      const sessionTotal = page.getByTestId("context-window-session-total");
      await expect(sessionTotal).toBeVisible({ timeout: 10_000 });
      await expect(sessionTotal).toContainText("Session total");
      await expect(sessionTotal).toContainText("Update host");
      await expect(sessionTotal).not.toContainText("Agent runtime");
    });
  } finally {
    await workspace.cleanup();
    await daemon.close().catch(() => undefined);
  }
});
