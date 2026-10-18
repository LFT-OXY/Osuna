import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

// 假 Codex 从这个文件读对话；用例拿到工作区路径后再写，daemon 每次列表时现读。
const threadsFile = path.join(tmpdir(), `session-history-codex-threads-${process.pid}.json`);
// 挪对话改写的是 CODEX_HOME 里的对话文件：指到临时目录，绝不碰开发者的 ~/.codex。
const codexHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-session-history-codex-"));

test.use({
  e2eDaemonEnvironment: { CODEX_HOME: codexHome },
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
    await rm(path.join(codexHome, "sessions"), { recursive: true, force: true });
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
      const gatewayProvider = gatewayRow.getByTestId("session-history-row-codex-model-provider");
      await expect(gatewayProvider).toContainText("Codex model provider");
      await expect(gatewayProvider).toContainText("osuna_api_endpoint");
      await expect(
        page
          .getByTestId("session-history-row-codex-thread-official")
          .getByTestId("session-history-row-codex-model-provider"),
      ).toContainText("openai");
    } finally {
      await workspace.cleanup();
    }
  });

  test("moves a Codex conversation to another Codex model provider", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-move-" });
    const rollout = await seedGatewayConversation({ repoPath: workspace.repoPath, isIdle: true });

    try {
      const row = await openSessionHistoryRow(page, workspace.workspaceId);
      const sheet = await openMoveSheet({ page, row });
      await expect(sheet.getByTestId("move-codex-conversation-backup-note")).toContainText(
        "Moving it back to osuna_api_endpoint undoes the move",
      );
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();

      await expect(sheet).toBeHidden({ timeout: 30_000 });
      await expect(page.getByText("Moved to openai")).toBeVisible();
      await expect(row.getByTestId("session-history-row-codex-model-provider")).toContainText(
        "openai",
      );
      expect(await readFile(rollout, "utf8")).toContain('"model_provider":"openai"');
    } finally {
      await workspace.cleanup();
    }
  });

  test("says why a Codex conversation written just now was not moved", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-move-active-" });
    const rollout = await seedGatewayConversation({ repoPath: workspace.repoPath, isIdle: false });
    const before = await readFile(rollout, "utf8");

    try {
      const row = await openSessionHistoryRow(page, workspace.workspaceId);
      const sheet = await openMoveSheet({ page, row });
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();

      const error = sheet.getByTestId("move-codex-conversation-error");
      await expect(error).toContainText("Conversation not moved", { timeout: 30_000 });
      await expect(error).toContainText("written to in the last minute");
      await expect(sheet).toBeVisible();
      expect(await readFile(rollout, "utf8")).toBe(before);
    } finally {
      await workspace.cleanup();
    }
  });
});

const GATEWAY_THREAD = "thread-gateway";

/** 一段记在中转站服务商名下的对话：对话文件放进临时 CODEX_HOME，假 Codex 列表时读它。 */
async function seedGatewayConversation(input: {
  repoPath: string;
  isIdle: boolean;
}): Promise<string> {
  const directory = path.join(codexHome, "sessions", "2026", "10", "17");
  const rollout = path.join(directory, `rollout-2026-10-17T10-00-00-${GATEWAY_THREAD}.jsonl`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    rollout,
    `${JSON.stringify({
      timestamp: "2026-10-17T10:00:00.000Z",
      type: "session_meta",
      payload: { id: GATEWAY_THREAD, cwd: input.repoPath, model_provider: "osuna_api_endpoint" },
    })}\n`,
  );
  if (input.isIdle) {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(rollout, anHourAgo, anHourAgo);
  }
  await writeFile(
    threadsFile,
    JSON.stringify([
      {
        id: GATEWAY_THREAD,
        cwd: input.repoPath,
        name: "Started through the gateway",
        path: rollout,
        updatedAt: Math.floor(Date.now() / 1000) - 120,
      },
    ]),
  );
  return rollout;
}

async function openSessionHistoryRow(page: Page, workspaceId: string) {
  await gotoWorkspace(page, workspaceId);
  await waitForWorkspaceTabsVisible(page);
  const explorer = await ensureExplorerSidebar(page);
  await explorer.getByTestId("workspace-tab-session_history").click();
  const row = page.getByTestId(`session-history-row-codex-${GATEWAY_THREAD}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function openMoveSheet(input: { page: Page; row: ReturnType<Page["getByTestId"]> }) {
  const { page, row } = input;
  await row.hover();
  await page.getByTestId(`session-history-kebab-codex:${GATEWAY_THREAD}`).click();
  await page
    .getByTestId(`session-history-menu-move-codex-model-provider-codex:${GATEWAY_THREAD}`)
    .click();
  const sheet = page.getByTestId("move-codex-conversation-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}
