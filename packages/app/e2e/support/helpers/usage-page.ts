import { expect, type Page } from "@playwright/test";
import { gotoAppShell } from "./app";

export async function openUsagePage(page: Page): Promise<void> {
  await gotoAppShell(page);
  await openUsagePageFromShell(page);
}

/**
 * Reaches the page through the sidebar without navigating. The auto-seed fixture
 * rewrites the host registry on every navigation, so a spec that has just added
 * a host must stay inside the loaded app.
 */
export async function openUsagePageFromShell(page: Page): Promise<void> {
  // A reload keeps the route, so the row is only needed when we are elsewhere.
  if (!page.url().endsWith("/usage")) {
    const sidebarRow = page.locator('[data-testid="sidebar-usage"]:visible').first();
    await expect(sidebarRow).toBeVisible({ timeout: 30_000 });
    await sidebarRow.click();
  }
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByTestId("usage-overview")).toBeVisible({ timeout: 30_000 });
}

async function usageHeroTokens(page: Page): Promise<string> {
  return (await page.getByTestId("usage-total-tokens").textContent()) ?? "";
}

/** The scan is periodic, so the hero starts at zero and fills in. */
export async function waitForUsageTotal(page: Page, expected: string): Promise<void> {
  await expect.poll(() => usageHeroTokens(page), { timeout: 30_000 }).toBe(expected);
}

export async function openUsageHostFilter(page: Page): Promise<void> {
  await page.getByTestId("usage-host-filter-trigger").click();
  await expect(page.getByTestId("usage-host-filter-menu")).toBeVisible({ timeout: 10_000 });
}
