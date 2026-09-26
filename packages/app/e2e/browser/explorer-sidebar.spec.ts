import { expect, test } from "../support/fixtures";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  openFilesPanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

function explorerSidebar(page: Parameters<typeof ensureExplorerSidebar>[0]) {
  return page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
}

test.describe("Explorer sidebar", () => {
  test("starts with Files and Changes, switches views, and toggles without changing main", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-defaults-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const mainTabsBefore = await page
        .getByTestId("workspace-pane-main")
        .locator('[data-testid^="workspace-tab-"]')
        .count();

      const explorer = await ensureExplorerSidebar(page);
      await expect(explorer.getByTestId("explorer-sidebar-tab-files")).toBeVisible();
      await expect(explorer.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible();
      await expect(explorer.getByTestId("workspace-new-tab-button")).toHaveCount(0);

      await openFilesPanel(page);
      await expect(explorer.getByTestId("file-explorer-tree-scroll")).toBeVisible();

      await explorer.getByTestId("explorer-sidebar-tab-changes_tree").click();
      await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();

      await page.getByTestId("workspace-explorer-toggle").first().click();
      await expect(explorerSidebar(page)).toHaveCount(0);
      await expect(
        page.getByTestId("workspace-pane-main").locator('[data-testid^="workspace-tab-"]'),
      ).toHaveCount(mainTabsBefore);
    } finally {
      await workspace.cleanup();
    }
  });

  test("draws its tabs as workspace tab chips", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-tab-chips-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const explorer = await ensureExplorerSidebar(page);
      await explorer.getByTestId("explorer-sidebar-tab-changes_tree").click();
      const activeExplorerTab = explorer.getByTestId("explorer-sidebar-tab-changes_tree");
      const idleExplorerTab = explorer.getByTestId("explorer-sidebar-tab-files");
      const activeMainTab = page
        .getByTestId("workspace-pane-main")
        .locator('[data-testid^="workspace-tab-"][aria-selected="true"]')
        .filter({ visible: true })
        .first();
      await page.mouse.move(0, 0);

      await expect(activeExplorerTab).toHaveCSS("height", "26px");
      await expect(activeExplorerTab).toHaveCSS("border-radius", "8px");
      // Explorer 不持有焦点，当前 tab 与聚焦 pane 的当前 tab 同一档底色。
      const mainFill = await activeMainTab.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await expect(activeExplorerTab).toHaveCSS("background-color", mainFill);
      await expect(idleExplorerTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    } finally {
      await workspace.cleanup();
    }
  });
});
