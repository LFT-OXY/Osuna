import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectComposerContextStripBranch,
  expectNoBranchSwitcherInWorkspaceHeader,
  expectWorkspaceBranch,
  openChangesPanel,
  switchBranchFromChangesPanel,
  switchBranchFromComposerContextStrip,
} from "../support/helpers/branch-switcher";
import { clickNewChat } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  checkOutBranchInLinkedWorktree,
  leaveBranchOnlyOnRemote,
  readUpstreamBranch,
  readWorktreeBranchInfo,
} from "../support/helpers/workspace";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

// A freshly opened workspace shows the New tab launcher; the composer (and its
// context strip) arrives with a new agent draft tab.
async function openDraftInSeededWorkspace(page: Page, workspaceId: string): Promise<void> {
  await gotoAppShell(page);
  await waitForSidebarHydration(page);
  await switchWorkspaceViaSidebar({ page, serverId: getServerId(), workspaceId });
  await clickNewChat(page);
}

async function expectBranchOnDisk(repoPath: string, branchName: string): Promise<void> {
  await expect
    .poll(async () => (await readWorktreeBranchInfo({ worktreePath: repoPath })).currentBranch, {
      timeout: 30_000,
    })
    .toBe(branchName);
}

async function renameWorkspaceViaSidebar(
  page: Page,
  input: { workspaceId: string; title: string },
): Promise<void> {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${input.workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${input.workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  const renameItem = page.getByTestId(
    `sidebar-workspace-menu-rename-${serverId}:${input.workspaceId}`,
  );
  await expect(renameItem).toBeVisible({ timeout: 10_000 });
  await renameItem.click();

  const modalPrefix = `sidebar-workspace-rename-modal-${serverId}:${input.workspaceId}`;
  const renameInput = page.getByTestId(`${modalPrefix}-input`);
  await expect(renameInput).toBeVisible({ timeout: 10_000 });
  await renameInput.fill(input.title);
  await page.getByTestId(`${modalPrefix}-submit`).click();
  await expect(renameInput).toHaveCount(0, { timeout: 15_000 });
}

test.describe("Branch switcher", () => {
  // The first test after a spec-file switch can fail while the shared daemon
  // releases stale sessions from the previous spec; one retry stabilizes it.
  test.describe.configure({ retries: 1 });

  test("a custom workspace title stays in the header while the diff panel switches the real branch", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({
      repoPrefix: "branch-coherence-",
      repo: { branches: ["main", "dev"] },
    });

    try {
      expect(workspace.workspaceName).toBe("main");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: workspace.workspaceId });

      const customTitle = "Payments Refactor";
      await renameWorkspaceViaSidebar(page, {
        workspaceId: workspace.workspaceId,
        title: customTitle,
      });

      // The header shows the custom title verbatim (a plain static title), never a
      // branch name, and the branch switcher does not live in the header.
      const headerTitle = page
        .getByTestId("workspace-header-title")
        .filter({ visible: true })
        .first();
      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });
      await expectNoBranchSwitcherInWorkspaceHeader(page);

      // The diff panel's switcher tracks the real branch ("main"), not the title,
      // and switching it checks out the real branch on disk.
      await openChangesPanel(page);
      await expectWorkspaceBranch(page, "main");
      await switchBranchFromChangesPanel(page, { from: "main", to: "dev" });
      await expectWorkspaceBranch(page, "dev");

      // The custom title is unaffected by the branch switch.
      await expect(headerTitle).toHaveText(customTitle, { timeout: 30_000 });

      await expect
        .poll(
          async () =>
            (await readWorktreeBranchInfo({ worktreePath: workspace.repoPath })).currentBranch,
          { timeout: 30_000 },
        )
        .toBe("dev");
    } finally {
      await workspace.cleanup();
    }
  });

  test("the composer context strip switches the workspace to a local branch", async ({ page }) => {
    test.setTimeout(90_000);
    const workspace = await seedWorkspace({
      repoPrefix: "strip-branch-local-",
      repo: { branches: ["main", "dev"] },
    });

    try {
      await openDraftInSeededWorkspace(page, workspace.workspaceId);
      await expectComposerContextStripBranch(page, "main");

      await switchBranchFromComposerContextStrip(page, { from: "main", to: "dev" });

      await expectComposerContextStripBranch(page, "dev");
      await expectBranchOnDisk(workspace.repoPath, "dev");
      await expect(
        page.getByTestId("workspace-header-title").filter({ visible: true }).first(),
      ).toHaveText("dev", { timeout: 30_000 });
      await expect(
        page
          .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`)
          .getByText("dev", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await openChangesPanel(page);
      await expectWorkspaceBranch(page, "dev");
    } finally {
      await workspace.cleanup();
    }
  });

  test("the composer context strip checks out a branch that only exists on the remote", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const workspace = await seedWorkspace({
      repoPrefix: "strip-branch-remote-",
      repo: { withRemote: true, branches: ["main", "remote-only"] },
    });

    try {
      await leaveBranchOnlyOnRemote(workspace.repoPath, "remote-only");

      await openDraftInSeededWorkspace(page, workspace.workspaceId);
      await switchBranchFromComposerContextStrip(page, { from: "main", to: "remote-only" });

      await expectComposerContextStripBranch(page, "remote-only");
      await expectBranchOnDisk(workspace.repoPath, "remote-only");
      expect(readUpstreamBranch(workspace.repoPath, "remote-only")).toBe("origin/remote-only");
    } finally {
      await workspace.cleanup();
    }
  });

  test("the composer context strip stashes uncommitted changes and offers them back on return", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const workspace = await seedWorkspace({
      repoPrefix: "strip-branch-stash-",
      repo: { branches: ["main", "dev"] },
    });
    const readmePath = path.join(workspace.repoPath, "README.md");
    const editedReadme = "# Temp Repo\n\nwork in progress\n";

    try {
      await writeFile(readmePath, editedReadme);
      await openDraftInSeededWorkspace(page, workspace.workspaceId);

      const dialogs: string[] = [];
      page.on("dialog", async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.accept();
      });

      await switchBranchFromComposerContextStrip(page, { from: "main", to: "dev" });
      await expectComposerContextStripBranch(page, "dev");
      await expectBranchOnDisk(workspace.repoPath, "dev");
      expect(await readFile(readmePath, "utf8")).toBe("# Temp Repo\n");

      await switchBranchFromComposerContextStrip(page, { from: "dev", to: "main" });
      await expectComposerContextStripBranch(page, "main");
      await expect.poll(() => readFile(readmePath, "utf8"), { timeout: 30_000 }).toBe(editedReadme);

      expect(dialogs).toEqual([
        "Uncommitted changes\n\nYou have uncommitted changes. Stash them before switching branches?",
        "Restore stashed changes?\n\nThis branch has stashed changes from a previous session. Would you like to restore them?",
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  test("the composer context strip explains a branch held by another worktree", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const workspace = await seedWorkspace({
      repoPrefix: "strip-branch-held-",
      repo: { branches: ["main", "dev"] },
    });
    const linked = await checkOutBranchInLinkedWorktree(workspace.repoPath, "dev");

    try {
      await openDraftInSeededWorkspace(page, workspace.workspaceId);
      await switchBranchFromComposerContextStrip(page, { from: "main", to: "dev" });

      await expect(page.getByTestId("app-toast-message")).toHaveText(
        `Branch dev is already checked out in another worktree at ${linked.path}. Switch to it there.`,
        { timeout: 30_000 },
      );
      await expectComposerContextStripBranch(page, "main");
      await expectBranchOnDisk(workspace.repoPath, "main");
    } finally {
      await workspace.cleanup();
      await linked.cleanup();
    }
  });
});
