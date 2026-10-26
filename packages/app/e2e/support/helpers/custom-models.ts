import { expect, type Page } from "@playwright/test";
import { gotoAppShell, openSettings } from "./app";
import { clickProviderRow, openSettingsHostSection } from "./settings";
import { getServerId } from "./server-id";

export async function openCustomModels(page: Page): Promise<void> {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHostSection(page, getServerId(), "providers");
  // 点行的左上角：行中央可能是「Upgrade to …」，会让测试 daemon 真的去升级 CLI。
  await clickProviderRow(page, "claude");
  await expect(page.getByRole("textbox", { name: "Search models" })).toBeVisible();
}

export async function addCustomModel(page: Page, id: string): Promise<void> {
  await page.getByRole("button", { name: "Add model", exact: true }).click();
  await page.getByPlaceholder("e.g. openai/gpt-5").fill(id);
  // Osuna 的添加行就地展开在模型卡片里，不是单独的 sheet。
  await page.getByTestId("provider-add-model-submit").click();
  await expect(page.getByRole("button", { name: `Remove ${id}`, exact: true })).toHaveCount(1);
}

export async function removeCustomModel(page: Page, id: string): Promise<void> {
  await page.getByRole("textbox", { name: "Search models" }).fill(id);
  const remove = page.getByRole("button", { name: `Remove ${id}`, exact: true });
  await expect(remove).toBeInViewport({ ratio: 1 });
  await remove.click();
  await expect(remove).toHaveCount(0);
}

export async function expectCustomModelRetained(page: Page, id: string): Promise<void> {
  await page.getByRole("textbox", { name: "Search models" }).fill(id);
  await expect(page.getByRole("button", { name: `Remove ${id}`, exact: true })).toBeInViewport({
    ratio: 1,
  });
}
