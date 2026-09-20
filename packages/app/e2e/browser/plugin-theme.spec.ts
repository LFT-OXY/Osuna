import { pluginRequirements } from "../support/helpers/plugin-fixture";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { openSettingsSection } from "../support/helpers/settings";

const PLUGIN_ID = "plugin-theme-e2e";

// 配色取自 Catppuccin Mocha / Latte 的 base, text, surface0, surface1, mauve, subtext0, overlay0。
// 显示名也故意用真名和内置主题撞上：这正是装了 Catppuccin 插件的用户看到的，选择器要靠插件 id
// 副标题把两条分开，而不是靠夹具改名绕开。
const PLUGIN_SOURCE = `export default function contribute(plugin) {
  plugin.addTheme({
    id: "mocha",
    name: "Catppuccin Mocha",
    appearance: "dark",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      raised: "#313244",
      control: "#45475a",
      border: "#45475a",
      accent: "#cba6f7",
      mutedForeground: "#a6adc8",
      ring: "#6c7086",
    },
  });
  plugin.addTheme({
    id: "latte",
    name: "Catppuccin Latte",
    appearance: "light",
    colors: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      raised: "#e6e9ef",
      control: "#dce0e8",
      border: "#ccd0da",
      accent: "#8839ef",
      mutedForeground: "#6c6f85",
      ring: "#9ca0b0",
    },
  });
  return () => {};
}`;

// settingsStyles.sectionHeaderTitle paints from foregroundMuted, so the section heading proves the
// contributed palette reached the semantic tokens rather than just the swatch.
const DARK_FIXTURE_MUTED_FOREGROUND = "rgb(166, 173, 200)";
const LIGHT_FIXTURE_MUTED_FOREGROUND = "rgb(108, 111, 133)";

// 撞名时触发器也要带限定，否则无障碍标签仍然指向两个主题。
const QUALIFIED_DARK = `Catppuccin Mocha (${PLUGIN_ID})`;
const QUALIFIED_LIGHT = `Catppuccin Latte (${PLUGIN_ID})`;

test("applies a contributed theme and falls back when its plugin is gone", async ({
  page,
}, testInfo) => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-plugin-theme-e2e-"));
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previousConfig = await client.getDaemonConfig();
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: PLUGIN_ID, requirements: pluginRequirements }),
  );
  await writeFile(path.join(directory, "index.client.ts"), PLUGIN_SOURCE);

  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await openSettingsSection(page, "appearance");

    const sectionTitle = page.getByText("Theme", { exact: true }).first();
    await page.getByLabel("Theme: System", { exact: true }).click();
    // 两条 "Catppuccin Mocha" 同时在菜单里，插件那条靠插件 id 副标题被单独指认。
    const mochaItems = page.getByRole("menuitem").filter({ hasText: "Catppuccin Mocha" });
    const darkFixtureItem = mochaItems.filter({ hasText: PLUGIN_ID });
    const builtInMochaItem = mochaItems.filter({ hasNotText: PLUGIN_ID });
    await expect(darkFixtureItem).toBeVisible({ timeout: 30_000 });
    await expect(mochaItems).toHaveCount(2);
    await expect(darkFixtureItem).toHaveCount(1);
    await expect(builtInMochaItem).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath("plugin-theme-picker.png"),
      animations: "disabled",
      fullPage: true,
    });

    await test.step("a contributed light theme uses the light palette", async () => {
      await page
        .getByRole("menuitem")
        .filter({ hasText: "Catppuccin Latte" })
        .filter({ hasText: PLUGIN_ID })
        .click();
      await expect(page.getByLabel(`Theme: ${QUALIFIED_LIGHT}`, { exact: true })).toBeVisible();
      await expect(sectionTitle).toHaveCSS("color", LIGHT_FIXTURE_MUTED_FOREGROUND);
      await page.getByLabel(`Theme: ${QUALIFIED_LIGHT}`, { exact: true }).click();
    });

    await darkFixtureItem.click();
    await expect(page.getByLabel(`Theme: ${QUALIFIED_DARK}`, { exact: true })).toBeVisible();
    await expect(sectionTitle).toHaveCSS("color", DARK_FIXTURE_MUTED_FOREGROUND);
    await page.screenshot({
      path: testInfo.outputPath("plugin-theme-applied.png"),
      fullPage: true,
    });

    await test.step("the selection survives a reload", async () => {
      await page.reload();
      await expect(page.getByLabel(`Theme: ${QUALIFIED_DARK}`, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(sectionTitle).toHaveCSS("color", DARK_FIXTURE_MUTED_FOREGROUND);
    });

    await test.step("removing the plugin falls back to the default theme", async () => {
      await client.removePlugin(PLUGIN_ID);
      await expect(page.getByLabel("Theme: System", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(sectionTitle).not.toHaveCSS("color", DARK_FIXTURE_MUTED_FOREGROUND);
      await page.screenshot({
        path: testInfo.outputPath("plugin-theme-fallback.png"),
        fullPage: true,
      });
    });
  } finally {
    await client.removePlugin(PLUGIN_ID).catch(() => undefined);
    await client
      .patchDaemonConfig({ pluginsEnabled: previousConfig.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await client.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
