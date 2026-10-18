import { mkdtempSync } from "node:fs";
import { chmod, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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
import { z } from "zod";
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
    // Claude Code 的托管设置也指到临时目录。
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    // 列进程时 daemon 读到的是这份假进程表（封条换掉 ps），绝不是本机真实的。
    PASEO_E2E_PROCESS_TABLE_PATH: path.join(cliHome, "process-table.txt"),
    // 系统代理同样读这份假的（封条换掉 scutil 与注册表）。
    PASEO_E2E_SYSTEM_PROXY_PATH: path.join(cliHome, "system-proxy.json"),
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
      expect(list.agents?.claude).toMatchObject({ enabled: true, defaultModelId: "gpt-5" });
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
      await confirmSwitchOff(page);
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

  test("Keep claude.ai sign-in says what it changes, a failed save stays in place, and saving writes the token empty", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true })).error,
    ).toBeNull();
    const gatewayToken = (await readClaudeSettings()).env?.ANTHROPIC_AUTH_TOKEN;
    expect(gatewayToken).toBeTruthy();
    const claudeToken = async () => (await readClaudeSettings()).env?.ANTHROPIC_AUTH_TOKEN;
    await openClaudeCodePage(page);
    const section = agentSection(page);
    const toggle = section.getByRole("switch", { name: "Keep claude.ai sign-in" });

    await test.step("off: what works and what still doesn't is written next to the switch", async () => {
      await expect(toggle).not.toBeChecked();
      await expect(section.getByTestId("agent-api-endpoints-keep-claude-ai-login-hint")).toHaveText(
        "When on, Claude keeps its claude.ai sign-in while it goes through the gateway, so voice, claude.ai connectors, plan limits in /usage and cloud sessions keep working. Osuna never passes the sign-in on to an API endpoint. Remote Control and ultrareview stay off: Claude has them only on Anthropic's own address.",
      );
    });

    await test.step("a failed save stays in place and leaves the token", async () => {
      const claudeDir = path.join(cliHome, "claude");
      await chmod(claudeDir, 0o500);
      try {
        await toggle.click();
        await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
          "Couldn't change the API endpoint settings for Claude",
        );
      } finally {
        await chmod(claudeDir, 0o700);
      }
      await expect(toggle).not.toBeChecked();
      expect(await claudeToken()).toBe(gatewayToken);
      await section.getByRole("button", { name: "Dismiss" }).click();
      await expect(section.getByTestId("agent-api-endpoints-error")).toHaveCount(0);
    });

    await test.step("on: the token is written empty; off: it is written back", async () => {
      await toggle.click();
      await expect(toggle).toBeChecked();
      await expect.poll(claudeToken).toBe("");
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await expect.poll(claudeToken).toBe(gatewayToken);
    });
  });

  test("turning the switch on says how the default model was picked, and the default model can name one endpoint", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["first", "glm-4.6"],
    });
    await seedApiEndpoint(client, {
      name: "Relay B",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["glm-4.6"],
    });
    const settingsPath = path.join(cliHome, "claude", "settings.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `{ "model": "glm-4.6" }\n`);
    // 留下的模型会被后面的用例当成 CLI 原来的模型：用例最后关掉开关、删掉这份文件。
    await openClaudeCodePage(page);
    const section = agentSection(page);

    await test.step("on: Claude goes on with the model it was on, and the page says so", async () => {
      await section.getByTestId("agent-api-endpoints-switch").click();
      await expect(section.getByTestId("agent-api-endpoints-connection")).toHaveText(
        "Claude now uses API endpoints. It stays on glm-4.6, the model it was already using, through the gateway.",
      );
      await expect(defaultModelTrigger(page)).toHaveText("glm-4.6");
    });

    await test.step("the options list the bare names and each endpoint's models", async () => {
      await defaultModelTrigger(page).click();
      for (const [id, label] of [
        ["first", "first"],
        ["glm-4.6", "glm-4.6"],
        ["relay-a/glm-4.6", "glm-4.6 (Relay A)"],
        ["relay-b/glm-4.6", "glm-4.6 (Relay B)"],
      ]) {
        await expect(page.getByTestId(`agent-api-endpoints-default-option-${id}`)).toHaveText(
          label,
        );
      }
    });

    await test.step("a failed save stays in place and leaves the model", async () => {
      const claudeDir = path.join(cliHome, "claude");
      await chmod(claudeDir, 0o500);
      try {
        await page.getByTestId("agent-api-endpoints-default-option-relay-b/glm-4.6").click();
        await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
          "Couldn't change the API endpoint settings for Claude",
        );
      } finally {
        await chmod(claudeDir, 0o700);
      }
      await expect(defaultModelTrigger(page)).toHaveText("glm-4.6");
      expect(await claudeSettingsModel()).toBe("glm-4.6");
      await section.getByRole("button", { name: "Dismiss" }).click();
    });

    await test.step("saving one endpoint's model writes that name into the CLI", async () => {
      await defaultModelTrigger(page).click();
      await page.getByTestId("agent-api-endpoints-default-option-relay-b/glm-4.6").click();
      await expect(defaultModelTrigger(page)).toHaveText("glm-4.6 (Relay B)");
      await expect.poll(claudeSettingsModel).toBe("relay-b/glm-4.6");
      await expect(section.getByTestId("agent-api-endpoints-connection")).toHaveCount(0);
    });

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    await rm(settingsPath, { force: true });
  });

  test("Default thinking sits beside the default model: a failed save stays in place, Max says it holds every session, and a new chat starts at it", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["glm-5.3"],
    });
    await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "glm-5.3",
    });
    const settingsPath = path.join(cliHome, "claude", "settings.json");
    const workspace = await seedWorkspace({ repoPrefix: "api-endpoint-thinking-" });
    try {
      await openClaudeCodePage(page);
      const section = agentSection(page);
      const trigger = section.getByTestId("agent-api-endpoints-default-thinking-trigger");

      await test.step("not set at first, with the model's levels to pick from and Ultra Code beside them", async () => {
        await expect(trigger).toHaveText("Not set (Claude decides)");
        await expect(section.getByTestId("agent-api-endpoints-ultra-code")).toBeVisible();
        await trigger.click();
        for (const [id, label] of [
          ["high", "High"],
          ["xhigh", "Extra High"],
          ["max", "Max"],
        ]) {
          await expect(
            page.getByTestId(`agent-api-endpoints-default-thinking-option-${id}`),
          ).toHaveText(label);
        }
      });

      await test.step("a failed save stays in place and leaves the file", async () => {
        const claudeDir = path.join(cliHome, "claude");
        await chmod(claudeDir, 0o500);
        try {
          await page.getByTestId("agent-api-endpoints-default-thinking-option-high").click();
          await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
            "Couldn't change the API endpoint settings for Claude",
          );
        } finally {
          await chmod(claudeDir, 0o700);
        }
        await expect(trigger).toHaveText("Not set (Claude decides)");
        expect(await claudeSettingsEffort()).toBeUndefined();
        await section.getByRole("button", { name: "Dismiss" }).click();
      });

      await test.step("Max is written for every session and the page says it holds them there", async () => {
        await trigger.click();
        await page.getByTestId("agent-api-endpoints-default-thinking-option-max").click();
        await expect(trigger).toHaveText("Max");
        await expect(
          section.getByTestId("agent-api-endpoints-default-thinking-max-lock"),
        ).toHaveText(
          "At Max, every Claude session is held at Max, chats in Osuna included, and /effort can't lower it.",
        );
        await expect.poll(claudeSettingsEffortVariable).toBe("max");
      });

      await test.step("High is saved where Claude Code starts its sessions", async () => {
        await trigger.click();
        await page.getByTestId("agent-api-endpoints-default-thinking-option-high").click();
        await expect(trigger).toHaveText("High");
        await expect(
          section.getByTestId("agent-api-endpoints-default-thinking-max-lock"),
        ).toHaveCount(0);
        await expect.poll(claudeSettingsEffort).toBe("high");
      });

      await test.step("Ultra Code turns on and off on its own, leaving the level as it is", async () => {
        const ultraCode = section.getByTestId("agent-api-endpoints-ultra-code");
        await ultraCode.click();
        await expect.poll(claudeSettingsUltraCode).toBe(true);
        await ultraCode.click();
        await expect.poll(claudeSettingsUltraCode).toBeUndefined();
        expect(await claudeSettingsEffort()).toBe("high");
      });

      await test.step("a new chat with nothing remembered starts at the default thinking", async () => {
        await carryPreferencesAcrossReloads(page);
        await gotoWorkspace(page, workspace.workspaceId);
        await waitForSidebarHydration(page);
        await keepPreferencesForNextLoad(page, { provider: "claude" });
        await gotoWorkspace(page, workspace.workspaceId);
        await waitForSidebarHydration(page);
        await openGlobalNewWorkspaceComposer(page);
        await expectComposerModel(page, "glm-5.3");
        await expect(
          page.getByTestId("agent-thinking-selector").filter({ visible: true }),
        ).toHaveAccessibleName("Select thinking option (High)");
      });

      await test.step("at Max the chat's thinking says why every session runs there", async () => {
        await client.apiEndpointSetAgentSettings({
          provider: "claude",
          enabled: true,
          defaultThinkingOptionId: "max",
        });
        await page.getByTestId("agent-thinking-selector").filter({ visible: true }).click();
        await expect(page.getByTestId("thinking-note").filter({ visible: true })).toHaveText(
          "Every session runs at Max: Default thinking for Claude is Max in Settings, so the level picked here has no effect.",
        );
      });
    } finally {
      await workspace.cleanup();
      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      await rm(settingsPath, { force: true });
    }
  });

  test("the background task and Subagent models: a failed save stays in place, a saved one goes into env and Official takes it out", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["glm-5.3", "claude-haiku-4.5"],
    });
    await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "glm-5.3",
    });
    const settingsPath = path.join(cliHome, "claude", "settings.json");
    try {
      await openClaudeCodePage(page);
      const section = agentSection(page);
      const background = section.getByTestId("agent-api-endpoints-background-model-trigger");
      const subagent = section.getByTestId("agent-api-endpoints-subagent-model-trigger");
      const thinking = section.getByTestId("agent-api-endpoints-subagent-thinking-trigger");

      await test.step("both follow the default model at first", async () => {
        await expect(background).toHaveText("Same as the default model");
        await expect(subagent).toHaveText("Same as the default model");
        await expect(thinking).toHaveText("Not set (Claude decides)");
      });

      await test.step("a failed save stays in place and leaves the file", async () => {
        const claudeDir = path.join(cliHome, "claude");
        await background.click();
        await chmod(claudeDir, 0o500);
        try {
          await page
            .getByTestId("agent-api-endpoints-background-model-option-claude-haiku-4.5")
            .click();
          await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
            "Couldn't change the API endpoint settings for Claude",
          );
        } finally {
          await chmod(claudeDir, 0o700);
        }
        await expect(background).toHaveText("Same as the default model");
        expect(await claudeSettingsEnv("ANTHROPIC_SMALL_FAST_MODEL")).toBeUndefined();
        await section.getByRole("button", { name: "Dismiss" }).click();
      });

      await test.step("saved: the dotted Claude version goes in with hyphens, the Subagent as model:level", async () => {
        await background.click();
        await page
          .getByTestId("agent-api-endpoints-background-model-option-claude-haiku-4.5")
          .click();
        await expect(background).toHaveText("claude-haiku-4.5");
        await expect.poll(claudeSettingsBackgroundModel).toBe("claude-haiku-4-5");

        await subagent.click();
        await page.getByTestId("agent-api-endpoints-subagent-model-option-glm-5.3").click();
        await expect(subagent).toHaveText("glm-5.3");
        await thinking.click();
        await page.getByTestId("agent-api-endpoints-subagent-thinking-option-high").click();
        await expect(thinking).toHaveText("High");
        await expect.poll(claudeSettingsSubagentModel).toBe("glm-5.3:high");
      });

      await test.step("back to the default model takes the variable out", async () => {
        await background.click();
        await page.getByTestId("agent-api-endpoints-background-model-option-default").click();
        await expect(background).toHaveText("Same as the default model");
        await expect.poll(claudeSettingsBackgroundModel).toBeUndefined();
      });

      await test.step("switching off takes the Subagent model out of the file", async () => {
        await section.getByTestId("agent-api-endpoints-switch").click();
        await confirmSwitchOff(page);
        await expect(section.getByTestId("agent-api-endpoints-subagent-model")).toHaveCount(0);
        await expect.poll(claudeSettingsSubagentModel).toBeUndefined();
      });
    } finally {
      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      await rm(settingsPath, { force: true });
    }
  });

  test("Codex's default Subagent model and memory model: a failed save stays in place, saved ones go into config.toml and Official takes them out", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
      models: ["glm-5.3", "kimi-k2"],
    });
    await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      defaultModelId: "kimi-k2",
    });
    const codexDir = path.join(cliHome, "codex");
    try {
      await openAgentPage(page, "codex");
      const section = agentSection(page);
      const subagent = section.getByTestId("agent-api-endpoints-subagent-model-trigger");
      const thinking = section.getByTestId("agent-api-endpoints-subagent-thinking-trigger");
      const memory = section.getByTestId("agent-api-endpoints-memory-model-trigger");

      await test.step("nothing is set at first", async () => {
        await expect(subagent).toHaveText("Same as the main conversation");
        await expect(thinking).toHaveText("Not set (Codex decides)");
        await expect(memory).toHaveText("Codex's own");
        await expect(section).toContainText("Only used while Codex's memories feature is on");
      });

      await test.step("a failed save stays in place and leaves the file", async () => {
        await memory.click();
        await chmod(codexDir, 0o500);
        try {
          await page.getByTestId("agent-api-endpoints-memory-model-option-glm-5.3").click();
          await expect(section.getByTestId("agent-api-endpoints-error")).toContainText(
            "Couldn't change the API endpoint settings for Codex",
          );
        } finally {
          await chmod(codexDir, 0o700);
        }
        await expect(memory).toHaveText("Codex's own");
        expect(await readCodexConfig()).not.toContain("extract_model");
        await section.getByRole("button", { name: "Dismiss" }).click();
      });

      await test.step("saved: the four keys go into config.toml", async () => {
        await subagent.click();
        await page.getByTestId("agent-api-endpoints-subagent-model-option-glm-5.3").click();
        await expect(subagent).toHaveText("glm-5.3");
        await thinking.click();
        await page.getByTestId("agent-api-endpoints-subagent-thinking-option-high").click();
        await expect(thinking).toHaveText("High");
        await memory.click();
        await page.getByTestId("agent-api-endpoints-memory-model-option-glm-5.3").click();
        await expect(memory).toHaveText("glm-5.3");
        await expect.poll(readCodexConfig).toContain('default_subagent_model = "glm-5.3"');
        const config = await readCodexConfig();
        expect(config).toContain('default_subagent_reasoning_effort = "high"');
        expect(config).toContain('extract_model = "glm-5.3"');
        expect(config).toContain('consolidation_model = "glm-5.3"');
      });

      await test.step("switching off takes them out of the file", async () => {
        await section.getByTestId("agent-api-endpoints-switch").click();
        await confirmSwitchOff(page);
        await expect(section.getByTestId("agent-api-endpoints-memory-model")).toHaveCount(0);
        await expect.poll(readCodexConfig).not.toContain("default_subagent_model");
        expect(await readCodexConfig()).not.toContain("extract_model");
      });
    } finally {
      await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false });
      await rm(path.join(codexDir, "config.toml"), { force: true });
    }
  });

  test("Codex's forced Subagent model and Subagents on any model: a failed save stays in place, saved ones reach the gateway's settings and Codex's model list", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
      models: ["glm-5.3", "kimi-k2"],
    });
    const relayB = await seedApiEndpoint(client, {
      name: "Relay B",
      baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
      models: ["qwen-3"],
    });
    await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      defaultModelId: "kimi-k2",
    });
    const codexDir = path.join(cliHome, "codex");
    // 两项都存在 Osuna 自己的目录里（endpoints.json 与给 Codex 的模型目录），不写 config.toml。
    const catalogPath = /model_catalog_json = "([^"]+)"/.exec(await readCodexConfig())?.[1];
    if (catalogPath === undefined) throw new Error("Expected Codex's model list in config.toml");
    const forcedModel = async () =>
      (await client.apiEndpointList("codex")).agents?.codex?.forcedSubagentModelId ?? null;
    const catalogText = () => readFile(catalogPath, "utf8");
    // 目录里每个条目的多 Agent 版本（Relay B 关掉后：两个光秃秃的名字与两个「接口标识/模型名」）。
    const catalogVersions = async () =>
      CodexCatalogSchema.parse(JSON.parse(await catalogText())).models.map(
        (entry) => entry.multi_agent_version,
      );
    try {
      await openAgentPage(page, "codex");
      const section = agentSection(page);
      const forced = section.getByTestId("agent-api-endpoints-forced-subagent-model-trigger");
      const anyModel = section.getByTestId("agent-api-endpoints-any-subagent-model");
      const saveError = section.getByTestId("agent-api-endpoints-error");

      await test.step("nothing is forced and the switch is off at first", async () => {
        await expect(forced).toHaveText("Not forced");
        await expect(anyModel).not.toBeChecked();
        await expect(section).toContainText("Codex Subagents can use any model");
      });

      await test.step("a model whose endpoint was turned off meanwhile is refused, and the row stays", async () => {
        await forced.click();
        await client.apiEndpointSetEndpointState({ endpointId: relayB, enabled: false });
        await page.getByTestId("agent-api-endpoints-forced-subagent-model-option-qwen-3").click();
        await expect(saveError).toContainText(
          "Couldn't change the API endpoint settings for Codex",
        );
        await expect(saveError).toContainText("qwen-3 is not one of the models selected");
        await expect(forced).toHaveText("Not forced");
        expect(await forcedModel()).toBeNull();
        await section.getByRole("button", { name: "Dismiss" }).click();
      });

      await test.step("Codex's model list that can't be written leaves the switch off", async () => {
        const saved = await catalogText();
        // 目录文件的位置被一个文件夹占着：改写不成。
        await rm(catalogPath);
        await mkdir(path.join(catalogPath, "held"), { recursive: true });
        try {
          await anyModel.click();
          await expect(saveError).toContainText(
            "Couldn't change the API endpoint settings for Codex",
          );
          await expect(anyModel).not.toBeChecked();
        } finally {
          await rm(catalogPath, { recursive: true, force: true });
          await writeFile(catalogPath, saved);
        }
        await section.getByRole("button", { name: "Dismiss" }).click();
      });

      await test.step("saved: the gateway forces the model, and Codex's model list says V1", async () => {
        const configBefore = await readCodexConfig();
        await forced.click();
        await page.getByTestId("agent-api-endpoints-forced-subagent-model-option-glm-5.3").click();
        await expect(forced).toHaveText("glm-5.3");
        await expect.poll(forcedModel).toBe("glm-5.3");
        await anyModel.click();
        await expect(anyModel).toBeChecked();
        await expect.poll(catalogVersions).toEqual(["v1", "v1", "v1", "v1"]);
        expect(await readCodexConfig()).toBe(configBefore);
      });

      await test.step("Codex's own multi_agent_v2 on is told, with how to fix it", async () => {
        const configPath = path.join(codexDir, "config.toml");
        await writeFile(
          configPath,
          `${await readCodexConfig()}\n[features]\nmulti_agent_v2 = true\n`,
        );
        await openAgentPage(page, "codex");
        const notice = agentSection(page).getByTestId(
          "agent-api-endpoints-issue-codexMultiAgentV2On",
        );
        await expect(notice).toContainText(
          'Codex\'s own multi_agent_v2 overrides "Codex Subagents can use any model"',
        );
        await notice.getByRole("button", { name: "How to fix" }).click();
        await expect(notice.getByTestId("agent-api-endpoints-issue-fix-steps")).toContainText(
          "set multi_agent_v2 = false or delete it",
        );
      });
    } finally {
      await rm(path.join(codexDir, "config.toml"), { force: true });
    }
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

test.describe("Turning Use API endpoints off previews what it puts back", () => {
  const settingsPath = path.join(cliHome, "claude", "settings.json");
  const HAND_WRITTEN = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://hand-written.example"
  },
  "model": "opus"
}
`;
  // 关掉后 settings.json 的变化，按预览列出的顺序：前 8 行，其余 4 行折叠。
  const RESTORED_LINES = [
    '"ANTHROPIC_BASE_URL": "https://hand-written.example"',
    '"ANTHROPIC_AUTH_TOKEN": ••••',
    '"ANTHROPIC_API_KEY": ""',
    '"model": "opus"',
    '"permissions": {',
    '"deny": [',
    '"WebSearch"',
    '"modelPicker": {',
    '"options": [',
    '"model": "relay-a/claude-sonnet-4-5",',
    '"label": "claude-sonnet-4-5",',
    '"description": "Relay A"',
  ];
  const FOLDED_LINE_COUNT = 4;
  const NOW_LINES = [
    /^Now: "ANTHROPIC_BASE_URL": "http:\/\/127\.0\.0\.1:\d+\/api-endpoint-gateway",$/,
    'Now: "model": "claude-sonnet-4-5",',
  ];

  // 确认框里的东西直接按 testID 找：窄窗口里底部抽屉的外层不算可见。
  function inSheet(page: Page, testId: string): Locator {
    return page.getByTestId(testId).filter({ visible: true });
  }

  function sheetTitle(page: Page): Locator {
    return page.getByText("Turn off API endpoints for Claude?");
  }

  function readClaudeSettingsText(): Promise<string> {
    return readFile(settingsPath, "utf8");
  }

  async function switchClaudeOn(): Promise<void> {
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, HAND_WRITTEN);
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const on = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(on.error).toBeNull();
  }

  async function switchClaudeOffAndClear(): Promise<void> {
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    await writeFile(settingsPath, "{}\n");
  }

  test("reading, then every line of the file; Cancel changes nothing and the confirm turns it off", async ({
    page,
  }) => {
    try {
      await switchClaudeOn();
      const switched = await readFile(settingsPath, "utf8");
      const preview = await holdSwitchOffPreview(page);
      await openClaudeCodePage(page);
      const toggle = agentSection(page).getByTestId("agent-api-endpoints-switch");

      await test.step("reading what changes until the host answers", async () => {
        await toggle.click();
        await expect(sheetTitle(page)).toBeVisible();
        await expect(inSheet(page, "switch-off-loading")).toHaveText("Reading what changes…");
      });

      await test.step("every line of the file, values put back with what they are now", async () => {
        preview.release();
        const file = inSheet(page, `switch-off-file-${settingsPath}`);
        await expect(inSheet(page, "switch-off-loading")).toHaveCount(0);
        await expect(file.getByTestId("switch-off-line-text")).toHaveText(
          RESTORED_LINES.slice(0, 8),
        );
        await file.getByTestId("switch-off-more-lines").click();
        await expect(file.getByTestId("switch-off-line-text")).toHaveText(RESTORED_LINES);
        await expect(file.getByTestId("switch-off-line-now")).toHaveText(NOW_LINES);
        await expect(inSheet(page, "switch-off-codex-note")).toHaveCount(0);
      });

      await test.step("Cancel leaves the switch on and the file as it is", async () => {
        await inSheet(page, "switch-off-cancel").click();
        await expect(sheetTitle(page)).toHaveCount(0);
        await expect(toggle).toBeChecked();
        expect(await readFile(settingsPath, "utf8")).toBe(switched);
      });

      await test.step("confirming turns it off and puts the file back", async () => {
        await toggle.click();
        await confirmSwitchOff(page);
        await expect(sheetTitle(page)).toHaveCount(0);
        await expect(toggle).not.toBeChecked();
        await expect.poll(readClaudeSettingsText).toBe(HAND_WRITTEN);
      });
    } finally {
      await switchClaudeOffAndClear();
    }
  });

  test("a long file shows eight lines and folds the rest into N more lines", async ({ page }) => {
    try {
      await switchClaudeOn();
      await openClaudeCodePage(page);
      await agentSection(page).getByTestId("agent-api-endpoints-switch").click();
      const file = inSheet(page, `switch-off-file-${settingsPath}`);
      const more = file.getByTestId("switch-off-more-lines");

      await expect(more).toHaveText(`${FOLDED_LINE_COUNT} more lines`);
      await expect(file.getByTestId("switch-off-line")).toHaveCount(8);
      await more.click();
      await expect(file.getByTestId("switch-off-line")).toHaveCount(8 + FOLDED_LINE_COUNT);
      await expect(more).toHaveCount(0);
      await inSheet(page, "switch-off-cancel").click();
    } finally {
      await switchClaudeOffAndClear();
    }
  });

  test("a file Osuna can't read: described with the reason; the confirm is refused in place, Keep current settings turns it off", async ({
    page,
  }) => {
    const broken = '{\n  "theme": "dark"\n  "model": "opus"\n}\n';
    const reason = `${settingsPath} has a syntax error near line 3, column 3.`;
    try {
      await switchClaudeOn();
      await writeFile(settingsPath, broken);
      await openClaudeCodePage(page);
      const toggle = agentSection(page).getByTestId("agent-api-endpoints-switch");
      await toggle.click();

      await test.step("described in words with the reason", async () => {
        await expect(inSheet(page, "switch-off-described")).toContainText(
          "Osuna takes out everything it wrote into Claude's config",
        );
        await expect(inSheet(page, "switch-off-unavailable")).toContainText(reason);
        await expect(inSheet(page, "switch-off-keep-current")).toHaveCount(0);
      });

      await test.step("the confirm is sent; the host can't restore the file and says why", async () => {
        await confirmSwitchOff(page);
        await expect(inSheet(page, "switch-off-error")).toContainText(reason);
        await expect(inSheet(page, "switch-off-error")).toContainText(
          "Keep current settings turns it off and leaves the file as it is",
        );
        await expect(toggle).toBeChecked();
        expect(await readFile(settingsPath, "utf8")).toBe(broken);
      });

      await test.step("Keep current settings turns it off and leaves the file alone", async () => {
        await inSheet(page, "switch-off-keep-current").click();
        await expect(sheetTitle(page)).toHaveCount(0);
        await expect(toggle).not.toBeChecked();
        expect(await readFile(settingsPath, "utf8")).toBe(broken);
      });
    } finally {
      await switchClaudeOffAndClear();
    }
  });

  test("Codex says its Osuna model provider stays, and the confirm stays reachable on a narrow window", async ({
    page,
  }) => {
    const configPath = path.join(cliHome, "codex", "config.toml");
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
      models: ["kimi-k2"],
    });
    try {
      const on = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });
      expect(on.error).toBeNull();
      const preview = await holdSwitchOffPreview(page);
      await openAgentPage(page, "codex");
      // 窄窗口下侧栏收起，先在宽窗口里进到 Codex 页再收窄。
      await page.setViewportSize({ width: 390, height: 844 });
      await agentSection(page).getByTestId("agent-api-endpoints-switch").click();

      const note = "Osuna's Codex model provider stays, so conversations opened on it still open.";
      await expect(inSheet(page, "switch-off-loading")).toBeVisible();
      await expect(inSheet(page, "switch-off-codex-note")).toHaveText(note);
      preview.release();
      await expect(inSheet(page, `switch-off-file-${configPath}`)).toBeVisible();
      await expect(inSheet(page, "switch-off-codex-note")).toHaveText(note);
      await expect(inSheet(page, "switch-off-confirm")).toBeInViewport();
      await confirmSwitchOff(page);
      await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
      await expect.poll(readCodexConfig).not.toContain('model_provider = "osuna_api_endpoint"');
    } finally {
      await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false });
      await rm(configPath, { force: true });
    }
  });

  test("a host without the capability switches off at once, with no preview", async ({ page }) => {
    try {
      await switchClaudeOn();
      await hideCliWiringCapability(page);
      await openClaudeCodePage(page);
      const toggle = agentSection(page).getByTestId("agent-api-endpoints-switch");

      await toggle.click();

      await expect(toggle).not.toBeChecked();
      await expect(sheetTitle(page)).toHaveCount(0);
      await expect.poll(readClaudeSettingsText).toBe(HAND_WRITTEN);
    } finally {
      await switchClaudeOffAndClear();
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

  test("Switch to official opens the same preview; a failed confirm stays in it, then it turns the switch off and restores the file", async ({
    page,
  }) => {
    const settingsPath = path.join(claudeDir(), "settings.json");
    // 前面的用例可能留下或删掉这个文件；从一个空设置开始。
    await mkdir(claudeDir(), { recursive: true });
    await writeFile(settingsPath, "{}\n");
    await repointClaudeElsewhere();
    await openClaudeCodePage(page);
    await expect(issue(page, "notThroughGateway")).toBeVisible();
    const switchOffError = page.getByTestId("switch-off-error").filter({ visible: true });

    await test.step("the preview lists the address another tool wrote as taken out", async () => {
      await issueButton(page, "switchToOfficial").click();
      const file = page.getByTestId(`switch-off-file-${settingsPath}`).filter({ visible: true });
      await expect(
        file.getByTestId("switch-off-line-text").filter({ hasText: OTHER_TOOL_URL }),
      ).toHaveText(`"ANTHROPIC_BASE_URL": "${OTHER_TOOL_URL}",`);
    });

    await test.step("a failed confirm stays in the sheet", async () => {
      await chmod(claudeDir(), 0o500);
      try {
        await confirmSwitchOff(page);
        await expect(switchOffError).toContainText(
          "Couldn't change the API endpoint settings for Claude",
        );
      } finally {
        await chmod(claudeDir(), 0o700);
      }
      await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeChecked();
    });

    await test.step("retrying turns the switch off and restores the file", async () => {
      await confirmSwitchOff(page);
      await expect(switchOffError).toHaveCount(0);
      await expect(issue(page, "notThroughGateway")).toHaveCount(0);
      await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
      await expect.poll(claudeSettingsBaseUrl).toBeUndefined();
      expect(await readFile(settingsPath, "utf8")).toBe("{}\n");
    });
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

  test("Model replaced says which model Claude Code was switched to: Apply again and Keep current settings each fail in place, then do what they say", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const on = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(on.error).toBeNull();
    const settingsPath = path.join(claudeDir(), "settings.json");
    // 终端里的 /model 换成了哪家接口都没有的模型。
    const switchModel = async () => {
      const settings = await readClaudeSettings();
      await writeFile(settingsPath, JSON.stringify({ ...settings, model: "gpt-9" }, null, 2));
    };
    await switchModel();
    const host = await failKeepCurrentSettings(page);
    await openClaudeCodePage(page);

    await expect(issue(page, "modelReplaced")).toContainText(
      "Claude was switched to a model no API endpoint serves",
    );
    await expect(issue(page, "modelReplaced")).toContainText("was changed to gpt-9 outside Osuna");
    await expect(issueButton(page, "reapply")).toBeVisible();
    await expect(issueButton(page, "keepReplacedModel")).toHaveText("Keep current settings");

    await test.step("Apply again fails in place, then writes the default model back", async () => {
      await pressWhileReadOnly(page, "reapply");
      await expect(issue(page, "modelReplaced")).toBeVisible();
      await expect.poll(claudeSettingsModel).toBe("gpt-9");
      await issueError(page).getByRole("button", { name: "Dismiss" }).click();
      await issueButton(page, "reapply").click();
      await expect(issue(page, "modelReplaced")).toHaveCount(0);
      await expect.poll(claudeSettingsModel).toBe("claude-sonnet-4-5");
    });

    await test.step("Keep current settings fails in place, then stops the warning with the switch on", async () => {
      await switchModel();
      await page.reload();
      await expect(issue(page, "modelReplaced")).toBeVisible();
      await issueButton(page, "keepReplacedModel").click();
      await expect(issueError(page)).toContainText(
        'Couldn\'t finish "Keep current settings" for Claude',
      );
      await expect(issue(page, "modelReplaced")).toBeVisible();

      host.failing = false;
      await issueButton(page, "keepReplacedModel").click();
      await expect(issue(page, "modelReplaced")).toHaveCount(0);
      await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeChecked();
      expect((await readClaudeSettings()).model).toBe("gpt-9");
    });
  });

  test("a settings file Osuna can't read is explained in the UI language, with no actions", async ({
    page,
  }) => {
    await mkdir(claudeDir(), { recursive: true });
    await writeFile(path.join(claudeDir(), "settings.json"), '{ "env": { "A": "1" "B": "2" } }');
    try {
      await openClaudeCodePage(page);
      const unreadable = issue(page, "configUnparsable");
      await expect(unreadable).toContainText(
        "Osuna can't read Claude's settings file, so it can't change it",
      );
      await expect(unreadable).toContainText(
        `${path.join(claudeDir(), "settings.json")} has a syntax error near line 1, column 21.`,
      );
      await expect(unreadable.getByRole("button")).toHaveCount(0);
    } finally {
      await writeFile(path.join(claudeDir(), "settings.json"), "{}\n");
    }
  });

  test("turning the switch on over a file that isn't JSONC either is refused, and says why", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const settingsPath = path.join(claudeDir(), "settings.json");
    const broken = '{\n  "theme": "dark"\n  "model": "opus"\n}\n';
    await mkdir(claudeDir(), { recursive: true });
    await writeFile(settingsPath, broken);
    try {
      await openClaudeCodePage(page);
      await agentSection(page).getByTestId("agent-api-endpoints-switch").click();

      const failure = agentSection(page).getByTestId("agent-api-endpoints-error");
      await expect(failure).toContainText("Couldn't change the API endpoint settings for Claude");
      await expect(failure).toContainText(
        `${settingsPath} has a syntax error near line 3, column 3.`,
      );
      await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).not.toBeChecked();
      expect(await readFile(settingsPath, "utf8")).toBe(broken);
      // 一个区块一次一条：提示区同样的「读不懂」先收起，关掉红色那条后再出现。
      await expect(issue(page, "configUnparsable")).toHaveCount(0);
      await failure.getByRole("button", { name: "Dismiss" }).click();
      await expect(issue(page, "configUnparsable")).toContainText(
        `${settingsPath} has a syntax error near line 3, column 3.`,
      );
    } finally {
      await writeFile(settingsPath, "{}\n");
    }
  });

  test("a settings file with comments is still changed, says Claude Code can't read it, and How to fix opens the steps", async ({
    page,
  }) => {
    const settingsPath = path.join(claudeDir(), "settings.json");
    const commented = '{\n  // mine\n  "theme": "dark",\n}\n';
    await mkdir(claudeDir(), { recursive: true });
    await writeFile(settingsPath, commented);
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    try {
      const on = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
      expect(on.error).toBeNull();
      const written = await readFile(settingsPath, "utf8");
      expect(written).toContain("  // mine\n");
      expect(written).toContain("/api-endpoint-gateway");

      await openClaudeCodePage(page);
      const notice = issue(page, "settingsHasComments");
      await expect(notice).toContainText("Claude can't read its settings file: it has comments");
      await expect(notice).toContainText(
        "Claude chats in Osuna go to the official API instead of your API endpoints",
      );
      const steps = notice.getByTestId("agent-api-endpoints-issue-fix-steps");
      await expect(steps).toHaveCount(0);
      await notice.getByRole("button", { name: "How to fix" }).click();
      await expect(steps).toContainText("Delete every // and /* */ comment in the file");
      await notice.getByRole("button", { name: "How to fix" }).click();
      await expect(steps).toHaveCount(0);

      await test.step("once the comments are gone, the notice goes", async () => {
        const withoutComments = (await readFile(settingsPath, "utf8"))
          .replace("  // mine\n", "")
          .replace(/,(\s*[}\]])/g, "$1");
        JSON.parse(withoutComments);
        await writeFile(settingsPath, withoutComments);
        await openClaudeCodePage(page);
        await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeChecked();
        await expect(issue(page, "settingsHasComments")).toHaveCount(0);
      });
    } finally {
      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      await writeFile(settingsPath, "{}\n");
    }
  });

  test("a cloud-platform switch in the managed settings says where it is set and how to fix it", async ({
    page,
  }) => {
    const managedFile = path.join(cliHome, "managed", "managed-settings.json");
    await mkdir(path.dirname(managedFile), { recursive: true });
    await writeFile(managedFile, JSON.stringify({ env: { CLAUDE_CODE_USE_BEDROCK: "1" } }));
    await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    try {
      const on = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
      expect(on.error).toBeNull();

      await openClaudeCodePage(page);
      const notice = issue(page, "cloudSwitchOn");
      await expect(notice).toContainText(
        "Claude sends its requests to Amazon Bedrock, not through the gateway",
      );
      await expect(notice).toContainText(
        `Claude's managed settings (${managedFile}) turn on CLAUDE_CODE_USE_BEDROCK.`,
      );
      await expect(issueButton(page, "reapply")).toHaveCount(0);
      await expect(issueButton(page, "switchToOfficial")).toBeVisible();
      await notice.getByRole("button", { name: "How to fix" }).click();
      await expect(notice.getByTestId("agent-api-endpoints-issue-fix-steps")).toContainText(
        "Ask whoever manages this computer to remove CLAUDE_CODE_USE_BEDROCK",
      );

      await test.step("once the administrator takes it out, the notice goes", async () => {
        await writeFile(managedFile, JSON.stringify({ env: {} }));
        await openClaudeCodePage(page);
        await expect(agentSection(page).getByTestId("agent-api-endpoints-switch")).toBeChecked();
        await expect(issue(page, "cloudSwitchOn")).toHaveCount(0);
      });
    } finally {
      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      await rm(path.dirname(managedFile), { recursive: true, force: true });
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

  test("Codex behind a system proxy that doesn't pass its requests on says where the proxy is set and how to fix it", async ({
    page,
  }) => {
    // 不转发的假代理：全局模式的代理把 127.0.0.1 也送去别处，回 502。
    const proxy = createServer((_request, response) => {
      response.writeHead(502).end("Bad Gateway");
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (address === null || typeof address === "string") throw new Error("No proxy port");
    const proxyUrl = `http://127.0.0.1:${address.port}`;
    const systemProxyPath = path.join(cliHome, "system-proxy.json");
    await writeFile(
      systemProxyPath,
      JSON.stringify({ url: proxyUrl, http: proxyUrl, socks: null, bypass: [] }),
    );
    try {
      await seedApiEndpoint(client, {
        name: "Relay A",
        baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
        models: ["kimi-k2"],
      });
      const on = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });
      expect(on.error).toBeNull();

      await openAgentPage(page, "codex");
      const notice = issue(page, "codexProxied");
      await expect(notice).toContainText(
        "Codex reaches Osuna through a proxy that doesn't pass its requests on",
      );
      await expect(notice).toContainText(
        `through the proxy at ${proxyUrl}, set in the system proxy settings.`,
      );
      await expect(notice).toContainText("Codex chats in Osuna already go around the proxy.");
      await expect(issueButton(page, "reapply")).toHaveCount(0);
      await expect(issueButton(page, "switchToOfficial")).toBeVisible();
      await notice.getByRole("button", { name: "How to fix" }).click();
      const steps = notice.getByTestId("agent-api-endpoints-issue-fix-steps");
      await expect(steps).toContainText("add a DIRECT rule for 127.0.0.0/8");
      await expect(steps).toContainText("Or add this line to your shell profile (~/.zshrc).");
      await expect(steps.getByTestId("agent-api-endpoints-issue-fix-command")).toHaveText(
        "export NO_PROXY=127.0.0.1",
      );
      await expect(steps.getByRole("button", { name: "Copy" })).toBeVisible();
      await steps.scrollIntoViewIfNeeded();
      await expect(steps).toBeInViewport({ ratio: 1 });
      // 展开的步骤在说明下面、按钮上面。
      const stepsBox = await steps.boundingBox();
      const buttonBox = await issueButton(page, "switchToOfficial").boundingBox();
      if (stepsBox === null || buttonBox === null) throw new Error("The notice isn't laid out");
      expect(stepsBox.y + stepsBox.height).toBeLessThanOrEqual(buttonBox.y);
    } finally {
      await rm(systemProxyPath, { force: true });
      // daemon 把设了的系统代理记 15 秒：等提示消失再交给下一个用例。
      await expect.poll(codexIssueCodes, { timeout: 20_000 }).not.toContain("codex_proxied");
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  test("after a rewrite, the copies still on the old settings are listed with how to reopen each", async ({
    page,
  }) => {
    const codexDir = path.join(cliHome, "codex");
    const pidFile = path.join(codexDir, "app-server-daemon", "app-server.pid");
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000);
    // ps 的格式：pid、父 pid、已运行时间、命令行。终端里的 Codex 两小时前启动，还有一个刚启动的不算；
    // 后台 app-server 有一个终端 codex 连着，Osuna 不重启它。
    const table = [
      "  4101     1    02:00:00 /opt/homebrew/bin/codex",
      "  4102     1    00:00:01 /opt/homebrew/bin/codex resume --last",
      `  4103     1    03:00:00 ${codexDir}/packages/app-server-daemon/releases/0.163.0/bin/codex app-server --listen unix:///x --managed-daemon`,
      "  4104     1    01:00:00 /Users/me/.local/bin/claude",
    ].join("\n");
    await writeFile(path.join(cliHome, "process-table.txt"), `${table}\n`);
    await mkdir(path.dirname(pidFile), { recursive: true });
    await writeFile(pidFile, JSON.stringify({ pid: 4103 }));
    await utimes(pidFile, threeHoursAgo, threeHoursAgo);
    try {
      await seedApiEndpoint(client, {
        name: "Relay A",
        baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
        models: ["kimi-k2"],
      });
      const on = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });
      expect(on.error).toBeNull();

      await openAgentPage(page, "codex");
      const reopen = agentSection(page).getByTestId("agent-api-endpoints-reopen");
      await expect(reopen).toContainText(
        "Running copies of Codex still have the settings from before",
      );
      // 同一 worker 里别的用例留下的 Osuna 会话也会算进来，这里只看终端与 app-server 两行。
      const lines = reopen.getByTestId("agent-api-endpoints-reopen-line");
      const terminal = lines.filter({ hasText: "In a terminal" });
      await expect(terminal).toHaveCount(1);
      await expect(terminal).toHaveText(
        "In a terminal (1, first started 2 hours ago): quit Codex and start it again.",
      );
      await expect(
        lines.filter({ hasText: "Background app-server (started 3 hours ago): restart it with" }),
      ).toHaveCount(1);
      const command = reopen.getByTestId("agent-api-endpoints-reopen-command");
      await expect(command).toHaveText("codex app-server daemon restart");
      await expect(command).toBeInViewport({ ratio: 1 });
      await expect(reopen.getByTestId("agent-api-endpoints-reopen-note")).toHaveCount(0);
      // 「知道了」收起这一块，副本没变就不再出现。
      await reopen.getByTestId("agent-api-endpoints-reopen-dismiss").click();
      await expect(agentSection(page).getByTestId("agent-api-endpoints-reopen")).toHaveCount(0);
    } finally {
      await writeFile(path.join(cliHome, "process-table.txt"), "");
      await rm(path.join(codexDir, "app-server-daemon"), { recursive: true, force: true });
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

/** 关「使用第三方接口」的确认框里按确认。 */
async function confirmSwitchOff(page: Page): Promise<void> {
  await page.getByTestId("switch-off-confirm").filter({ visible: true }).click();
}

/** 关开关前的预览请求先扣下，`release` 之后才送到 daemon：确认框停在「正在读取」。 */
async function holdSwitchOffPreview(page: Page): Promise<{ release: () => void }> {
  const held: string[] = [];
  const host = { isHolding: true, forward: (_message: string) => {} };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    host.forward = (message) => server.send(message);
    ws.onMessage((message) => {
      const isPreview =
        typeof message === "string" && message.includes("preview_switch_off.request");
      if (host.isHolding && isPreview) {
        held.push(message);
        return;
      }
      server.send(message);
    });
  });
  return {
    release: () => {
      host.isHolding = false;
      for (const message of held.splice(0)) host.forward(message);
    },
  };
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

const CodexCatalogSchema = z.object({
  models: z.array(z.object({ multi_agent_version: z.string().optional() })),
});

async function readCodexConfig(): Promise<string> {
  try {
    return await readFile(path.join(cliHome, "codex", "config.toml"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** 主机报给 Codex 页提示区的 code。 */
async function codexIssueCodes(): Promise<string[]> {
  const issues = (await client.apiEndpointList("codex")).agentIssues?.codex ?? [];
  return issues.map((item) => item.code);
}

function agentSection(page: Page): Locator {
  return page.getByTestId("agent-api-endpoints").filter({ visible: true });
}

function defaultModelTrigger(page: Page): Locator {
  return agentSection(page).getByTestId("agent-api-endpoints-default-model-trigger");
}

interface ClaudeSettingsFile {
  model?: string;
  effortLevel?: string;
  ultracode?: boolean;
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

async function claudeSettingsUltraCode(): Promise<boolean | undefined> {
  return (await readClaudeSettings()).ultracode;
}

async function claudeSettingsEffortVariable(): Promise<string | undefined> {
  return (await readClaudeSettings()).env?.CLAUDE_CODE_EFFORT_LEVEL;
}

async function claudeSettingsEnv(key: string): Promise<string | undefined> {
  return (await readClaudeSettings()).env?.[key];
}

function claudeSettingsBackgroundModel(): Promise<string | undefined> {
  return claudeSettingsEnv("ANTHROPIC_SMALL_FAST_MODEL");
}

function claudeSettingsSubagentModel(): Promise<string | undefined> {
  return claudeSettingsEnv("CLAUDE_CODE_SUBAGENT_MODEL");
}

async function claudeSettingsEffort(): Promise<string | undefined> {
  return (await readClaudeSettings()).effortLevel;
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
