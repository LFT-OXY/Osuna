import { mkdtempSync } from "node:fs";
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
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsHost, openSettingsHostSection } from "../support/helpers/settings";
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
});
