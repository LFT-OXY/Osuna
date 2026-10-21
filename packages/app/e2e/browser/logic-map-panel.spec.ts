import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

function logicMapSwitch(page: Page): Locator {
  return page.getByTestId("composer-logic-map-switch").filter({ visible: true });
}

function explorerLogicMapTab(page: Page): Locator {
  return page.getByTestId("workspace-explorer-sidebar").getByTestId("workspace-tab-logic_map");
}

/** 打开时在选择层里选"新建"。 */
async function setLogicMapSwitch(page: Page, on: boolean): Promise<void> {
  const toggle = logicMapSwitch(page);
  await toggle.click();
  if (on) {
    await page
      .getByTestId("composer-logic-map-picker")
      .filter({ visible: true })
      .getByTestId("composer-logic-map-picker-new")
      .click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", on ? "true" : "false");
}

test.describe("Logic map tab in the Explorer sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("the first switch-on adds and selects it; once closed, only the + menu brings it back", async ({
    page,
  }, testInfo) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `logic-map-panel-${testInfo.workerIndex}-`,
      title: "Logic map panel agent",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await expect(logicMapSwitch(page)).toHaveAttribute("aria-checked", "false", {
        timeout: 30_000,
      });
      // 没用过逻辑图的 workspace 不带这个标签。
      await expect(page.getByTestId("workspace-tab-logic_map")).toHaveCount(0);

      await setLogicMapSwitch(page, true);

      const tab = explorerLogicMapTab(page);
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
      await expect(page.getByTestId("logic-map-new-map").filter({ visible: true })).toHaveText(
        "StartThe agent hasn't added any nodes yet.",
      );

      await tab.click({ button: "right", position: { x: 12, y: 13 } });
      await page.getByRole("menuitem", { name: "Close", exact: true }).click();
      await expect(tab).toHaveCount(0);

      await setLogicMapSwitch(page, false);
      await setLogicMapSwitch(page, true);
      await expect(tab).toHaveCount(0);

      const explorer = page.getByTestId("workspace-explorer-sidebar");
      await explorer.getByRole("button", { name: "New tab", exact: true }).click();
      const menu = page.getByTestId("workspace-new-tab-menu").filter({ visible: true });
      await menu.getByRole("menuitem", { name: "Logic map", exact: true }).click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    } finally {
      await agent.cleanup();
    }
  });
});
