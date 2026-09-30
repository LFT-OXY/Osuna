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

const fixtures = createUsageFixtureRoots("paseo-price-table-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

/** Token totals come only from the parsers, so they are exact. */
const FIXTURE_TOKENS = "180,248";

interface PricingConfigClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(): Promise<{
    config: { usage?: { pricing?: { autoUpdate?: boolean } } };
  }>;
  patchDaemonConfig(patch: { usage: { pricing: { overrides: [] } } }): Promise<unknown>;
}

/** 清空覆盖价：同一个 worker daemon 上前面的用例可能已经给无价格的模型定过价。 */
async function clearCustomPrices(): Promise<void> {
  const client = await connectDaemonClient<PricingConfigClient>({
    clientIdPrefix: "price-table-e2e",
  });
  try {
    await client.patchDaemonConfig({ usage: { pricing: { overrides: [] } } });
  } finally {
    await client.close().catch(() => undefined);
  }
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

/** LiteLLM 组的副标题：daemon 读的是内置快照还是联网缓存都认。 */
const LITELLM_SUBTITLE =
  /(Bundled LiteLLM snapshot|LiteLLM prices fetched online), updated .+ · \$ per million tokens/;

/**
 * 内置快照每次发版前都会刷新，所以它漏掉哪个模型不是常量。无价格的模型排在自定义
 * 价格组最前面，取这一组的第一行，不管它是哪个模型。
 */
async function topRowModel(page: Page): Promise<string> {
  const firstRow = page
    .getByTestId("price-table-custom-group")
    .locator('[data-testid^="price-table-row-"]')
    .first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const testId = await firstRow.getAttribute("data-testid");
  if (!testId) throw new Error("Expected the first price table row to carry a testID.");
  return testId.replace("price-table-row-", "");
}

/**
 * 自定义组第一行的模型。调用前先 `clearCustomPrices()`：这样它一定是无价格数据的
 * 那一行，输入框一进来就开着。
 */
async function openUnpricedRowEditor(page: Page): Promise<string> {
  const model = await topRowModel(page);
  await expect(page.getByTestId(`price-table-input-${model}-input`)).toBeVisible();
  return model;
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
      await expect(page.getByTestId("price-table-litellm-group")).toContainText(LITELLM_SUBTITLE);
      await expect(page.getByTestId("provider-usage-card")).toHaveCount(0);
    });

    const model = await topRowModel(page);

    await test.step("a half-filled price is refused with a reason", async () => {
      await page.getByTestId(`price-table-input-${model}-input`).fill("10");
      await page.getByTestId(`price-table-save-${model}`).click();

      await expect(page.getByTestId(`price-table-error-${model}`)).toHaveText(
        "Enter a number in all four columns.",
      );
      // 错误替换了状态行；被拒的保存没有写出去，这一行仍开着输入框、没有编辑按钮。
      await expect(page.getByTestId(`price-table-row-${model}`)).not.toContainText(
        "No price data · estimated $0",
      );
      await expect(page.getByTestId(`price-table-input-${model}-output`)).toBeVisible();
      await expect(page.getByTestId(`price-table-edit-${model}`)).toHaveCount(0);
    });

    await test.step("the unpriced model leads the custom group and takes a custom price", async () => {
      const group = page.getByTestId("price-table-custom-group");
      const row = group.getByTestId(`price-table-row-${model}`);
      await expect(group).toContainText(/No price data \d+/);

      // The model the snapshot misses is a small slice of the fixture tree, so
      // the price has to be absurd for the two-decimal total to move at all.
      await page.getByTestId(`price-table-input-${model}-input`).fill("1000000");
      await page.getByTestId(`price-table-input-${model}-cachedInput`).fill("0");
      await page.getByTestId(`price-table-input-${model}-cacheWrite`).fill("0");
      await page.getByTestId(`price-table-input-${model}-output`).fill("1000000");
      await page.getByTestId(`price-table-save-${model}`).click();

      // 保存后这一行留在自定义组，变成显示数值的已定价状态。
      await expect(row).toContainText("Custom price", { timeout: 30_000 });
      await expect(row).not.toContainText("No price data · estimated $0");
      await expect(row).toContainText("1000000");
      await expect(group.getByTestId(`price-table-edit-${model}`)).toBeVisible();
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
    // The worker daemon starts with PASEO_USAGE_PRICING_AUTO_UPDATE=0.
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
    await clearCustomPrices();
    await installDaemonConfigFailureFixture(page, "config is read-only on this host");

    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHostSection(page, serverId, "usage");

    const model = await openUnpricedRowEditor(page);
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

    const group = page.getByTestId("price-table-litellm-group");
    const button = page.getByTestId("price-table-refresh");
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
    await refresh.waitForRequestCount(1);

    // 没有错误时，错误那一格换回副标题。
    await expect(page.getByTestId("price-table-control-error")).toHaveCount(0);
    await expect(button).toBeEnabled();
    // 副标题仍然报得出快照时间：刷新没有把卡片打回加载态。
    await expect(group).toContainText(LITELLM_SUBTITLE);
  });

  test("the LiteLLM group folds its models until asked", async ({ page }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHostSection(page, serverId, "usage");

    const group = page.getByTestId("price-table-litellm-group");
    const toggle = page.getByTestId("price-table-litellm-toggle");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toContainText(/\d+ models? priced by LiteLLM/);
    await expect(group.locator('[data-testid^="price-table-row-"]')).toHaveCount(0);

    await toggle.click();
    const firstRow = group.locator('[data-testid^="price-table-row-"]').first();
    await expect(firstRow).toBeVisible();
    // 这一组只读：没有输入框，也没有保存。
    await expect(group.locator('[data-testid^="price-table-input-"]')).toHaveCount(0);
    await expect(group.locator('[data-testid^="price-table-save-"]')).toHaveCount(0);

    await toggle.click();
    await expect(group.locator('[data-testid^="price-table-row-"]')).toHaveCount(0);
  });
});
