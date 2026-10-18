import { mkdtempSync } from "node:fs";
import { chmod, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

// 假 Codex 从这个文件读对话；用例拿到工作区路径后再写，daemon 每次列表时现读。
const threadsFile = path.join(tmpdir(), `session-history-codex-threads-${process.pid}.json`);
// 挪对话改写的是 CODEX_HOME 里的对话文件：指到临时目录，绝不碰开发者的 ~/.codex。
const codexHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-session-history-codex-"));
// 假 Claude Code 的会话从这里读，用来对照非 Codex 的行。
const claudeConfigDir = mkdtempSync(path.join(tmpdir(), "paseo-e2e-session-history-claude-"));

test.use({
  e2eDaemonEnvironment: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeConfigDir },
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        codex: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/session-history-codex.mjs")],
          env: { SESSION_HISTORY_CODEX_THREADS: threadsFile },
        },
        claude: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/session-history-claude.mjs")],
        },
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
    await rm(path.join(codexHome, "config.toml"), { force: true });
    await rm(path.join(claudeConfigDir, "projects"), { recursive: true, force: true });
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

  test("offers the move only on Codex rows", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-move-only-" });
    await seedGatewayConversation({ repoPath: workspace.repoPath, isIdle: true });
    await seedClaudeSession(workspace.repoPath);

    try {
      await openSessionHistoryRow(page, workspace.workspaceId);
      await page.getByTestId("session-history-scope-host").click();
      const claudeRow = page.getByTestId(`session-history-row-claude-${CLAUDE_SESSION}`);
      await expect(claudeRow).toBeVisible({ timeout: 30_000 });
      await claudeRow.hover();
      await page.getByTestId(`session-history-kebab-claude:${CLAUDE_SESSION}`).click();
      await expect(
        page.getByTestId(`session-history-menu-copy-resume-command-claude:${CLAUDE_SESSION}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`session-history-menu-move-codex-model-provider-claude:${CLAUDE_SESSION}`),
      ).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps a failed move in place with its backup until it is tried again", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-move-failed-" });
    const rollout = await seedGatewayConversation({ repoPath: workspace.repoPath, isIdle: true });
    const before = await readFile(rollout, "utf8");
    // 对话文件所在目录不可写：旁边的临时文件建不出来，挪动失败、文件不变。
    await chmod(path.dirname(rollout), 0o555);

    try {
      const row = await openSessionHistoryRow(page, workspace.workspaceId);
      const sheet = await openMoveSheet({ page, row });
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();

      const error = sheet.getByTestId("move-codex-conversation-error");
      await expect(error).toContainText("Conversation not moved", { timeout: 30_000 });
      await expect(error).toContainText("Backup: ");
      await expect(error).toContainText("codex-model-provider-moves");
      expect(await readFile(rollout, "utf8")).toBe(before);

      await chmod(path.dirname(rollout), 0o755);
      await page.getByTestId("move-codex-conversation-confirm").click();
      await expect(sheet).toBeHidden({ timeout: 30_000 });
      expect(await readFile(rollout, "utf8")).toContain('"model_provider":"openai"');
    } finally {
      await chmod(path.dirname(rollout), 0o755);
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

  test("moves several selected Codex conversations at once and says which were skipped", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-batch-" });
    const [first, second, busy] = await seedConversations({
      repoPath: workspace.repoPath,
      conversations: [
        { id: "thread-batch-1", name: "Rename the parser", isIdle: true },
        { id: "thread-batch-2", name: "Fix the flaky test", isIdle: true },
        { id: "thread-batch-3", name: "Still running", isIdle: false },
      ],
    });
    const busyBefore = await readFile(busy, "utf8");

    try {
      await openSessionHistory(page, workspace.workspaceId);
      await page.getByTestId("session-history-select").click();
      for (const id of ["thread-batch-1", "thread-batch-2", "thread-batch-3"]) {
        const row = page.getByTestId(`session-history-row-codex-${id}`);
        await row.click();
        await expect(row).toHaveAttribute("aria-checked", "true");
      }
      await expect(page.getByTestId("session-history-selection-count")).toHaveText("3 selected");
      await page.getByTestId("session-history-selection-move").click();

      const sheet = page.getByTestId("move-codex-conversation-sheet");
      await expect(sheet).toContainText("3 conversations");
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();

      const results = sheet.getByTestId("move-codex-conversation-results");
      await expect(results).toBeVisible({ timeout: 30_000 });
      await expect(
        sheet.getByTestId("move-codex-conversation-result-thread-batch-1"),
      ).toContainText("Moved to openai");
      await expect(
        sheet.getByTestId("move-codex-conversation-result-thread-batch-2"),
      ).toContainText("Moved to openai");
      await expect(
        sheet.getByTestId("move-codex-conversation-result-thread-batch-3"),
      ).toContainText("written to in the last minute");
      expect(await readFile(first, "utf8")).toContain('"model_provider":"openai"');
      expect(await readFile(second, "utf8")).toContain('"model_provider":"openai"');
      expect(await readFile(busy, "utf8")).toBe(busyBefore);

      await page.getByTestId("move-codex-conversation-cancel").click();
      await expect(sheet).toBeHidden();
      await expect(page.getByTestId("session-history-select")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps the dialog open with the reason and backup when one conversation of a batch fails", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-batch-failed-" });
    const [first, second] = await seedConversations({
      repoPath: workspace.repoPath,
      conversations: [
        { id: "thread-batch-1", name: "Rename the parser", isIdle: true },
        { id: "thread-batch-2", name: "Fix the flaky test", isIdle: true },
      ],
    });
    const before = await readFile(second, "utf8");
    // 第二段对话的目录不可写：它挪不成，已改的改回，原因与备份留在框里。
    await chmod(path.dirname(second), 0o555);

    try {
      await openSessionHistory(page, workspace.workspaceId);
      await page.getByTestId("session-history-select").click();
      await page.getByTestId("session-history-row-codex-thread-batch-1").click();
      await page.getByTestId("session-history-row-codex-thread-batch-2").click();
      await page.getByTestId("session-history-selection-move").click();
      const sheet = page.getByTestId("move-codex-conversation-sheet");
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();

      const failed = sheet.getByTestId("move-codex-conversation-result-thread-batch-2");
      await expect(failed).toContainText("Not moved", { timeout: 30_000 });
      await expect(failed).toContainText("codex-model-provider-moves");
      await expect(
        sheet.getByTestId("move-codex-conversation-result-thread-batch-1"),
      ).toContainText("Moved to openai");
      expect(await readFile(first, "utf8")).toContain('"model_provider":"openai"');
      expect(await readFile(second, "utf8")).toBe(before);
      await expect(sheet).toBeVisible();
    } finally {
      await chmod(path.dirname(second), 0o755);
      await workspace.cleanup();
    }
  });

  test("offers the move when a resume fails because the Codex model provider is gone", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-resume-" });
    // 对话记在 osuna_api_endpoint 名下，临时 CODEX_HOME 的 config.toml 里没有这张表。
    await seedGatewayConversation({ repoPath: workspace.repoPath, isIdle: true });

    try {
      const row = await openSessionHistoryRow(page, workspace.workspaceId);
      await row.hover();
      await page.getByTestId(`session-history-kebab-codex:${GATEWAY_THREAD}`).click();
      await page.getByTestId(`session-history-menu-import-codex:${GATEWAY_THREAD}`).click();

      const error = page.getByTestId("session-history-import-error");
      await expect(error).toContainText("Codex can't continue this conversation", {
        timeout: 30_000,
      });
      await expect(error).toContainText(
        "This conversation is filed under the Codex model provider osuna_api_endpoint",
      );
      await error.getByTestId("session-history-import-error-move").click();
      const sheet = page.getByTestId("move-codex-conversation-sheet");
      await expect(sheet).toBeVisible();
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();
      await expect(sheet).toBeHidden({ timeout: 30_000 });
      await expect(error).toBeHidden();

      await row.hover();
      await page.getByTestId(`session-history-kebab-codex:${GATEWAY_THREAD}`).click();
      await page.getByTestId(`session-history-menu-import-codex:${GATEWAY_THREAD}`).click();
      await expect(row).toContainText("Osuna", { timeout: 30_000 });
      await expect(error).toBeHidden();
    } finally {
      await workspace.cleanup();
    }
  });

  test("offers the move on the Agent page when an archived Codex agent can't resume", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-agent-" });
    // 每条用例一段新对话：worker 的 daemon 是共用的，导入过的对话不能再导入。
    const agentId = await seedArchivedAgentWhoseProviderIsGone({
      workspace,
      threadId: "thread-agent-moved",
    });

    try {
      const error = await unarchiveUntilRefused({ page, workspace, agentId });
      await expect(error).toContainText("Codex can't continue this agent's conversation");
      await error.getByTestId("agent-unarchive-error-move").click();
      const sheet = page.getByTestId("move-codex-conversation-sheet");
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();
      await expect(sheet).toBeHidden({ timeout: 30_000 });
      await expect(error).toBeHidden();

      await page.getByRole("button", { name: "Unarchive" }).click();
      await expect(page.getByRole("button", { name: "Unarchive" })).toBeHidden({
        timeout: 30_000,
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("keeps a failed move from the Agent page in the dialog", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "session-history-codex-agent-failed-" });
    const agentId = await seedArchivedAgentWhoseProviderIsGone({
      workspace,
      threadId: "thread-agent-failed",
    });
    const rollout = agentRollout("thread-agent-failed");
    const before = await readFile(rollout, "utf8");
    await chmod(path.dirname(rollout), 0o555);

    try {
      const error = await unarchiveUntilRefused({ page, workspace, agentId });
      await error.getByTestId("agent-unarchive-error-move").click();
      const sheet = page.getByTestId("move-codex-conversation-sheet");
      await page.getByTestId("move-codex-conversation-target-trigger").click();
      await page.getByTestId("move-codex-conversation-target-openai").click();
      await page.getByTestId("move-codex-conversation-confirm").click();

      await expect(sheet.getByTestId("move-codex-conversation-error")).toContainText(
        "Conversation not moved",
        { timeout: 30_000 },
      );
      await expect(sheet).toBeVisible();
      expect(await readFile(rollout, "utf8")).toBe(before);
    } finally {
      await chmod(path.dirname(rollout), 0o755);
      await workspace.cleanup();
    }
  });
});

const GATEWAY_THREAD = "thread-gateway";
const CLAUDE_SESSION = "5f0c2d3e-0000-4000-8000-00000000c1a0";

/** 一段 Claude Code 会话：假 Claude 的 CLAUDE_CONFIG_DIR/projects 下的一个会话文件。 */
async function seedClaudeSession(repoPath: string): Promise<void> {
  const directory = path.join(claudeConfigDir, "projects", "-session-history-claude");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${CLAUDE_SESSION}.jsonl`),
    `${JSON.stringify({
      type: "custom-title",
      customTitle: "Tidy the README",
      sessionId: CLAUDE_SESSION,
      cwd: repoPath,
    })}\n`,
  );
}

function agentRollout(threadId: string): string {
  return path.join(
    codexHome,
    "sessions",
    "2026",
    "10",
    "10",
    `rollout-2026-10-17T10-00-00-${threadId}.jsonl`,
  );
}

/**
 * 一个已归档的 Codex Agent：对话先记在 cc 名下（config.toml 里有表）导入，再归档；之后 cc 从
 * config.toml 里拿掉，取消归档时 Codex 就续不上。
 */
async function seedArchivedAgentWhoseProviderIsGone(input: {
  workspace: SeededWorkspace;
  threadId: string;
}): Promise<string> {
  const { workspace, threadId } = input;
  await seedConversations({
    repoPath: workspace.repoPath,
    conversations: [{ id: threadId, name: "Tidy the parser", isIdle: true }],
    provider: "cc",
  });
  await writeFile(path.join(codexHome, "config.toml"), '[model_providers.cc]\nname = "CC"\n');
  const client = workspace.client as unknown as AgentSeedClient;
  const agent = await client.importAgent({
    providerId: "codex",
    providerHandleId: threadId,
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
  });
  await client.archiveAgent(agent.id);
  await writeFile(path.join(codexHome, "config.toml"), "");
  return agent.id;
}

/** 打开这个已归档 Agent 的页面并按「取消归档」，直到续不上的错误出来（页面刚连上时按钮可能还没就绪）。 */
async function unarchiveUntilRefused(input: {
  page: Page;
  workspace: SeededWorkspace;
  agentId: string;
}) {
  const { page, workspace, agentId } = input;
  await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId });
  const error = page.getByTestId("agent-unarchive-error");
  await expect(page.getByText("Start chatting with this agent...")).toBeVisible({
    timeout: 30_000,
  });
  await expect(async () => {
    await page.getByRole("button", { name: "Unarchive" }).click();
    await expect(error).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  return error;
}

/** 种子客户端就是完整的 DaemonClient；这里只用到导入与归档。 */
interface AgentSeedClient {
  importAgent(input: {
    providerId: string;
    providerHandleId: string;
    cwd: string;
    workspaceId: string;
  }): Promise<{ id: string }>;
  archiveAgent(agentId: string): Promise<unknown>;
}

/** 几段记在中转站服务商名下的对话：对话文件放进临时 CODEX_HOME，假 Codex 列表时读它们。返回对话文件路径。 */
async function seedConversations(input: {
  repoPath: string;
  conversations: Array<{ id: string; name: string; isIdle: boolean }>;
  provider?: string;
}): Promise<string[]> {
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const threads = [];
  const rollouts = [];
  for (const [index, conversation] of input.conversations.entries()) {
    // 每段对话一个日期目录，好让一段的目录不可写而不影响别的。
    const directory = path.join(codexHome, "sessions", "2026", "10", String(10 + index));
    const rollout = path.join(directory, `rollout-2026-10-17T10-00-00-${conversation.id}.jsonl`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      rollout,
      `${JSON.stringify({
        timestamp: "2026-10-17T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: conversation.id,
          cwd: input.repoPath,
          model_provider: input.provider ?? "osuna_api_endpoint",
        },
      })}\n`,
    );
    if (conversation.isIdle) await utimes(rollout, anHourAgo, anHourAgo);
    threads.push({
      id: conversation.id,
      cwd: input.repoPath,
      name: conversation.name,
      path: rollout,
      updatedAt: Math.floor(Date.now() / 1000) - 120 - index,
    });
    rollouts.push(rollout);
  }
  await writeFile(threadsFile, JSON.stringify(threads));
  return rollouts;
}

/** 一段记在中转站服务商名下的对话。 */
async function seedGatewayConversation(input: {
  repoPath: string;
  isIdle: boolean;
}): Promise<string> {
  const [rollout] = await seedConversations({
    repoPath: input.repoPath,
    conversations: [
      { id: GATEWAY_THREAD, name: "Started through the gateway", isIdle: input.isIdle },
    ],
  });
  return rollout!;
}

async function openSessionHistory(page: Page, workspaceId: string) {
  await gotoWorkspace(page, workspaceId);
  await waitForWorkspaceTabsVisible(page);
  const explorer = await ensureExplorerSidebar(page);
  await explorer.getByTestId("workspace-tab-session_history").click();
}

async function openSessionHistoryRow(page: Page, workspaceId: string) {
  await openSessionHistory(page, workspaceId);
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
