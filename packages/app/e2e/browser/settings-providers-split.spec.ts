import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  expectProviderSelected,
  openSettingsHost,
  openSettingsHostSection,
  readProviderRowIds,
} from "../support/helpers/settings";
import { buildProviderSettingsRoute } from "@/utils/host-routes";

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

    const [first, second] = await readProviderRowIds(page);
    if (!first || !second) {
      throw new Error("Expected the e2e daemon to report at least two providers.");
    }

    await test.step("entering the section selects the first provider", async () => {
      await expectProviderSelected(page, serverId, first);
    });

    await test.step("pressing a row replaces the address with that provider", async () => {
      const historyLength = await readHistoryLength(page);
      await page.getByTestId(`provider-row-${second}`).click();
      await expectProviderSelected(page, serverId, second);
      await expect(page.getByTestId(`provider-row-${first}`)).not.toHaveAttribute(
        "aria-selected",
        "true",
      );
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
  });
});
