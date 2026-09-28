import type { Locator } from "@playwright/test";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { expect, type Page } from "../fixtures";

const PROVIDER_BUTTON = "agent-provider-selector";

/** 纯图标的 provider 按钮以当前 provider 命名。 */
export function providerButton(page: Page, providerLabel: string): Locator {
  return page
    .getByRole("button", { name: `Select agent provider (${providerLabel})`, exact: true })
    .filter({ visible: true });
}

function providerMenu(page: Page): Locator {
  return page.getByTestId("combobox-desktop-container");
}

export function providerMenuOption(page: Page, providerId: string): Locator {
  return providerMenu(page).getByTestId(`agent-provider-option-${providerId}`);
}

export function moreAgentsRow(page: Page): Locator {
  return providerMenu(page).getByTestId("agent-provider-more");
}

/** 展开后折叠区的行都排在「More agents」行之后，数量应等于标题里的 N。 */
export async function expectMoreAgentsCountMatchesRows(page: Page): Promise<void> {
  const title = (await moreAgentsRow(page).innerText()).trim();
  const count = Number(/\((\d+)\)$/.exec(title)?.[1]);
  const rowIds = await providerMenu(page)
    .locator('[data-testid^="agent-provider-option-"], [data-testid="agent-provider-more"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid") ?? ""));
  expect(rowIds.length - rowIds.indexOf("agent-provider-more") - 1, title).toBe(count);
}

export async function openProviderMenu(page: Page): Promise<void> {
  await page.getByTestId(PROVIDER_BUTTON).filter({ visible: true }).click();
  await expect(providerMenu(page)).toBeVisible({ timeout: 30_000 });
}

/** 菜单打开时高亮当前 provider；方向键按屏幕顺序移动，步数从实际行序里读。 */
export async function moveProviderHighlight(
  page: Page,
  input: { from: string; to: string },
): Promise<void> {
  const rowIds = await providerMenu(page)
    .locator('[data-testid^="agent-provider-option-"], [data-testid="agent-provider-more"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid") ?? ""));
  const from = rowIds.indexOf(`agent-provider-option-${input.from}`);
  const to = rowIds.indexOf(`agent-provider-option-${input.to}`);
  expect(from, `menu rows: ${JSON.stringify(rowIds)}`).toBeGreaterThanOrEqual(0);
  expect(to, `menu rows: ${JSON.stringify(rowIds)}`).toBeGreaterThanOrEqual(0);
  const key = to > from ? "ArrowDown" : "ArrowUp";
  for (let step = 0; step < Math.abs(to - from); step += 1) {
    await page.keyboard.press(key);
  }
}

export async function chooseProvider(page: Page, providerId: string): Promise<void> {
  await providerMenuOption(page, providerId).click();
  await expect(providerMenu(page)).toHaveCount(0, { timeout: 30_000 });
}

/** 模型菜单只列当前 provider，换 provider 要走 provider 按钮；不可用的在折叠区里。 */
export async function selectComposerProvider(page: Page, providerId: string): Promise<void> {
  await openProviderMenu(page);
  // 先等列表渲染出行再判断目标在不在折叠区，否则会误点「More agents」把它收起来。
  await expect(
    providerMenu(page).locator('[data-testid^="agent-provider-option-"]').first(),
  ).toBeVisible({ timeout: 30_000 });
  const option = providerMenuOption(page, providerId);
  if ((await option.count()) === 0) {
    await moreAgentsRow(page).click();
  }
  await chooseProvider(page, providerId);
}

/** 各控件在屏幕上的左边缘，应按 toolbar 顺序递增。 */
export async function expectToolbarOrder(page: Page, controls: Locator[]): Promise<void> {
  const lefts = await Promise.all(
    controls.map(async (control) => (await control.boundingBox())?.x ?? Number.NaN),
  );
  expect(lefts.every(Number.isFinite), `toolbar lefts: ${JSON.stringify(lefts)}`).toBe(true);
  expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
}

export async function expectProviderStatus(input: {
  client: DaemonClient;
  cwd: string;
  provider: string;
  status: ProviderSnapshotEntry["status"];
}): Promise<void> {
  const { client, cwd, provider, status } = input;
  for (const scope of [undefined, cwd]) {
    await expect
      .poll(
        async () => {
          const snapshot = await client.getProvidersSnapshot(scope ? { cwd: scope } : undefined);
          return snapshot.entries.find((entry) => entry.provider === provider)?.status;
        },
        { timeout: 30_000 },
      )
      .toBe(status);
  }
}
