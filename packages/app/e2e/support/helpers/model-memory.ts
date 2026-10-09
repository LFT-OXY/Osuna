import type { DaemonClient } from "@osuna/client/internal/daemon-client";
import { expect, type Page } from "../fixtures";
import { openModelPicker } from "./agent-profiles";
import { selectComposerProvider } from "./provider-selector";

export async function startWithoutRememberedModel(page: Page) {
  await page.addInitScript(() => localStorage.removeItem("@osuna:create-agent-preferences"));
}

export async function chooseModel(page: Page, provider: string, label: string) {
  await selectComposerProvider(page, provider);
  await selectProviderModel(page, provider, label);
}

/** 记住的 provider 就是当前 provider，模型菜单直接打开在它的模型列表上。 */
export async function reselectModel(page: Page, provider: string, label: string) {
  await expectRememberedModel(page, label);
  await selectProviderModel(page, provider, label);
}

async function selectProviderModel(page: Page, provider: string, label: string) {
  await openModelPicker(page);
  await page
    .getByTestId("combobox-desktop-container")
    .locator(`[data-testid^="model-row-${provider}-"]`)
    .filter({ hasText: label })
    .click();
  await expect(
    page
      .getByRole("button", { name: `Select model (${label})`, exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
}

export async function expectSavedSelection(page: Page, provider: string, model: string) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("@osuna:create-agent-preferences") ?? "null"),
      ),
    )
    .toMatchObject({ provider, providerPreferences: { [provider]: { model } } });
}

export async function expectCreatedModelAgents(
  page: Page,
  client: DaemonClient,
  provider: string,
  model: string,
  count: number,
) {
  await expect
    .poll(
      async () => {
        const result = await client.fetchAgents({ scope: "active" });
        return result.entries
          .filter(({ agent }) => agent.provider === provider)
          .map(({ agent }) => agent.model);
      },
      { timeout: 60_000 },
    )
    .toEqual(Array(count).fill(model));
  await expect(page.getByTestId(/^workspace-tab-agent_/).filter({ visible: true })).toHaveCount(1);
}

export async function expectRememberedModel(page: Page, label: string) {
  await expect(
    page
      .getByRole("button", { name: `Select model (${label})`, exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
}
