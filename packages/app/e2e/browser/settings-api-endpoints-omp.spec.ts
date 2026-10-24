import { mkdtempSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { parse } from "yaml";
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
 * OMP 提供方页的「使用第三方接口」（任务 10-16-pi-omp-endpoints 工单 04）：打开会改写 OMP 默认那套配置的 models.yml 与
 * config.yml。daemon 的家目录是临时目录，OMP 的目录落在其中的 .omp/agent，绝不碰开发者的 ~/.omp，也不运行真的 OMP。
 */
const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-api-endpoints-omp-"));
const homeDir = path.join(cliHome, "home");
const ompDir = path.join(homeDir, ".omp", "agent");
const modelsPath = path.join(ompDir, "models.yml");
const configPath = path.join(ompDir, "config.yml");
// OMP 的命名配置（omp --profile <名字>）都在这里；只有讲命名配置的用例放，用完删掉。
const profilesDir = path.join(homeDir, ".omp", "profiles");
test.use({
  // Osuna 里的 OMP 由假的 OMP（e2e/fixtures/fake-omp-rpc.mjs）扮演；别的 CLI 关掉，免得真的 Pi、Claude Code、Codex 被起来。
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        omp: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/fake-omp-rpc.mjs")],
        },
        pi: { enabled: false },
        claude: { enabled: false },
        codex: { enabled: false },
        copilot: { enabled: false },
        opencode: { enabled: false },
      },
    },
  },
  e2eDaemonEnvironment: {
    CLAUDE_CONFIG_DIR: path.join(cliHome, "claude"),
    CODEX_HOME: path.join(cliHome, "codex"),
    PI_CODING_AGENT_DIR: "",
    OMP_PROFILE: "",
    PI_PROFILE: "",
    PI_CONFIG_DIR: "",
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_PROCESS_TABLE_PATH: path.join(cliHome, "process-table.txt"),
    PASEO_E2E_SYSTEM_PROXY_PATH: path.join(cliHome, "system-proxy.json"),
    PASEO_E2E_FAKE_SITES_PATH: path.join(cliHome, "fake-sites.json"),
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
  },
});

const USER_CONFIG = `# my omp settings
modelRoles:
  default: anthropic/claude-sonnet-4-5 # main
theme: dark
`;

let relay: FakeRelay;
let client: Awaited<ReturnType<typeof connectApiEndpointClient>>;

test.beforeEach(async ({ page }) => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
  await resetApiEndpoints(client);
  await rm(modelsPath, { force: true });
  await mkdir(ompDir, { recursive: true });
  await writeFile(configPath, USER_CONFIG);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(async () => {
  await resetApiEndpoints(client);
  await rm(profilesDir, { recursive: true, force: true });
  await client.close();
  await relay.close();
});

async function openOmpPage(page: Page): Promise<void> {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, "omp");
  await expectProviderDetail(page, serverId, "omp");
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

interface OmpConfig {
  modelRoles?: Record<string, string>;
  defaultThinkingLevel?: string;
}

async function ompConfig(): Promise<OmpConfig> {
  return parse(await readFile(configPath, "utf8")) as OmpConfig;
}

async function ompDefaultRole(): Promise<string | undefined> {
  return (await ompConfig()).modelRoles?.default;
}

test("the switch writes OMP's default role and Osuna's provider, the default model can change, and switching off previews and restores", async ({
  page,
}) => {
  await seedRelay();
  await openOmpPage(page);
  const section = agentSection(page);
  const toggle = section.getByTestId("agent-api-endpoints-switch");

  await test.step("on: OMP's default role is Osuna's first model", async () => {
    // 没有命名配置时只有默认那一块，不分节、没有节标题。
    await expect(page.getByTestId("agent-api-endpoints-profile-omp")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(section.getByTestId("agent-api-endpoints-default-model-trigger")).toHaveText(
      "glm-5",
    );
    await expect.poll(ompDefaultRole).toBe("osuna/glm-5");
    // 角色那一行的注释留着。
    expect(await readFile(configPath, "utf8")).toContain("default: osuna/glm-5 # main");
    const models = parse(await readFile(modelsPath, "utf8")) as {
      providers: { osuna: { auth: string; models: { id: string }[] } };
    };
    expect(models.providers.osuna.auth).toBe("apiKey");
    expect(models.providers.osuna.models.map((model) => model.id)).toEqual([
      "glm-5",
      "kimi-k2",
      "relay-a/glm-5",
      "relay-a/kimi-k2",
    ]);
  });

  await test.step("a failed save stays in this section and leaves OMP's default role", async () => {
    await section.getByTestId("agent-api-endpoints-default-model-trigger").click();
    await chmod(ompDir, 0o500);
    try {
      await page.getByTestId("agent-api-endpoints-default-option-relay-a/kimi-k2").click();
      await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
        "Couldn't change the API endpoint settings for Oh My Pi",
      );
    } finally {
      await chmod(ompDir, 0o700);
    }
    await expect(section.getByTestId("agent-api-endpoints-default-model-trigger")).toHaveText(
      "glm-5",
    );
    expect(await ompDefaultRole()).toBe("osuna/glm-5");
    await section.getByRole("button", { name: "Dismiss" }).click();
  });

  await test.step("picking one endpoint's model writes it as OMP's default role", async () => {
    await section.getByTestId("agent-api-endpoints-default-model-trigger").click();
    await page.getByTestId("agent-api-endpoints-default-option-relay-a/kimi-k2").click();
    await expect(section.getByTestId("agent-api-endpoints-default-model-trigger")).toHaveText(
      "kimi-k2 (Relay A)",
    );
    await expect.poll(ompDefaultRole).toBe("osuna/relay-a/kimi-k2");
  });

  await test.step("switching off lists OMP's default role, then puts both files back", async () => {
    await toggle.click();
    await expect(page.getByText("Turn off API endpoints for Oh My Pi?")).toBeVisible();
    // 家目录下的路径在预览里写成 ~/…。
    const configFile = inSheet(page, "switch-off-file-~/.omp/agent/config.yml");
    await expect(configFile.getByTestId("switch-off-line-text")).toHaveText([
      "default: anthropic/claude-sonnet-4-5 # main",
    ]);
    await expect(configFile.getByTestId("switch-off-line-now")).toHaveText([
      "Now: default: osuna/relay-a/kimi-k2 # main",
    ]);
    await expect(inSheet(page, "switch-off-file-~/.omp/agent/models.yml")).toBeVisible();
    await inSheet(page, "switch-off-confirm").click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => readFile(configPath, "utf8")).toBe(USER_CONFIG);
  });
});

test("OMP's default thinking offers auto and the model's levels, and a failed change stays in this section", async ({
  page,
}) => {
  await client.apiEndpointSave({
    provider: "omp",
    name: "Relay A",
    baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
    models: [{ id: "glm-5" }, { id: "kimi-k2" }],
    modelSettings: { models: { "glm-5": { efforts: ["low", "medium", "high", "max"] } } },
  });
  await openOmpPage(page);
  const section = agentSection(page);
  await section.getByTestId("agent-api-endpoints-switch").click();
  const trigger = section.getByTestId("agent-api-endpoints-default-thinking-trigger");

  await test.step("unset: OMP's own level, nothing written", async () => {
    await expect(trigger).toHaveText("Not set (Oh My Pi decides)");
    expect(await ompConfig()).not.toHaveProperty("defaultThinkingLevel");
  });

  await test.step("the options are auto and the levels OMP offers for the default model", async () => {
    await trigger.click();
    for (const level of ["auto", "low", "medium", "high", "max"]) {
      await expect(
        page.getByTestId(`agent-api-endpoints-default-thinking-option-${level}`),
      ).toBeVisible();
    }
    await expect(page.getByTestId("agent-api-endpoints-default-thinking-option-off")).toHaveCount(
      0,
    );
  });

  await test.step("a failed save keeps the level and says so here", async () => {
    await chmod(ompDir, 0o500);
    try {
      await page.getByTestId("agent-api-endpoints-default-thinking-option-high").click();
      await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
        "Couldn't change the API endpoint settings for Oh My Pi",
      );
    } finally {
      await chmod(ompDir, 0o700);
    }
    await expect(trigger).toHaveText("Not set (Oh My Pi decides)");
    await section.getByRole("button", { name: "Dismiss" }).click();
  });

  await test.step("picking a level writes it into OMP's config.yml", async () => {
    await trigger.click();
    await page.getByTestId("agent-api-endpoints-default-thinking-option-high").click();
    await expect(trigger).toHaveText("High");
    await expect.poll(ompConfig).toMatchObject({ defaultThinkingLevel: "high" });
  });

  await test.step("switching off puts config.yml back", async () => {
    await section.getByTestId("agent-api-endpoints-switch").click();
    await inSheet(page, "switch-off-confirm").click();
    await expect.poll(() => readFile(configPath, "utf8")).toBe(USER_CONFIG);
  });
});

test("OMP's model roles: a role takes a model and a thinking level, can be cleared back to OMP, and a failed change stays here", async ({
  page,
}) => {
  await seedRelay();
  await openOmpPage(page);
  const section = agentSection(page);
  await section.getByTestId("agent-api-endpoints-switch").click();
  await expect.poll(ompDefaultRole).toBe("osuna/glm-5");
  const slow = section.getByTestId("agent-api-endpoints-role-slow");
  const modelTrigger = slow.getByTestId("agent-api-endpoints-role-slow-model-trigger");
  const thinkingTrigger = slow.getByTestId("agent-api-endpoints-role-slow-thinking-trigger");

  await test.step("switching on leaves the nine roles empty, each saying what OMP uses then", async () => {
    await expect(section.getByTestId("agent-api-endpoints-model-roles")).toBeVisible();
    await expect(slow).toContainText("Hard problems (slow)");
    await expect(slow).toContainText("When empty: same as the default model (glm-5)");
    await expect(section.getByTestId("agent-api-endpoints-role-memory")).toContainText(
      "When empty: the Small tasks model (glm-5)",
    );
    await expect(modelTrigger).toHaveText("Empty");
    await expect(thinkingTrigger).toHaveText("Session level");
    expect(Object.keys((await ompConfig()).modelRoles ?? {})).toEqual(["default"]);
  });

  await test.step("picking a model writes the role into config.yml", async () => {
    await modelTrigger.click();
    await page.getByTestId("agent-api-endpoints-role-slow-option-relay-a/kimi-k2").click();
    await expect(modelTrigger).toHaveText("kimi-k2 (Relay A)");
    await expect
      .poll(async () => (await ompConfig()).modelRoles?.slow)
      .toBe("osuna/relay-a/kimi-k2");
    // 顾问空着时用难题的模型，说明跟着写上它。
    await expect(section.getByTestId("agent-api-endpoints-role-advisor")).toContainText(
      "When empty: the Hard problems model (kimi-k2 (Relay A))",
    );
  });

  await test.step("picking a thinking level adds it after the model", async () => {
    await thinkingTrigger.click();
    await page.getByTestId("agent-api-endpoints-role-slow-thinking-option-xhigh").click();
    await expect(thinkingTrigger).toHaveText("Extra high");
    await expect
      .poll(async () => (await ompConfig()).modelRoles?.slow)
      .toBe("osuna/relay-a/kimi-k2:xhigh");
  });

  await test.step("a failed change keeps the role and says so in this section", async () => {
    await modelTrigger.click();
    await chmod(ompDir, 0o500);
    try {
      await page.getByTestId("agent-api-endpoints-role-slow-option-glm-5").click();
      await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
        "Couldn't change the API endpoint settings for Oh My Pi",
      );
    } finally {
      await chmod(ompDir, 0o700);
    }
    await expect(modelTrigger).toHaveText("kimi-k2 (Relay A)");
    expect((await ompConfig()).modelRoles?.slow).toBe("osuna/relay-a/kimi-k2:xhigh");
    await section.getByRole("button", { name: "Dismiss" }).click();
  });

  await test.step("clearing the role hands it back to OMP", async () => {
    await modelTrigger.click();
    await page.getByTestId("agent-api-endpoints-role-slow-option-unset").click();
    await expect(modelTrigger).toHaveText("Empty");
    await expect(thinkingTrigger).toHaveText("Session level");
    await expect
      .poll(async () => (await ompConfig()).modelRoles)
      .toEqual({
        default: "osuna/glm-5",
      });
  });
});

test("a config.yml OMP can't read keeps the switch off and says which file, in this section", async ({
  page,
}) => {
  await seedRelay();
  const broken = "modelRoles:\n  default: [a\n";
  await writeFile(configPath, broken);
  await openOmpPage(page);
  const section = agentSection(page);
  const toggle = section.getByTestId("agent-api-endpoints-switch");

  await toggle.click();

  const error = section.getByTestId("agent-api-endpoints-error");
  await expect(error).toContainText("Couldn't change the API endpoint settings for Oh My Pi");
  await expect(error).toContainText("config.yml");
  await expect(toggle).not.toBeChecked();
  expect(await readFile(configPath, "utf8")).toBe(broken);

  await writeFile(configPath, USER_CONFIG);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(error).toHaveCount(0);
  await expect.poll(ompDefaultRole).toBe("osuna/glm-5");
});

test("a host without OMP's API endpoints shows no switch on OMP's page", async ({ page }) => {
  await hideHostFeature(page, "apiEndpointOmp");
  await openOmpPage(page);
  await expect(page.getByTestId("provider-models-section").filter({ visible: true })).toBeVisible();
  await expect(agentSection(page)).toHaveCount(0);
});

test("each named OMP profile is a block of its own, whose switch and failures touch only that profile", async ({
  page,
}) => {
  const workDir = path.join(profilesDir, "work", "agent");
  const workConfigPath = path.join(workDir, "config.yml");
  await mkdir(workDir, { recursive: true });
  await writeFile(workConfigPath, USER_CONFIG);
  await mkdir(path.join(profilesDir, "personal", "agent"), { recursive: true });
  await seedRelay();
  await openOmpPage(page);
  const section = agentSection(page);
  const defaultBlock = section.getByTestId("agent-api-endpoints-profile-omp");
  const personal = section.getByTestId("agent-api-endpoints-profile-omp#personal");
  const work = section.getByTestId("agent-api-endpoints-profile-omp#work");
  const workToggle = work.getByTestId("agent-api-endpoints-switch");

  await test.step("the default block comes first, then one block per profile, each titled and off", async () => {
    // 「第三方接口」是分组标题，每套一节，节标题依次是「默认」与配置名。
    await expect(section.getByText("API endpoints", { exact: true })).toBeVisible();
    await expect(defaultBlock.getByText("Default", { exact: true })).toBeVisible();
    await expect(personal.getByText("personal", { exact: true })).toBeVisible();
    await expect(work.getByText("work", { exact: true })).toBeVisible();
    for (const block of [defaultBlock, personal, work]) {
      await expect(block.getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
    }
  });

  await test.step("turning work on writes only work's config.yml", async () => {
    await workToggle.click();
    await expect(workToggle).toBeChecked();
    await expect(work.getByTestId("agent-api-endpoints-default-model-trigger")).toHaveText("glm-5");
    await expect(work.getByTestId("agent-api-endpoints-model-roles")).toBeVisible();
    await expect
      .poll(async () => (parse(await readFile(workConfigPath, "utf8")) as OmpConfig).modelRoles)
      .toEqual({ default: "osuna/glm-5" });
    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
    await expect(defaultBlock.getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
    await expect(personal.getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
  });

  await test.step("a failed change in work says so in work's block only", async () => {
    await work.getByTestId("agent-api-endpoints-default-model-trigger").click();
    await chmod(workDir, 0o500);
    try {
      await page.getByTestId("agent-api-endpoints-default-option-relay-a/kimi-k2").click();
      await expect(work.getByTestId("agent-api-endpoints-error")).toContainText(
        "Couldn't change the API endpoint settings for Oh My Pi · work",
      );
    } finally {
      await chmod(workDir, 0o700);
    }
    await expect(defaultBlock.getByTestId("agent-api-endpoints-error")).toHaveCount(0);
    await work.getByRole("button", { name: "Dismiss" }).click();
  });

  await test.step("switching work off previews work's files and puts its config.yml back", async () => {
    await workToggle.click();
    await expect(page.getByText("Turn off API endpoints for Oh My Pi · work?")).toBeVisible();
    await expect(
      inSheet(page, "switch-off-file-~/.omp/profiles/work/agent/config.yml"),
    ).toBeVisible();
    await inSheet(page, "switch-off-confirm").click();
    await expect(workToggle).not.toBeChecked();
    await expect.poll(() => readFile(workConfigPath, "utf8")).toBe(USER_CONFIG);
  });
});
