const SETTINGS_TIMEOUT_MS = 5_000;
const FONT_LIST_TIMEOUT_MS = 15_000;
const PREVIEW_LABEL = "Live preview of content typography, syntax theme, and code font";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readFontSize(locator) {
  return locator.evaluate((element) => getComputedStyle(element).fontSize);
}

export async function runAppearanceFontSizeRegression(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();

  await page.getByLabel("Theme: System", { exact: true }).click();
  await page.getByText("Pure black", { exact: true }).click();

  const interfaceSizeInput = page.getByRole("textbox", { name: "Interface font size" });
  const contentSizeInput = page.getByRole("textbox", { name: "Content font size" });
  const sectionTitle = page.getByText("Theme", { exact: true }).first();
  await interfaceSizeInput.waitFor({ state: "visible", timeout: SETTINGS_TIMEOUT_MS });

  assert((await interfaceSizeInput.inputValue()) === "14", "Interface size did not start at 14px");
  assert((await contentSizeInput.inputValue()) === "15", "Content size did not start at 15px");
  assert(
    (await readFontSize(sectionTitle)) === "13px",
    "Theme label did not start at the default 13px ramp size",
  );

  await interfaceSizeInput.fill("12");
  await interfaceSizeInput.press("Tab");

  await page.waitForFunction(
    () => {
      const interfaceInput = document.querySelector('input[aria-label="Interface font size"]');
      const contentInput = document.querySelector('input[aria-label="Content font size"]');
      const themeLabel = [...document.querySelectorAll("div")].find(
        (element) => element.children.length === 0 && element.textContent?.trim() === "Theme",
      );
      return (
        interfaceInput?.value === "12" &&
        contentInput?.value === "15" &&
        themeLabel instanceof HTMLElement &&
        getComputedStyle(themeLabel).fontSize === "11px"
      );
    },
    undefined,
    { timeout: SETTINGS_TIMEOUT_MS },
  );

  await runCodeFontPickerRegression(page);

  await page.getByRole("button", { name: "Back", exact: true }).click();
}

// Electron 没有注册权限处理器，local-fonts 按默认放行：展开 Code font 选择器就能列出本机字体。
async function runCodeFontPickerRegression(page) {
  await page.getByLabel("Code font family: System default", { exact: true }).click();
  const firstFamilyOption = page.locator('[data-testid^="font-family-option-"]').first();
  await firstFamilyOption.waitFor({ state: "visible", timeout: FONT_LIST_TIMEOUT_MS });
  const family = (await firstFamilyOption.textContent())?.trim();
  assert(family, "Code font picker listed a font without a name");
  await firstFamilyOption.click();

  await page.getByLabel(`Code font family: ${family}`, { exact: true }).waitFor({
    state: "visible",
    timeout: SETTINGS_TIMEOUT_MS,
  });
  await page.waitForFunction(
    ({ expectedFamily, previewLabel }) => {
      const preview = document.querySelector(`[aria-label="${previewLabel}"]`);
      const codeLine = preview?.children[1]?.firstElementChild;
      if (!(codeLine instanceof HTMLElement)) return false;
      const [first = ""] = getComputedStyle(codeLine).fontFamily.split(",");
      return first.trim().replace(/^["']|["']$/g, "") === expectedFamily;
    },
    { expectedFamily: family, previewLabel: PREVIEW_LABEL },
    { timeout: SETTINGS_TIMEOUT_MS },
  );

  await page.getByLabel(`Code font family: ${family}`, { exact: true }).click();
  await page.locator('[data-testid="font-picker-default-option"]').click();
  await page.getByLabel("Code font family: System default", { exact: true }).waitFor({
    state: "visible",
    timeout: SETTINGS_TIMEOUT_MS,
  });
}
