import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import {
  connectApiEndpointClient,
  hideHostFeature,
  resetApiEndpoints,
  seedApiEndpoint,
  startFakeRelay,
  type FakeRelay,
} from "../support/helpers/api-endpoints";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  clickProviderRow,
  expectProviderDetail,
  expectProvidersList,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";

/*
 * Pi 提供方页的「使用第三方接口」（任务 10-16-pi-omp-endpoints 工单 02）：打开会改写 Pi 的 models.json 与 settings.json，
 * Pi 的 agent 目录指到临时目录（PI_CODING_AGENT_DIR），绝不碰开发者的 ~/.pi，也不运行真的 Pi。
 */
const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-api-endpoints-pi-"));
const piDir = path.join(cliHome, "pi-agent");
const modelsPath = path.join(piDir, "models.json");
const settingsPath = path.join(piDir, "settings.json");
test.use({
  e2eDaemonEnvironment: {
    PI_CODING_AGENT_DIR: piDir,
    CLAUDE_CONFIG_DIR: path.join(cliHome, "claude"),
    CODEX_HOME: path.join(cliHome, "codex"),
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_PROCESS_TABLE_PATH: path.join(cliHome, "process-table.txt"),
    PASEO_E2E_SYSTEM_PROXY_PATH: path.join(cliHome, "system-proxy.json"),
    PASEO_E2E_FAKE_SITES_PATH: path.join(cliHome, "fake-sites.json"),
    HOME: path.join(cliHome, "home"),
    XDG_CONFIG_HOME: path.join(cliHome, "home", ".config"),
    XDG_DATA_HOME: path.join(cliHome, "home", ".local", "share"),
  },
});

const USER_SETTINGS = `{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "theme": "dark"
}
`;

let relay: FakeRelay;
let client: Awaited<ReturnType<typeof connectApiEndpointClient>>;

test.beforeEach(async ({ page }) => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
  await resetApiEndpoints(client);
  await rm(modelsPath, { force: true });
  await mkdir(piDir, { recursive: true });
  await writeFile(settingsPath, USER_SETTINGS);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(async () => {
  await resetApiEndpoints(client);
  await client.close();
  await relay.close();
});

async function openPiPage(page: Page): Promise<void> {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, "pi");
  await expectProviderDetail(page, serverId, "pi");
}

function agentSection(page: Page): Locator {
  return page.getByTestId("agent-api-endpoints").filter({ visible: true });
}

function inSheet(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true });
}

async function seedRelay(): Promise<void> {
  await seedApiEndpoint(client, {
    name: "Relay A",
    baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
    models: ["glm-5", "kimi-k2"],
  });
}

interface PiSettings {
  defaultProvider?: string;
  defaultModel?: string;
}

async function piSettings(): Promise<PiSettings> {
  return JSON.parse(await readFile(settingsPath, "utf8")) as PiSettings;
}

async function piDefaultModel(): Promise<string | undefined> {
  return (await piSettings()).defaultModel;
}

test("the switch writes Pi's default provider and model, the default model can change, and switching off previews and restores", async ({
  page,
}) => {
  await seedRelay();
  await openPiPage(page);
  const section = agentSection(page);
  const toggle = section.getByTestId("agent-api-endpoints-switch");

  await test.step("off: the switch says what it does for Pi", async () => {
    await expect(section.getByTestId("agent-api-endpoints-switch-hint")).toHaveText(
      "When on, Pi can use the selected models of the endpoints that are on in API endpoints. Turn it off to go back to official.",
    );
    await expect(section.getByTestId("agent-api-endpoints-default-model")).toHaveCount(0);
  });

  await test.step("on: Pi defaults to Osuna's provider with the first model", async () => {
    await toggle.click();
    await expect(toggle).toBeChecked();
    const trigger = section.getByTestId("agent-api-endpoints-default-model-trigger");
    await expect(trigger).toHaveText("glm-5");
    await expect
      .poll(piSettings)
      .toMatchObject({ defaultProvider: "osuna", defaultModel: "glm-5" });
    const models = JSON.parse(await readFile(modelsPath, "utf8")) as {
      providers: { osuna: { models: { id: string }[] } };
    };
    expect(models.providers.osuna.models.map((model) => model.id)).toEqual([
      "glm-5",
      "kimi-k2",
      "relay-a/glm-5",
      "relay-a/kimi-k2",
    ]);
  });

  await test.step("picking another default model rewrites settings.json", async () => {
    await section.getByTestId("agent-api-endpoints-default-model-trigger").click();
    await page.getByTestId("agent-api-endpoints-default-option-kimi-k2").click();
    await expect(section.getByTestId("agent-api-endpoints-default-model-trigger")).toHaveText(
      "kimi-k2",
    );
    await expect.poll(piDefaultModel).toBe("kimi-k2");
  });

  await test.step("switching off lists Pi's default provider and model, then puts them back", async () => {
    await toggle.click();
    await expect(page.getByText("Turn off API endpoints for Pi?")).toBeVisible();
    const settingsFile = inSheet(page, `switch-off-file-${settingsPath}`);
    await expect(settingsFile.getByTestId("switch-off-line-text")).toHaveText([
      '"defaultProvider": "anthropic",',
      '"defaultModel": "claude-sonnet-4-5",',
    ]);
    await expect(settingsFile.getByTestId("switch-off-line-now")).toHaveText([
      'Now: "defaultProvider": "osuna",',
      'Now: "defaultModel": "kimi-k2",',
    ]);
    await expect(inSheet(page, `switch-off-file-${modelsPath}`)).toBeVisible();
    await inSheet(page, "switch-off-confirm").click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });
});

test("a models.json Pi can't read keeps the switch off and says which file, in this section", async ({
  page,
}) => {
  await seedRelay();
  const broken = '{\n  "providers": {}\n  "x": 1\n}\n';
  await writeFile(modelsPath, broken);
  await openPiPage(page);
  const section = agentSection(page);
  const toggle = section.getByTestId("agent-api-endpoints-switch");

  await toggle.click();

  const error = section.getByTestId("agent-api-endpoints-error");
  await expect(error).toContainText("Couldn't change the API endpoint settings for Pi");
  await expect(error).toContainText("models.json");
  await expect(toggle).not.toBeChecked();
  expect(await readFile(modelsPath, "utf8")).toBe(broken);
  expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);

  await writeFile(modelsPath, "{}\n");
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(error).toHaveCount(0);
  await expect.poll(piDefaultModel).toBe("glm-5");
});

test("a host without Pi's API endpoints shows no switch on Pi's page", async ({ page }) => {
  await hideHostFeature(page, "apiEndpointPi");
  await openPiPage(page);
  await expect(page.getByTestId("provider-models-section").filter({ visible: true })).toBeVisible();
  await expect(agentSection(page)).toHaveCount(0);
});
