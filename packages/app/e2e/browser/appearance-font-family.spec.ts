import { expect, test } from "../support/fixtures";
import type { Page } from "@playwright/test";
import { openSettingsSection } from "../support/helpers/settings";

async function openAppearance(page: Page) {
  await page.goto("/settings");
  await openSettingsSection(page, "appearance");
}

// Osuna 在 Web 上用系统字体选择器代替文本框：按钮以「字段: 当前值」命名，空值显示 System default。
function fontFamilyButton(page: Page, name: string, family: string) {
  return page.getByRole("button", { name: `${name}: ${family || "System default"}`, exact: true });
}

async function setFontFamily(page: Page, name: string, family: string) {
  await page.getByRole("button", { name: new RegExp(`^${name}: `) }).click();
  if (family === "") {
    await page.getByTestId("font-picker-default-option").click();
    return;
  }
  await page.getByPlaceholder("Search fonts").fill(family);
  await page.getByTestId("font-picker-custom-option").click();
}

for (const name of ["Code font family", "Interface font family"]) {
  test(`keeps settings usable after an unfinished quote in ${name}`, async ({ page }, testInfo) => {
    await openAppearance(page);
    await setFontFamily(page, name, "'Fira Code', monospace");
    await expect(fontFamilyButton(page, name, "'Fira Code', monospace")).toBeVisible();

    await setFontFamily(page, name, "'foo");
    await expect(fontFamilyButton(page, name, "'Fira Code', monospace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
    // Osuna 的设置分区标题用 typeScale.label（13px），上游是 12px
    await expect(page.getByText("Theme", { exact: true }).first()).toHaveCSS("font-size", "13px");

    await page.screenshot({ path: testInfo.outputPath("rejected-font.png") });
    await page.reload();
    await expect(fontFamilyButton(page, name, "'Fira Code', monospace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
    await setFontFamily(page, name, "");
    await expect(fontFamilyButton(page, name, "")).toBeVisible();
  });
}

test("opens settings with defaults when a malformed font was already saved", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ monoFontFamily: "'foo", uiFontFamily: '"foo' }),
    );
  });
  await openAppearance(page);
  await expect(fontFamilyButton(page, "Code font family", "")).toBeVisible();
  await expect(fontFamilyButton(page, "Interface font family", "")).toBeVisible();
  await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
  await expect(page.getByText("Theme", { exact: true }).first()).toHaveCSS("font-size", "13px");
});
