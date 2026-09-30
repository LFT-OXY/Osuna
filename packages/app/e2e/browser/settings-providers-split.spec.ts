import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  expectProviderDetailStacked,
  expectProviderSelected,
  expectProvidersListStacked,
  goBackInSettings,
  openCompactSettings,
  openSettingsHost,
  openSettingsHostSection,
  providerRow,
  readProviderRowIds,
} from "../support/helpers/settings";
import { buildOpenProjectRoute, buildProviderSettingsRoute } from "@/utils/host-routes";

const WIDE_VIEWPORT = { width: 1280, height: 800 };
// 设置侧栏 320，内容区 580，放不下两列（736），又不到紧凑断点。
const NARROW_DESKTOP_VIEWPORT = { width: 900, height: 800 };
const PHONE_VIEWPORT = { width: 390, height: 844 };

async function readTwoProviderIds(page: Page): Promise<[string, string]> {
  const [first, second] = await readProviderRowIds(page);
  if (!first || !second) {
    throw new Error("Expected the e2e daemon to report at least two providers.");
  }
  return [first, second];
}

function readHistoryLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length);
}

test.describe("Settings providers list and detail", () => {
  test("selects providers through the address on a wide window", async ({ page }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openSettingsHostSection(page, serverId, "providers");

    const [first, second] = await readTwoProviderIds(page);

    await test.step("entering the section selects the first provider", async () => {
      await expectProviderSelected(page, serverId, first);
    });

    await test.step("pressing a row replaces the address with that provider", async () => {
      const historyLength = await readHistoryLength(page);
      await providerRow(page, second).click();
      await expectProviderSelected(page, serverId, second);
      await expect(providerRow(page, first)).not.toHaveAttribute("aria-selected", "true");
      expect(await readHistoryLength(page)).toBe(historyLength);
    });

    await test.step("opening a provider address directly selects it", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, second));
      await expectProviderSelected(page, serverId, second);
    });

    await test.step("an unknown provider address falls back to the first provider", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, "no-such-provider"));
      await expectProviderSelected(page, serverId, first);
    });

    await test.step("narrowing keeps the selection and the breadcrumb returns to the list", async () => {
      await page.setViewportSize(NARROW_DESKTOP_VIEWPORT);
      await expectProviderDetailStacked(page, serverId, first);
      await page.getByTestId("settings-providers-breadcrumb").click();
      await expectProvidersListStacked(page, serverId);
    });
  });
});

test.describe("Settings providers list and detail on a narrow desktop window", () => {
  test.use({ viewport: NARROW_DESKTOP_VIEWPORT });

  test("pushes the detail and returns through the breadcrumb", async ({ page }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openSettingsHostSection(page, serverId, "providers");
    await expectProvidersListStacked(page, serverId);
    const [, second] = await readTwoProviderIds(page);

    await test.step("pressing a row pushes its detail", async () => {
      await providerRow(page, second).click();
      await expectProviderDetailStacked(page, serverId, second);
      await expect(page.getByTestId("settings-providers-breadcrumb")).toBeVisible();
    });

    await test.step("the breadcrumb returns to the list", async () => {
      await page.getByTestId("settings-providers-breadcrumb").click();
      await expectProvidersListStacked(page, serverId);
    });

    await test.step("resizing keeps the selected provider", async () => {
      await providerRow(page, second).click();
      await expectProviderDetailStacked(page, serverId, second);
      await page.setViewportSize(WIDE_VIEWPORT);
      await expectProviderSelected(page, serverId, second);
      await page.setViewportSize(NARROW_DESKTOP_VIEWPORT);
      await expectProviderDetailStacked(page, serverId, second);
    });

    await test.step("an unknown provider address returns to the list", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, "no-such-provider"));
      await expectProvidersListStacked(page, serverId);
    });
  });
});

test.describe("Settings providers list and detail on a phone", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("pushes the detail and Back returns to the list", async ({ page }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());
    await openSettingsHostSection(page, serverId, "providers");
    await expectProvidersListStacked(page, serverId);
    const [first] = await readTwoProviderIds(page);

    await test.step("pressing a row pushes its full-screen detail", async () => {
      const [label] = (await providerRow(page, first).innerText()).split("\n");
      await providerRow(page, first).click();
      await expectProviderDetailStacked(page, serverId, first);
      await expect(page.getByTestId("provider-detail-refresh")).toBeVisible();
      // 顶栏标题与页内头部块各显示一次名称。
      await expect(
        page.getByText(label ?? "", { exact: true }).filter({ visible: true }),
      ).toHaveCount(2);
      await expect(
        page
          .getByTestId(`provider-detail-header-${first}`)
          .getByRole("button", { name: "Refresh", exact: true }),
      ).toHaveCount(0);
    });

    await test.step("Back returns to the list", async () => {
      await goBackInSettings(page);
      await expectProvidersListStacked(page, serverId);
    });

    await test.step("an unknown provider address returns to the list", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, "no-such-provider"));
      await expectProvidersListStacked(page, serverId);
    });
  });
});
