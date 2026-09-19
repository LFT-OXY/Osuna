import { pluginRequirements } from "../support/helpers/plugin-fixture";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { openSettingsSection } from "../support/helpers/settings";

const PLUGIN_ID = "plugin-theme-e2e";

// 配色取自 Catppuccin Mocha / Latte 的 base, text, surface0, surface1, mauve, subtext0, overlay0，
// 但显示名必须是夹具自己的 —— 这两套 Catppuccin 现在是内置主题，同名会让文字选择器撞车。
const PLUGIN_SOURCE = `export default function contribute(plugin) {
  plugin.addTheme({
    id: "mocha",
    name: "Plugin Fixture Dark",
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
    name: "Plugin Fixture Light",
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
    const darkFixtureItem = page.getByText("Plugin Fixture Dark", { exact: true });
    await expect(darkFixtureItem).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: testInfo.outputPath("plugin-theme-picker.png"),
      animations: "disabled",
      fullPage: true,
    });

    await test.step("a contributed light theme uses the light palette", async () => {
      await page.getByText("Plugin Fixture Light", { exact: true }).click();
      await expect(page.getByLabel("Theme: Plugin Fixture Light", { exact: true })).toBeVisible();
      await expect(sectionTitle).toHaveCSS("color", LIGHT_FIXTURE_MUTED_FOREGROUND);
      await page.getByLabel("Theme: Plugin Fixture Light", { exact: true }).click();
    });

    await darkFixtureItem.click();
    await expect(page.getByLabel("Theme: Plugin Fixture Dark", { exact: true })).toBeVisible();
    await expect(sectionTitle).toHaveCSS("color", DARK_FIXTURE_MUTED_FOREGROUND);
    await page.screenshot({
      path: testInfo.outputPath("plugin-theme-applied.png"),
      fullPage: true,
    });

    await test.step("the selection survives a reload", async () => {
      await page.reload();
      await expect(page.getByLabel("Theme: Plugin Fixture Dark", { exact: true })).toBeVisible({
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
