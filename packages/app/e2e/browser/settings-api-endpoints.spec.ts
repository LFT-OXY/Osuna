import { mkdtempSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import {
  connectApiEndpointClient,
  RELAY_KEY,
  resetApiEndpoints,
  seedApiEndpoint,
  sendThroughGateway,
  startFakeRelay,
  type FakeRelay,
} from "../support/helpers/api-endpoints";
import { readFile } from "node:fs/promises";
import {
  closeModelPicker,
  expectComposerModel,
  expectModelRowSelected,
  openModelPicker,
  selectModelRow,
} from "../support/helpers/agent-profiles";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { gotoWorkspace } from "../support/helpers/launcher";
import { expectSavedSelection } from "../support/helpers/model-memory";
import { openGlobalNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import {
  clickProviderRow,
  expectProviderDetail,
  expectProvidersList,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { buildApiEndpointSettingsRoute } from "@/utils/host-routes";

// 打开总开关会改写 CLI 自己的配置：指到临时目录，绝不碰开发者的 ~/.claude 与 ~/.codex。
const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-api-endpoints-"));
test.use({
  e2eDaemonEnvironment: {
    CLAUDE_CONFIG_DIR: path.join(cliHome, "claude"),
    CODEX_HOME: path.join(cliHome, "codex"),
  },
});

const WIDE_VIEWPORT = { width: 1280, height: 800 };

let relay: FakeRelay;
let client: Awaited<ReturnType<typeof connectApiEndpointClient>>;

test.beforeEach(async ({ page }) => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
  await resetApiEndpoints(client);
  await page.setViewportSize(WIDE_VIEWPORT);
});

test.afterEach(async () => {
  await resetApiEndpoints(client);
  await client.close();
  await relay.close();
});

async function openApiEndpointsPage(page: Page): Promise<void> {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "api-endpoints");
  await expect(page.getByTestId("api-endpoints-list")).toBeVisible();
}

function row(page: Page, endpointId: string): Locator {
  return page.getByTestId(`api-endpoint-row-${endpointId}`).filter({ visible: true });
}

function group(page: Page, which: "enabled" | "disabled"): Locator {
  return page.getByTestId(`api-endpoints-${which}-group`).filter({ visible: true });
}

// 设置页压栈后下层页面仍挂着，页头标题有两个。
function headerTitle(page: Page): Locator {
  return page.getByTestId("settings-detail-header-title").filter({ visible: true });
}

function connectionForm(page: Page): Locator {
  return page.getByTestId("api-endpoint-connection-form");
}

async function fillConnection(
  page: Page,
  input: { name: string; apiKey: string; address: string },
): Promise<void> {
  await page.getByTestId("api-endpoint-connection-name").fill(input.name);
  await page.getByTestId("api-endpoint-connection-api-key").fill(input.apiKey);
  await page.getByTestId("api-endpoint-connection-address").fill(input.address);
}

function postedPaths(target: FakeRelay): string[] {
  return target.requests
    .filter((request) => request.method === "POST")
    .map((request) => request.url)
    .sort();
}

function authorizationsSeen(target: FakeRelay): Set<string | undefined> {
  return new Set(target.requests.map((request) => request.authorization));
}

function namesAndSwitches(endpoints: { name: string; enabled?: boolean }[]) {
  return endpoints.map((endpoint) => [endpoint.name, endpoint.enabled]);
}

function statusesOf(results: { status: string }[]): string[] {
  return results.map((result) => result.status);
}

function countOf(items: unknown[]): () => number {
  return () => items.length;
}

function detectionTags(page: Page): Locator[] {
  return ["anthropic_messages", "openai_chat", "openai_responses"].map((format) =>
    page.getByTestId(`api-endpoint-connection-detection-${format}`),
  );
}

test.describe("Settings API endpoints", () => {
  test("an empty host explains the page and offers to add one", async ({ page }) => {
    await openApiEndpointsPage(page);

    await expect(group(page, "enabled")).toContainText("On0");
    await expect(page.getByTestId("api-endpoints-empty")).toContainText(
      "No API endpoints yetAPI endpoints are shared by everything on this computer.",
    );
    await expect(page.getByTestId("api-endpoints-disabled-group")).toHaveCount(0);
    await page.getByTestId("api-endpoints-empty-add").click();
    await expect(connectionForm(page)).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-save")).toHaveText(
      "Save and fetch models",
    );
  });

  test("auto-detect fills the formats that answered, saving opens the endpoint, and an edit keeps the key", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-add-button").click();
    await fillConnection(page, {
      name: "Good relay",
      apiKey: RELAY_KEY,
      address: `${relay.origin}/good/`,
    });
    await expect(page.getByTestId("api-endpoint-connection-save")).toBeDisabled();

    await test.step("each format is tried once and labelled", async () => {
      await page.getByTestId("api-endpoint-connection-detect").click();
      const [anthropic, chat, responses] = detectionTags(page);
      await expect(anthropic).toHaveText("Detected");
      await expect(chat).toHaveText("Detected");
      await expect(responses).toHaveText("Not detected");
      await expect(page.getByTestId("api-endpoint-connection-url-anthropic_messages")).toHaveValue(
        `${relay.origin}/good`,
      );
      await expect(page.getByTestId("api-endpoint-connection-url-openai_chat")).toHaveValue(
        `${relay.origin}/good/v1`,
      );
      await expect(page.getByTestId("api-endpoint-connection-url-openai_responses")).toHaveValue(
        "",
      );
      expect(postedPaths(relay)).toEqual([
        "/good/v1/chat/completions",
        "/good/v1/messages",
        "/good/v1/responses",
      ]);
    });

    let endpointId = "";
    await test.step("saving opens the new endpoint's page", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const list = await client.apiEndpointList("claude");
      expect(namesAndSwitches(list.endpoints)).toEqual([["Good relay", true]]);
      endpointId = list.endpoints[0]?.id ?? "";
      await expect(page).toHaveURL(
        new RegExp(`${buildApiEndpointSettingsRoute(getServerId(), endpointId)}$`),
      );
      await expect(headerTitle(page)).toHaveText("Good relay");
      await expect(
        page.getByTestId("api-endpoint-connection-row-openai_chat").filter({ visible: true }),
      ).toContainText(`${relay.origin}/good/v1`);
      await expect(
        page.getByTestId("api-endpoint-connection-row-openai_responses").filter({ visible: true }),
      ).toContainText("Not set, this format is not used");
    });

    await test.step("editing the connection with a blank key keeps the saved key", async () => {
      await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
      await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("Good relay");
      await page.getByTestId("api-endpoint-connection-name").fill("Good relay 2");
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      await expect(headerTitle(page)).toHaveText("Good relay 2");

      relay.requests.length = 0;
      const detected = await client.apiEndpointDetectFormats({
        endpointId,
        baseUrl: `${relay.origin}/good`,
      });
      expect(statusesOf(detected.results)).toEqual(["ok", "ok", "not_detected"]);
      expect(authorizationsSeen(relay)).toEqual(new Set([`Bearer ${RELAY_KEY}`]));
    });
  });

  test("a rejected key marks every format and the key field, and nothing can be saved", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await fillConnection(page, {
      name: "Wrong key",
      apiKey: "sk-wrong",
      address: `${relay.origin}/good`,
    });
    await page.getByTestId("api-endpoint-connection-detect").click();

    for (const tag of detectionTags(page)) await expect(tag).toHaveText("Key rejected");
    await expect(page.getByTestId("api-endpoint-connection-api-key-field-error")).toHaveText(
      "The upstream rejected this key (401 / 403)",
    );
    await expect(page.getByTestId("api-endpoint-connection-save")).toBeDisabled();
    expect(postedPaths(relay)).toEqual([]);
  });

  test("the endpoint switch moves the row, and asks first when an agent would go back to official", async ({
    page,
  }) => {
    const usable = await seedApiEndpoint(client, {
      name: "Usable relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const empty = await seedApiEndpoint(client, {
      name: "Empty relay",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: [],
    });
    const turnedOn = await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
    });
    expect(turnedOn.error).toBeNull();
    await openApiEndpointsPage(page);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      // 第一次取消，之后确认。
      void (dialogs.length === 1 ? dialog.dismiss() : dialog.accept());
    });

    await test.step("switching off an endpoint without models asks nothing", async () => {
      await row(page, empty).getByTestId(`api-endpoint-switch-${empty}`).click();
      await expect(group(page, "disabled").getByTestId(`api-endpoint-row-${empty}`)).toBeVisible();
      expect(dialogs).toEqual([]);
    });

    await test.step("switching off the last usable endpoint names the agent and can be cancelled", async () => {
      await row(page, usable).getByTestId(`api-endpoint-switch-${usable}`).click();
      await expect.poll(countOf(dialogs)).toBe(1);
      expect(dialogs[0]).toBe(
        "Switch off Usable relay?\n\nClaude will go back to official.\nNo other endpoint that is on has models selected.",
      );
      await expect(group(page, "enabled").getByTestId(`api-endpoint-row-${usable}`)).toBeVisible();
    });

    await test.step("confirming switches it off and the agent goes back to official", async () => {
      await row(page, usable).getByTestId(`api-endpoint-switch-${usable}`).click();
      await expect(group(page, "disabled").getByTestId(`api-endpoint-row-${usable}`)).toBeVisible();
      await expect(group(page, "disabled")).toContainText("Off2");
      const list = await client.apiEndpointList("claude");
      expect(list.agents?.claude?.enabled).toBe(false);
    });

    await test.step("switching it back on asks nothing", async () => {
      await row(page, usable).getByTestId(`api-endpoint-switch-${usable}`).click();
      await expect(group(page, "enabled").getByTestId(`api-endpoint-row-${usable}`)).toBeVisible();
      expect(dialogs).toHaveLength(2);
    });
  });

  test("a cooling endpoint shows when it is back, and Resume now makes it available", async ({
    page,
  }) => {
    const broke = await seedApiEndpoint(client, {
      name: "Broke relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/broke` }],
      models: ["claude-broke"],
    });
    const rejected = await seedApiEndpoint(client, {
      name: "Rejected relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/reject` }],
      models: ["claude-rejected"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(await sendThroughGateway("claude-broke")).toBe(402);
    expect(await sendThroughGateway("claude-rejected")).toBe(401);

    await openApiEndpointsPage(page);
    await expect(row(page, broke).getByTestId("api-endpoint-row-state")).toHaveText(
      "Cooling down, back in 30 minutes",
    );
    await expect(row(page, rejected).getByTestId("api-endpoint-row-state")).toHaveText(
      "Key rejected, needs a check",
    );
    await expect(row(page, rejected).getByTestId("api-endpoint-resume")).toHaveCount(0);

    await expect(row(page, broke)).toHaveAccessibleName("Broke relay details, Cooling down");
    await row(page, broke).getByTestId("api-endpoint-resume").click();
    await expect(row(page, broke)).toHaveAccessibleName("Broke relay details, Available");
    await expect(row(page, broke).getByTestId("provider-status-dot-success")).toBeVisible();
    await expect(row(page, broke).getByTestId("api-endpoint-row-state")).toHaveCount(0);
    await expect(row(page, broke).getByTestId("api-endpoint-resume")).toHaveCount(0);
    const list = await client.apiEndpointList("claude");
    expect(list.endpoints.find((endpoint) => endpoint.id === broke)?.cooldown).toBeNull();
  });

  test("fetched models start off, a family turns on and off at once, and a refetch keeps the choice", async ({
    page,
  }) => {
    relay.goodModels = ["claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5"];
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: [],
    });
    await openEndpointDetail(page, endpointId);
    const models = page.getByTestId("api-endpoint-models-section").filter({ visible: true });

    await test.step("opening the page fetches the list, every model off", async () => {
      await expect(models.getByTestId("api-endpoint-model-family-claude")).toContainText("0/2");
      await expect(models.getByTestId("api-endpoint-model-family-gpt")).toContainText("0/1");
      await expect(modelSwitch(page, "claude-sonnet-4-5")).not.toBeChecked();
      await expect(modelSwitch(page, "claude-haiku-4-5")).not.toBeChecked();
      expect(await selectedModelsOf(endpointId)).toEqual([]);
    });

    await test.step("Select all turns the family on and becomes Select none", async () => {
      const selectAll = models.getByTestId("api-endpoint-family-select-all");
      await expect(selectAll).toHaveText("Select all");
      await selectAll.click();
      await expect(selectAll).toHaveText("Select none");
      await expect(modelSwitch(page, "claude-haiku-4-5")).toBeChecked();
      await expect
        .poll(selectedModelsReader(endpointId))
        .toEqual(["claude-sonnet-4-5", "claude-haiku-4-5"]);
      await selectAll.click();
      await expect(selectAll).toHaveText("Select all");
      await expect.poll(selectedModelsReader(endpointId)).toEqual([]);
    });

    await test.step("a model added by hand is on and stays after it is switched off", async () => {
      await modelSwitch(page, "claude-sonnet-4-5").click();
      await models.getByTestId("api-endpoint-models-add").click();
      await page.getByTestId("api-endpoint-models-add-input").fill("secret-model");
      await page.getByTestId("api-endpoint-models-add-submit").click();
      await models.getByTestId("api-endpoint-model-family-other").click();
      await expect(modelSwitch(page, "secret-model")).toBeChecked();
      await modelSwitch(page, "secret-model").click();
      await expect(modelSwitch(page, "secret-model")).not.toBeChecked();
      await expect
        .poll(selectedAndManualReader(endpointId))
        .toEqual([["claude-sonnet-4-5"], ["secret-model"]]);
    });

    await test.step("a refetch adds new models off, keeps the choice and marks what is gone", async () => {
      relay.goodModels = ["claude-haiku-4-5", "gpt-5", "gpt-5-mini"];
      await models.getByTestId("api-endpoint-models-refetch").click();
      await expect(models.getByTestId("api-endpoint-model-family-gpt")).toContainText("0/2");
      await expect(page.getByTestId("api-endpoint-model-gone-secret-model")).toHaveCount(0);
      await expect(modelSwitch(page, "secret-model")).not.toBeChecked();
      await models.getByTestId("api-endpoint-model-family-claude").click();
      await expect(modelSwitch(page, "claude-sonnet-4-5")).toBeChecked();
      await expect(page.getByTestId("api-endpoint-model-gone-claude-sonnet-4-5")).toHaveText(
        "No longer in the upstream list",
      );
      await expect(page.getByTestId("api-endpoint-model-gone-claude-haiku-4-5")).toHaveCount(0);
    });

    await test.step("a search keeps only families with a match", async () => {
      await models.getByTestId("api-endpoint-models-search").fill("mini");
      await expect(models.getByTestId("api-endpoint-model-family-gpt")).toContainText("0/2");
      await expect(models.getByTestId("api-endpoint-model-family-claude")).toHaveCount(0);
      await expect(modelSwitch(page, "gpt-5-mini")).toBeVisible();
      await expect(modelSwitch(page, "gpt-5")).toHaveCount(0);
      await models.getByTestId("api-endpoint-models-search").fill("nothing-like-this");
      await expect(models.getByTestId("api-endpoint-models-no-matches")).toBeVisible();
    });
  });

  test("the tier mapping offers only the selected models, and Claude Code's opus goes out as the mapped model", async ({
    page,
  }) => {
    relay.goodModels = ["claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5"];
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5", "gpt-5"],
    });
    await openEndpointDetail(page, endpointId);

    await page.getByTestId("api-endpoint-mapping-opus-trigger").filter({ visible: true }).click();
    await expect(page.getByTestId("api-endpoint-mapping-opus-option-unmapped")).toHaveText(
      "Don't map",
    );
    await expect(page.getByTestId("api-endpoint-mapping-opus-option-gpt-5")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-mapping-opus-option-claude-haiku-4-5")).toHaveCount(
      0,
    );
    await page.getByTestId("api-endpoint-mapping-opus-option-claude-sonnet-4-5").click();
    await expect
      .poll(async () => (await client.apiEndpointList("claude")).endpoints[0]?.modelMapping)
      .toEqual({ opus: "claude-sonnet-4-5" });

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    relay.requests.length = 0;
    expect(await sendThroughGateway("opus")).toBe(200);
    expect(
      relay.requests.filter((request) => request.method === "POST").map((request) => request.model),
    ).toEqual(["claude-sonnet-4-5"]);
  });

  test("Searches the web by itself saves from its switch, a failed save stays in place, and a Chat-only endpoint has no such row", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Searching relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const chatOnlyId = await seedApiEndpoint(client, {
      name: "Chat relay",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5"],
    });
    const host = await failSearchesWebSave(page);
    await openEndpointDetail(page, endpointId);
    const section = page.getByTestId("api-endpoint-web-search-section").filter({ visible: true });
    const toggle = section.getByRole("switch", { name: "Searches the web by itself" });
    const searchesWeb = async () =>
      (await client.apiEndpointList("claude")).endpoints.find((entry) => entry.id === endpointId)
        ?.searchesWeb;

    await expect(section).toContainText("Web search");
    await expect(toggle).not.toBeChecked();

    await test.step("a failed save stays under the switch", async () => {
      await toggle.click();
      await expect(section.getByTestId("api-endpoint-web-search-error")).toHaveText(
        "Couldn't save: EACCES: permission denied",
      );
      await expect(toggle).not.toBeChecked();
      expect(await searchesWeb()).toBe(false);
    });

    await test.step("trying again saves it and clears the failure", async () => {
      host.failing = false;
      await toggle.click();
      await expect(toggle).toBeChecked();
      await expect(section.getByTestId("api-endpoint-web-search-error")).toHaveCount(0);
      await expect.poll(searchesWeb).toBe(true);
    });

    await openEndpointDetail(page, chatOnlyId);
    await expect(page.getByTestId("api-endpoint-detail").filter({ visible: true })).toBeVisible();
    await expect(page.getByTestId("api-endpoint-web-search-section")).toHaveCount(0);
  });

  test("Test connection shows one result per address, and a rejected key reads Key rejected", async ({
    page,
  }) => {
    const good = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [
        { format: "anthropic_messages", url: `${relay.origin}/good` },
        { format: "openai_chat", url: `${relay.origin}/good/v1` },
        { format: "openai_responses", url: `${relay.origin}/good/v1` },
      ],
      models: ["claude-sonnet-4-5", "gpt-5"],
    });
    const wrongKey = await seedApiEndpoint(client, {
      name: "Wrong key",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
      apiKey: "sk-wrong",
    });

    await openEndpointDetail(page, good);
    await page.getByTestId("api-endpoint-test-connection").filter({ visible: true }).click();
    await expect(testResult(page, "anthropic_messages")).toHaveText(/^Connected · \d+ ms$/);
    await expect(testResult(page, "openai_chat")).toHaveText(/^Connected · \d+ ms$/);
    await expect(testResult(page, "openai_responses")).toContainText("Couldn't connect");
    await expect(
      page.getByTestId("api-endpoint-test-reason-openai_responses").filter({ visible: true }),
    ).toContainText("HTTP 404");

    await page.getByTestId("settings-api-endpoints-breadcrumb").filter({ visible: true }).click();
    await openEndpointRow(page, wrongKey);
    await page.getByTestId("api-endpoint-test-connection").filter({ visible: true }).click();
    await expect(testResult(page, "anthropic_messages")).toContainText("Key rejected");
    await expect(testResult(page, "openai_chat")).toHaveCount(0);
  });

  test("deleting an endpoint says what happens to each agent's default model, then it is gone", async ({
    page,
  }) => {
    const first = await seedApiEndpoint(client, {
      name: "First relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const second = await seedApiEndpoint(client, {
      name: "Second relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["gpt-5"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.accept();
    });

    await test.step("the default model moves to the next endpoint's model", async () => {
      await openEndpointDetail(page, first);
      await deleteFromMenu(page);
      await expect.poll(countOf(dialogs)).toBe(1);
      expect(dialogs[0]).toBe(
        "Delete First relay?\n\nFirst relay's models will be removed from every agent's model list.\nClaude's default model will change from claude-sonnet-4-5 to gpt-5.",
      );
      await expect(page.getByTestId("api-endpoints-list").filter({ visible: true })).toBeVisible();
      await expect(row(page, first)).toHaveCount(0);
      const list = await client.apiEndpointList("claude");
      expect(list.agents?.claude).toEqual({ enabled: true, defaultModelId: "gpt-5" });
    });

    await test.step("deleting the last endpoint sends the agent back to official", async () => {
      await openEndpointRow(page, second);
      await deleteFromMenu(page);
      await expect.poll(countOf(dialogs)).toBe(2);
      expect(dialogs[1]).toBe(
        "Delete Second relay?\n\nSecond relay's models will be removed from every agent's model list.\nClaude will go back to official.",
      );
      await expect(row(page, second)).toHaveCount(0);
      const list = await client.apiEndpointList("claude");
      expect(list.agents?.claude?.enabled).toBe(false);
    });
  });
});

test.describe("API endpoints on the Claude Code page and in the model selector", () => {
  test("the switch, the default model and the manage row replace the old radio rows", async ({
    page,
  }) => {
    const relayA = await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5", "gpt-5"],
    });
    await seedApiEndpoint(client, {
      name: "Kimi",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/broke` }],
      models: ["kimi-k2"],
    });
    // Kimi 只有它有 kimi-k2：经中转站回 402 欠费后冷却 30 分钟，入口行要点名它。
    await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "claude-sonnet-4-5",
    });
    expect(await sendThroughGateway("kimi-k2")).toBe(402);
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });

    await openClaudeCodePage(page);
    const section = agentSection(page);

    await test.step("off: the switch explains itself and the default model is hidden", async () => {
      await expect(section.getByTestId("agent-api-endpoints-switch-hint")).toHaveText(
        "When on, Claude can use the selected models of the endpoints that are on in API endpoints. Turn it off to go back to official.",
      );
      await expect(section.getByTestId("agent-api-endpoints-default-model")).toHaveCount(0);
      await expect(section.getByTestId("agent-api-endpoints-summary")).toHaveText(
        "2 on·Kimi cooling down, back in 30 minutes",
      );
      await expect(page.getByTestId("api-endpoints-use-official")).toHaveCount(0);
      await expect(page.locator('[data-testid^="api-endpoint-use-"]')).toHaveCount(0);
    });

    await test.step("on: the CLI points at the gateway with the default model", async () => {
      await section.getByTestId("agent-api-endpoints-switch").click();
      await expect(defaultModelTrigger(page)).toHaveText("claude-sonnet-4-5");
      const settings = await readClaudeSettings();
      expect(settings.env?.ANTHROPIC_BASE_URL).toContain("/api-endpoint-gateway");
      expect(settings.model).toBe("claude-sonnet-4-5");
    });

    await test.step("the default model offers each selected model once", async () => {
      await defaultModelTrigger(page).click();
      for (const modelId of ["claude-sonnet-4-5", "gpt-5", "kimi-k2"]) {
        await expect(
          page.getByTestId(`agent-api-endpoints-default-option-${modelId}`),
        ).toBeVisible();
      }
      await page.getByTestId("agent-api-endpoints-default-option-gpt-5").click();
      await expect(defaultModelTrigger(page)).toHaveText("gpt-5");
      await expect.poll(claudeSettingsModel).toBe("gpt-5");
    });

    await test.step("switching Relay A off moves the default model, and the page follows", async () => {
      await section.getByTestId("agent-api-endpoints-manage").click();
      await expect(page.getByTestId("api-endpoints-list").filter({ visible: true })).toBeVisible();
      await page.getByTestId(`api-endpoint-switch-${relayA}`).filter({ visible: true }).click();
      await expect(group(page, "disabled")).toContainText("Relay A");
      await page.goBack();
      await expect(defaultModelTrigger(page)).toHaveText("kimi-k2");
      await expect(agentSection(page).getByTestId("agent-api-endpoints-summary")).toHaveText(
        "1 on·Kimi cooling down, back in 30 minutes",
      );
    });

    await test.step("off again: the CLI is official and the default model is hidden", async () => {
      await agentSection(page).getByTestId("agent-api-endpoints-switch").click();
      await expect(agentSection(page).getByTestId("agent-api-endpoints-default-model")).toHaveCount(
        0,
      );
      await expect.poll(claudeSettingsBaseUrl).toBeUndefined();
    });
  });

  test("the switch cannot be turned on until an endpoint that is on has a model", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Empty relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: [],
    });
    await openClaudeCodePage(page);
    const section = agentSection(page);
    await expect(section.getByTestId("agent-api-endpoints-switch-hint")).toHaveText(
      "Turn on an endpoint in API endpoints and select its models first.",
    );
    await expect(section.getByTestId("agent-api-endpoints-switch")).toBeDisabled();
  });

  test("the model selector groups models by endpoint and keeps the endpoint picked", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5", "kimi-k2"],
    });
    await seedApiEndpoint(client, {
      name: "Relay B",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5", "claude-sonnet-4-5"],
    });
    await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "gpt-5",
    });
    const workspace = await seedWorkspace({ repoPrefix: "api-endpoint-selector-" });
    try {
      await carryPreferencesAcrossReloads(page);
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await keepPreferencesForNextLoad(page, { provider: "claude" });
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);

      await test.step("a new chat with nothing remembered starts on the default model", async () => {
        await expectComposerModel(page, "gpt-5");
        await openModelPicker(page);
      });

      await test.step("each endpoint is a group, a shared name shows under both", async () => {
        const picker = page.getByTestId("combobox-desktop-container");
        await expect(picker.locator('[data-testid^="model-endpoint-group-"]')).toHaveText([
          "Relay A",
          "Relay B",
        ]);
        for (const modelId of ["relay-a/claude-sonnet-4-5", "relay-b/claude-sonnet-4-5"]) {
          await expect(picker.getByTestId(`model-row-claude-${modelId}`)).toHaveText(
            "claude-sonnet-4-5",
          );
        }
        await expect(picker).not.toContainText("relay-");
      });

      await test.step("picking Relay B's model keeps Relay B and shows the bare name", async () => {
        await selectModelRow(page, { provider: "claude", modelId: "relay-b/claude-sonnet-4-5" });
        await expectComposerModel(page, "claude-sonnet-4-5");
        await openModelPicker(page);
        await expectModelRowSelected(page, {
          provider: "claude",
          modelId: "relay-b/claude-sonnet-4-5",
        });
        await expect(
          page
            .getByTestId("combobox-desktop-container")
            .getByTestId("model-row-claude-relay-a/claude-sonnet-4-5"),
        ).toHaveAttribute("aria-selected", "false");
        await closeModelPicker(page);
      });

      await test.step("the next new chat starts on the remembered choice", async () => {
        await expectSavedSelection(page, "claude", "relay-b/claude-sonnet-4-5");
        await keepPreferencesForNextLoad(page, "current");
        await gotoWorkspace(page, workspace.workspaceId);
        await waitForSidebarHydration(page);
        await openGlobalNewWorkspaceComposer(page);
        await expectComposerModel(page, "claude-sonnet-4-5");
        await openModelPicker(page);
        await expectModelRowSelected(page, {
          provider: "claude",
          modelId: "relay-b/claude-sonnet-4-5",
        });
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("Codex gets the same section, and its model selector is grouped the same way", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5", "kimi-k2"],
    });
    await seedApiEndpoint(client, {
      name: "Relay B",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5", "gpt-5"],
    });

    await test.step("the Codex page turns the switch on and points Codex at the gateway", async () => {
      await openAgentPage(page, "codex");
      await agentSection(page).getByTestId("agent-api-endpoints-switch").click();
      await expect(defaultModelTrigger(page)).toHaveText("gpt-5");
      await expect.poll(readCodexConfig).toContain('model_provider = "osuna_api_endpoint"');
      await expect(agentSection(page).getByTestId("agent-api-endpoints-summary")).toHaveText(
        "2 on",
      );
    });

    const workspace = await seedWorkspace({ repoPrefix: "api-endpoint-codex-selector-" });
    try {
      await carryPreferencesAcrossReloads(page);
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await keepPreferencesForNextLoad(page, { provider: "codex" });
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);

      await test.step("the picker lists each endpoint as a group", async () => {
        await expectComposerModel(page, "gpt-5");
        await openModelPicker(page);
        const picker = page.getByTestId("combobox-desktop-container");
        await expect(picker.locator('[data-testid^="model-endpoint-group-"]')).toHaveText([
          "Relay A",
          "Relay B",
        ]);
        await expect(picker.getByTestId("model-row-codex-relay-b/gpt-5")).toHaveText("gpt-5");
        await expect(picker).not.toContainText("relay-");
        await selectModelRow(page, { provider: "codex", modelId: "relay-b/gpt-5" });
        await expectComposerModel(page, "gpt-5");
        await openModelPicker(page);
        await expectModelRowSelected(page, { provider: "codex", modelId: "relay-b/gpt-5" });
      });
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Settings changed outside Osuna on the provider pages", () => {
  const OTHER_TOOL_URL = "https://other-tool.example";

  /** Claude Code 的开关打开后，别的程序把 settings.json 的中转站地址改走。 */
  async function repointClaudeElsewhere(): Promise<string> {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const on = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(on.error).toBeNull();
    const settingsPath = path.join(cliHome, "claude", "settings.json");
    const settings = await readClaudeSettings();
    const changed = JSON.stringify(
      { ...settings, env: { ...settings.env, ANTHROPIC_BASE_URL: OTHER_TOOL_URL } },
      null,
      2,
    );
    await writeFile(settingsPath, changed);
    return changed;
  }

  function issue(page: Page, kind: string): Locator {
    return agentSection(page).getByTestId(`agent-api-endpoints-issue-${kind}`);
  }

  function issueButton(page: Page, action: string): Locator {
    return agentSection(page).getByTestId(`agent-api-endpoints-issue-${action}`);
  }

  function issueError(page: Page): Locator {
    return agentSection(page).getByTestId("agent-api-endpoints-issue-error");
  }

  /** Claude 的配置目录只读时按下这个处理：daemon 原子替换文件失败，等失败信息出现后再放开目录。 */
  async function pressWhileReadOnly(page: Page, action: string): Promise<void> {
    await chmod(claudeDir(), 0o500);
    try {
      await issueButton(page, action).click();
      await expect(issueError(page)).toBeVisible();
    } finally {
      await chmod(claudeDir(), 0o700);
    }
  }

  function claudeDir(): string {
    return path.join(cliHome, "claude");
  }

  test("no longer through the gateway: Apply again fails in place, then points Claude Code back", async ({
    page,
  }) => {
    await repointClaudeElsewhere();
    await openClaudeCodePage(page);

    await expect(issue(page, "notThroughGateway")).toContainText(
      "Claude no longer goes through the gateway: its settings were changed outside Osuna",
    );
    await expect(issue(page, "notThroughGateway")).toContainText("env.ANTHROPIC_BASE_URL");

    await test.step("failure stays in place until dismissed", async () => {
      await pressWhileReadOnly(page, "reapply");
      await expect(issueError(page)).toContainText('Couldn\'t finish "Apply again" for Claude');
      await expect(issue(page, "notThroughGateway")).toBeVisible();
      await expect.poll(claudeSettingsBaseUrl).toBe(OTHER_TOOL_URL);
      await issueError(page).getByRole("button", { name: "Dismiss" }).click();
      await expect(issueError(page)).toHaveCount(0);
    });

    await test.step("retrying succeeds: the issue goes and the file points at the gateway", async () => {
      await pressWhileReadOnly(page, "reapply");
      await issueButton(page, "reapply").click();
      await expect(issue(page, "notThroughGateway")).toHaveCount(0);
      await expect(issueError(page)).toHaveCount(0);
      await expect.poll(claudeSettingsBaseUrl).toContain("/api-endpoint-gateway");
      await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeChecked();
    });
  });

  test("Switch to official fails in place, then turns the switch off and restores the file", async ({
    page,
  }) => {
    await repointClaudeElsewhere();
    await openClaudeCodePage(page);
    await expect(issue(page, "notThroughGateway")).toBeVisible();

    await pressWhileReadOnly(page, "switchToOfficial");
    await expect(issueError(page)).toContainText(
      'Couldn\'t finish "Switch to official" for Claude',
    );
    await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeChecked();

    await issueButton(page, "switchToOfficial").click();
    await expect(issue(page, "notThroughGateway")).toHaveCount(0);
    await expect(issueError(page)).toHaveCount(0);
    await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
    await expect.poll(claudeSettingsBaseUrl).toBeUndefined();
  });

  test("Keep current settings fails in place, then turns the switch off and leaves the file as changed", async ({
    page,
  }) => {
    const changed = await repointClaudeElsewhere();
    // daemon 自己的数据目录改不成只读（写入前会把权限改回来）：让主机对这一次请求回失败。
    const host = await failKeepCurrentSettings(page);
    await openClaudeCodePage(page);
    await expect(issue(page, "notThroughGateway")).toBeVisible();

    await issueButton(page, "keepCurrent").click();
    await expect(issueError(page)).toContainText(
      'Couldn\'t finish "Keep current settings" for Claude',
    );
    await expect(issueError(page)).toContainText("EACCES: permission denied");
    await expect(issue(page, "notThroughGateway")).toBeVisible();
    await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeChecked();

    host.failing = false;
    await issueButton(page, "keepCurrent").click();
    await expect(issue(page, "notThroughGateway")).toHaveCount(0);
    await expect(issueError(page)).toHaveCount(0);
    await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
    expect(await readFile(path.join(claudeDir(), "settings.json"), "utf8")).toBe(changed);
  });

  test("a settings file Osuna can't read is explained, with no actions", async ({ page }) => {
    await mkdir(claudeDir(), { recursive: true });
    await writeFile(path.join(claudeDir(), "settings.json"), '{ "env": { "A": "1", } }');
    try {
      await openClaudeCodePage(page);
      const unreadable = issue(page, "configUnparsable");
      await expect(unreadable).toContainText(
        "Osuna can't read Claude's settings file, so it can't change it",
      );
      await expect(unreadable).toContainText(path.join(claudeDir(), "settings.json"));
      await expect(unreadable.getByRole("button")).toHaveCount(0);
    } finally {
      await writeFile(path.join(claudeDir(), "settings.json"), "{}\n");
    }
  });

  test("a Codex profile that overrides the switch is explained, with no actions", async ({
    page,
  }) => {
    const configPath = path.join(cliHome, "codex", "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, 'profile = "work"\n\n[profiles.work]\nmodel_provider = "azure"\n');
    try {
      await openAgentPage(page, "codex");
      const override = issue(page, "codexProfileOverride");
      await expect(override).toContainText('Codex\'s profile "work" overrides the API endpoints');
      await expect(override).toContainText(`[profiles.work] in ${configPath} sets model_provider`);
      await expect(override.getByRole("button")).toHaveCount(0);
    } finally {
      await writeFile(configPath, "");
    }
  });

  test("a host without the capability shows no issues and asks for an update", async ({ page }) => {
    await repointClaudeElsewhere();
    await hideCliWiringCapability(page);
    await openClaudeCodePage(page);

    await expect(
      agentSection(page).getByTestId("agent-api-endpoints-issues-update-host"),
    ).toHaveText(
      "Update Osuna on this host to see here when Claude's settings are changed outside Osuna.",
    );
    await expect(agentSection(page).getByTestId("agent-api-endpoints-issues")).toHaveCount(0);
  });
});

/** `failing` 为 true 时，keep_current_settings 请求不送到 daemon，直接回一个失败响应。 */
async function failKeepCurrentSettings(page: Page): Promise<{ failing: boolean }> {
  const host = { failing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const request =
        typeof message === "string" && message.includes("keep_current_settings.request")
          ? (JSON.parse(message) as { message?: { requestId?: string; provider?: string } }).message
          : undefined;
      if (!host.failing || !request) {
        server.send(message);
        return;
      }
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "provider.api_endpoint.keep_current_settings.response",
            payload: {
              requestId: request.requestId,
              provider: request.provider,
              agent: null,
              error: { code: "unknown", message: "EACCES: permission denied" },
            },
          },
        }),
      );
    });
  });
  return host;
}

/** `failing` 为 true 时，带 searchesWeb 的保存请求不送到 daemon，直接回一个失败响应。 */
async function failSearchesWebSave(page: Page): Promise<{ failing: boolean }> {
  const host = { failing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isSearchSave =
        typeof message === "string" &&
        message.includes("provider.api_endpoint.save.request") &&
        message.includes('"searchesWeb"');
      const request = isSearchSave
        ? (JSON.parse(message) as { message?: { requestId?: string } }).message
        : undefined;
      if (!host.failing || !request) {
        server.send(message);
        return;
      }
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "provider.api_endpoint.save.response",
            payload: {
              requestId: request.requestId,
              endpoint: null,
              error: { code: "unknown", message: "EACCES: permission denied" },
            },
          },
        }),
      );
    });
  });
  return host;
}

/** 从 server_info 去掉 apiEndpointCliWiring，模拟 v0.16 的主机。 */
async function hideCliWiringCapability(page: Page): Promise<void> {
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
        delete payload.features.apiEndpointCliWiring;
      }
      ws.send(JSON.stringify(envelope));
    });
  });
}

const CARRIED_PREFERENCES_KEY = "e2e-api-endpoints-carried-preferences";

/**
 * 测试夹具每次加载页面都把新建对话的记忆改回 mock 提供方；这个脚本注册在它之后，
 * 把 keepPreferencesForNextLoad 存下的记忆再写回去，模拟重开 App 后记忆还在。
 */
async function carryPreferencesAcrossReloads(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const carried = sessionStorage.getItem(key);
    if (carried) localStorage.setItem("@paseo:create-agent-preferences", carried);
  }, CARRIED_PREFERENCES_KEY);
}

function serializePreferences(preferences: { provider: string } | "current"): string | null {
  if (preferences === "current") return null;
  return JSON.stringify(preferences);
}

/** "current" 是 App 自己当前存下的记忆。 */
async function keepPreferencesForNextLoad(
  page: Page,
  preferences: { provider: string } | "current",
): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      const carried = value ?? localStorage.getItem("@paseo:create-agent-preferences") ?? "";
      sessionStorage.setItem(key, carried);
    },
    { key: CARRIED_PREFERENCES_KEY, value: serializePreferences(preferences) },
  );
}

async function openClaudeCodePage(page: Page): Promise<void> {
  await openAgentPage(page, "claude");
}

async function openAgentPage(page: Page, provider: "claude" | "codex"): Promise<void> {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, provider);
  await expectProviderDetail(page, serverId, provider);
  await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeVisible();
}

async function readCodexConfig(): Promise<string> {
  try {
    return await readFile(path.join(cliHome, "codex", "config.toml"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function agentSection(page: Page): Locator {
  return page.getByTestId("agent-api-endpoints").filter({ visible: true });
}

function defaultModelTrigger(page: Page): Locator {
  return agentSection(page).getByTestId("agent-api-endpoints-default-model-trigger");
}

interface ClaudeSettingsFile {
  model?: string;
  env?: Record<string, string>;
}

/** 测试用临时目录里的 Claude Code 配置；还没写过时为空。 */
async function readClaudeSettings(): Promise<ClaudeSettingsFile> {
  let text: string;
  try {
    text = await readFile(path.join(cliHome, "claude", "settings.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return JSON.parse(text) as ClaudeSettingsFile;
}

async function claudeSettingsModel(): Promise<string | undefined> {
  return (await readClaudeSettings()).model;
}

async function claudeSettingsBaseUrl(): Promise<string | undefined> {
  return (await readClaudeSettings()).env?.ANTHROPIC_BASE_URL;
}

async function openEndpointRow(page: Page, endpointId: string): Promise<void> {
  await row(page, endpointId).click();
  await expect(page.getByTestId("api-endpoint-detail").filter({ visible: true })).toBeVisible();
}

async function openEndpointDetail(page: Page, endpointId: string): Promise<void> {
  await openApiEndpointsPage(page);
  await openEndpointRow(page, endpointId);
}

async function deleteFromMenu(page: Page): Promise<void> {
  await page.getByTestId("api-endpoint-detail-menu").filter({ visible: true }).click();
  await page.getByTestId("api-endpoint-detail-delete").click();
}

function modelSwitch(page: Page, modelId: string): Locator {
  return page.getByTestId(`api-endpoint-model-switch-${modelId}`).filter({ visible: true });
}

function testResult(page: Page, format: string): Locator {
  return page.getByTestId(`api-endpoint-test-result-${format}`).filter({ visible: true });
}

function ids(models: { id: string }[] | undefined): string[] {
  return (models ?? []).map((model) => model.id);
}

async function selectedModelsOf(endpointId: string): Promise<string[]> {
  const list = await client.apiEndpointList("claude");
  return ids(list.endpoints.find((endpoint) => endpoint.id === endpointId)?.models);
}

function selectedModelsReader(endpointId: string): () => Promise<string[]> {
  return () => selectedModelsOf(endpointId);
}

function selectedAndManualReader(endpointId: string): () => Promise<string[][]> {
  return async () => {
    const list = await client.apiEndpointList("claude");
    const endpoint = list.endpoints.find((entry) => entry.id === endpointId);
    return [ids(endpoint?.models), ids(endpoint?.manualModels)];
  };
}
