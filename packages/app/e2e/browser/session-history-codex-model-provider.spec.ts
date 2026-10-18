import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

// 假 Codex 从这个文件读对话；用例拿到工作区路径后再写，daemon 每次列表时现读。
const threadsFile = path.join(tmpdir(), `session-history-codex-threads-${process.pid}.json`);

test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        codex: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/session-history-codex.mjs")],
          env: { SESSION_HISTORY_CODEX_THREADS: threadsFile },
        },
        claude: { enabled: false },
        copilot: { enabled: false },
        opencode: { enabled: false },
        pi: { enabled: false },
        omp: { enabled: false },
      },
    },
  },
});

test.describe("Session history", () => {
  test.afterEach(async () => {
    await rm(threadsFile, { force: true });
  });

  test("names the Codex model provider of each Codex conversation", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-provider-" });
    const now = Math.floor(Date.now() / 1000);
    await writeFile(
      threadsFile,
      JSON.stringify([
        {
          id: "thread-official",
          cwd: workspace.repoPath,
          name: "Started on the official setup",
          modelProvider: "openai",
          updatedAt: now - 60,
        },
        {
          id: "thread-gateway",
          cwd: workspace.repoPath,
          name: "Started through the gateway",
          modelProvider: "osuna_api_endpoint",
          updatedAt: now - 120,
        },
      ]),
    );

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const explorer = await ensureExplorerSidebar(page);
      await explorer.getByTestId("workspace-tab-session_history").click();

      const gatewayRow = page.getByTestId("session-history-row-codex-thread-gateway");
      await expect(gatewayRow).toBeVisible({ timeout: 30_000 });
      await expect(gatewayRow).toContainText("Started through the gateway");
      await expect(
        gatewayRow.getByLabel("Codex model provider: osuna_api_endpoint", { exact: true }),
      ).toHaveText("osuna_api_endpoint");
      await expect(
        page
          .getByTestId("session-history-row-codex-thread-official")
          .getByLabel("Codex model provider: openai", { exact: true }),
      ).toHaveText("openai");
    } finally {
      await workspace.cleanup();
    }
  });
});
