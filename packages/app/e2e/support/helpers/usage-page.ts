import { expect, type Page } from "@playwright/test";
import { gotoAppShell } from "./app";
import { daemonWsRoutePattern } from "./daemon-port";

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
    const sidebarRow = page.locator('[data-testid="sidebar-usage-stats"]:visible').first();
    await expect(sidebarRow).toBeVisible({ timeout: 30_000 });
    await sidebarRow.click();
  }
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByTestId("usage-overview")).toBeVisible({ timeout: 30_000 });
  // The app chrome has to survive the navigation. While "/usage" was missing
  // from the route list that enables it, the page landed with no sidebar and no
  // way back out.
  await expect(page.locator('[data-testid="sidebar-usage-stats"]:visible').first()).toBeVisible();
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

/** 从 server_info 去掉 gatewayLedger，模拟没有中转站账本的旧 daemon。在打开页面之前调用。 */
export async function hideGatewayLedger(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string" || !message.includes('"server_info"')) {
        ws.send(message);
        return;
      }
      const envelope = JSON.parse(message) as {
        message?: { payload?: { status?: unknown; features?: Record<string, unknown> } };
      };
      const payload = envelope.message?.payload;
      if (payload?.status === "server_info" && payload.features) {
        delete payload.features.gatewayLedger;
      }
      ws.send(JSON.stringify(envelope));
    });
  });
}
