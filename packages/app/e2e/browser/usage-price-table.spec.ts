import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsHostSection } from "../support/helpers/settings";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsagePage, waitForUsageTotal } from "../support/helpers/usage-page";
import {
  installDaemonConfigFailureFixture,
  installPricingRefreshFixture,
} from "../support/helpers/usage-pricing";

const fixtures = createUsageFixtureRoots("osuna-price-table-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

/** Token totals come only from the parsers, so they are exact. */
const FIXTURE_TOKENS = "180,248";

interface PricingConfigClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(): Promise<{
    config: { usage?: { pricing?: { autoUpdate?: boolean } } };
  }>;
}

/** Reads the switch back out of the daemon, not out of the page it just set. */
async function readAutoUpdate(): Promise<boolean | undefined> {
  const client = await connectDaemonClient<PricingConfigClient>({
    clientIdPrefix: "price-table-e2e",
  });
  try {
    const { config } = await client.getDaemonConfig();
    return config.usage?.pricing?.autoUpdate;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * The bundled price snapshot is refreshed before a release, so which model it
 * misses is not a constant. The daemon sorts unpriced models first, so the top
 * row is the one to price, whichever it turns out to be.
 */
async function topRowModel(page: Page): Promise<string> {
  const firstRow = page.locator('[data-testid^="price-table-row-"]').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const testId = await firstRow.getAttribute("data-testid");
  if (!testId) throw new Error("Expected the first price table row to carry a testID.");
  return testId.replace("price-table-row-", "");
}

/**
 * Opens the editor on a row that already has a price, and answers with its
 * model. Which model the snapshot misses is not fixed, and a sibling test may
 * have priced it already, so a priced row is the only row every run has.
 */
async function openPricedRowEditor(page: Page): Promise<string> {
  const editButton = page.locator('[data-testid^="price-table-edit-"]').first();
  await expect(editButton).toBeVisible({ timeout: 30_000 });
  const testId = await editButton.getAttribute("data-testid");
  if (!testId) throw new Error("Expected the edit button to carry a testID.");
  await editButton.click();
  return testId.replace("price-table-edit-", "");
}

test.describe("Price table", () => {
  test.describe.configure({ timeout: 300_000 });

  test("prices the model the snapshot misses, and the usage page follows", async ({ page }) => {
    let costBefore = "";

    await test.step("the usage page reports one model it cannot price", async () => {
      await openUsagePage(page);
      await waitForUsageTotal(page, FIXTURE_TOKENS);
      await expect(page.getByTestId("usage-unpriced-summary")).toHaveText(
        "1 model has no price data",
      );
      costBefore = (await page.getByTestId("usage-total-cost").textContent()) ?? "";
      expect(costBefore).toMatch(/^\$\d+\.\d{2}$/);
    });

    const serverId = getServerId();
    // The usage page is a top-level route with its own header; settings is
    // reached from the shell, not from here.
    await gotoAppShell(page);
    await openSettings(page);

    await test.step("the host section is the price table now", async () => {
      await expect(page.getByTestId("settings-host-section-usage")).toContainText("Price table");
      await openSettingsHostSection(page, serverId, "usage");
      const card = page.getByTestId("host-page-price-table-card");
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText(
        /\$ per million tokens · LiteLLM snapshot, updated .+, \d+ models/,
      );
      await expect(page.getByTestId("provider-usage-card")).toHaveCount(0);
    });

    const model = await topRowModel(page);

    await test.step("a half-filled price is refused with a reason", async () => {
      await page.getByTestId(`price-table-input-${model}-input`).fill("10");
      await page.getByTestId(`price-table-save-${model}`).click();

      await expect(page.getByTestId(`price-table-error-${model}`)).toHaveText(
        "Enter a number in all four columns.",
      );
      // 被拒的保存没有写出去：这一行还是无价格。
      await expect(page.getByTestId(`price-table-row-${model}`)).toContainText(
        "No price data · estimated $0",
      );
    });

    await test.step("the unpriced model leads the table and takes a custom price", async () => {
      const row = page.getByTestId(`price-table-row-${model}`);
      await expect(row).toContainText("No price data · estimated $0");

      // The model the snapshot misses is a small slice of the fixture tree, so
      // the price has to be absurd for the two-decimal total to move at all.
      await page.getByTestId(`price-table-input-${model}-input`).fill("1000000");
      await page.getByTestId(`price-table-input-${model}-cachedInput`).fill("0");
      await page.getByTestId(`price-table-input-${model}-cacheWrite`).fill("0");
      await page.getByTestId(`price-table-input-${model}-output`).fill("1000000");
      await page.getByTestId(`price-table-save-${model}`).click();

      await expect(row).toContainText("Custom", { timeout: 30_000 });
      await expect(row).not.toContainText("No price data · estimated $0");
      await expect(page.getByTestId(`price-table-edit-${model}`)).toBeVisible();
    });

    await test.step("the usage page prices every model and the estimate moves", async () => {
      await openUsagePage(page);
      await waitForUsageTotal(page, FIXTURE_TOKENS);
      await expect(page.getByTestId("usage-unpriced-summary")).toHaveCount(0);
      await expect(page.getByTestId("usage-total-cost")).not.toHaveText(costBefore);
    });
  });

  test("the auto-update switch writes through to the daemon config", async ({ page }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHostSection(page, serverId, "usage");

    const toggle = page.getByTestId("price-table-auto-update-switch");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    // The worker daemon starts with OSUNA_USAGE_PRICING_AUTO_UPDATE=0.
    expect(await readAutoUpdate()).toBe(false);
    await expect(toggle).not.toBeChecked();

    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(await readAutoUpdate()).toBe(true);

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await readAutoUpdate()).toBe(false);
  });

  test("a refused save keeps the row open and names the daemon's reason", async ({ page }) => {
    const serverId = getServerId();
    await installDaemonConfigFailureFixture(page, "config is read-only on this host");

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHostSection(page, serverId, "usage");

    const model = await openPricedRowEditor(page);
    await page.getByTestId(`price-table-input-${model}-input`).fill("1");
    await page.getByTestId(`price-table-input-${model}-cachedInput`).fill("1");
    await page.getByTestId(`price-table-input-${model}-cacheWrite`).fill("1");
    await page.getByTestId(`price-table-input-${model}-output`).fill("1");
    await page.getByTestId(`price-table-save-${model}`).click();

    // 本地化的句子在前，daemon 给的原因在后；`requestType=` / `code=` 那截调试尾巴
    // 不进界面，只进 console。
    await expect(page.getByTestId(`price-table-error-${model}`)).toHaveText(
      "Could not save this price. config is read-only on this host",
    );
    // 草稿没被清掉，用户不必重新输入四列。
    await expect(page.getByTestId(`price-table-save-${model}`)).toBeEnabled();
    await expect(page.getByTestId(`price-table-input-${model}-output`)).toHaveValue("1");
  });

  test("a refused auto-update change names its own failure, not the price's", async ({ page }) => {
    const serverId = getServerId();
    await installDaemonConfigFailureFixture(page, "auto-update is fixed by a launch flag");

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHostSection(page, serverId, "usage");

    const toggle = page.getByTestId("price-table-auto-update-switch");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await toggle.click();

    await expect(page.getByTestId("price-table-control-error")).toHaveText(
      "Could not change auto-update. auto-update is fixed by a launch flag",
    );
  });

  test("refresh now surfaces the reason the daemon could not refresh", async ({ page }) => {
    const serverId = getServerId();
    const refresh = await installPricingRefreshFixture(page, {
      result: "failed",
      fetchedAt: new Date().toISOString(),
      error: "price table host unreachable",
    });

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHostSection(page, serverId, "usage");

    const button = page.getByTestId("price-table-refresh");
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
    await refresh.waitForRequestCount(1);

    await expect(page.getByTestId("price-table-control-error")).toHaveText(
      "price table host unreachable",
    );
    await expect(button).toBeEnabled();
    expect(refresh.requestCount()).toBe(1);
  });

  test("a refresh the daemon accepted leaves no error behind", async ({ page }) => {
    const serverId = getServerId();
    const refresh = await installPricingRefreshFixture(page, {
      result: "updated",
      fetchedAt: new Date().toISOString(),
      error: null,
    });

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHostSection(page, serverId, "usage");

    const card = page.getByTestId("host-page-price-table-card");
    const button = page.getByTestId("price-table-refresh");
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
    await refresh.waitForRequestCount(1);

    // 这一行常驻占位，所以「没有错误」是空字符串而不是不存在。
    await expect(page.getByTestId("price-table-control-error")).toHaveText("");
    await expect(button).toBeEnabled();
    // 副标题仍然报得出快照时间：刷新没有把卡片打回加载态。
    await expect(card).toContainText(
      /\$ per million tokens · LiteLLM snapshot, updated .+, \d+ models/,
    );
  });
});
