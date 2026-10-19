import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";
import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { clickNewChat, gotoWorkspace } from "../support/helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import type { SeedDaemonClient } from "../support/helpers/seed-client";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

function logicMapSwitch(page: Page): Locator {
  return page.getByTestId("composer-logic-map-switch").filter({ visible: true });
}

async function agentLogicMap(client: SeedDaemonClient, agentId: string): Promise<string | null> {
  const { entries } = await client.fetchAgents();
  const agent = entries.find((entry) => entry.agent.id === agentId)?.agent;
  return getLogicMapNameFromLabels(agent?.labels);
}

/** 工作区里每个 Agent 是否维护着一张新建的图：true 是有，null 是开关关着。 */
async function workspaceLogicMaps(
  client: SeedDaemonClient,
  workspaceId: string,
): Promise<(true | null)[]> {
  const { entries } = await client.fetchAgents();
  return entries
    .filter((entry) => entry.agent.workspaceId === workspaceId)
    .map((entry) => {
      const mapName = getLogicMapNameFromLabels(entry.agent.labels);
      if (mapName === null) return null;
      expect(mapName).toMatch(/^untitled-[0-9a-f]{8}$/);
      return true;
    });
}

/** 从 server_info 去掉 `logicMap`，模拟还不支持逻辑图的老 Host。 */
async function installHostWithoutLogicMap(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string" || !message.includes('"server_info"')) {
        ws.send(message);
        return;
      }
      const envelope = JSON.parse(message) as {
        message?: { payload?: { status?: unknown; features?: Record<string, unknown> } };
      };
      const payload = envelope.message?.payload;
      if (payload?.status === "server_info" && payload.features) {
        delete payload.features.logicMap;
      }
      ws.send(JSON.stringify(envelope));
    });
  });
}

/** daemon 回绝每一次开关请求，模拟主机上写不了图（磁盘满、目录没权限等）。 */
async function installHostRejectingLogicMapToggle(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      if (typeof message !== "string" || !message.includes("agent.logic_map.set_enabled.request")) {
        server.send(message);
        return;
      }
      const envelope = JSON.parse(message) as { message: { requestId: string } };
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "agent.logic_map.set_enabled.response",
            payload: {
              requestId: envelope.message.requestId,
              agentId: null,
              mapName: null,
              error: "No space left on device",
            },
          },
        }),
      );
    });
  });
}

function logicMapFolders(cwd: string): Promise<string[]> {
  return readdir(path.join(cwd, "docs", "logic-maps"));
}

test.describe("Logic map toggle in the composer toolbar", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("starts off on a running agent, turns on, and turns off again", async ({
    page,
  }, testInfo) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `logic-map-agent-${testInfo.workerIndex}-`,
      title: "Logic map agent",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      const toggle = logicMapSwitch(page);
      await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(() => agentLogicMap(agent.client, agent.agentId))
        .toMatch(/^untitled-[0-9a-f]{8}$/);

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect.poll(() => agentLogicMap(agent.client, agent.agentId)).toBeNull();
    } finally {
      await agent.cleanup();
    }
  });

  test("a draft turned on hands its map to the agent its first message creates", async ({
    page,
  }, testInfo) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `logic-map-draft-${testInfo.workerIndex}-`,
      title: "Existing agent",
    });
    try {
      await gotoWorkspace(page, agent.workspaceId);
      await clickNewChat(page);
      const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
      await expect(composer).toBeEditable({ timeout: 30_000 });
      const toggle = logicMapSwitch(page);
      await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect.poll(() => logicMapFolders(agent.cwd)).toHaveLength(1);
      const [firstMap] = await logicMapFolders(agent.cwd);

      // 关掉再打开沿用同一张图，不再多建文件夹。
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");

      // 重新打开 Osuna 后草稿的开关还开着。
      await page.reload();
      await expect(composer).toBeEditable({ timeout: 30_000 });
      await expect(logicMapSwitch(page)).toHaveAttribute("aria-checked", "true", {
        timeout: 30_000,
      });
      expect(await logicMapFolders(agent.cwd)).toEqual([firstMap]);

      await composer.fill("sketch the checkout flow");
      await composer.press("Enter");

      // 原来那个 Agent 没开逻辑图，新建的这个带着草稿建好的图。
      await expect
        .poll(async () => (await workspaceLogicMaps(agent.client, agent.workspaceId)).sort())
        .toEqual([null, true]);
      await expect(logicMapSwitch(page)).toHaveAttribute("aria-checked", "true");
      expect(await logicMapFolders(agent.cwd)).toEqual([firstMap]);
    } finally {
      await agent.cleanup();
    }
  });

  test("a host without the logic map shows the update hint instead of the switch", async ({
    page,
  }, testInfo) => {
    await installHostWithoutLogicMap(page);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `logic-map-old-host-${testInfo.workerIndex}-`,
      title: "Old host agent",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      const hint = page.getByTestId("composer-logic-map-host-outdated").filter({ visible: true });
      await expect(hint).toBeVisible({ timeout: 30_000 });
      await expect(hint).toHaveAccessibleName("Update Osuna on this host to use the logic map.");
      await expect(page.getByTestId("composer-logic-map-switch")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });

  test("a toggle the host rejects tells the user and goes back to off", async ({
    page,
  }, testInfo) => {
    await installHostRejectingLogicMapToggle(page);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `logic-map-rejected-${testInfo.workerIndex}-`,
      title: "Rejected toggle agent",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      const toggle = logicMapSwitch(page);
      await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });

      await toggle.click();

      await expect(page.getByTestId("app-toast-message")).toHaveText(
        "Could not change the logic map: No space left on device",
      );
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(toggle).toBeEnabled();
      expect(await agentLogicMap(agent.client, agent.agentId)).toBeNull();
    } finally {
      await agent.cleanup();
    }
  });
});
