// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/gui/tests/fixtures/curl 里各厂商的 curl 示例。
import { mkdtempSync } from "node:fs";
import { chmod, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator, WebSocketRoute } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import {
  answerImportRpc,
  CLAUDE_CODE_ONLY,
  CLAUDE_CODE_SAMPLE,
  CODEX_ONLY,
  CODEX_SAMPLE,
  connectApiEndpointClient,
  hideManagementCapability,
  openApiEndpointsPage,
  RELAY_ACCOUNT_TOKEN,
  RELAY_KEY,
  setCliHeaderSamples,
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
import { installLoginUsage } from "../support/helpers/usage-login";
import { openUsagePageFromShell } from "../support/helpers/usage-page";
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
    // 取网站图标、导入链接的图片只经封条的假外网（这份文件里写了的网址才有回复），绝不上网。
    PASEO_E2E_FAKE_SITES_PATH: path.join(cliHome, "fake-sites.json"),
    // 从别的软件导入读 daemon 的家目录（CC Switch、Alma）与 XDG 目录（OpenCode）：都换成临时的，
    // 绝不读开发者真实的配置。
    HOME: path.join(cliHome, "import-home"),
    XDG_CONFIG_HOME: path.join(cliHome, "import-home", ".config"),
    XDG_DATA_HOME: path.join(cliHome, "import-home", ".local", "share"),
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

function methodsSeen(target: FakeRelay): Set<string> {
  return new Set(target.requests.map((request) => request.method));
}

function listingsOf(target: FakeRelay): FakeRelay["requests"] {
  return target.requests.filter((request) => request.method === "GET");
}

function modelsAsked(target: FakeRelay): (string | undefined)[] {
  return target.requests.map((request) => request.model);
}

function deploymentListings(target: FakeRelay): FakeRelay["requests"] {
  return target.requests.filter((request) => request.url.includes("/deployments"));
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

// 窄窗口的模板选择窗口是滑上来的：几块的位置要在同一帧里量，分开量会量到滑动中的不同位置。
async function templateTileOriginsInOneFrame(
  page: Page,
  templateIds: string[],
): Promise<({ x: number; y: number } | null)[]> {
  return page.evaluate((testIds) => {
    const origins: ({ x: number; y: number } | null)[] = [];
    for (const id of testIds) {
      let origin: { x: number; y: number } | null = null;
      for (const node of document.querySelectorAll(`[data-testid="api-endpoint-template-${id}"]`)) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          origin = { x: rect.x, y: rect.y };
          break;
        }
      }
      origins.push(origin);
    }
    return origins;
  }, templateIds);
}

// 自动检测每种格式一行，这里取那一行的结论。
function detectionTags(page: Page): Locator[] {
  return ["anthropic_messages", "openai_chat", "openai_responses"].map((format) =>
    page.getByTestId(`api-endpoint-connection-detection-${format}-verdict`),
  );
}

const DETECTED_IN = /^Detected · \d+ ms$/;

test.describe("Settings API endpoints", () => {
  test("an empty host explains the page and offers to add one", async ({ page }) => {
    await openApiEndpointsPage(page);

    await expect(group(page, "enabled")).toContainText("On0");
    await expect(page.getByTestId("api-endpoints-empty")).toContainText(
      "No API endpoints yetAPI endpoints are shared by everything on this computer.",
    );
    await expect(page.getByTestId("api-endpoints-disabled-group")).toHaveCount(0);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await expect(connectionForm(page)).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-save")).toHaveText(
      "Save and fetch models",
    );
  });

  test("auto-detect lists the formats that answered, Use these fills them, saving opens the endpoint, and an edit keeps the key", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-add-button").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await fillConnection(page, {
      name: "Good relay",
      apiKey: RELAY_KEY,
      address: `${relay.origin}/good/`,
    });
    await expect(page.getByTestId("api-endpoint-connection-save")).toBeDisabled();

    await test.step("each format is tried once and gets a row; Use these fills in those that answered", async () => {
      await page.getByTestId("api-endpoint-connection-detect").click();
      const [anthropic, chat, responses] = detectionTags(page);
      await expect(anthropic).toHaveText(DETECTED_IN);
      await expect(chat).toHaveText(DETECTED_IN);
      await expect(responses).toHaveText("Not detected");
      await expect(
        page.getByTestId("api-endpoint-connection-detection-openai_responses-reason"),
      ).toHaveText("HTTP 404: Not Found · /responses · model gpt-5");
      // 检测只列结论，「采用这些」之前地址栏不动，保存按钮旁说明为什么还不能保存。
      await expect(page.getByTestId("api-endpoint-connection-url-openai_chat")).toHaveValue("");
      await expect(page.getByTestId("api-endpoint-connection-take-to-save")).toHaveText(
        "Press Use these to fill in the addresses before saving.",
      );
      await page.getByTestId("api-endpoint-connection-use-detected").click();
      await expect(page.getByTestId("api-endpoint-connection-taken")).toHaveText(
        "Taken · save to keep",
      );
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
    await page.getByTestId("api-endpoint-template-custom").click();
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

  test("an endpoint detects and saves without a key and sends none; a failed save stays in the form", async ({
    page,
  }) => {
    const host = await failConnectionSave(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await expect(page.getByTestId("api-endpoint-connection-api-key-field")).toContainText(
      "API key (optional)",
    );
    await expect(page.getByTestId("api-endpoint-connection-address-field-hint")).toHaveText(
      "Press Auto-detect: Osuna tries each of the three request formats once and lists how each answered; Use these fills in the addresses that work. The key goes with each try only if you fill it in.",
    );
    await page.getByTestId("api-endpoint-connection-name").fill("Local server");
    const detect = page.getByTestId("api-endpoint-connection-detect");
    // 地址没填时不能检测；key 不填不影响。
    await expect(detect).toBeDisabled();
    await page.getByTestId("api-endpoint-connection-address").fill(`${relay.origin}/free`);
    const save = page.getByTestId("api-endpoint-connection-save");

    await test.step("auto-detect works without a key", async () => {
      await expect(detect).toBeEnabled();
      await detect.click();
      const [anthropic, chat, responses] = detectionTags(page);
      await expect(anthropic).toHaveText(DETECTED_IN);
      await expect(chat).toHaveText(DETECTED_IN);
      await expect(responses).toHaveText("Not detected");
      await page.getByTestId("api-endpoint-connection-use-detected").click();
      await expect(page.getByTestId("api-endpoint-connection-url-openai_chat")).toHaveValue(
        `${relay.origin}/free/v1`,
      );
      await expect(save).toBeEnabled();
    });

    await test.step("a failed save keeps the form and says why", async () => {
      await save.click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("Local server");
      expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
    });

    await test.step("trying again saves it with no key, and its models are fetched without one", async () => {
      host.failing = false;
      relay.requests.length = 0;
      await save.click();
      await expect(connectionForm(page)).toHaveCount(0);
      const list = await client.apiEndpointList("claude");
      expect(list.endpoints).toMatchObject([{ name: "Local server", hasApiKey: false }]);
      await expect(headerTitle(page)).toHaveText("Local server");
      await expect(
        page.getByTestId("api-endpoint-connection-section").filter({ visible: true }),
      ).toContainText("None (optional)");
      await expect.poll(countOf(relay.requests)).toBeGreaterThan(0);
    });
    expect(authorizationsSeen(relay)).toEqual(new Set([undefined]));
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

  test("the endpoint order: the row menu's four moves, Alt+↑/↓ and a drag each change it and it survives a reload", async ({
    page,
  }) => {
    const [a, b, c] = await seedRelays(["Relay A", "Relay B", "Relay C"]);
    const off = await seedApiEndpoint(client, {
      name: "Relay Off",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    await client.apiEndpointSetEndpointState({ endpointId: off, enabled: false });
    await openApiEndpointsPage(page);
    await expect.poll(orderReader(page, "enabled")).toEqual([a, b, c]);

    await test.step("the row menu: Move to top, Move down, Move to bottom, Move up", async () => {
      await openOrderMenu(page, a);
      await expect(orderItem(page, "top")).toBeDisabled();
      await expect(orderItem(page, "up")).toBeDisabled();
      await expect(orderItem(page, "down")).toHaveText(/Move down/);
      await orderItem(page, "bottom").click();
      await expect.poll(orderReader(page, "enabled")).toEqual([b, c, a]);

      await openOrderMenu(page, a);
      await orderItem(page, "top").click();
      await expect.poll(orderReader(page, "enabled")).toEqual([a, b, c]);

      await openOrderMenu(page, a);
      await orderItem(page, "down").click();
      await expect.poll(orderReader(page, "enabled")).toEqual([b, a, c]);

      await openOrderMenu(page, c);
      await orderItem(page, "up").click();
      await expect.poll(orderReader(page, "enabled")).toEqual([b, c, a]);
      await expect.poll(storedOrder).toEqual([b, c, a, off]);
    });

    await test.step("right-clicking a row opens the same menu (as magpie)", async () => {
      await row(page, a).click({ button: "right" });
      await expect(orderItem(page, "bottom")).toBeDisabled();
      await orderItem(page, "top").click();
      await expect.poll(orderReader(page, "enabled")).toEqual([a, b, c]);
      await row(page, a).click({ button: "right" });
      await orderItem(page, "bottom").click();
      await expect.poll(orderReader(page, "enabled")).toEqual([b, c, a]);
      await expect.poll(storedOrder).toEqual([b, c, a, off]);
    });

    await test.step("Alt+↑/↓ on the focused row moves it and keeps the focus on it", async () => {
      await row(page, a).focus();
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(orderReader(page, "enabled")).toEqual([b, a, c]);
      await expect(row(page, a)).toBeFocused();
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(orderReader(page, "enabled")).toEqual([a, b, c]);
      await page.keyboard.press("Alt+Shift+ArrowDown");
      await expect.poll(orderReader(page, "enabled")).toEqual([b, c, a]);
      await page.keyboard.press("Alt+ArrowDown");
      await expect.poll(storedOrder).toEqual([b, c, a, off]);
    });

    await test.step("dragging a row's handle onto another row puts it there, without opening it", async () => {
      const listUrl = page.url();
      await dragRow(page, a, b);
      await expect.poll(orderReader(page, "enabled")).toEqual([a, b, c]);
      await expect.poll(storedOrder).toEqual([a, b, c, off]);
      expect(page.url()).toBe(listUrl);
    });

    await test.step("the order is still there after a reload, and the Off group keeps its own", async () => {
      await page.reload();
      await expect.poll(orderReader(page, "enabled")).toEqual([a, b, c]);
      expect(await rowOrder(page, "disabled")).toEqual([off]);
    });
  });

  test("two quick moves: the later one has the last word and the list never jumps back", async ({
    page,
  }) => {
    const [a, b, c] = await seedRelays(["Relay A", "Relay B", "Relay C"]);
    await holdSecondSetOrder(page);
    await openApiEndpointsPage(page);
    await expect.poll(orderReader(page, "enabled")).toEqual([a, b, c]);
    await recordEnabledOrders(page);

    await row(page, a).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Alt+ArrowDown");

    await expect.poll(storedOrder).toEqual([b, c, a]);
    await expect.poll(orderReader(page, "enabled")).toEqual([b, c, a]);
    await expect(row(page, a)).toBeFocused();
    const seen = await recordedOrders(page);
    const settled = seen.findIndex((order) => order.join() === [b, c, a].join());
    expect(settled).toBeGreaterThanOrEqual(0);
    expect(seen.slice(settled).map((order) => order.join())).toEqual(
      seen.slice(settled).map(() => [b, c, a].join()),
    );
  });

  test("a failed order change stays in place and the list goes back; a retry saves it", async ({
    page,
  }) => {
    const [a, b] = await seedRelays(["Relay A", "Relay B"]);
    const host = await failSetOrder(page);
    await openApiEndpointsPage(page);

    await openOrderMenu(page, b);
    await orderItem(page, "top").click();
    await expect(
      page.getByTestId("api-endpoints-action-error").filter({ visible: true }),
    ).toHaveText(/EACCES: permission denied/);
    await expect.poll(orderReader(page, "enabled")).toEqual([a, b]);
    expect(await storedOrder()).toEqual([a, b]);

    host.failing = false;
    await openOrderMenu(page, b);
    await orderItem(page, "top").click();
    await expect.poll(orderReader(page, "enabled")).toEqual([b, a]);
    await expect(page.getByTestId("api-endpoints-action-error")).toHaveCount(0);
    expect(await storedOrder()).toEqual([b, a]);
  });

  test("a host without apiEndpointManagement shows no order menu and no drag handle", async ({
    page,
  }) => {
    const [a] = await seedRelays(["Relay A", "Relay B"]);
    await hideManagementCapability(page);
    await openApiEndpointsPage(page);
    await expect(row(page, a)).toBeVisible();
    await expect(page.getByTestId(`api-endpoint-order-menu-${a}`)).toHaveCount(0);
    await expect(page.getByTestId("api-endpoint-drag-handle")).toHaveCount(0);
    // 搜索框与行上的 key 打码、默认模型也只给声明了它的主机。
    await expect(page.getByTestId("api-endpoints-search")).toHaveCount(0);
    await expect(page.getByTestId("api-endpoint-row-facts")).toHaveCount(0);
  });

  test("the search box finds endpoints by name, address and model name, says when none matches, and Escape clears it", async ({
    page,
  }) => {
    const openRouter = await seedApiEndpoint(client, {
      name: "OpenRouter",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const moonshot = await seedApiEndpoint(client, {
      name: "Moonshot",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/kimi-gateway/v1` }],
      models: ["kimi-k2"],
    });
    const zhipu = await seedApiEndpoint(client, {
      name: "Zhipu GLM",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["glm-4.6"],
    });
    await client.apiEndpointSetEndpointState({ endpointId: zhipu, enabled: false });
    await openApiEndpointsPage(page);
    const search = page.getByTestId("api-endpoints-search").filter({ visible: true });
    const shown = async () => [
      ...(await rowOrder(page, "enabled")),
      ...(await rowOrder(page, "disabled").catch(() => [])),
    ];

    await search.fill("openrouter");
    await expect.poll(shown).toEqual([openRouter]);
    await search.fill("kimi-gateway");
    await expect.poll(shown).toEqual([moonshot]);
    await search.fill("GLM");
    await expect.poll(shown).toEqual([zhipu]);
    await search.fill("moon kimi");
    await expect.poll(shown).toEqual([moonshot]);
    // 接口标识（默认模型写「接口标识/模型名」的那段）也能搜到。
    await search.fill("zhipu-glm");
    await expect.poll(shown).toEqual([zhipu]);

    await search.fill("deepseek");
    await expect.poll(shown).toEqual([]);
    // 没有分组标题，空状态直接在搜索框下面。
    await expect(group(page, "enabled")).toHaveCount(0);
    await expect(
      page.getByTestId("api-endpoints-add-button").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("api-endpoints-no-match").filter({ visible: true })).toHaveText(
      "No endpoint matches “deepseek”Search looks at each endpoint's name, base URLs and model names.",
    );

    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect.poll(shown).toEqual([openRouter, moonshot, zhipu]);
    await expect(page.getByTestId("api-endpoints-no-match")).toHaveCount(0);
  });

  test("while searching, a move goes among the rows shown and the hidden ones keep their order (as magpie)", async ({
    page,
  }) => {
    const [a, b, c, d] = await seedRelays(["Relay A", "Other B", "Relay C", "Relay D"]);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-search").filter({ visible: true }).fill("relay");
    await expect.poll(orderReader(page, "enabled")).toEqual([a, c, d]);

    await openOrderMenu(page, c);
    await orderItem(page, "up").click();
    await expect.poll(storedOrder).toEqual([c, a, b, d]);
    await expect.poll(orderReader(page, "enabled")).toEqual([c, a, d]);

    await row(page, c).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(storedOrder).toEqual([a, c, b, d]);

    await openOrderMenu(page, a);
    await orderItem(page, "bottom").click();
    await expect.poll(storedOrder).toEqual([c, b, d, a]);

    await dragRow(page, a, c);
    await expect.poll(storedOrder).toEqual([a, c, b, d]);
  });

  test("each row shows its key mask, its model count and whose default model goes there; a provider name opens its page", async ({
    page,
  }) => {
    const first = await seedApiEndpoint(client, {
      name: "First relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5", "claude-haiku-4-5"],
      apiKey: "sk-or-v1-abcdef1234",
    });
    const second = await seedApiEndpoint(client, {
      name: "Second relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const local = await client.apiEndpointSave({
      provider: "claude",
      name: "Local server",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/local/v1` }],
      models: [{ id: "qwen3" }],
    });
    const localId = local.endpoint?.id ?? "";
    for (const provider of ["claude", "codex"]) {
      const on = await client.apiEndpointSetAgentSettings({
        provider,
        enabled: true,
        defaultModelId: "claude-sonnet-4-5",
      });
      expect(on.error).toBeNull();
    }
    await openApiEndpointsPage(page);
    const facts = (endpointId: string) =>
      row(page, endpointId).getByTestId("api-endpoint-row-facts");

    await expect(facts(first)).toHaveText(
      "sk-o…1234·2 models selected·Default model of Claude, Codex",
    );
    await expect(row(page, first).getByTestId("api-endpoint-row-key")).toHaveAccessibleName(
      "API key sk-o…1234",
    );
    await expect(facts(second)).toHaveText("sk-e…elay·1 model selected");
    await expect(facts(localId)).toHaveText("1 model selected");

    await test.step("with the first endpoint off, the bare name goes to the second", async () => {
      await client.apiEndpointSetEndpointState({ endpointId: first, enabled: false });
      await page.reload();
      await expect(row(page, second).getByTestId("api-endpoint-row-default-model")).toHaveText(
        "Default model of Claude, Codex",
      );
      await expect(row(page, first).getByTestId("api-endpoint-row-default-model")).toHaveCount(0);
    });

    await test.step("a provider's name opens its settings page", async () => {
      const listUrl = page.url();
      await row(page, second).getByTestId("api-endpoint-row-provider-codex").click();
      await expectProviderDetail(page, getServerId(), "codex");
      expect(page.url()).not.toBe(listUrl);
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

  test("a model the vendor lists with a window of a million tokens or more carries its size beside the name; a smaller one carries none", async ({
    page,
  }) => {
    relay.goodModels = ["wide-window", "huge-window", "narrow-window"];
    relay.goodModelContexts = {
      "wide-window": 1_048_576,
      "huge-window": 2_000_000,
      "narrow-window": 200_000,
    };
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["wide-window"],
    });
    await openEndpointDetail(page, endpointId);
    const context = (modelId: string) =>
      page.getByTestId(`api-endpoint-model-context-${modelId}`).filter({ visible: true });

    await expect(context("wide-window")).toHaveText("1M");
    await expect(context("huge-window")).toHaveText("2M");
    await expect(
      page.getByTestId("api-endpoint-model-narrow-window").filter({ visible: true }),
    ).toBeVisible();
    await expect(context("narrow-window")).toHaveCount(0);
  });

  test("Forget fetched list empties the list and its time; a failed forget stays in place", async ({
    page,
  }) => {
    relay.goodModels = ["claude-sonnet-4-5", "gpt-5"];
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["gpt-5"],
    });
    const host = await failRequests(page, "provider.api_endpoint.forget_catalog");
    await openEndpointDetail(page, endpointId);
    const models = page.getByTestId("api-endpoint-models-section").filter({ visible: true });
    await expect(models.getByTestId("api-endpoint-models-fetched-at")).toContainText(/Fetched/);
    const menu = models.getByTestId("api-endpoint-models-menu");
    const forget = page.getByTestId("api-endpoint-models-forget");

    await test.step("a failed forget says why and keeps the list", async () => {
      await menu.click();
      await forget.click();
      await expect(models.getByTestId("api-endpoint-models-forget-error")).toContainText(
        "EACCES: permission denied",
      );
      expect((await catalogOf(endpointId))?.models.length).toBe(2);
      await expect(models.getByTestId("api-endpoint-model-family-claude")).toBeVisible();
    });

    await test.step("forgetting empties the list and its time; the selected model stays", async () => {
      host.failing = false;
      await menu.click();
      await forget.click();
      await expect(models.getByTestId("api-endpoint-models-forget-error")).toHaveCount(0);
      await expect.poll(catalogReader(endpointId)).toBeUndefined();
      await expect(models.getByTestId("api-endpoint-models-fetched-at")).toHaveCount(0);
      await expect(menu).toHaveCount(0);
      await expect(models.getByTestId("api-endpoint-model-family-claude")).toHaveCount(0);
      await expect(modelSwitch(page, "gpt-5")).toBeChecked();
      expect(await selectedModelsOf(endpointId)).toEqual(["gpt-5"]);
    });
  });

  test("a failed fetch on the endpoint page says why without the request address", async ({
    page,
  }) => {
    const rejected = await seedApiEndpoint(client, {
      name: "Wrong key",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: [],
      apiKey: "sk-wrong",
    });
    const unreachable = await seedApiEndpoint(client, {
      name: "Gone relay",
      baseUrls: [{ format: "anthropic_messages", url: `http://127.0.0.1:${await closedPort()}` }],
      models: [],
    });
    const failed = page.getByTestId("api-endpoint-models-failed").filter({ visible: true });

    await test.step("a rejected key", async () => {
      await openEndpointDetail(page, rejected);
      await expect(failed).toContainText("HTTP 401: Invalid API key · /v1/models");
      await expect(failed).not.toContainText(/https?:\/\//);
    });

    await test.step("an address that does not answer", async () => {
      await page.getByTestId("settings-api-endpoints-breadcrumb").filter({ visible: true }).click();
      await openEndpointRow(page, unreachable);
      await expect(failed).toContainText("ECONNREFUSED");
      await expect(failed).not.toContainText(/https?:\/\//);
    });
  });

  test("Add by hand takes several model names separated by commas; a failed add stays in place", async ({
    page,
  }) => {
    relay.goodModels = ["claude-sonnet-4-5"];
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: [],
    });
    const host = await failRequests(page, "provider.api_endpoint.save");
    await openEndpointDetail(page, endpointId);
    const models = page.getByTestId("api-endpoint-models-section").filter({ visible: true });
    await expect(models.getByTestId("api-endpoint-model-family-claude")).toBeVisible();
    await models.getByTestId("api-endpoint-models-add").click();
    const input = page.getByTestId("api-endpoint-models-add-input");
    await input.fill("first-own, second-own ,, first-own");

    await test.step("a failed add keeps what was typed and says why", async () => {
      await page.getByTestId("api-endpoint-models-add-submit").click();
      await expect(page.getByTestId("api-endpoint-models-add-error")).toContainText(
        "EACCES: permission denied",
      );
      await expect(input).toHaveValue("first-own, second-own ,, first-own");
      expect(await selectedAndManualReader(endpointId)()).toEqual([[], []]);
    });

    await test.step("adding again adds each name once, turned on", async () => {
      host.failing = false;
      await page.getByTestId("api-endpoint-models-add-submit").click();
      await expect(input).toHaveCount(0);
      await expect.poll(selectedAndManualReader(endpointId)).toEqual([
        ["first-own", "second-own"],
        ["first-own", "second-own"],
      ]);
      await models.getByTestId("api-endpoint-model-family-other").click();
      await expect(modelSwitch(page, "first-own")).toBeChecked();
      await expect(modelSwitch(page, "second-own")).toBeChecked();
    });
  });

  test("Model scope: Vendor's list serves the list's first 24; Picked only keeps them; a failed switch stays as it was", async ({
    page,
  }) => {
    relay.goodModels = numberedModels(26);
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: [],
      modelScope: "vendor",
    });
    const host = await failRequests(page, "provider.api_endpoint.save");
    await openEndpointDetail(page, endpointId);
    const scope = page.getByTestId("api-endpoint-model-scope-section").filter({ visible: true });
    const firstServed = numberedModels(24);

    await test.step("Vendor's list says only the first 24 are served, and they are on", async () => {
      await expect(scope.getByTestId("api-endpoint-model-scope-hint")).toContainText(
        "the first 24 in list order",
      );
      await expect(scope.getByTestId("api-endpoint-auto-pick")).toHaveCount(0);
      expect(await selectedModelsOf(endpointId)).toEqual(firstServed);
      const models = page.getByTestId("api-endpoint-models-section").filter({ visible: true });
      await expect(models.getByTestId("api-endpoint-model-family-other")).toContainText("24/26");
      await expect(modelSwitch(page, "model-25")).not.toBeChecked();
    });

    await test.step("a failed switch says why and stays on Vendor's list", async () => {
      await scope.getByTestId("api-endpoint-model-scope-picked").click();
      await expect(page.getByTestId("api-endpoint-detail-error-alert")).toContainText(
        "EACCES: permission denied",
      );
      await expect(scope.getByTestId("api-endpoint-model-scope-hint")).toContainText(
        "the first 24 in list order",
      );
      expect((await endpointOf(endpointId))?.modelScope).toBe("vendor");
    });

    await test.step("Picked only keeps exactly what was served", async () => {
      host.failing = false;
      await scope.getByTestId("api-endpoint-model-scope-picked").click();
      await expect(scope.getByTestId("api-endpoint-auto-pick")).toBeVisible();
      await expect.poll(scopeReader(endpointId)).toBe("picked");
      expect(await selectedModelsOf(endpointId)).toEqual(firstServed);
    });

    await test.step("back on Vendor's list, switching a model off moves to Picked only", async () => {
      await scope.getByTestId("api-endpoint-model-scope-vendor").click();
      await expect.poll(scopeReader(endpointId)).toBe("vendor");
      await modelSwitch(page, "model-01").click();
      await expect.poll(scopeReader(endpointId)).toBe("picked");
      expect(await selectedModelsOf(endpointId)).toEqual(firstServed.slice(1));
      await expect(scope.getByTestId("api-endpoint-auto-pick")).toBeVisible();
    });
  });

  test("Auto-pick rules: a model name or a regex RE2 cannot read is not a rule, a failed add or remove stays in place, and a rule switches on what it matches", async ({
    page,
  }) => {
    relay.goodModels = numberedModels(26);
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["model-01"],
    });
    const host = await failRequests(page, "provider.api_endpoint.save");
    host.failing = false;
    await openEndpointDetail(page, endpointId);
    const scope = page.getByTestId("api-endpoint-model-scope-section").filter({ visible: true });
    const input = scope.getByTestId("api-endpoint-auto-pick-input");
    const add = scope.getByTestId("api-endpoint-auto-pick-add");
    const error = scope.getByTestId("api-endpoint-auto-pick-error");

    await test.step("a model name is turned away before anything is sent", async () => {
      await input.fill("model-02");
      await add.click();
      await expect(error).toHaveText(
        "“model-02” is a model name. A rule has a * in it or begins with “re:”.",
      );
      await expect(input).toHaveValue("model-02");
      // RE2 读不懂的（如反向引用）也当场说明，和 magpie 一样。
      await input.fill("re:(model)\\1");
      await add.click();
      await expect(error).toHaveText(
        "“re:(model)\\1” is not a regular expression that can be read.",
      );
      expect((await endpointOf(endpointId))?.autoPick).toBeUndefined();
    });

    await test.step("a failed add says why and keeps what was typed", async () => {
      host.failing = true;
      await input.fill("MODEL-2*");
      await add.click();
      await expect(error).toContainText("EACCES: permission denied");
      await expect(input).toHaveValue("MODEL-2*");
      expect((await endpointOf(endpointId))?.autoPick).toBeUndefined();
    });

    await test.step("adding the rule switches on the matching models listed now, in any case", async () => {
      host.failing = false;
      await add.click();
      await expect(scope.getByTestId("api-endpoint-auto-pick-rule-MODEL-2*")).toBeVisible();
      await expect(input).toHaveValue("");
      await expect(error).toHaveCount(0);
      await expect
        .poll(selectedModelsReader(endpointId))
        .toEqual([
          "model-20",
          "model-21",
          "model-22",
          "model-23",
          "model-24",
          "model-25",
          "model-26",
          "model-01",
        ]);
    });

    await test.step("a failed remove says why and keeps the rule; removing again drops it and keeps the models", async () => {
      host.failing = true;
      await scope.getByTestId("api-endpoint-auto-pick-remove-MODEL-2*").click();
      await expect(error).toContainText("EACCES: permission denied");
      await expect(scope.getByTestId("api-endpoint-auto-pick-rule-MODEL-2*")).toBeVisible();
      host.failing = false;
      await scope.getByTestId("api-endpoint-auto-pick-remove-MODEL-2*").click();
      await expect(scope.getByTestId("api-endpoint-auto-pick-rule-MODEL-2*")).toHaveCount(0);
      await expect.poll(autoPickReader(endpointId)).toBeUndefined();
      expect(await selectedModelsOf(endpointId)).toHaveLength(8);
    });
  });

  // 接口管理好用性工单 13：模型行菜单的「模型设置」与详情页的「整家默认」。
  test("Model settings: the row menu opens it, a failed save or Restore default stays in place, and saving reaches the endpoint", async ({
    page,
  }) => {
    relay.goodModels = ["model-01", "model-02"];
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["model-01"],
    });
    const host = await failRequests(page, "provider.api_endpoint.save");
    host.failing = false;
    await openEndpointDetail(page, endpointId);
    const sheet = page.getByTestId("api-endpoint-model-settings");
    const openSettingsOf = async (modelId: string) => {
      await page
        .getByTestId(`api-endpoint-model-menu-${modelId}`)
        .filter({ visible: true })
        .click();
      await page.getByTestId(`api-endpoint-model-settings-open-${modelId}`).click();
      await expect(sheet).toBeVisible();
    };
    const settingsReader = async () => (await endpointOf(endpointId))?.modelSettings;

    await test.step("every item and the CLIs they don't reach are shown; the switch is a switch", async () => {
      await openSettingsOf("model-01");
      await expect(sheet.getByTestId("api-endpoint-model-settings-model")).toContainText(
        "model-01",
      );
      await expect(sheet.getByTestId("api-endpoint-model-settings-name-field-hint")).toContainText(
        "Claude Code has no display name setting",
      );
      await expect(
        sheet.getByTestId("api-endpoint-model-settings-output-field-hint"),
      ).toContainText("Codex has no output limit setting");
      await expect(sheet.getByTestId("api-endpoint-model-settings-images")).toHaveRole("switch");
      await expect(sheet.getByTestId("api-endpoint-model-settings-save")).toBeDisabled();
    });

    await test.step("a number that isn't one is refused in place", async () => {
      await sheet.getByTestId("api-endpoint-model-settings-context").fill("12.5");
      await expect(sheet.getByTestId("api-endpoint-model-settings-context-field-error")).toHaveText(
        "Use a count like 272k",
      );
      await expect(sheet.getByTestId("api-endpoint-model-settings-save")).toBeDisabled();
    });

    await test.step("a failed save says why and keeps every input", async () => {
      await sheet.getByTestId("api-endpoint-model-settings-name").fill("Fast one");
      await sheet.getByTestId("api-endpoint-model-settings-context").fill("128,000");
      await sheet.getByTestId("api-endpoint-model-settings-efforts").click();
      await page.getByTestId("api-endpoint-model-settings-effort-high").click();
      await page.keyboard.press("Escape");
      await expect(sheet.getByTestId("api-endpoint-model-settings-efforts")).toContainText("high");
      await sheet.getByTestId("api-endpoint-model-settings-images").click();
      host.failing = true;
      await sheet.getByTestId("api-endpoint-model-settings-save").click();
      await expect(sheet.getByTestId("api-endpoint-model-settings-error")).toContainText(
        "EACCES: permission denied",
      );
      await expect(sheet.getByTestId("api-endpoint-model-settings-name")).toHaveValue("Fast one");
      expect(await settingsReader()).toBeUndefined();
    });

    await test.step("saving closes the window and reaches the endpoint", async () => {
      host.failing = false;
      await sheet.getByTestId("api-endpoint-model-settings-save").click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(settingsReader).toEqual({
        models: {
          "model-01": { name: "Fast one", context: 128_000, efforts: ["high"], images: true },
        },
      });
    });

    await test.step("Restore default: a failure stays in place, then it goes back to automatic", async () => {
      await openSettingsOf("model-01");
      await expect(sheet.getByTestId("api-endpoint-model-settings-name")).toHaveValue("Fast one");
      host.failing = true;
      await sheet.getByTestId("api-endpoint-model-settings-restore").click();
      await expect(sheet.getByTestId("api-endpoint-model-settings-error")).toContainText(
        "EACCES: permission denied",
      );
      expect((await settingsReader())?.models?.["model-01"]?.name).toBe("Fast one");
      host.failing = false;
      await sheet.getByTestId("api-endpoint-model-settings-restore").click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(settingsReader).toBeUndefined();
    });
  });

  test("Defaults for all models: a failed save keeps the numbers, and saving reaches the endpoint", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["model-01"],
    });
    const host = await failRequests(page, "provider.api_endpoint.save");
    await openEndpointDetail(page, endpointId);
    const section = page
      .getByTestId("api-endpoint-model-defaults-section")
      .filter({ visible: true });
    const save = section.getByTestId("api-endpoint-model-defaults-save");
    const settingsReader = async () => (await endpointOf(endpointId))?.modelSettings;

    await expect(save).toBeDisabled();
    await section.getByTestId("api-endpoint-model-defaults-context").fill("200000");
    await section.getByTestId("api-endpoint-model-defaults-compact").fill("150000");
    await save.click();
    await expect(section.getByTestId("api-endpoint-model-defaults-error")).toContainText(
      "EACCES: permission denied",
    );
    await expect(section.getByTestId("api-endpoint-model-defaults-compact")).toHaveValue("150000");
    expect(await settingsReader()).toBeUndefined();

    host.failing = false;
    await save.click();
    await expect.poll(settingsReader).toEqual({ defaults: { context: 200_000, compact: 150_000 } });
    await expect(section.getByTestId("api-endpoint-model-defaults-error")).toHaveCount(0);
    await expect(save).toBeDisabled();
  });

  // 接口管理好用性工单 15：上游模型名与只用这种格式。
  test("Upstream name and Use only this format: a failed save keeps them, saving reaches the endpoint, the row menu sets the format, and a gone URL is told", async ({
    page,
  }) => {
    relay.goodModels = ["model-01", "model-02"];
    const anthropicUrl = { format: "anthropic_messages", url: `${relay.origin}/good` };
    const chatUrl = { format: "openai_chat", url: `${relay.origin}/good/v1` };
    const responsesUrl = { format: "openai_responses", url: `${relay.origin}/good/v1` };
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [anthropicUrl, chatUrl],
      models: ["model-01"],
    });
    const host = await failRequests(page, "provider.api_endpoint.save");
    host.failing = false;
    await openEndpointDetail(page, endpointId);
    const sheet = page.getByTestId("api-endpoint-model-settings");
    const settingsReader = async () => (await endpointOf(endpointId))?.modelSettings;
    const openModelSettings = async () => {
      await page.getByTestId("api-endpoint-model-menu-model-01").filter({ visible: true }).click();
      await page.getByTestId("api-endpoint-model-settings-open-model-01").click();
      await expect(sheet).toBeVisible();
    };

    await test.step("the model settings: a failed save keeps both, then saving reaches the endpoint", async () => {
      await openModelSettings();
      const upstreamName = sheet.getByTestId("api-endpoint-model-settings-upstream-name");
      await expect(upstreamName).toHaveAttribute("placeholder", "model-01");
      await upstreamName.fill("vendor/*");
      await sheet.getByTestId("api-endpoint-model-settings-format-openai_chat").click();
      host.failing = true;
      await sheet.getByTestId("api-endpoint-model-settings-save").click();
      await expect(sheet.getByTestId("api-endpoint-model-settings-error")).toContainText(
        "EACCES: permission denied",
      );
      await expect(upstreamName).toHaveValue("vendor/*");
      expect(await settingsReader()).toBeUndefined();
      host.failing = false;
      await sheet.getByTestId("api-endpoint-model-settings-save").click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(settingsReader).toEqual({
        models: { "model-01": { upstreamName: "vendor/*", format: "openai_chat" } },
      });
      await expect(
        page.getByTestId("api-endpoint-model-format-model-01").filter({ visible: true }),
      ).toHaveText("OpenAI Chat only");
    });

    await test.step("the row menu: a failed change is told on the page, then picking the checked format again takes it away", async () => {
      const pickChecked = async () => {
        await page
          .getByTestId("api-endpoint-model-menu-model-01")
          .filter({ visible: true })
          .click();
        await expect(page.getByTestId("api-endpoint-model-format-menu-model-01")).toContainText(
          "OpenAI Chat",
        );
        await page.getByTestId("api-endpoint-model-format-menu-model-01").click();
        await page.getByTestId("api-endpoint-model-format-pin-model-01-openai_chat").click();
      };
      host.failing = true;
      await pickChecked();
      await expect(
        page.getByTestId("api-endpoint-detail-error-alert").filter({ visible: true }),
      ).toContainText("EACCES: permission denied");
      expect((await settingsReader())?.models?.["model-01"]?.format).toBe("openai_chat");
      host.failing = false;
      await pickChecked();
      await expect
        .poll(settingsReader)
        .toEqual({ models: { "model-01": { upstreamName: "vendor/*" } } });
      await expect(page.getByTestId("api-endpoint-model-format-model-01")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-detail-error-alert")).toHaveCount(0);
    });

    await test.step("a format whose URL is gone no longer applies, and the model settings say so", async () => {
      const saved = await client.apiEndpointSave({
        provider: "claude",
        endpointId,
        name: "Good relay",
        baseUrls: [anthropicUrl, chatUrl, responsesUrl],
        models: [{ id: "model-01" }],
        modelSettings: { models: { "model-01": { format: "openai_responses" } } },
      });
      expect(saved.error).toBeNull();
      const gone = await client.apiEndpointSave({
        provider: "claude",
        endpointId,
        name: "Good relay",
        baseUrls: [anthropicUrl, chatUrl],
        models: [{ id: "model-01" }],
      });
      expect(gone.error).toBeNull();
      // 别处改的这家：重新打开详情页读到新的。
      await openEndpointDetail(page, endpointId);
      await expect(
        page.getByTestId("api-endpoint-model-format-model-01").filter({ visible: true }),
      ).toHaveText("OpenAI Responses only · not in effect");
      await openModelSettings();
      await expect(sheet.getByTestId("api-endpoint-model-settings-format-field-hint")).toHaveText(
        "This endpoint no longer has a base URL for OpenAI Responses, so this setting doesn't apply.",
      );
      await expect(sheet.getByTestId("api-endpoint-model-settings-format")).toHaveText(
        "OpenAI Responses · not in effect",
      );
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    });

    await test.step("the row menu shows a void format checked and not in effect, and picking it again clears it", async () => {
      await page.getByTestId("api-endpoint-model-menu-model-01").filter({ visible: true }).click();
      const root = page.getByTestId("api-endpoint-model-format-menu-model-01");
      await expect(root).toContainText("OpenAI Responses · not in effect");
      await root.click();
      const voidRow = page.getByTestId("api-endpoint-model-format-pin-model-01-openai_responses");
      await expect(voidRow).toContainText("OpenAI Responses · not in effect");
      await expect(voidRow).toHaveAttribute("aria-checked", "true");
      await voidRow.click();
      await expect.poll(settingsReader).toBeUndefined();
      await expect(page.getByTestId("api-endpoint-model-format-model-01")).toHaveCount(0);
    });
  });

  test("Defaults for all models: the upstream name for every model fails in place, then reaches the endpoint", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["model-01"],
    });
    const host = await failRequests(page, "provider.api_endpoint.save");
    await openEndpointDetail(page, endpointId);
    const section = page
      .getByTestId("api-endpoint-model-defaults-section")
      .filter({ visible: true });
    const input = section.getByTestId("api-endpoint-model-defaults-upstream-name");
    const save = section.getByTestId("api-endpoint-model-defaults-save");
    const settingsReader = async () => (await endpointOf(endpointId))?.modelSettings;

    await input.fill("zhipu/*");
    await save.click();
    await expect(section.getByTestId("api-endpoint-model-defaults-error")).toContainText(
      "EACCES: permission denied",
    );
    await expect(input).toHaveValue("zhipu/*");
    expect(await settingsReader()).toBeUndefined();
    host.failing = false;
    await save.click();
    await expect.poll(settingsReader).toEqual({ defaults: { upstreamName: "zhipu/*" } });
  });

  test("Auto-detect on a saved endpoint offers to ask the tried model in one format only, made with the Save", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [
        { format: "anthropic_messages", url: `${relay.origin}/good` },
        { format: "openai_chat", url: `${relay.origin}/good/v1` },
      ],
      models: ["model-01"],
    });
    await openEndpointDetail(page, endpointId);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-connection-detect-model").fill("model-01");
    await page.getByTestId("api-endpoint-connection-detect").click();
    const chatOnly = page.getByTestId("api-endpoint-connection-only-openai_chat");
    const pending = page.getByTestId("api-endpoint-connection-only-pending");
    await expect(chatOnly).toHaveText("Ask model-01 over OpenAI Chat only");
    await expect(page.getByTestId("api-endpoint-connection-only-anthropic_messages")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-only-openai_responses")).toHaveCount(0);
    await chatOnly.click();
    await expect(pending).toHaveText(
      "After saving, model-01 is only asked over OpenAI Chat. Press it again to undo.",
    );
    // 再点一次取消，再选上。
    await chatOnly.click();
    await expect(pending).toHaveCount(0);
    await chatOnly.click();
    await expect(pending).toBeVisible();
    await page.getByTestId("api-endpoint-connection-save").click();
    await expect(connectionForm(page)).toHaveCount(0);
    await expect
      .poll(async () => (await endpointOf(endpointId))?.modelSettings)
      .toEqual({ models: { "model-01": { format: "openai_chat" } } });
  });

  test("Each picked model lists every model on every format; Use these makes a model that answered on one format only use it; a rejected key and a cancel", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [
        { format: "anthropic_messages", url: `${relay.origin}/good` },
        { format: "openai_chat", url: `${relay.origin}/good/v1` },
      ],
      models: ["claude-sonnet-4-5", "chat-only-glm"],
    });
    await openEndpointDetail(page, endpointId);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    const each = page.getByTestId("api-endpoint-connection-detect-each");
    const verdict = (model: string, format: string) =>
      page.getByTestId(`api-endpoint-connection-each-${model}-${format}-verdict`);
    const reason = (model: string, format: string) =>
      page.getByTestId(`api-endpoint-connection-each-${model}-${format}-reason`);

    await test.step("each model gets a row with each format's answer", async () => {
      relay.requests.length = 0;
      await each.click();
      await expect(verdict("claude-sonnet-4-5", "anthropic_messages")).toHaveText(/^\d+ ms$/);
      await expect(verdict("claude-sonnet-4-5", "openai_chat")).toHaveText(/^\d+ ms$/);
      // 没答上的：格式名那一行写状态码，下一行写结论与原因。
      await expect(verdict("claude-sonnet-4-5", "openai_responses")).toHaveText("404");
      await expect(verdict("chat-only-glm", "anthropic_messages")).toHaveText("400");
      await expect(reason("chat-only-glm", "anthropic_messages")).toHaveText(
        "Not detected · The model chat-only-glm is not served here · /v1/messages",
      );
      await expect(verdict("chat-only-glm", "openai_chat")).toHaveText(/^\d+ ms$/);
      // 两个模型、三种格式，各问一次。
      expect(postedPaths(relay)).toHaveLength(6);
      await expect(page.getByTestId("api-endpoint-connection-each-given")).toHaveText(
        "“Use these” also sets “Use only this format”: chat-only-glm: OpenAI Chat only",
      );
    });

    await test.step("Use these and Save make it use only that format", async () => {
      await page.getByTestId("api-endpoint-connection-use-detected").click();
      await expect(page.getByTestId("api-endpoint-connection-each-given")).toHaveText(
        "After saving, these use “Use only this format”: chat-only-glm: OpenAI Chat only",
      );
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      await expect
        .poll(modelSettingsReader(endpointId))
        .toEqual({ models: { "chat-only-glm": { format: "openai_chat" } } });
    });

    await test.step("a rejected key reads Key rejected on every format", async () => {
      await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
      await page.getByTestId("api-endpoint-connection-api-key").fill("sk-wrong");
      await each.click();
      for (const model of ["claude-sonnet-4-5", "chat-only-glm"]) {
        for (const format of ["anthropic_messages", "openai_chat", "openai_responses"]) {
          await expect(verdict(model, format)).toHaveText("401");
          await expect(reason(model, format)).toHaveText(/^Key rejected · Invalid API key · /);
        }
      }
      await expect(page.getByTestId("api-endpoint-connection-use-detected")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-connection-none-answered")).toBeVisible();
    });

    await test.step("a detection that hangs can be cancelled", async () => {
      await page.getByTestId("api-endpoint-connection-api-key").fill(RELAY_KEY);
      await page.getByTestId("api-endpoint-connection-address").fill(`${relay.origin}/slow`);
      await each.click();
      await page.getByTestId("api-endpoint-connection-detect-cancel").click();
      await expect(page.getByTestId("api-endpoint-connection-detect-cancel")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-connection-each-results")).toHaveCount(0);
      await expect(each).toBeEnabled();
    });
  });

  test("Long conversations: Full window and Compact at reach the host, and a refusal keeps what was there", async ({
    page,
  }) => {
    const host = await failRequests(page, "provider.api_endpoint.set_long_conversations");
    await openApiEndpointsPage(page);
    const section = page.getByTestId("api-endpoints-long-conversations").filter({ visible: true });
    const fullWindow = section.getByTestId("api-endpoints-full-window-switch");
    const compactAt = section.getByTestId("api-endpoints-compact-at");
    const hostSettings = async () => (await client.apiEndpointList("claude")).longConversations;

    await expect(compactAt).toHaveAttribute("placeholder", "272,000");
    await compactAt.fill("400000");
    await compactAt.press("Enter");
    await expect(section.getByTestId("api-endpoints-long-conversations-error")).toContainText(
      "EACCES: permission denied",
    );
    await expect(compactAt).toHaveValue("400000");
    expect(await hostSettings()).toEqual({});

    host.failing = false;
    await compactAt.press("Enter");
    await expect.poll(hostSettings).toEqual({ compactAt: 400_000 });
    await expect(section.getByTestId("api-endpoints-long-conversations-error")).toHaveCount(0);
    // 存好的数按千分位写回；magpie 的简写也认。
    await expect(compactAt).toHaveValue("400,000");
    await compactAt.fill("1.5m");
    await compactAt.press("Enter");
    await expect.poll(hostSettings).toEqual({ compactAt: 1_500_000 });
    await expect(compactAt).toHaveValue("1,500,000");

    // 「完整窗口」开着时压缩阈值照样列出、改不了，看得出存着的数还在。
    await fullWindow.click();
    await expect.poll(hostSettings).toEqual({ fullContext: true, compactAt: 1_500_000 });
    await expect(compactAt).not.toBeEditable();
    await expect(compactAt).toHaveValue("1,500,000");
    host.failing = true;
    await fullWindow.click();
    await expect(section.getByTestId("api-endpoints-long-conversations-error")).toBeVisible();
    await expect(compactAt).not.toBeEditable();
    host.failing = false;
    await fullWindow.click();
    await expect.poll(hostSettings).toEqual({ compactAt: 1_500_000 });
    await expect(compactAt).toBeEditable();
  });

  test("Disabled models: an entry picked or typed reaches the host with what it matches, Enable takes it off, and a refusal or a repeat keeps the list", async ({
    page,
  }) => {
    await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5", "gemini-3-preview"],
    });
    const host = await failRequests(page, "provider.api_endpoint.set_disabled_models");
    await openApiEndpointsPage(page);
    const section = page.getByTestId("api-endpoints-disabled-models").filter({ visible: true });
    const error = section.getByTestId("api-endpoints-disabled-models-error");
    const hostList = async () => (await client.apiEndpointList("claude")).disabledModels;
    const search = () =>
      page.locator('input[placeholder*="*-preview"]').filter({ visible: true }).last();
    const disable = async (typed: string) => {
      await section.getByTestId("api-endpoints-disabled-models-add").click();
      await search().fill(typed);
      await search().press("Enter");
    };

    // 空着时只有「禁用模型」那一行；式子的写法在标题旁的说明里。
    await expect(section).toContainText("No endpoint offers it any more");
    await disable("*-PREVIEW");
    await expect(error).toContainText("EACCES: permission denied");
    expect(await hostList()).toEqual([]);
    await expect(section.getByTestId("api-endpoints-disabled-model-*-PREVIEW")).toHaveCount(0);

    host.failing = false;
    await disable("*-PREVIEW");
    await expect.poll(hostList).toEqual(["*-PREVIEW"]);
    await expect(error).toHaveCount(0);
    const entry = section.getByTestId("api-endpoints-disabled-model-*-PREVIEW");
    await expect(entry).toContainText("Matches 1:");
    await expect(entry).toContainText("good-relay/gemini-3-preview");

    // 只差大小写的在选单里置灰，写明存着的是哪一条；不能选，名单下面也不冒出报错。
    await section.getByTestId("api-endpoints-disabled-models-add").click();
    await search().fill("*-preview");
    const listed = page
      .getByTestId("api-endpoints-disabled-models-listed-option")
      .filter({ visible: true });
    await expect(listed).toContainText("Already on the list as *-PREVIEW");
    await expect(listed).toBeDisabled();
    // 回车在这一项上什么都不做，选单留着。
    await search().press("Enter");
    await expect(search()).toBeVisible();
    await search().press("Escape");
    await expect(search()).toHaveCount(0);
    await expect(error).toHaveCount(0);
    expect(await hostList()).toEqual(["*-PREVIEW"]);

    // 「启用」被主机拒绝：原因就地写出，条目和它命中的模型都留着；再点一次成功，条目才消失。
    const enable = entry.getByRole("button", { name: "Enable *-PREVIEW" });
    host.failing = true;
    await enable.click();
    await expect(error).toContainText("EACCES: permission denied");
    await expect(entry).toContainText("good-relay/gemini-3-preview");
    expect(await hostList()).toEqual(["*-PREVIEW"]);

    host.failing = false;
    await enable.click();
    await expect.poll(hostList).toEqual([]);
    await expect(section.getByTestId("api-endpoints-disabled-model-*-PREVIEW")).toHaveCount(0);
    await expect(error).toHaveCount(0);

    // 从选单里挑：只禁这一家的这个模型（接口标识/模型）。
    await section.getByTestId("api-endpoints-disabled-models-add").click();
    await page.getByText("gemini-3-preview", { exact: true }).filter({ visible: true }).click();
    await expect.poll(hostList).toEqual(["good-relay/gemini-3-preview"]);
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

  test("Duplicate opens the add dialog filled from the endpoint: Cancel adds nothing, a failed save stays in the form, and a blank key keeps the original's", async ({
    page,
  }) => {
    const host = await failConnectionSave(page);
    const source = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [
        { format: "anthropic_messages", url: `${relay.origin}/good` },
        { format: "openai_chat", url: `${relay.origin}/good/v1` },
      ],
      models: ["claude-sonnet-4-5", "gpt-5"],
    });
    await openEndpointDetail(page, source);
    const name = page.getByTestId("api-endpoint-connection-name");

    await test.step("the dialog opens as a new endpoint named <name> copy, its key box empty", async () => {
      await duplicateFromMenu(page);
      await expect(connectionForm(page)).toContainText("Duplicate Good relay");
      await expect(name).toHaveValue("Good relay copy");
      const key = page.getByTestId("api-endpoint-connection-api-key");
      await expect(key).toHaveValue("");
      await expect(key).toHaveAttribute(
        "placeholder",
        "Keeps the original key sk-e…elay, or paste another",
      );
      await expect(page.getByTestId("api-endpoint-connection-url-openai_chat")).toHaveValue(
        `${relay.origin}/good/v1`,
      );
    });

    await test.step("Cancel adds nothing", async () => {
      await connectionForm(page).getByRole("button", { name: "Cancel" }).click();
      await expect(connectionForm(page)).toHaveCount(0);
      expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(1);
    });

    await test.step("a failed save keeps the form and says why", async () => {
      await duplicateFromMenu(page);
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(name).toHaveValue("Good relay copy");
      expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(1);
    });

    await test.step("saving adds the copy with the original's key and models, and opens it", async () => {
      host.failing = false;
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const list = await client.apiEndpointList("claude");
      expect(list.endpoints).toMatchObject([
        { id: source, name: "Good relay" },
        {
          name: "Good relay copy",
          hasApiKey: true,
          models: [{ id: "claude-sonnet-4-5" }, { id: "gpt-5" }],
        },
      ]);
      const copyId = list.endpoints[1]?.id ?? "";
      await expect(page).toHaveURL(
        new RegExp(`${buildApiEndpointSettingsRoute(getServerId(), copyId)}$`),
      );
      await expect(headerTitle(page)).toHaveText("Good relay copy");

      relay.requests.length = 0;
      const detected = await client.apiEndpointDetectFormats({
        endpointId: copyId,
        baseUrl: `${relay.origin}/good`,
      });
      expect(statusesOf(detected.results)).toEqual(["ok", "ok", "not_detected"]);
      expect(authorizationsSeen(relay)).toEqual(new Set([`Bearer ${RELAY_KEY}`]));
    });
  });

  test("Duplicate in a row's menu on the list opens the same dialog and saving opens the copy", async ({
    page,
  }) => {
    const [source = ""] = await seedRelays(["Good relay"]);
    await openApiEndpointsPage(page);
    await page.getByTestId(`api-endpoint-order-menu-${source}`).filter({ visible: true }).click();
    await page.getByTestId(`api-endpoint-row-duplicate-${source}`).click();
    await expect(connectionForm(page)).toContainText("Duplicate Good relay");
    await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("Good relay copy");
    await expect(page.getByTestId("api-endpoint-connection-url-anthropic_messages")).toHaveValue(
      `${relay.origin}/good`,
    );

    await page.getByTestId("api-endpoint-connection-save").click();
    await expect(connectionForm(page)).toHaveCount(0);
    const list = await client.apiEndpointList("claude");
    expect(list.endpoints).toMatchObject([
      { id: source, name: "Good relay" },
      { name: "Good relay copy", hasApiKey: true, models: [{ id: "claude-sonnet-4-5" }] },
    ]);
    await expect(headerTitle(page)).toHaveText("Good relay copy");
  });

  test("Show reads the saved key back into the edit dialog; a failed read stays on the key field", async ({
    page,
  }) => {
    const host = await failRevealKey(page);
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    await openEndpointDetail(page, endpointId);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    const key = page.getByTestId("api-endpoint-connection-api-key");
    const show = page.getByTestId("api-endpoint-connection-show-key");

    await test.step("a failed read says why on the key and the key stays hidden", async () => {
      await show.click();
      await expect(page.getByTestId("api-endpoint-connection-api-key-field-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(key).toHaveValue("");
      await expect(key).toHaveAttribute("type", "password");
      await expect(show).toHaveText("Show");
    });

    await test.step("Show puts the saved key in the box; Hide empties it again", async () => {
      host.failing = false;
      await show.click();
      await expect(key).toHaveValue(RELAY_KEY);
      await expect(key).not.toHaveAttribute("type", "password");
      await expect(show).toHaveText("Hide");
      await expect(page.getByTestId("api-endpoint-connection-api-key-field-error")).toHaveCount(0);
      await show.click();
      await expect(key).toHaveValue("");
      await expect(key).toHaveAttribute("type", "password");
    });

    await test.step("saving after only reading it keeps the key", async () => {
      await show.click();
      await expect(key).toHaveValue(RELAY_KEY);
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      expect((await client.apiEndpointList("claude")).endpoints[0]?.hasApiKey).toBe(true);
    });
  });

  test("a long key shown in a narrow window can be read in full, and Hide masks it again", async ({
    page,
  }) => {
    const longKey = `sk-e2e-${"0123456789abcdef".repeat(7)}-end`;
    expect(longKey.length).toBeGreaterThan(100);
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
      apiKey: longKey,
    });
    await openEndpointDetail(page, endpointId);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    const key = page.getByTestId("api-endpoint-connection-api-key");
    const show = page.getByTestId("api-endpoint-connection-show-key");

    await show.click();
    await expect(key).toHaveValue(longKey);
    await expect(show).toHaveText("Hide");
    // 框里不滚动就能读全：没有横向或纵向溢出。
    const overflow = await key.evaluate((node) => ({
      x: node.scrollWidth - node.clientWidth,
      y: node.scrollHeight - node.clientHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    // 留 1px：行高取整后 scrollHeight 可能比 clientHeight 多出不到一像素。
    expect(overflow.y).toBeLessThanOrEqual(1);
    // 框不伸到按钮底下。
    const keyBox = await key.boundingBox();
    const showBox = await show.boundingBox();
    if (!keyBox || !showBox) throw new Error("The key box or Show is not laid out");
    expect(keyBox.x + keyBox.width).toBeLessThanOrEqual(showBox.x);

    await show.click();
    await expect(key).toHaveValue("");
    await expect(key).toHaveAttribute("type", "password");
    await expect(show).toHaveText("Show");

    // 打了新 key 再显示：换成多行框后字还在，删字后框跟着变矮。
    await key.fill(longKey);
    await show.click();
    await expect(key).toHaveValue(longKey);
    const tall = await key.boundingBox();
    if (!tall) throw new Error("The key box is not laid out");
    await key.fill("sk-short");
    await expect(key).toHaveValue("sk-short");
    await expect
      .poll(async () => (await key.boundingBox())?.height ?? Infinity)
      .toBeLessThan(tall.height);
    // 多行框里按回车不会把换行带进 key。
    await key.press("End");
    await key.press("Enter");
    await expect(key).toHaveValue("sk-short");
  });

  test("a custom endpoint's icon: a built-in one, or a picture kept by the host; a picture too large or not a picture says why", async ({
    page,
  }) => {
    // 最小的 1×1 PNG。
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    async function pickPicture(file: { name: string; mimeType: string; buffer: Buffer }) {
      const chooser = page.waitForEvent("filechooser");
      await page.getByTestId("api-endpoint-connection-icon-picture").click();
      await (await chooser).setFiles(file);
    }
    const iconField = page.getByTestId("api-endpoint-connection-icon-field");
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-name").fill("Home relay");
    await page.getByTestId("api-endpoint-connection-url-openai_chat").fill(`${relay.origin}/v1`);

    await test.step("Built-in icons opens a grid that search narrows; picking one closes it and offers Default", async () => {
      await expect(page.getByTestId("api-endpoint-connection-icon-default")).toHaveCount(0);
      await page.getByTestId("api-endpoint-connection-icon-built-in").click();
      await expect(page.getByTestId("api-endpoint-connection-icon-grid")).toBeVisible();
      await page.getByTestId("api-endpoint-connection-icon-search").fill("deepsee");
      await expect(page.getByTestId("api-endpoint-connection-icon-openai")).toHaveCount(0);
      await page.getByTestId("api-endpoint-connection-icon-deepseek-color").click();
      await expect(page.getByTestId("api-endpoint-connection-icon-grid")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-connection-icon-default")).toBeVisible();
    });

    await test.step("a picture over 1 MB, or a file that is no picture, says why and keeps the icon", async () => {
      await pickPicture({
        name: "huge.png",
        mimeType: "image/png",
        buffer: Buffer.concat([png, Buffer.alloc(1 << 20)]),
      });
      await expect(iconField).toContainText("The picture is over 1 MB. Pick a smaller one.");
      await pickPicture({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("text") });
      await expect(iconField).toContainText("Not a picture Osuna can show.");
      await expect(page.getByTestId("api-endpoint-connection-icon-default")).toBeVisible();
    });

    await test.step("a picture is kept by the host and saved with the endpoint; the row shows it", async () => {
      await pickPicture({ name: "home.png", mimeType: "image/png", buffer: png });
      await expect(iconField).not.toContainText("Not a picture");
      await expect(
        page.getByTestId("api-endpoint-connection-icon-preview").locator("img"),
      ).toHaveCount(1);
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved?.icon).toMatch(/^file:[0-9a-f]{16}\.png$/);
      expect((await client.apiEndpointReadIcon({ icon: saved?.icon ?? "" })).icon).toEqual({
        data: png.toString("base64"),
        mimeType: "image/png",
      });
      await openApiEndpointsPage(page);
      await expect(row(page, saved?.id ?? "").locator("img")).toHaveCount(1);
    });
  });

  test("From the website: an address on this machine says why; an icon the host found becomes the endpoint's", async ({
    page,
  }) => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    // 外网站点的结果由测试答，用一张先存好的图片。
    const { icon: found } = await client.apiEndpointStoreIcon({ data: png.toString("base64") });
    const askedFor: string[] = [];
    await answerSiteIcons(page, { icon: found, askedFor });
    const iconField = page.getByTestId("api-endpoint-connection-icon-field");
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-name").fill("Home relay");

    await test.step("an address on this machine is refused by the host, which says why", async () => {
      await page.getByTestId("api-endpoint-connection-url-openai_chat").fill(`${relay.origin}/v1`);
      await page.getByTestId("api-endpoint-connection-icon-website").click();
      await expect(iconField).toContainText(
        "The address is on this computer or the local network, so its website's icon can't be fetched.",
      );
      await expect(page.getByTestId("api-endpoint-connection-icon-default")).toHaveCount(0);
    });

    await test.step("a public address gets the icon the host found, and saving keeps it", async () => {
      await page
        .getByTestId("api-endpoint-connection-url-openai_chat")
        .fill("https://api.relay.example/v1");
      await page.getByTestId("api-endpoint-connection-icon-website").click();
      await expect(
        page.getByTestId("api-endpoint-connection-icon-preview").locator("img"),
      ).toHaveCount(1);
      await expect(iconField).not.toContainText("can't be fetched");
      expect(askedFor).toEqual(["https://api.relay.example/v1"]);
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved?.icon).toBe(found);
    });
  });

  test("Test models: each model gets a dot, its format and time; a failure says why; one model alone; the filters; a refused test; cancel; and the results go with the page", async ({
    page,
  }) => {
    // 都在「其他」家族里，一屏看得到；保存后 daemon 当场拉的清单也是这些。
    const slowModels = ["slow-1", "slow-2", "slow-3", "slow-4", "slow-5", "slow-6"];
    relay.goodModels = ["relay-ok", "bad-model", "lite:free", ...slowModels];
    const asked = () => modelsAsked(relay).filter((model) => model !== undefined);
    const abandoned = () => relay.abandoned;
    const slowAsked = () => asked().filter((model) => model.startsWith("slow-")).length;
    const endpointId = await seedApiEndpoint(client, {
      name: "Good relay",
      baseUrls: [
        { format: "anthropic_messages", url: `${relay.origin}/good` },
        { format: "openai_chat", url: `${relay.origin}/good/v1` },
      ],
      models: ["relay-ok", "bad-model", "lite:free"],
    });
    const slowId = await seedApiEndpoint(client, {
      name: "Slow relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: slowModels,
    });
    const host = await refuseTestModels(page);
    await openEndpointDetail(page, endpointId);
    const status = page.getByTestId("api-endpoint-models-test-status").filter({ visible: true });
    const testButton = page.getByTestId("api-endpoint-models-test").filter({ visible: true });
    const dot = (modelId: string, kind: string) =>
      page.getByTestId(`api-endpoint-model-test-dot-${modelId}-${kind}`).filter({ visible: true });
    const modelRow = (modelId: string) =>
      page.getByTestId(`api-endpoint-model-${modelId}`).filter({ visible: true });

    await test.step("a refused test says why in place and marks no model", async () => {
      await testButton.click();
      await expect(page.getByTestId("api-endpoint-models-test-error")).toContainText(
        "EACCES: permission denied",
      );
      await expect(page.getByTestId("api-endpoint-model-test-relay-ok")).toHaveCount(0);
      expect(asked()).toEqual([]);
    });

    await test.step("the whole list: a green dot, the format and the time; the failure keeps its reason", async () => {
      host.refusing = false;
      await testButton.click();
      await expect(status).toHaveText("3 tested · 1 failed");
      await expect(dot("relay-ok", "ok")).toBeVisible();
      await expect(page.getByTestId("api-endpoint-model-test-relay-ok")).toHaveText(
        /^Anthropic · \d+ ms$/,
      );
      await expect(dot("bad-model", "failed")).toBeVisible();
      // 照 magpie：「格式 · 状态码 · 原因」，不露地址；原因与上游原文一字不差。
      await expect(page.getByTestId("api-endpoint-model-test-reason-bad-model")).toHaveText(
        "Anthropic · 404 · The model bad-model does not exist",
      );
      expect([...new Set(asked())].sort()).toEqual(["bad-model", "lite:free", "relay-ok"]);
      await expect(page.getByTestId("api-endpoint-model-free-lite:free")).toHaveText("Free");
    });

    await test.step("Working only drops the failure, Free only keeps the free one", async () => {
      const working = page.getByTestId("api-endpoint-models-working-only");
      await expect(working).toHaveRole("switch");
      await working.click();
      await expect(modelRow("bad-model")).toHaveCount(0);
      await expect(modelRow("relay-ok")).toBeVisible();
      await working.click();
      await page.getByTestId("api-endpoint-models-free-only").click();
      await expect(modelRow("lite:free")).toBeVisible();
      await expect(modelRow("relay-ok")).toHaveCount(0);
      await page.getByTestId("api-endpoint-models-free-only").click();
    });

    await test.step("Test this asks one model and keeps the others' results", async () => {
      relay.requests.length = 0;
      await page.getByTestId("api-endpoint-model-menu-relay-ok").filter({ visible: true }).click();
      await page.getByTestId("api-endpoint-model-test-one-relay-ok").click();
      await expect(status).toHaveText("1 tested · 0 failed");
      expect(asked()).toEqual(["relay-ok"]);
      await expect(dot("bad-model", "failed")).toBeVisible();
    });

    await test.step("leaving the page clears the results", async () => {
      await openEndpointDetail(page, slowId);
      await openEndpointDetail(page, endpointId);
      await expect(page.getByTestId("api-endpoint-model-test-relay-ok")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-models-working-only")).toHaveCount(0);
    });

    await test.step("a test in progress shows its progress and can be cancelled", async () => {
      await openEndpointDetail(page, slowId);
      await testButton.click();
      await expect(status).toHaveText("Testing models… 0 / 6");
      await expect(dot("slow-1", "testing")).toBeVisible();
      await expect.poll(slowAsked).toBe(4);
      await page.getByTestId("api-endpoint-models-test-cancel").filter({ visible: true }).click();
      await expect(status).toHaveText("Test cancelled");
      await expect(page.getByTestId("api-endpoint-model-test-slow-1")).toHaveCount(0);
      await expect.poll(abandoned).toBe(4);
      expect(slowAsked()).toBe(4);
    });

    await test.step("leaving the page while a test runs cancels it: nothing more goes upstream", async () => {
      relay.requests.length = 0;
      relay.abandoned = 0;
      await testButton.click();
      await expect.poll(slowAsked).toBe(4);
      await openEndpointDetail(page, endpointId);
      // daemon 断开了挂着的四个，剩下两个再没发出去。
      await expect.poll(abandoned).toBe(4);
      expect(slowAsked()).toBe(4);
    });
  });

  test("Test as Claude Code and as Codex: each passes a group that admits only that CLI, fails one that doesn't, and Claude Code says why it can't test before Claude Code has come through", async ({
    page,
  }) => {
    relay.goodModels = ["cc-only-sonnet", "codex-only-glm"];
    // 只有 Codex 来过：按 Claude Code 测还测不了。
    await setCliHeaderSamples({ codex: CODEX_SAMPLE });
    const endpointId = await seedApiEndpoint(client, {
      name: "Members relay",
      baseUrls: [
        { format: "anthropic_messages", url: `${relay.origin}/good` },
        { format: "openai_chat", url: `${relay.origin}/good/v1` },
      ],
      models: ["cc-only-sonnet", "codex-only-glm"],
    });
    await openEndpointDetail(page, endpointId);
    // 两个模型分在「GPT」（名字带 codex）与「其他」两个家族标签下：先切到它那一栏。
    const familyOf: Record<string, RegExp> = {
      "cc-only-sonnet": /^Other/,
      "codex-only-glm": /^GPT/,
    };
    const openMenu = async (modelId: string) => {
      await page.getByRole("tab", { name: familyOf[modelId] }).click();
      await page
        .getByTestId(`api-endpoint-model-menu-${modelId}`)
        .filter({ visible: true })
        .click();
    };
    const testAs = (method: string, modelId: string) =>
      page.getByTestId(`api-endpoint-model-test-as-${method}-${modelId}`);
    const dot = (modelId: string, kind: string) =>
      page.getByTestId(`api-endpoint-model-test-dot-${modelId}-${kind}`).filter({ visible: true });
    const reason = (modelId: string) =>
      page.getByTestId(`api-endpoint-model-test-reason-${modelId}`).filter({ visible: true });
    const sent = (model: string) => relay.requests.filter((request) => request.model === model);

    await test.step("before Claude Code has come through, Test as Claude Code can't be pressed and says why", async () => {
      await openMenu("cc-only-sonnet");
      const item = testAs("claude_code", "cc-only-sonnet");
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toContainText(
        'Claude Code hasn\'t used API endpoints yet. Use Claude Code once with "Use API endpoints" on, then test again.',
      );
      await page.keyboard.press("Escape");
      expect(sent("cc-only-sonnet")).toEqual([]);
    });

    await test.step("Test as Codex sends Codex's headers and passes the Codex-only group", async () => {
      relay.requests.length = 0;
      await openMenu("codex-only-glm");
      await testAs("codex", "codex-only-glm").click();
      await expect(dot("codex-only-glm", "ok")).toBeVisible();
      await expect(page.getByTestId("api-endpoint-model-test-codex-only-glm")).toHaveText(
        /^OpenAI Chat · \d+ ms$/,
      );
      expect(sent("codex-only-glm")).toEqual([
        expect.objectContaining({
          url: "/good/v1/chat/completions",
          originator: "codex_cli_rs",
          userAgent: CODEX_SAMPLE["user-agent"],
          stream: true,
        }),
      ]);
    });

    await test.step("Test as Codex fails on the Claude Code-only group and keeps the upstream's reason", async () => {
      await openMenu("cc-only-sonnet");
      await testAs("codex", "cc-only-sonnet").click();
      await expect(dot("cc-only-sonnet", "failed")).toBeVisible();
      await expect(reason("cc-only-sonnet")).toHaveText(`OpenAI Chat · 403 · ${CLAUDE_CODE_ONLY}`);
    });

    await test.step("once Claude Code has come through, Test as Claude Code sends its headers and passes", async () => {
      await setCliHeaderSamples({ claude_code: CLAUDE_CODE_SAMPLE, codex: CODEX_SAMPLE });
      // 样本是打开页面时读的：重新打开这一页。
      await openEndpointDetail(page, endpointId);
      relay.requests.length = 0;
      await openMenu("cc-only-sonnet");
      await testAs("claude_code", "cc-only-sonnet").click();
      await expect(dot("cc-only-sonnet", "ok")).toBeVisible();
      expect(sent("cc-only-sonnet")).toEqual([
        expect.objectContaining({
          url: "/good/v1/messages",
          userAgent: CLAUDE_CODE_SAMPLE["user-agent"],
          stream: true,
        }),
      ]);
    });

    await test.step("Test as Claude Code fails on the Codex-only group", async () => {
      await openMenu("codex-only-glm");
      await testAs("claude_code", "codex-only-glm").click();
      await expect(dot("codex-only-glm", "failed")).toBeVisible();
      await expect(reason("codex-only-glm")).toHaveText(`Anthropic · 403 · ${CODEX_ONLY}`);
    });
    await setCliHeaderSamples(null);
  });

  test("a host without apiEndpointManagement has no Duplicate, no Show and no model scope", async ({
    page,
  }) => {
    const [endpointId = ""] = await seedRelays(["Relay A"]);
    await hideManagementCapability(page);
    await openEndpointDetail(page, endpointId);
    await page.getByTestId("api-endpoint-detail-menu").filter({ visible: true }).click();
    await expect(page.getByTestId("api-endpoint-detail-edit-connection")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-detail-duplicate")).toHaveCount(0);
    // 也没有服务范围与测试模型。
    await expect(page.getByTestId("api-endpoint-model-scope-section")).toHaveCount(0);
    await expect(page.getByTestId("api-endpoint-models-test")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await expect(page.getByTestId("api-endpoint-connection-api-key")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-show-key")).toHaveCount(0);
  });
});

test.describe("Templates", () => {
  function templatePicker(page: Page): Locator {
    return page.getByTestId("api-endpoint-template-picker");
  }

  function urlField(page: Page, format: string): Locator {
    return page.getByTestId(`api-endpoint-connection-url-${format}`);
  }

  /** 「去拿 key ↗」在网页上用 window.open 打开；记下打开的地址，不真的开新页。 */
  async function recordOpenedUrls(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __openedUrls: string[] }).__openedUrls = opened;
      window.open = (url?: string | URL) => {
        opened.push(String(url));
        return null;
      };
    });
  }

  async function openedUrls(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls);
  }

  test("+ opens the template list: Custom first, the groups, search with an empty state, and Custom is the blank form", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    const picker = templatePicker(page);
    await expect(picker).toBeVisible();

    await test.step("Custom comes first, then vendors and relay services", async () => {
      const custom = await page.getByTestId("api-endpoint-template-custom").boundingBox();
      const anthropic = await page.getByTestId("api-endpoint-template-anthropic").boundingBox();
      expect(custom?.y ?? Infinity).toBeLessThan(anthropic?.y ?? 0);
      await expect(page.getByTestId("api-endpoint-template-custom")).toContainText("Custom");
      await expect(picker).toContainText("Vendors");
      await expect(picker).toContainText("Relay services");
      // 国际站与中国站合成一行。
      await expect(page.getByTestId("api-endpoint-template-moonshot")).toHaveText("Kimi");
      await expect(page.getByTestId("api-endpoint-template-moonshot-cn")).toHaveCount(0);
    });

    await test.step("search finds by name and host, and says when nothing matches", async () => {
      await page.getByTestId("api-endpoint-template-search").fill("moonshot.cn");
      await expect(page.getByTestId("api-endpoint-template-moonshot")).toBeVisible();
      await expect(page.getByTestId("api-endpoint-template-openai")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-template-custom")).toHaveCount(0);
      await page.getByTestId("api-endpoint-template-search").fill("no such vendor");
      await expect(page.getByTestId("api-endpoint-templates-no-match")).toContainText(
        "Nothing called “no such vendor”",
      );
    });

    await test.step("Add it as a custom endpoint opens the blank form, with Auto-detect", async () => {
      await page.getByTestId("api-endpoint-templates-add-custom").click();
      await expect(connectionForm(page)).toBeVisible();
      await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("");
      await expect(page.getByTestId("api-endpoint-connection-detect")).toBeVisible();
      await expect(page.getByTestId("api-endpoint-connection-template")).toHaveCount(0);
    });
  });

  // 区域、套餐类的说明最长；宽窗口两个一行时它们放得下一行。
  const PLAN_NOTE_TEMPLATES = [
    "kimi-code",
    "xiaomi",
    "baidu-qianfan",
    "tencent-cloud",
    "huaweicloud",
    "volcengine",
    "qwen",
    "qwen-token-plan",
    "bailian-token-plan",
  ];

  for (const language of ["en", "zh-CN"] as const) {
    test(`at 1280 the template list reads each region or plan note in full, two to a row (${language})`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem("@paseo:app-settings", JSON.stringify({ language: value }));
      }, language);
      await openApiEndpointsPage(page);
      await page.getByTestId("api-endpoints-empty-add").click();
      await expect(templatePicker(page)).toBeVisible();
      for (const id of PLAN_NOTE_TEMPLATES) {
        const tile = page.getByTestId(`api-endpoint-template-${id}`);
        await expect(tile).toBeVisible();
        expect(await clippedTextsOf(tile), id).toEqual([]);
      }
      const [left, right, next] = await templateTileOriginsInOneFrame(page, [
        "anthropic",
        "openai",
        "deepseek",
      ]);
      expect(right?.y ?? Infinity).toBe(left?.y ?? 0);
      expect(next?.x ?? Infinity).toBe(left?.x ?? 0);
    });
  }

  test("at 390 the template list stays one to a row", async ({ page }) => {
    await openApiEndpointsPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("api-endpoints-empty-add").click();
    await expect(templatePicker(page)).toBeVisible();
    const [first, second] = await templateTileOriginsInOneFrame(page, ["anthropic", "openai"]);
    expect(second?.x ?? Infinity).toBe(first?.x ?? 0);
    expect(second?.y ?? 0).toBeGreaterThan(first?.y ?? Infinity);
  });

  test("the template list and an endpoint's row show the brand's icon; one without a brand icon shows its first letter", async ({
    page,
  }) => {
    // DeepSeek 的鲸鱼是它自己的蓝色；小米 MiMo 的商标缩到图标大小认不出，只写首字。
    const deepseekBlue = '[fill="#4D6BFE"]';
    const deepseekId = await seedApiEndpoint(client, {
      name: "DeepSeek",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5"],
      templateId: "deepseek",
    });
    const customId = await seedApiEndpoint(client, {
      name: "Home relay",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5"],
    });
    await openApiEndpointsPage(page);

    await test.step("an endpoint from a template shows its brand; a custom one its first letter", async () => {
      await expect(row(page, deepseekId).locator(deepseekBlue)).toHaveCount(1);
      await expect(row(page, deepseekId).getByText("D", { exact: true })).toHaveCount(0);
      await expect(row(page, customId).locator(deepseekBlue)).toHaveCount(0);
      await expect(row(page, customId).getByText("H", { exact: true })).toBeVisible();
    });

    await test.step("the template list shows each brand the same way", async () => {
      await page.getByTestId("api-endpoints-add-button").filter({ visible: true }).click();
      await expect(templatePicker(page)).toBeVisible();
      const deepseek = page.getByTestId("api-endpoint-template-deepseek");
      await expect(deepseek.locator(deepseekBlue)).toHaveCount(1);
      await expect(deepseek.getByText("D", { exact: true })).toHaveCount(0);
      const xiaomi = page.getByTestId("api-endpoint-template-xiaomi");
      await xiaomi.scrollIntoViewIfNeeded();
      await expect(xiaomi.getByText("X", { exact: true })).toBeVisible();
    });
  });

  test("a list that fails to load says why and keeps Custom; Try again loads it", async ({
    page,
  }) => {
    await failFirstTemplateList(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await expect(page.getByTestId("api-endpoint-templates-error")).toContainText(
      "Couldn't load the templates: EACCES: permission denied",
    );
    await expect(page.getByTestId("api-endpoint-template-custom")).toBeVisible();
    await page.getByTestId("api-endpoint-templates-error").getByRole("button").click();
    await expect(page.getByTestId("api-endpoint-template-zhipu")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-templates-error")).toHaveCount(0);
  });

  test("a template fills the form; switching the plan or the site keeps the key and moves the addresses and Get a key; it saves with its template and plan", async ({
    page,
  }) => {
    await recordOpenedUrls(page);
    const host = await failConnectionSave(page);
    await openApiEndpointsPage(page);
    const { templates } = await client.apiEndpointListTemplates();
    const zhipu = templates.find((template) => template.id === "zhipu");
    const coding = zhipu?.regions?.find((region) => region.id === "coding");
    if (!zhipu || !coding) throw new Error("zhipu has no Coding Plan");

    await test.step("Zhipu GLM starts on pay as you go", async () => {
      await page.getByTestId("api-endpoints-empty-add").click();
      await page.getByTestId("api-endpoint-template-zhipu").click();
      await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("Zhipu GLM");
      await expect(page.getByTestId("api-endpoint-connection-detect")).toHaveCount(0);
      await expect(urlField(page, "openai_chat")).toHaveValue(
        "https://open.bigmodel.cn/api/paas/v4",
      );
      await page.getByTestId("api-endpoint-connection-get-key").click();
      expect(await openedUrls(page)).toEqual([zhipu.keysUrl]);
    });

    await test.step("the Coding Plan moves the addresses; the key stays", async () => {
      await page.getByTestId("api-endpoint-connection-api-key").fill("sk-zhipu");
      await page.getByTestId("api-endpoint-connection-region-coding").click();
      await expect(urlField(page, "openai_chat")).toHaveValue(
        "https://open.bigmodel.cn/api/coding/paas/v4",
      );
      await expect(urlField(page, "openai_responses")).toHaveValue(
        "https://open.bigmodel.cn/api/v1",
      );
      await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveValue("sk-zhipu");
    });

    await test.step("a failed save stays in the form with the plan and the key", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(urlField(page, "openai_responses")).toHaveValue(
        "https://open.bigmodel.cn/api/v1",
      );
      await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveValue("sk-zhipu");
    });

    await test.step("saving keeps the plan's addresses, the template and the plan", async () => {
      host.failing = false;
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved).toMatchObject({
        name: "Zhipu GLM",
        templateId: "zhipu",
        region: "coding",
        baseUrls: coding.baseUrls,
        hasApiKey: true,
      });
    });

    await test.step("StepFun's China site: only the key stays, Get a key follows", async () => {
      await page.goBack();
      await page.getByTestId("api-endpoints-add-button").filter({ visible: true }).click();
      await page.getByTestId("api-endpoint-template-stepfun").click();
      await page.getByTestId("api-endpoint-connection-api-key").fill("sk-step");
      await page.getByTestId("api-endpoint-connection-region-api").click();
      await page.getByTestId("api-endpoint-connection-site-china").click();
      await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("StepFun (China)");
      await expect(urlField(page, "openai_chat")).toHaveValue(
        "https://api.stepfun.com/step_plan/v1",
      );
      await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveValue("sk-step");
      await page.getByTestId("api-endpoint-connection-get-key").click();
      expect((await openedUrls(page)).at(-1)).toBe("https://platform.stepfun.com/interface-key");
    });
  });

  test("Add another opens the same template as a new endpoint and saving opens it", async ({
    page,
  }) => {
    const { templates } = await client.apiEndpointListTemplates();
    const deepseek = templates.find((template) => template.id === "deepseek");
    if (!deepseek) throw new Error("no DeepSeek template");
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: deepseek.name,
      baseUrls: deepseek.baseUrls,
      apiKey: "sk-one",
      models: [],
      templateId: deepseek.id,
    });
    const firstId = saved.endpoint?.id ?? "";
    await openEndpointDetail(page, firstId);

    await page.getByTestId("api-endpoint-detail-menu").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-detail-add-another").click();
    await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("DeepSeek");
    await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveValue("");
    await page.getByTestId("api-endpoint-connection-api-key").fill("sk-two");
    await page.getByTestId("api-endpoint-connection-save").click();

    await expect(connectionForm(page)).toHaveCount(0);
    await expect(headerTitle(page)).toHaveText("DeepSeek 2");
    const listed = (await client.apiEndpointList("claude")).endpoints;
    expect(listed.map((endpoint) => [endpoint.name, endpoint.templateId])).toEqual([
      ["DeepSeek", "deepseek"],
      ["DeepSeek 2", "deepseek"],
    ]);
  });

  test("Amazon Bedrock: pick a region, a failed save keeps it, and saving gives the built-in models without asking anyone", async ({
    page,
  }) => {
    const host = await failConnectionSave(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-search").fill("bedrock");
    await page.getByTestId("api-endpoint-template-bedrock").click();

    await test.step("the ten regions are in a menu; eu-west-1 moves every address", async () => {
      await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("Amazon Bedrock");
      await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveAttribute(
        "placeholder",
        "Paste the key",
      );
      await expect(page.getByTestId("api-endpoint-connection-region")).toHaveText("us-east-1");
      await page.getByTestId("api-endpoint-connection-region").click();
      await expect(page.getByTestId("api-endpoint-connection-region-ap-south-1")).toBeVisible();
      await page.getByTestId("api-endpoint-connection-region-eu-west-1").click();
      await expect(page.getByTestId("api-endpoint-connection-region")).toHaveText("eu-west-1");
      await expect(urlField(page, "anthropic_messages")).toHaveValue(
        "https://bedrock-runtime.eu-west-1.amazonaws.com/anthropic",
      );
      await expect(urlField(page, "openai_chat")).toHaveValue(
        "https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1",
      );
      await page.getByTestId("api-endpoint-connection-api-key").fill("bedrock-api-key");
    });

    await test.step("a failed save stays in the form with the region and the key", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(urlField(page, "openai_chat")).toHaveValue(
        "https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1",
      );
      await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveValue(
        "bedrock-api-key",
      );
    });

    await test.step("saving opens it with Bedrock's built-in models", async () => {
      host.failing = false;
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      await expect(headerTitle(page)).toHaveText("Amazon Bedrock");
      // 内置清单 18 个，新建的跟随接口清单全都在服务；左栏先选中的家族是 DeepSeek（Bedrock 的 Claude id 认不出家族，归「其他」）。
      await expect(page.getByText("18 selected / 18 total")).toBeVisible();
      await expect(modelSwitch(page, "deepseek.v3.2")).toBeChecked();
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved).toMatchObject({
        templateId: "bedrock",
        region: "eu-west-1",
        hasApiKey: true,
        modelScope: "vendor",
      });
    });
  });

  test("Azure OpenAI asks for the resource's address; a failed save keeps it, and saving lists its deployments with the key in api-key", async ({
    page,
  }) => {
    const host = await failConnectionSave(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-search").fill("azure");
    await page.getByTestId("api-endpoint-template-azure").click();
    // 假资源在本机，不是 Azure 的主机：地址原样保存。
    const resource = `${relay.origin}/azure/openai/v1`;

    await test.step("one address box says to fill in the resource's own, in place of the format addresses", async () => {
      const field = page.getByTestId("api-endpoint-connection-endpoint-field");
      await expect(field).toContainText("Resource endpoint");
      await expect(field).toContainText("Keys and Endpoint in the Azure portal");
      await expect(page.getByTestId("api-endpoint-connection-endpoint")).toHaveAttribute(
        "placeholder",
        "https://<resource>.openai.azure.com",
      );
      await expect(page.getByTestId("api-endpoint-connection-formats")).toHaveCount(0);
      await expect(connectionForm(page)).toContainText("lists the resource's deployments");
      await expect(connectionForm(page)).not.toContainText("shared by all three formats");
      await expect(page.getByTestId("api-endpoint-connection-save")).toBeDisabled();
      await page.getByTestId("api-endpoint-connection-endpoint").fill(resource);
      await page.getByTestId("api-endpoint-connection-api-key").fill(RELAY_KEY);
    });

    await test.step("a failed save stays in the form with the address and the key", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(page.getByTestId("api-endpoint-connection-endpoint")).toHaveValue(resource);
      await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveValue(RELAY_KEY);
    });

    await test.step("saving opens it with the resource's deployments", async () => {
      host.failing = false;
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      await expect(modelSwitch(page, "my-gpt-deployment")).toBeVisible();
      await expect(modelSwitch(page, "my-kimi-deployment")).toBeVisible();
      // 保存当场列一次、打开接口页又列一次；两种格式在同一个地址上，每次只问一遍。
      await expect.poll(deploymentCountReader(relay)).toBe(2);
      for (const listing of deploymentListings(relay)) {
        expect(listing).toMatchObject({ apiKey: RELAY_KEY, authorization: undefined });
      }
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved).toMatchObject({
        templateId: "azure",
        baseUrls: [
          { format: "openai_chat", url: resource },
          { format: "openai_responses", url: resource },
        ],
      });
    });
  });

  test("a server on this machine asks only for its address and no key; a failed save keeps it, and a new port moves every address", async ({
    page,
  }) => {
    const host = await failConnectionSave(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await expect(templatePicker(page)).toContainText("On this machine");
    await page.getByTestId("api-endpoint-template-search").fill("ollama");
    await page.getByTestId("api-endpoint-template-ollama").click();
    const address = page.getByTestId("api-endpoint-connection-service-address");

    await test.step("one Server address box, starting at Ollama's port; the key is optional", async () => {
      await expect(address).toHaveValue("http://localhost:11434");
      await expect(page.getByTestId("api-endpoint-connection-formats")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-connection-address")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-connection-api-key-field")).toContainText(
        "API key (optional)",
      );
      await expect(page.getByTestId("api-endpoint-connection-api-key")).toHaveAttribute(
        "placeholder",
        "Optional for local servers",
      );
      await expect(page.getByTestId("api-endpoint-connection-save")).toBeEnabled();
    });

    await test.step("an address that is none says so and can't be saved", async () => {
      await address.fill("http://localhost:99999");
      await expect(page.getByTestId("api-endpoint-connection-service-address-field")).toContainText(
        "http://localhost:99999 isn't an address like http://localhost:11434",
      );
      await expect(page.getByTestId("api-endpoint-connection-save")).toBeDisabled();
      await address.fill("127.0.0.1:11500");
    });

    await test.step("a failed save stays in the form with the address", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(address).toHaveValue("127.0.0.1:11500");
    });

    await test.step("saving moves both addresses to the new port, each keeping its path, with no key", async () => {
      host.failing = false;
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      await expect(headerTitle(page)).toHaveText("Ollama");
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved).toMatchObject({
        templateId: "ollama",
        hasApiKey: false,
        baseUrls: [
          { format: "anthropic_messages", url: "http://127.0.0.1:11500" },
          { format: "openai_chat", url: "http://127.0.0.1:11500/v1" },
        ],
      });
    });
  });

  test("a template already added has a green dot and opens its endpoint; a global and China row adds the side not added yet", async ({
    page,
  }) => {
    const { templates } = await client.apiEndpointListTemplates();
    const saveFrom = async (id: string) => {
      const template = templates.find((candidate) => candidate.id === id);
      if (!template) throw new Error(`no template ${id}`);
      const saved = await client.apiEndpointSave({
        provider: "claude",
        name: template.name,
        baseUrls: template.baseUrls,
        apiKey: `sk-${id}`,
        models: [],
        templateId: id,
      });
      return saved.endpoint?.id ?? "";
    };
    const openaiId = await saveFrom("openai");
    await saveFrom("moonshot");
    await openApiEndpointsPage(page);

    await page.getByTestId("api-endpoints-add-button").filter({ visible: true }).click();
    await expect(page.getByTestId("api-endpoint-template-openai-added")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-template-moonshot-added")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-template-deepseek-added")).toHaveCount(0);

    await page.getByTestId("api-endpoint-template-moonshot").click();
    await expect(page.getByTestId("api-endpoint-connection-name")).toHaveValue("Kimi (China)");
    await expect(page.getByTestId("api-endpoint-connection-website")).toHaveText(
      "platform.moonshot.cn ↗",
    );
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByTestId("api-endpoints-add-button").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-template-openai").click();
    await expect(templatePicker(page)).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`${buildApiEndpointSettingsRoute(getServerId(), openaiId)}$`),
    );
    await expect(headerTitle(page)).toHaveText("OpenAI");
  });

  /** 照浏览器真实粘贴的样子派发 paste 事件；返回表单是否拦下了它。 */
  function paste(field: Locator, text: string): Promise<boolean> {
    return field.evaluate((input, value) => {
      (input as HTMLInputElement).focus();
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", value);
      const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    }, text);
  }

  // Moonshot 与 Anthropic 文档里的例子（照 magpie 的 fixtures/curl），一个 key 是占位符，一个换成了自己的 key。
  const MOONSHOT_CURL = [
    "curl https://api.moonshot.cn/v1/chat/completions \\",
    '    -H "Content-Type: application/json" \\',
    '    -H "Authorization: Bearer $MOONSHOT_API_KEY" \\',
    "    -d '{",
    '        "model": "kimi-k3",',
    '        "messages": [{"role": "user", "content": "你好"}]',
    "   }'",
  ].join("\n");
  const OWN_KEY = "sk-ant-api03-Qx7vT2mK9pLw4RzN8bYc";
  const ANTHROPIC_CURL = [
    "curl https://api.anthropic.com/v1/messages \\",
    `  -H "x-api-key: ${OWN_KEY}" \\`,
    '  -H "anthropic-version: 2023-06-01" \\',
    '  -d \'{"model": "claude-opus-5-5", "max_tokens": 1024}\'',
  ].join("\n");

  function isPastedRelayCopy(endpoint: { name: string }): boolean {
    return endpoint.name === "Pasted relay copy";
  }

  test("a curl command pasted into the address or the key fills the custom form; a template takes only the key", async ({
    page,
  }) => {
    const host = await failConnectionSave(page);
    await openApiEndpointsPage(page);
    const address = page.getByTestId("api-endpoint-connection-address");
    const apiKey = page.getByTestId("api-endpoint-connection-api-key");
    const models = page.getByTestId("api-endpoint-connection-models");
    const note = page.getByTestId("api-endpoint-connection-curl-note");

    await test.step("Moonshot's example into the address: its format, address and model; its key only stands for one", async () => {
      await page.getByTestId("api-endpoints-empty-add").click();
      await page.getByTestId("api-endpoint-template-custom").click();
      // 添加窗口的「模型」框一直在（能拉模型），粘贴前是空的。
      await expect(models).toHaveValue("");
      expect(await paste(address, MOONSHOT_CURL)).toBe(true);
      await expect(address).toHaveValue("https://api.moonshot.cn/v1");
      await expect(urlField(page, "openai_chat")).toHaveValue("https://api.moonshot.cn/v1");
      await expect(apiKey).toHaveValue("");
      await expect(apiKey).toBeFocused();
      await expect(models).toHaveValue("kimi-k3");
      await expect(note).toHaveText(
        "Filled in from the curl command: OpenAI Chat base URL · model kimi-k3. Its key, $MOONSHOT_API_KEY, is only a placeholder: paste your own API key.",
      );
    });

    await test.step("Anthropic's, with a key of the user's own, into the key: the other format is added", async () => {
      expect(await paste(apiKey, ANTHROPIC_CURL)).toBe(true);
      await expect(apiKey).toHaveValue(OWN_KEY);
      await expect(urlField(page, "anthropic_messages")).toHaveValue("https://api.anthropic.com");
      await expect(urlField(page, "openai_chat")).toHaveValue("https://api.moonshot.cn/v1");
      await expect(models).toHaveValue("kimi-k3, claude-opus-5-5");
      await expect(note).toHaveText(
        "Filled in from the curl command: Anthropic base URL · API key · model claude-opus-5-5.",
      );
    });

    await test.step("a URL with no known endpoint, and a placeholder left in the address, are each told", async () => {
      expect(
        await paste(address, 'curl https://relay.example.com/v1/completions -H "x-api-key: sk-a"'),
      ).toBe(true);
      await expect(note).toHaveText(
        "Filled in from the curl command: API key. Its URL doesn't end in /chat/completions, /messages or /responses: type the address yourself.",
      );
      expect(
        await paste(
          address,
          'curl "https://{WorkspaceId}.maas.aliyuncs.com/compatible-mode/v1/chat/completions"',
        ),
      ).toBe(true);
      await expect(note).toHaveText(
        "Filled in from the curl command: OpenAI Chat base URL. Replace {WorkspaceId} in the address.",
      );
    });

    await test.step("text that isn't curl pastes as before", async () => {
      expect(await paste(apiKey, "sk-plain")).toBe(false);
    });

    await test.step("the relay's own example: a failed save keeps the form, then it saves with the model picked", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByTestId("api-endpoints-empty-add").click();
      await page.getByTestId("api-endpoint-template-custom").click();
      await page.getByTestId("api-endpoint-connection-name").fill("Pasted relay");
      const relayCurl = `curl ${relay.origin}/good/v1/chat/completions -H "Authorization: Bearer ${RELAY_KEY}" -d '{"model":"good-1"}'`;
      expect(await paste(address, relayCurl)).toBe(true);
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "EACCES: permission denied",
      );
      await expect(models).toHaveValue("good-1");
      await expect(apiKey).toHaveValue(RELAY_KEY);
      host.failing = false;
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved).toMatchObject({
        name: "Pasted relay",
        baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
        // 新建的跟随接口清单：拉到的清单加上粘贴带来的（记作手动添加）。
        models: [{ id: "claude-sonnet-4-5" }, { id: "gpt-5" }, { id: "good-1" }],
        manualModels: [{ id: "good-1" }],
        modelScope: "vendor",
        hasApiKey: true,
      });
    });

    await test.step("a duplicate of it adds the pasted model to the original's", async () => {
      await duplicateFromMenu(page);
      const relayCurl = `curl ${relay.origin}/good/v1/chat/completions -d '{"model":"good-2"}'`;
      expect(await paste(address, relayCurl)).toBe(true);
      await expect(models).toHaveValue("good-2");
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const { endpoints } = await client.apiEndpointList("claude");
      const copy = endpoints.find(isPastedRelayCopy);
      expect(copy).toMatchObject({
        models: [{ id: "claude-sonnet-4-5" }, { id: "gpt-5" }, { id: "good-1" }, { id: "good-2" }],
        manualModels: [{ id: "good-1" }, { id: "good-2" }],
        hasApiKey: true,
      });
    });

    await test.step("a template takes only the key from it, in a narrow window's sheet too", async () => {
      await openApiEndpointsPage(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId("api-endpoints-add-button").filter({ visible: true }).click();
      await page.getByTestId("api-endpoint-template-zhipu").click();
      expect(await paste(apiKey, MOONSHOT_CURL.replace("$MOONSHOT_API_KEY", "sk-zhipu"))).toBe(
        true,
      );
      await expect(apiKey).toHaveValue("sk-zhipu");
      await expect(urlField(page, "openai_chat")).toHaveValue(
        "https://open.bigmodel.cn/api/paas/v4",
      );
      // 模板只取 key，不往「模型」框里加。
      await expect(models).toHaveValue("");
      await expect(note).toHaveText("Filled in from the curl command: API key.");
    });
  });

  test("a host without apiEndpointManagement opens the blank form from + with no curl filling, and has no Add another", async ({
    page,
  }) => {
    const [endpointId = ""] = await seedRelays(["Relay A"]);
    await hideManagementCapability(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-add-button").filter({ visible: true }).click();
    await expect(connectionForm(page)).toBeVisible();
    await expect(templatePicker(page)).toHaveCount(0);
    // 老主机上粘贴 curl 照常粘进框里，不填表。
    expect(await paste(page.getByTestId("api-endpoint-connection-address"), MOONSHOT_CURL)).toBe(
      false,
    );
    await expect(page.getByTestId("api-endpoint-connection-curl-note")).toHaveCount(0);
    // 老主机不认表单里的值：没有试用模型、测试连接与拉取模型。
    await expect(page.getByTestId("api-endpoint-connection-detect-model")).toHaveCount(0);
    await expect(page.getByTestId("api-endpoint-connection-test-button")).toHaveCount(0);
    await expect(page.getByTestId("api-endpoint-connection-fetch-models")).toHaveCount(0);
    // 老主机不认请求头、附加请求体与 key 头：没有「高级」。
    await expect(page.getByTestId("api-endpoint-connection-advanced")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await openEndpointRow(page, endpointId);
    await page.getByTestId("api-endpoint-detail-menu").filter({ visible: true }).click();
    await expect(page.getByTestId("api-endpoint-detail-edit-connection")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-detail-add-another")).toHaveCount(0);
  });
});

test.describe("Checking an API endpoint before saving it", () => {
  async function openCustomForm(page: Page, input: { apiKey: string }): Promise<void> {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-name").fill("Unsaved relay");
    await page.getByTestId("api-endpoint-connection-api-key").fill(input.apiKey);
  }

  async function fillFormatUrls(page: Page, prefix: string): Promise<void> {
    await page
      .getByTestId("api-endpoint-connection-url-anthropic_messages")
      .fill(`${relay.origin}${prefix}`);
    await page
      .getByTestId("api-endpoint-connection-url-openai_chat")
      .fill(`${relay.origin}${prefix}/v1`);
    await page
      .getByTestId("api-endpoint-connection-url-openai_responses")
      .fill(`${relay.origin}${prefix}/v1`);
  }

  function testVerdict(page: Page, format: string): Locator {
    return page.getByTestId(`api-endpoint-connection-test-${format}-verdict`);
  }

  test("Fetch models lists the vendor's models to pick from, and the save follows that list with the pick added by hand", async ({
    page,
  }) => {
    await openCustomForm(page, { apiKey: RELAY_KEY });
    await page
      .getByTestId("api-endpoint-connection-url-openai_chat")
      .fill(`${relay.origin}/good/v1`);
    const fetchButton = page.getByTestId("api-endpoint-connection-fetch-models");

    await test.step("the list comes back with nothing picked, and nothing is kept on the host", async () => {
      await fetchButton.click();
      await expect(page.getByTestId("api-endpoint-connection-catalog-count")).toHaveText(
        "0 of 2 picked",
      );
      // 只列模型（先问 <base>/v1/models，落空再问 <base>/models），带填的 key。
      expect(methodsSeen(relay)).toEqual(new Set(["GET"]));
      expect(authorizationsSeen(relay)).toEqual(new Set([`Bearer ${RELAY_KEY}`]));
      expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
    });

    await test.step("a model picked goes into Models", async () => {
      await page.getByTestId("api-endpoint-connection-catalog-model-gpt-5").click();
      await expect(page.getByTestId("api-endpoint-connection-models")).toHaveValue("gpt-5");
      await expect(page.getByTestId("api-endpoint-connection-catalog-count")).toHaveText(
        "1 of 2 picked",
      );
      // 底栏的保存与清单同时在窗口里；已经拉过清单，按钮就只是「保存」。
      await expect(page.getByTestId("api-endpoint-connection-save")).toBeInViewport();
      await expect(page.getByTestId("api-endpoint-connection-save")).toHaveText("Save");
    });

    await test.step("saving keeps the list, fetched once more as magpie does, and follows it with the pick added by hand", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [endpoint] = (await client.apiEndpointList("claude")).endpoints;
      expect(endpoint).toMatchObject({
        name: "Unsaved relay",
        models: [{ id: "claude-sonnet-4-5" }, { id: "gpt-5" }],
        catalog: { models: [{ id: "claude-sonnet-4-5" }, { id: "gpt-5" }] },
      });
      // 新建的跟随接口清单；挑的模型记作手动添加，总在服务。
      expect(endpoint?.modelScope).toBe("vendor");
      expect(endpoint?.manualModels).toEqual([{ id: "gpt-5" }]);
      await expect(headerTitle(page)).toHaveText("Unsaved relay");
      // 新建一家保存时当场再拉一次（照 magpie），打开接口页又拉一次；清单还是那两个。
      await expect.poll(listingCountReader(relay)).toBe(6);
    });
  });

  test("Fetch models says why it failed, and can be cancelled", async ({ page }) => {
    await openCustomForm(page, { apiKey: "sk-wrong" });
    await page
      .getByTestId("api-endpoint-connection-url-openai_chat")
      .fill(`${relay.origin}/good/v1`);
    await page.getByTestId("api-endpoint-connection-fetch-models").click();
    await expect(page.getByTestId("api-endpoint-connection-models-field-error")).toContainText(
      "HTTP 401",
    );
    // 原因不露原样请求地址（地址就在上面的输入框里）。
    await expect(page.getByTestId("api-endpoint-connection-models-field-error")).not.toContainText(
      /https?:\/\//,
    );
    await expect(page.getByTestId("api-endpoint-connection-catalog")).toHaveCount(0);

    await page.getByTestId("api-endpoint-connection-api-key").fill(RELAY_KEY);
    await page
      .getByTestId("api-endpoint-connection-url-openai_chat")
      .fill(`${relay.origin}/slow/v1`);
    await page.getByTestId("api-endpoint-connection-fetch-models").click();
    await page.getByTestId("api-endpoint-connection-fetch-cancel").click();
    await expect(page.getByTestId("api-endpoint-connection-fetch-cancel")).toHaveCount(0);
    await expect(page.getByTestId("api-endpoint-connection-fetch-models")).toBeEnabled();
    await expect(page.getByTestId("api-endpoint-connection-models-field-error")).toHaveCount(0);
  });

  test("Test connection gives each format its time or its error, and can be cancelled", async ({
    page,
  }) => {
    await openCustomForm(page, { apiKey: RELAY_KEY });
    await fillFormatUrls(page, "/good");
    const testButton = page.getByTestId("api-endpoint-connection-test-button");

    await test.step("each address answers in its own row", async () => {
      await testButton.click();
      await expect(testVerdict(page, "anthropic_messages")).toHaveText(/^Connected · \d+ ms$/);
      await expect(testVerdict(page, "openai_chat")).toHaveText(/^Connected · \d+ ms$/);
      await expect(testVerdict(page, "openai_responses")).toHaveText("Couldn't connect");
      await expect(
        page.getByTestId("api-endpoint-connection-test-openai_responses-reason"),
      ).toHaveText("HTTP 404: Not Found · /responses");
      expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
    });

    await test.step("a wrong key is told apart and marks the key", async () => {
      await page.getByTestId("api-endpoint-connection-api-key").fill("sk-wrong");
      await expect(testVerdict(page, "openai_chat")).toHaveCount(0);
      await testButton.click();
      await expect(testVerdict(page, "openai_chat")).toHaveText("Key rejected");
      await expect(page.getByTestId("api-endpoint-connection-api-key-field-error")).toHaveText(
        "The upstream rejected this key (401 / 403)",
      );
    });

    await test.step("a test that hangs can be cancelled", async () => {
      await page.getByTestId("api-endpoint-connection-api-key").fill(RELAY_KEY);
      await fillFormatUrls(page, "/slow");
      await testButton.click();
      await expect(testVerdict(page, "openai_chat")).toHaveText("Testing…");
      await page.getByTestId("api-endpoint-connection-test-cancel").click();
      await expect(testVerdict(page, "openai_chat")).toHaveCount(0);
      await expect(testButton).toBeEnabled();
    });
  });

  test("a vendor with no model list is detected with the model typed to try; a detection can be cancelled", async ({
    page,
  }) => {
    await openCustomForm(page, { apiKey: RELAY_KEY });
    const address = page.getByTestId("api-endpoint-connection-address");
    await address.fill(`${relay.origin}/nolist`);
    const detect = page.getByTestId("api-endpoint-connection-detect");

    await test.step("without a model to try nothing can be asked", async () => {
      await detect.click();
      for (const tag of detectionTags(page)) await expect(tag).toHaveText("Not detected");
      await expect(page.getByTestId("api-endpoint-connection-none-answered")).toHaveText(
        "None answered: check the address and the key, or type a model the vendor serves",
      );
      await expect(page.getByTestId("api-endpoint-connection-use-detected")).toHaveCount(0);
    });

    await test.step("with one typed it is asked on every format, and Use these fills them in", async () => {
      await page.getByTestId("api-endpoint-connection-detect-model").fill("claude-sonnet-4-5");
      relay.requests.length = 0;
      await detect.click();
      const [anthropic, chat, responses] = detectionTags(page);
      await expect(anthropic).toHaveText(DETECTED_IN);
      await expect(chat).toHaveText(DETECTED_IN);
      await expect(responses).toHaveText("Not detected");
      expect(modelsAsked(relay)).toEqual([
        "claude-sonnet-4-5",
        "claude-sonnet-4-5",
        "claude-sonnet-4-5",
      ]);
      await page.getByTestId("api-endpoint-connection-use-detected").click();
      await expect(page.getByTestId("api-endpoint-connection-url-openai_chat")).toHaveValue(
        `${relay.origin}/nolist/v1`,
      );
      expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
    });

    await test.step("a detection that hangs can be cancelled", async () => {
      await address.fill(`${relay.origin}/slow`);
      await detect.click();
      await page.getByTestId("api-endpoint-connection-detect-cancel").click();
      await expect(page.getByTestId("api-endpoint-connection-detect-cancel")).toHaveCount(0);
      await expect(page.getByTestId("api-endpoint-connection-detection")).toHaveCount(0);
      await expect(detect).toBeEnabled();
    });
  });
});

function postsOf(target: FakeRelay): FakeRelay["requests"] {
  return target.requests.filter((request) => request.method === "POST");
}

function relayTeamsOf(requests: FakeRelay["requests"]): (string | undefined)[] {
  return requests.map((request) => request.relayTeam);
}

// 接口管理好用性工单 22：「高级」里的请求头、附加请求体、key 放在哪个头（照 magpie 编辑窗口的 Advanced）。
test.describe("An endpoint's headers, extra body and key header", () => {
  function advanced(page: Page): Locator {
    return page.getByTestId("api-endpoint-connection-advanced");
  }

  test("a reserved field and a bad header name are refused on the spot; the typed values go with Test connection and are saved", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-name").fill("Relay with extras");
    await page.getByTestId("api-endpoint-connection-api-key").fill(RELAY_KEY);
    await page
      .getByTestId("api-endpoint-connection-url-anthropic_messages")
      .fill(`${relay.origin}/good`);
    const save = page.getByTestId("api-endpoint-connection-save");

    await test.step("Advanced is folded until opened; a custom endpoint starts with one empty header row", async () => {
      await expect(page.getByTestId("api-endpoint-connection-headers")).toHaveCount(0);
      await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
      await expect(page.getByTestId("api-endpoint-connection-header-name-0")).toHaveValue("");
      // 第三方 Anthropic 地址才有 key 放在哪个头。
      await expect(page.getByTestId("api-endpoint-connection-key-header")).toBeVisible();
    });

    await test.step("a bad header name warns that its requests will fail without holding the save; a reserved extra body field holds it", async () => {
      await page.getByTestId("api-endpoint-connection-header-name-0").fill("X Relay Team");
      await page.getByTestId("api-endpoint-connection-header-value-0").fill("team-e2e");
      await expect(page.getByTestId("api-endpoint-connection-headers-problem")).toHaveText(
        "“X Relay Team” isn't a valid header name: use letters, digits and ! # $ % & ' * + - . ^ _ ` | ~ only. Requests with it will fail.",
      );
      await expect(save).toBeEnabled();
      await page.getByTestId("api-endpoint-connection-header-name-0").fill("X-Relay-Team");
      await expect(page.getByTestId("api-endpoint-connection-headers-problem")).toHaveCount(0);
      const extraBody = page.getByTestId("api-endpoint-connection-extra-body-input");
      await extraBody.fill('{"!messages": []}');
      await expect(page.getByTestId("api-endpoint-connection-extra-body-problem")).toHaveText(
        "Osuna sets “messages” itself, so it can't be added",
      );
      await expect(save).toBeDisabled();
      await extraBody.fill('{"prompt_cache_key": "${sessionId}"}');
      await expect(page.getByTestId("api-endpoint-connection-extra-body-problem")).toHaveCount(0);
      await expect(save).toBeEnabled();
    });

    await test.step("a key header the relay doesn't take fails the test as a rejected key", async () => {
      // 假中转站只认 Authorization: Bearer：只放 x-api-key 就被拒。
      await page.getByTestId("api-endpoint-connection-key-header-x-api-key").click();
      await page.getByTestId("api-endpoint-connection-test-button").click();
      await expect(
        page.getByTestId("api-endpoint-connection-test-anthropic_messages-verdict"),
      ).toHaveText("Key rejected");
    });

    await test.step("Test connection carries the typed header, extra body and key header", async () => {
      await page.getByTestId("api-endpoint-connection-key-header-bearer").click();
      relay.requests.length = 0;
      await page.getByTestId("api-endpoint-connection-test-button").click();
      await expect(
        page.getByTestId("api-endpoint-connection-test-anthropic_messages-verdict"),
      ).toHaveText(/^Connected · \d+ ms$/);
      const posted = postsOf(relay);
      expect(relayTeamsOf(posted)).toEqual(["team-e2e"]);
      expect(posted[0]?.xApiKey).toBeUndefined();
      expect(posted[0]?.body).toMatch(/"prompt_cache_key":"osuna-test-[0-9a-f]{12}"/);
    });

    await test.step("saving keeps all three, and the edit window opens with Advanced unfolded", async () => {
      await save.click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [endpoint] = (await client.apiEndpointList("claude")).endpoints;
      expect(endpoint).toMatchObject({
        headers: { "X-Relay-Team": "team-e2e" },
        extraBody: { prompt_cache_key: "${sessionId}" },
        keyHeader: "bearer",
      });
      await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
      await expect(page.getByTestId("api-endpoint-connection-header-value-0")).toHaveValue(
        "team-e2e",
      );
      await expect(advanced(page)).toBeVisible();
    });
  });

  test("a save the host refuses for a reserved extra body field says why in the window, in place", async ({
    page,
  }) => {
    // 表单当场就挡住保留字段：在发出去的保存里塞一个，看 daemon 的拒收怎么显示。
    await addReservedFieldToSaves(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-name").fill("Refused relay");
    await page.getByTestId("api-endpoint-connection-api-key").fill(RELAY_KEY);
    await page
      .getByTestId("api-endpoint-connection-url-anthropic_messages")
      .fill(`${relay.origin}/good`);
    await page.getByTestId("api-endpoint-connection-save").click();

    await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
      "Osuna sets “messages” itself, so it can't be added",
    );
    await expect(connectionForm(page)).toBeVisible();
    expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
  });

  test("a template's suggested headers are offered to add, and the key header is not offered on Anthropic's own address", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-anthropic").click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    const suggested = page.getByTestId(
      "api-endpoint-connection-suggested-header-anthropic-workspace-id",
    );
    await expect(suggested).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-key-header")).toHaveCount(0);
    await suggested.click();
    await expect(page.getByTestId("api-endpoint-connection-header-name-0")).toHaveValue(
      "anthropic-workspace-id",
    );
    await expect(suggested).toHaveCount(0);
  });

  test("at 390 a header's name and value read as one pair: the gap between pairs is wider than inside one", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("api-endpoints-empty-add").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    await page.getByTestId("api-endpoint-connection-add-header").click();
    const name0 = await boxOf(page.getByTestId("api-endpoint-connection-header-name-0"));
    const value0 = await boxOf(page.getByTestId("api-endpoint-connection-header-value-0"));
    const name1 = await boxOf(page.getByTestId("api-endpoint-connection-header-name-1"));
    // 窄窗口里名和值上下两行。
    expect(value0.y).toBeGreaterThan(name0.y + name0.height - 1);
    // testID 落在框里的文字上，框的上下留白两边一样，相减就抵消了。
    const inside = value0.y - (name0.y + name0.height);
    const between = name1.y - (value0.y + value0.height);
    expect(between - inside).toBeGreaterThanOrEqual(8);
  });
});

// 接口管理好用性工单 23：不校验证书（照 magpie 编辑窗口的 Certificate），打开前先确认，打开后行上一直有标记。
test.describe("Don't check its certificate", () => {
  // 保留域名，不会解析到任何地方：保存后当场拉清单也出不了本机。
  const SELF_SIGNED_URL = "https://relay.self-signed.example/v1";

  test("asks before turning it on: cancel keeps it off, confirm turns it on; a refused save says why and keeps the form; a save marks the row", async ({
    page,
  }) => {
    await refuseFirstSaveAsTemplate(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-name").fill("Self-signed relay");
    const field = page.getByTestId("api-endpoint-connection-insecure-tls");
    const toggle = page.getByTestId("api-endpoint-connection-insecure-tls-switch");
    const sheet = page.getByTestId("api-endpoint-insecure-tls-confirm-sheet");

    await test.step("offered only once an address is https", async () => {
      await page.getByTestId("api-endpoint-connection-url-openai_chat").fill(`${relay.origin}/v1`);
      await expect(field).toHaveCount(0);
      await page.getByTestId("api-endpoint-connection-url-openai_chat").fill(SELF_SIGNED_URL);
      await expect(field).toBeVisible();
      await expect(toggle).not.toBeChecked();
    });

    await test.step("turning it on asks first; Cancel leaves it off", async () => {
      await toggle.click();
      await expect(sheet).toBeVisible();
      await expect(page.getByTestId("api-endpoint-insecure-tls-risk")).toContainText(
        "Whoever answers there could pretend to be it and see your API key and your conversations.",
      );
      await page.getByTestId("api-endpoint-insecure-tls-cancel").click();
      await expect(sheet).toHaveCount(0);
      await expect(toggle).not.toBeChecked();
    });

    await test.step("Don't check turns it on", async () => {
      await toggle.click();
      await page.getByTestId("api-endpoint-insecure-tls-confirm").click();
      await expect(sheet).toHaveCount(0);
      await expect(toggle).toBeChecked();
      await expect(connectionForm(page)).toBeVisible();
    });

    await test.step("a save the host refuses says why in the window and keeps the setting", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(
        "An endpoint added from a template always checks its certificate. Only an endpoint added with Custom can skip the check.",
      );
      await expect(toggle).toBeChecked();
      expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
    });

    await test.step("saving again keeps it, and the row carries the mark", async () => {
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved?.insecureTls).toBe(true);
      await openApiEndpointsPage(page);
      await expect(page.getByTestId("api-endpoint-row-insecure-tls")).toBeVisible();
      await expect(page.getByTestId("api-endpoint-row-insecure-tls")).toHaveText(
        "Don't check its certificate",
      );
    });

    await test.step("turning it off needs no confirm and takes the mark away", async () => {
      await openEndpointRow(page, await firstEndpointId());
      await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
      await expect(toggle).toBeChecked();
      await toggle.click();
      await expect(sheet).toHaveCount(0);
      await expect(toggle).not.toBeChecked();
      await page.getByTestId("api-endpoint-connection-save").click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved?.insecureTls).toBeUndefined();
      await openApiEndpointsPage(page);
      await expect(page.getByTestId(`api-endpoint-row-${saved?.id ?? ""}`)).toBeVisible();
      await expect(page.getByTestId("api-endpoint-row-insecure-tls")).toHaveCount(0);
    });
  });

  test("not offered for an endpoint added from a template", async ({ page }) => {
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-anthropic").click();
    await expect(page.getByTestId("api-endpoint-connection-name")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-insecure-tls")).toHaveCount(0);
  });
});

// 接口管理好用性工单 24：「高级」里的冷却设置（magpie QuotaRest、RestCap、RestCapOff；magpie 只在命令行设）。
test.describe("An endpoint's cooldown settings", () => {
  test("out-of-range minutes are refused on the spot; a refused save says why and keeps the form; a save keeps both settings", async ({
    page,
  }) => {
    await refuseFirstSaveWithCooldown(page);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-empty-add").click();
    await page.getByTestId("api-endpoint-template-custom").click();
    await page.getByTestId("api-endpoint-connection-name").fill("Quota relay");
    await page
      .getByTestId("api-endpoint-connection-url-anthropic_messages")
      .fill(`${relay.origin}/good`);
    const save = page.getByTestId("api-endpoint-connection-save");
    const quotaRest = page.getByTestId("api-endpoint-connection-quota-rest-input");
    const restCap = page.getByTestId("api-endpoint-connection-rest-cap-input");
    const problem = "Enter whole minutes from 0 to 11520 (8 days)";

    await test.step("folded until Advanced is opened; empty fields show the gateway's own minutes", async () => {
      await expect(quotaRest).toHaveCount(0);
      await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
      await expect(quotaRest).toHaveValue("");
      await expect(quotaRest).toHaveAttribute("placeholder", "15");
      await expect(restCap).toHaveAttribute("placeholder", "10 / 30");
    });

    await test.step("more than eight days, or not whole minutes, is said on the spot and holds the save", async () => {
      await quotaRest.fill("11521");
      await expect(page.getByTestId("api-endpoint-connection-quota-rest-problem")).toHaveText(
        problem,
      );
      await expect(save).toBeDisabled();
      await quotaRest.fill("60");
      await expect(page.getByTestId("api-endpoint-connection-quota-rest-problem")).toHaveCount(0);
      await restCap.fill("1.5");
      await expect(page.getByTestId("api-endpoint-connection-rest-cap-problem")).toHaveText(
        problem,
      );
      await expect(save).toBeDisabled();
      await restCap.fill("5");
      await expect(page.getByTestId("api-endpoint-connection-rest-cap-problem")).toHaveCount(0);
      await expect(save).toBeEnabled();
    });

    await test.step("a save the host refuses says why in the window and keeps the typed minutes", async () => {
      await save.click();
      await expect(page.getByTestId("api-endpoint-connection-error")).toHaveText(problem);
      await expect(quotaRest).toHaveValue("60");
      expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
    });

    await test.step("saving again keeps both, and the edit window opens with them unfolded", async () => {
      await save.click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved?.cooldownSettings).toEqual({ quotaRestMinutes: 60, restCapMinutes: 5 });
      // 添加后停在这家的详情页。
      await expect(page.getByTestId("api-endpoint-detail").filter({ visible: true })).toBeVisible();
      await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
      await expect(quotaRest).toHaveValue("60");
      await expect(restCap).toHaveValue("5");
    });

    await test.step("no rest after unknown failures takes the longest rest's place, and emptying a field clears it", async () => {
      await page.getByTestId("api-endpoint-connection-no-fail-rest-switch").click();
      await expect(restCap).toHaveCount(0);
      await quotaRest.fill("");
      await save.click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved?.cooldownSettings).toEqual({ noFailRest: true });
    });

    await test.step("rest until a time each day: a time it can't read is said on the spot; one it reads replaces the minutes", async () => {
      await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
      await quotaRest.fill("60");
      await page.getByTestId("api-endpoint-connection-quota-rest-time").click();
      await expect(quotaRest).toHaveCount(0);
      const resetAt = page.getByTestId("api-endpoint-connection-quota-reset-at-input");
      await expect(resetAt).toHaveAttribute("placeholder", "08:00");
      await resetAt.fill("8am");
      await expect(page.getByTestId("api-endpoint-connection-quota-reset-at-problem")).toHaveText(
        "Enter a time like 08:00, or 00:00+08:00 on the vendor's clock",
      );
      await expect(save).toBeDisabled();
      await resetAt.fill("00:00+08:00");
      await expect(page.getByTestId("api-endpoint-connection-quota-reset-at-problem")).toHaveCount(
        0,
      );
      await save.click();
      await expect(connectionForm(page)).toHaveCount(0);
      const [saved] = (await client.apiEndpointList("claude")).endpoints;
      expect(saved?.cooldownSettings).toEqual({ quotaResetAt: "00:00+08:00", noFailRest: true });
      await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
      await expect(resetAt).toHaveValue("00:00+08:00");
    });
  });
});

/** 第一次保存把额度冷却改成九天：daemon 按越界拒收，看拒收怎么显示；之后的保存照常。 */
async function refuseFirstSaveWithCooldown(page: Page): Promise<void> {
  const host = { isRefusing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isSave =
        typeof message === "string" && message.includes("provider.api_endpoint.save.request");
      if (!isSave || !host.isRefusing) {
        server.send(message);
        return;
      }
      host.isRefusing = false;
      const envelope = JSON.parse(message) as { message: Record<string, unknown> };
      envelope.message.cooldownSettings = { quotaRestMinutes: 9 * 24 * 60 };
      server.send(JSON.stringify(envelope));
    });
  });
}

async function firstEndpointId(): Promise<string> {
  const [endpoint] = (await client.apiEndpointList("claude")).endpoints;
  if (!endpoint) throw new Error("Expected a saved endpoint");
  return endpoint.id;
}

/** 第一次保存塞进模板 id：daemon 按模板接口拒收不校验证书，看拒收怎么显示；之后的保存照常。 */
async function refuseFirstSaveAsTemplate(page: Page): Promise<void> {
  const host = { isRefusing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isSave =
        typeof message === "string" && message.includes("provider.api_endpoint.save.request");
      if (!isSave || !host.isRefusing) {
        server.send(message);
        return;
      }
      host.isRefusing = false;
      const envelope = JSON.parse(message) as { message: Record<string, unknown> };
      envelope.message.templateId = "deepseek";
      server.send(JSON.stringify(envelope));
    });
  });
}

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

  test("Endpoint name in model lists: a refusal stays in place, then Only when names clash names only the shared model's endpoints in the selector and Never names none", async ({
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
    const hostDisplay = async () => (await client.apiEndpointList("claude")).endpointNameDisplay;
    const host = await failRequests(page, "provider.api_endpoint.set_endpoint_name_display");
    await openApiEndpointsPage(page);
    const section = page.getByTestId("api-endpoints-endpoint-names").filter({ visible: true });
    const trigger = section.getByTestId("api-endpoints-endpoint-names-trigger");

    await test.step("a refused choice goes back to the saved one and says why in the row", async () => {
      await expect(trigger).toHaveText("Always");
      await trigger.click();
      await page.getByTestId("api-endpoints-endpoint-names-clash").click();
      await expect(section).toContainText("Couldn't save: EACCES: permission denied");
      await expect(trigger).toHaveText("Always");
      expect(await hostDisplay()).toBe("always");
    });

    await test.step("a saved choice reaches the host and the error goes", async () => {
      host.failing = false;
      await trigger.click();
      await page.getByTestId("api-endpoints-endpoint-names-clash").click();
      await expect.poll(hostDisplay).toBe("clash");
      await expect(trigger).toHaveText("Only when names clash");
      await expect(section).not.toContainText("Couldn't save");
    });

    const workspace = await seedWorkspace({ repoPrefix: "api-endpoint-names-" });
    try {
      await carryPreferencesAcrossReloads(page);
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await keepPreferencesForNextLoad(page, { provider: "claude" });
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);
      const picker = page.getByTestId("combobox-desktop-container");
      const rowOf = (modelId: string) => picker.getByTestId(`model-row-claude-${modelId}`);
      // 快照推过来之前打开的选单还是上一种：每次打开读一遍，读完关上。
      const sharedRowText = async () => {
        await openModelPicker(page);
        const text = await rowOf("relay-a/claude-sonnet-4-5").textContent();
        await closeModelPicker(page);
        return text;
      };

      await test.step("only when names clash: no endpoint headings, only the shared name's two rows name their endpoint", async () => {
        await openModelPicker(page);
        await expect(picker.locator('[data-testid^="model-endpoint-group-"]')).toHaveCount(0);
        await expect(rowOf("relay-a/claude-sonnet-4-5")).toHaveText("claude-sonnet-4-5Relay A");
        await expect(rowOf("relay-b/claude-sonnet-4-5")).toHaveText("claude-sonnet-4-5Relay B");
        await expect(rowOf("relay-a/kimi-k2")).toHaveText("kimi-k2");
        await expect(rowOf("relay-b/gpt-5")).toHaveText("gpt-5");
        await closeModelPicker(page);
      });

      await test.step("never: no row names its endpoint", async () => {
        await client.apiEndpointSetEndpointNameDisplay({ display: "never" });
        await expect.poll(sharedRowText).toBe("claude-sonnet-4-5");
        await openModelPicker(page);
        await expect(rowOf("relay-b/claude-sonnet-4-5")).toHaveText("claude-sonnet-4-5");
        await expect(picker).not.toContainText("Relay");
        await closeModelPicker(page);
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("Endpoint name in model lists atop an endpoint's models: the same host setting, with a preview of its first model and a refusal kept in place", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const relayA = await seedApiEndpoint(client, {
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5", "kimi-k2"],
    });
    await seedApiEndpoint(client, {
      name: "Relay B",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5"],
    });
    const host = await failRequests(page, "provider.api_endpoint.set_endpoint_name_display");
    await openEndpointDetail(page, relayA);
    // 在「模型」区顶上一行（照 magpie 放在模型名字上面）。
    const section = page
      .getByTestId("api-endpoint-models-section")
      .getByTestId("api-endpoint-endpoint-names-row")
      .filter({ visible: true });
    const trigger = section.getByTestId("api-endpoint-endpoint-names-trigger");
    const preview = section.getByTestId("api-endpoint-endpoint-names-preview");

    await expect(preview).toHaveText("Lists show “claude-sonnet-4-5 (Relay A)”");
    await trigger.click();
    await page.getByTestId("api-endpoint-endpoint-names-never").click();
    await expect(section).toContainText("Couldn't save: EACCES: permission denied");
    await expect(preview).toHaveText("Lists show “claude-sonnet-4-5 (Relay A)”");

    host.failing = false;
    await trigger.click();
    await page.getByTestId("api-endpoint-endpoint-names-clash").click();
    await expect
      .poll(async () => (await client.apiEndpointList("claude")).endpointNameDisplay)
      .toBe("clash");
    // 没有别家叫 claude-sonnet-4-5：同名时显示就不带接口名。
    await expect(preview).toHaveText("Lists show “claude-sonnet-4-5”");
    // 别的客户端改了，列表下一次刷新（每 30 秒）时这里跟着变。
    await client.apiEndpointSetEndpointNameDisplay({ display: "always" });
    await expect(trigger).toHaveText("Always", { timeout: 45_000 });
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
    // 接口名显示方式缺省是「总是」（照 magpie）：选单行写「模型名 (接口名)」，说明换成 via Osuna。
    '"label": "claude-sonnet-4-5 (Relay A)",',
    '"description": "via Osuna"',
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

/** 读回 key 的请求在 failing 为 true 时被拒（像主机读不了 keys.json），之后照常送到 daemon。 */
async function failRevealKey(page: Page): Promise<{ failing: boolean }> {
  const host = { failing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isReveal =
        typeof message === "string" && message.includes("provider.api_endpoint.reveal_key.request");
      const request = isReveal
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
            type: "provider.api_endpoint.reveal_key.response",
            payload: {
              requestId: request.requestId,
              apiKey: null,
              error: { code: "unknown", message: "EACCES: permission denied" },
            },
          },
        }),
      );
    });
  });
  return host;
}

async function duplicateFromMenu(page: Page): Promise<void> {
  await page.getByTestId("api-endpoint-detail-menu").filter({ visible: true }).click();
  await page.getByTestId("api-endpoint-detail-duplicate").click();
  await expect(connectionForm(page)).toBeVisible();
}

/** 第一次要模板清单时不送到 daemon，直接回一条失败；之后照常。 */
async function failFirstTemplateList(page: Page): Promise<void> {
  let failed = false;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isList =
        typeof message === "string" &&
        message.includes("provider.api_endpoint.list_templates.request");
      if (!isList || failed) {
        server.send(message);
        return;
      }
      failed = true;
      const request = (JSON.parse(message) as { message?: { requestId?: string } }).message;
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "provider.api_endpoint.list_templates.response",
            payload: {
              requestId: request?.requestId,
              templates: [],
              error: { code: "unknown", message: "EACCES: permission denied" },
            },
          },
        }),
      );
    });
  });
}

/** 保存接口连接的请求在 `failing` 时不送到 daemon，直接回一条写入失败。 */
/**
 * 浏览器测试绝不让 daemon 上网：从网站取图标的请求（本机地址的除外，daemon 自己就拒收）由这里答 icon，并记下问的地址。
 */
async function answerSiteIcons(
  page: Page,
  input: { icon: string | null; askedFor: string[] },
): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => answerSiteIcon({ message, ws, server, ...input }));
  });
}

function answerSiteIcon(input: {
  message: string | Buffer;
  ws: WebSocketRoute;
  server: WebSocketRoute;
  icon: string | null;
  askedFor: string[];
}): void {
  const { message, ws, server } = input;
  const request =
    typeof message === "string" && message.includes("provider.api_endpoint.fetch_site_icon")
      ? (JSON.parse(message) as { message?: { requestId?: string; baseUrl?: string } }).message
      : undefined;
  if (!request || request.baseUrl?.includes("127.0.0.1")) {
    server.send(message);
    return;
  }
  input.askedFor.push(request.baseUrl ?? "");
  ws.send(
    JSON.stringify({
      type: "session",
      message: {
        type: "provider.api_endpoint.fetch_site_icon.response",
        payload: { requestId: request.requestId, icon: input.icon, error: null },
      },
    }),
  );
}

async function failConnectionSave(page: Page): Promise<{ failing: boolean }> {
  const host = { failing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isSave =
        typeof message === "string" && message.includes("provider.api_endpoint.save.request");
      const request = isSave
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

/** 发往 daemon 的保存里都塞进一个保留字段（!messages），看 daemon 拒收时界面怎么说。 */
async function addReservedFieldToSaves(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isSave =
        typeof message === "string" && message.includes("provider.api_endpoint.save.request");
      if (!isSave) {
        server.send(message);
        return;
      }
      const envelope = JSON.parse(message) as { message: Record<string, unknown> };
      envelope.message.extraBody = { "!messages": [] };
      server.send(JSON.stringify(envelope));
    });
  });
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

/** 刚关掉的本机端口：连上去被拒。 */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
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

/** model-01、model-02……：同属「其他」家族、按清单顺序排的一串模型名。 */
function numberedModels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `model-${String(index + 1).padStart(2, "0")}`);
}

function scopeReader(endpointId: string): () => Promise<string | undefined> {
  return async () => (await endpointOf(endpointId))?.modelScope;
}

function modelSettingsReader(endpointId: string) {
  return async () => (await endpointOf(endpointId))?.modelSettings;
}

function autoPickReader(endpointId: string): () => Promise<string[] | undefined> {
  return async () => (await endpointOf(endpointId))?.autoPick;
}

async function endpointOf(endpointId: string) {
  const list = await client.apiEndpointList("claude");
  return list.endpoints.find((endpoint) => endpoint.id === endpointId);
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

/** 存几家开着、选了同一个模型的接口，返回 id（按存的先后）。 */
async function seedRelays(names: string[]): Promise<string[]> {
  const seeded: string[] = [];
  for (const name of names) {
    seeded.push(
      await seedApiEndpoint(client, {
        name,
        baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
        models: ["claude-sonnet-4-5"],
      }),
    );
  }
  return seeded;
}

function orderReader(page: Page, which: "enabled" | "disabled"): () => Promise<string[]> {
  return () => rowOrder(page, which);
}

/** 一组里各行的接口 id，从上到下。 */
async function rowOrder(page: Page, which: "enabled" | "disabled"): Promise<string[]> {
  return group(page, which)
    .locator('[data-testid^="api-endpoint-row-ep_"]')
    .evaluateAll((rows) =>
      rows.map((element) => element.getAttribute("data-testid")?.slice("api-endpoint-row-".length)),
    ) as Promise<string[]>;
}

/** 主机存下的接口顺序。 */
async function storedOrder(): Promise<string[]> {
  return (await client.apiEndpointList("claude")).endpoints.map((endpoint) => endpoint.id);
}

async function openOrderMenu(page: Page, endpointId: string): Promise<void> {
  await page.getByTestId(`api-endpoint-order-menu-${endpointId}`).filter({ visible: true }).click();
  await expect(orderItem(page, "bottom")).toBeVisible();
}

function orderItem(page: Page, place: "up" | "down" | "top" | "bottom"): Locator {
  return page.getByTestId(`api-endpoint-order-${place}`).filter({ visible: true });
}

/** 按住一行的把手，拖到另一行的位置上松开。 */
async function dragRow(page: Page, fromId: string, ontoId: string): Promise<void> {
  const handle = row(page, fromId).getByTestId("api-endpoint-drag-handle");
  const from = await handle.boundingBox();
  const onto = await row(page, ontoId).boundingBox();
  if (!from || !onto) throw new Error("Rows to drag are not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 4 });
  await expect(page.getByTestId("api-endpoint-row-dragging")).toBeVisible();
  await expect(page.getByTestId("api-endpoint-row-drop-slot")).toBeVisible();
  await page.mouse.move(from.x + from.width / 2, onto.y + onto.height / 2, { steps: 12 });
  // 占位停到目标行的位置上才松手：落点就是它。
  await expect
    .poll(async () => (await page.getByTestId("api-endpoint-row-drop-slot").boundingBox())?.y)
    .toBeCloseTo(onto.y, -1);
  await page.mouse.up();
}

/** `failing` 为 true 时，set_order 请求不送到 daemon，直接回一个失败响应。 */
function failSetOrder(page: Page): Promise<{ failing: boolean }> {
  return failRequests(page, "provider.api_endpoint.set_order");
}

/** `failing` 为 true 时，这一种请求不送到 daemon，直接回一个失败响应（响应里除 error 外的字段取空值）。 */
async function failRequests(page: Page, rpc: string): Promise<{ failing: boolean }> {
  const host = { failing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const request =
        typeof message === "string" && message.includes(`"${rpc}.request"`)
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
            type: `${rpc}.response`,
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

function catalogReader(endpointId: string) {
  return () => catalogOf(endpointId);
}

function deploymentCountReader(target: FakeRelay): () => number {
  return () => deploymentListings(target).length;
}

function listingCountReader(target: FakeRelay): () => number {
  return () => listingsOf(target).length;
}

async function catalogOf(endpointId: string) {
  const list = await client.apiEndpointList("claude");
  return list.endpoints.find((endpoint) => endpoint.id === endpointId)?.catalog;
}

/** 测试模型的请求在 refusing 时由页面这头直接回一条被拒的响应，不到 daemon。 */
async function refuseTestModels(page: Page): Promise<{ refusing: boolean }> {
  const host = { refusing: true };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const request =
        typeof message === "string" &&
        message.includes('"provider.api_endpoint.test_models.request"')
          ? (JSON.parse(message) as { message?: { requestId?: string } }).message
          : undefined;
      if (!host.refusing || !request) {
        server.send(message);
        return;
      }
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "provider.api_endpoint.test_models.response",
            payload: {
              requestId: request.requestId,
              results: [],
              error: { code: "unknown", message: "EACCES: permission denied" },
            },
          },
        }),
      );
    });
  });
  return host;
}

/**
 * 第一个 set_order 照常送到 daemon，但它的响应扣到第二个发出来才给页面；第二个再晚 800 毫秒才送到 daemon。
 * 这段时间里页面若拿第一个保存后的列表刷新，就会把后一次先排好的顺序画回去。
 */
async function holdSecondSetOrder(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    let sent = 0;
    let answered = 0;
    let firstAnswer: string | null = null;
    server.onMessage((message) => {
      const isAnswer = typeof message === "string" && message.includes("set_order.response");
      if (isAnswer && ++answered === 1) {
        firstAnswer = message;
        return;
      }
      ws.send(message);
    });
    ws.onMessage((message) => {
      const isSetOrder = typeof message === "string" && message.includes("set_order.request");
      if (!isSetOrder || ++sent !== 2) {
        server.send(message);
        return;
      }
      const deliverFirst = () => {
        if (firstAnswer === null) {
          setTimeout(deliverFirst, 20);
          return;
        }
        ws.send(firstAnswer);
        setTimeout(() => server.send(message), 800);
      };
      deliverFirst();
    });
  });
}

/** 在页面里每 20 毫秒记一次「已开启」组的先后，直到读出来为止。 */
async function recordEnabledOrders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: string[][] = [];
    (window as unknown as { __orderSamples: string[][] }).__orderSamples = samples;
    setInterval(() => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="api-endpoints-enabled-group"] [data-testid^="api-endpoint-row-ep_"]',
        ),
      ).filter((element) => element.offsetParent !== null);
      samples.push(
        rows.map((element) =>
          (element.getAttribute("data-testid") ?? "").slice("api-endpoint-row-".length),
        ),
      );
    }, 20);
  });
}

async function recordedOrders(page: Page): Promise<string[][]> {
  return page.evaluate(() => (window as unknown as { __orderSamples: string[][] }).__orderSamples);
}

test.describe("Vendor status pages", () => {
  function vendor(input: {
    vendor: string;
    name: string;
    page: string;
    level: string | null;
    isLinkOnly?: boolean;
  }) {
    return {
      vendor: input.vendor,
      name: input.name,
      page: input.page,
      isLinkOnly: input.isLinkOnly ?? false,
      level: input.level,
      parts:
        input.level === "degraded"
          ? [{ name: "Claude API (api.anthropic.com)", status: "degraded_performance" }]
          : [],
      incidents: [],
      readAt: "2026-10-21T08:00:00.000Z",
      error: null,
    };
  }

  test("a vendor that reports problems is said on its endpoints' rows with a link to its status page; a vendor that is well says nothing", async ({
    page,
  }) => {
    const official = await seedApiEndpoint(client, {
      name: "Anthropic official",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const openai = await seedApiEndpoint(client, {
      name: "OpenAI official",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5"],
    });
    const deepseek = await seedApiEndpoint(client, {
      name: "DeepSeek official",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["deepseek-chat"],
    });
    const asked = await answerVendorStatus(page, {
      payload: {
        autoUpdate: true,
        vendors: [
          vendor({
            vendor: "anthropic",
            name: "Anthropic",
            page: "https://status.claude.com",
            level: "degraded",
          }),
          vendor({
            vendor: "openai",
            name: "OpenAI",
            page: "https://status.openai.com",
            level: "ok",
          }),
          vendor({
            vendor: "deepseek",
            name: "DeepSeek",
            page: "https://status.deepseek.com",
            level: null,
            isLinkOnly: true,
          }),
        ],
        endpointVendors: { [official]: "anthropic", [openai]: "openai", [deepseek]: "deepseek" },
        error: null,
      },
    });
    await openApiEndpointsPage(page);
    await expect.poll(() => asked.count).toBeGreaterThan(0);

    const notice = row(page, official).getByTestId("api-endpoint-row-vendor-status");
    await expect(notice.getByTestId("api-endpoint-row-vendor-status-text")).toHaveText(
      "Anthropic reports problems",
    );
    await expect(notice).toContainText("Claude API (api.anthropic.com): degraded performance");
    await expect(notice.getByTestId("api-endpoint-row-vendor-status-link")).toHaveText(
      "Status page ↗",
    );
    await expect(row(page, openai).getByTestId("api-endpoint-row-vendor-status")).toHaveCount(0);
    // DeepSeek 只给链接，不说异常。
    const deepseekLink = row(page, deepseek).getByTestId("api-endpoint-row-vendor-status");
    await expect(deepseekLink.getByTestId("api-endpoint-row-vendor-status-link")).toHaveText(
      "DeepSeek status ↗",
    );
    await expect(deepseekLink.getByTestId("api-endpoint-row-vendor-status-text")).toHaveCount(0);
  });

  test("the status pages are asked only while the Usage page or the API endpoints page is open, every five minutes", async ({
    page,
  }) => {
    // 用量页的订阅卡片要有一个账号才挂上；用 daemon 端真实的用量来源给它一个。
    const usage = await installLoginUsage({
      status: "available",
      windows: [{ id: "weekly", label: "Weekly", shortLabel: "wk", summary: true, usedPct: 54 }],
    });
    try {
      await page.clock.install();
      const asked = await answerVendorStatus(page, {
        payload: { autoUpdate: true, vendors: [], endpointVendors: {}, error: null },
      });
      const serverId = getServerId();
      // 页面关着时问过的话，打开页面后第一次答之前就已经到了，次数会多出来（同一条连接按顺序到）。
      const expectAsked = (times: number) => expect.poll(() => asked.count).toBe(times);

      await gotoAppShell(page);
      await page.clock.fastForward("11:00");
      await openUsagePageFromShell(page);
      await expect(page.getByTestId("usage-plan-usage-card")).toContainText("Weekly");
      await expectAsked(1);
      await page.clock.fastForward("05:01");
      await expectAsked(2);

      await openSettings(page);
      await openSettingsHost(page, serverId);
      await openSettingsHostSection(page, serverId, "providers");
      await page.clock.fastForward("11:00");
      await openSettingsHostSection(page, serverId, "api-endpoints");
      await expectAsked(3);
      await page.clock.fastForward("05:01");
      await expectAsked(4);
    } finally {
      await usage.cleanup();
    }
  });

  test("a failed status request leaves the list as it is", async ({ page }) => {
    const official = await seedApiEndpoint(client, {
      name: "Anthropic official",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    const asked = await answerVendorStatus(page, {
      payload: {
        autoUpdate: false,
        vendors: [],
        endpointVendors: {},
        error: { code: "unknown", message: "EACCES: permission denied" },
      },
    });
    await openApiEndpointsPage(page);
    await expect.poll(() => asked.count).toBeGreaterThan(0);
    await expect(row(page, official)).toBeVisible();
    await expect(row(page, official).getByTestId("api-endpoint-row-key")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-row-vendor-status")).toHaveCount(0);
    await expect(page.getByTestId("api-endpoints-load-error")).toHaveCount(0);
  });
});

/** 厂商状态的请求不送到 daemon，直接回给定的答案（daemon 不上网，假答案代替状态页），并数问了几次。 */
async function answerVendorStatus(
  page: Page,
  input: { payload: Record<string, unknown> },
): Promise<{ count: number }> {
  const asked = { count: 0 };
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const request =
        typeof message === "string" && message.includes("provider.api_endpoint.vendor_status")
          ? (JSON.parse(message) as { message?: { requestId?: string } }).message
          : undefined;
      if (!request) {
        server.send(message);
        return;
      }
      asked.count += 1;
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "provider.api_endpoint.vendor_status.response",
            payload: { requestId: request.requestId, ...input.payload },
          },
        }),
      );
    });
  });
  return asked;
}

test.describe("Import from other apps", () => {
  const importHome = path.join(cliHome, "import-home");

  // 假配置：CC Switch（config.json）里一家新的中转服务，Codex 里一家和已有接口重名的，OpenCode 里一个登录。
  // extra：CC Switch 里再多一家新的（Second Relay，在 localhost 上）。
  // openCodeKey：OpenCode 里再多一把 DeepSeek 的 key（发现提示不读 OpenCode，导入窗口读）。
  async function writeImportSources(
    input: { extra?: boolean; openCodeKey?: boolean } = {},
  ): Promise<void> {
    const second = {
      name: "Second Relay",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: `${relay.origin.replace("127.0.0.1", "localhost")}/good`,
          ANTHROPIC_AUTH_TOKEN: "sk-e2e-second",
        },
      },
    };
    await mkdir(path.join(importHome, ".cc-switch"), { recursive: true });
    await writeFile(
      path.join(importHome, ".cc-switch", "config.json"),
      JSON.stringify({
        claude: {
          providers: {
            ...(input.extra ? { second } : {}),
            team: {
              name: "Team Relay",
              settingsConfig: {
                env: {
                  ANTHROPIC_BASE_URL: `${relay.origin}/good`,
                  ANTHROPIC_AUTH_TOKEN: RELAY_KEY,
                  ANTHROPIC_MODEL: "claude-sonnet-4-5",
                },
              },
            },
          },
        },
      }),
    );
    await mkdir(path.join(cliHome, "codex"), { recursive: true });
    await writeFile(
      path.join(cliHome, "codex", "config.toml"),
      [
        "[model_providers.mine]",
        'name = "My Relay"',
        `base_url = "${relay.origin}/good/v1"`,
        'experimental_bearer_token = "sk-e2e-codex"',
        'wire_api = "chat"',
        "",
      ].join("\n"),
    );
    await mkdir(path.join(importHome, ".local", "share", "opencode"), { recursive: true });
    await writeFile(
      path.join(importHome, ".local", "share", "opencode", "auth.json"),
      JSON.stringify({
        anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
        ...(input.openCodeKey ? { deepseek: { type: "api", key: "sk-e2e-deepseek" } } : {}),
      }),
    );
  }

  // 只删自己放的假配置：daemon 也在这个临时 HOME 里写东西。
  test.afterEach(async () => {
    await rm(path.join(importHome, ".cc-switch"), { recursive: true, force: true });
    await rm(path.join(importHome, ".local", "share", "opencode"), {
      recursive: true,
      force: true,
    });
    await rm(path.join(cliHome, "codex", "config.toml"), { force: true });
  });

  function importSheet(page: Page): Locator {
    return page.getByTestId("api-endpoint-import-sheet").filter({ visible: true });
  }

  function importItem(page: Page, ref: string): Locator {
    return importSheet(page).getByTestId(`api-endpoint-import-item-${ref}`);
  }

  test("lists each app's entries with their standing, renames one in place and imports them", async ({
    page,
  }) => {
    await writeImportSources();
    await seedApiEndpoint(client, {
      name: "My Relay",
      // 换个主机名：同一主机上另一把 key 会是「同一家、key 不同」。
      baseUrls: [
        { format: "openai_chat", url: `${relay.origin.replace("127.0.0.1", "localhost")}/free/v1` },
      ],
      models: ["gpt-5"],
      apiKey: "sk-e2e-other",
    });
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-import-button").click();
    await expect(importSheet(page)).toBeVisible();

    const team = importItem(page, "claude/team");
    await expect(team).toContainText("Team Relay");
    await expect(team).toContainText("New");
    await expect(team).toContainText("Claude Code");
    // key 只给打码的。
    await expect(team).toContainText("sk-e…elay");
    await expect(importSheet(page)).not.toContainText(RELAY_KEY);
    await expect(team.getByTestId("api-endpoint-import-item-claude/team-pick")).toBeChecked();

    const mine = importItem(page, "mine");
    await expect(mine).toContainText("Name in use");
    await expect(mine.getByTestId("api-endpoint-import-item-mine-pick")).not.toBeChecked();
    await expect(mine.getByTestId("api-endpoint-import-item-mine-replace")).toBeVisible();
    // 就地改名：选上这一条，只能新增一家。
    await mine.getByTestId("api-endpoint-import-item-mine-name").fill("My Codex Relay");
    await expect(mine.getByTestId("api-endpoint-import-item-mine-pick")).toBeChecked();
    await expect(mine.getByTestId("api-endpoint-import-item-mine-replace")).toHaveCount(0);

    // OpenCode 的登录读得到、导不了；Alma 没装。
    await expect(importItem(page, "anthropic")).toContainText("Can't import");
    await expect(importSheet(page).getByTestId("api-endpoint-import-source-alma-empty")).toHaveText(
      "Not found on this host",
    );
    // 每个软件一节标着能导入几条；没找到的是「–」。
    await expect(importSheet(page).getByTestId("api-endpoint-import-source-alma-count")).toHaveText(
      "–",
    );
    await expect(
      importSheet(page).getByTestId("api-endpoint-import-source-cc-switch-count"),
    ).toHaveText("1");

    await expect(importSheet(page)).toContainText("2 selected");
    await page.getByTestId("api-endpoint-import-submit").click();
    await expect(importSheet(page)).toHaveCount(0);
    await expect(page.getByText("Imported 2: Team Relay, My Codex Relay")).toBeVisible();
    const list = page.getByTestId("api-endpoints-list");
    await expect(list).toContainText("Team Relay");
    await expect(list).toContainText("My Codex Relay");
    await expect(list).toContainText("My Relay");
  });

  for (const language of ["en", "zh-CN"] as const) {
    test(`at 390 an entry's facts wrap without a line starting with the · separator (${language})`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem("@paseo:app-settings", JSON.stringify({ language: value }));
      }, language);
      await writeImportSources();
      await openApiEndpointsPage(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId("api-endpoints-import-button").click();
      for (const ref of ["claude/team", "mine"]) {
        // 窄窗口里导入窗口是底部弹出的那份，按条目自己的标记找。
        const facts = page
          .getByTestId(`api-endpoint-import-item-${ref}-facts`)
          .filter({ visible: true });
        const lines = await linesOf(facts);
        // 390 宽放不下一行，否则这条测不到折行。
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) expect(line.startsWith("·"), line).toBe(false);
      }
    });
  }

  test("a scan that fails says why and can be tried again", async ({ page }) => {
    const scan = { fails: true };
    await answerImportRpc(page, {
      type: "provider.api_endpoint.import_scan",
      isAnswering: () => scan.fails,
      payload: {
        sources: [],
        error: { code: "endpoints_unparsable", message: "endpoints.json could not be parsed" },
      },
    });
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-import-button").click();
    const failed = importSheet(page).getByTestId("api-endpoint-import-scan-error");
    await expect(failed).toContainText("endpoints.json could not be parsed");
    await expect(page.getByTestId("api-endpoint-import-submit")).toBeDisabled();
    scan.fails = false;
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(
      importSheet(page).getByTestId("api-endpoint-import-source-cc-switch"),
    ).toBeVisible();
  });

  test("an import whose scan is out of date keeps the dialog, scans again and says so", async ({
    page,
  }) => {
    await writeImportSources();
    const seen = await answerImportRpc(page, {
      type: "provider.api_endpoint.import",
      isAnswering: () => true,
      payload: {
        imported: [],
        error: { code: "import_gone", message: "That entry is no longer in the app" },
      },
    });
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-import-button").click();
    const team = importItem(page, "claude/team");
    await expect(team.getByTestId("api-endpoint-import-item-claude/team-pick")).toBeChecked();
    await page.getByTestId("api-endpoint-import-submit").click();
    await expect(importSheet(page).getByTestId("api-endpoint-import-error")).toHaveText(
      "The scan was out of date, so Osuna scanned again. Check the picks and import again.",
    );
    await expect.poll(() => seen.scans).toBe(2);
    await expect(importSheet(page)).toBeVisible();
    await expect(team.getByTestId("api-endpoint-import-item-claude/team-pick")).toBeChecked();
    await expect(page.getByTestId("api-endpoints-list")).not.toContainText("Team Relay");
  });

  test("one entry that fails stops the import: the ones before it are added and named, the dialog stays on the failed one", async ({
    page,
  }) => {
    await writeImportSources({ extra: true });
    await failImportPickAt(page, 1);
    await openApiEndpointsPage(page);
    await page.getByTestId("api-endpoints-import-button").click();
    await expect(importItem(page, "claude/second")).toContainText("New");
    await expect(importItem(page, "claude/team")).toContainText("New");
    await page.getByTestId("api-endpoint-import-submit").click();

    await expect(page.getByText("Imported 1: Second Relay")).toBeVisible();
    await expect(page.getByTestId("api-endpoints-list")).toContainText("Second Relay");
    await expect(importSheet(page)).toBeVisible();
    const reason =
      "Team Relay wasn't imported: Team Relay doesn't share a name with an endpoint you have; keep both instead.";
    await expect(importSheet(page).getByTestId("api-endpoint-import-error")).toHaveText(reason);
    await expect(
      importItem(page, "claude/team").getByTestId("api-endpoint-import-item-claude/team-failed"),
    ).toHaveText(reason);
    // 重扫过：加好的那条已添加，不能再选。
    await expect(importItem(page, "claude/second")).toContainText("Already added");
    await expect(page.getByTestId("api-endpoints-list")).not.toContainText("Team Relay");
  });
});

test.describe("The prompt for local configurations", () => {
  const importHome = path.join(cliHome, "import-home");

  // CC Switch 里一家（extra 时两家）新的中转服务，OpenCode 里一把 key。
  async function writeDiscoverySources(input: { extra: boolean }): Promise<void> {
    const relayAt = (host: string, key: string, name: string) => ({
      name,
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: `${relay.origin.replace("127.0.0.1", host)}/good`,
          ANTHROPIC_AUTH_TOKEN: key,
        },
      },
    });
    const providers = {
      team: relayAt("127.0.0.1", RELAY_KEY, "Team Relay"),
      ...(input.extra ? { second: relayAt("localhost", "sk-e2e-second", "Second Relay") } : {}),
    };
    await mkdir(path.join(importHome, ".cc-switch"), { recursive: true });
    await writeFile(
      path.join(importHome, ".cc-switch", "config.json"),
      JSON.stringify({ claude: { providers } }),
    );
    await mkdir(path.join(importHome, ".local", "share", "opencode"), { recursive: true });
    await writeFile(
      path.join(importHome, ".local", "share", "opencode", "auth.json"),
      JSON.stringify({ deepseek: { type: "api", key: "sk-e2e-deepseek" } }),
    );
    // daemon 一分钟内只真读一次：导入窗口那种扫描会当场重读，提示照它算。
    await client.apiEndpointImportScan({ includeOpenCode: false });
  }

  test.afterEach(async () => {
    await rm(path.join(importHome, ".cc-switch"), { recursive: true, force: true });
    await rm(path.join(importHome, ".local", "share", "opencode"), {
      recursive: true,
      force: true,
    });
  });

  function prompt(page: Page): Locator {
    return page.getByTestId("api-endpoints-import-discovery").filter({ visible: true });
  }

  function importSheet(page: Page): Locator {
    return page.getByTestId("api-endpoint-import-sheet").filter({ visible: true });
  }

  function pickOf(page: Page, ref: string): Locator {
    return importSheet(page).getByTestId(`api-endpoint-import-item-${ref}-pick`);
  }

  test("says how many it found and in which apps; Review opens Import with only those picked", async ({
    page,
  }) => {
    await writeDiscoverySources({ extra: true });
    await openApiEndpointsPage(page);
    await expect(prompt(page)).toContainText("Found 2 local configurations");
    await expect(prompt(page)).toContainText("CC Switch");
    await expect(prompt(page)).not.toContainText(RELAY_KEY);
    await prompt(page).getByTestId("api-endpoints-import-discovery-review").click();
    await expect(importSheet(page)).toBeVisible();
    await expect(pickOf(page, "claude/team")).toBeChecked();
    await expect(pickOf(page, "claude/second")).toBeChecked();
    // OpenCode 不在提示里：从提示打开时不选上它。
    await expect(pickOf(page, "deepseek")).not.toBeChecked();
    await page.getByTestId("api-endpoint-import-submit").click();
    await expect(importSheet(page)).toHaveCount(0);
    await expect(page.getByText(/^Imported 2: /)).toBeVisible();
    // 都加上了：提示不再出现。
    await expect(prompt(page)).toHaveCount(0);
  });

  test("Review whose scan fails says why in the dialog and can be tried again", async ({
    page,
  }) => {
    await writeDiscoverySources({ extra: false });
    const scan = { fails: true };
    await answerImportRpc(page, {
      type: "provider.api_endpoint.import_scan",
      isAnswering: () => scan.fails,
      payload: {
        sources: [],
        error: { code: "endpoints_unparsable", message: "endpoints.json could not be parsed" },
      },
    });
    await openApiEndpointsPage(page);
    await expect(prompt(page)).toContainText("Found 1 local configuration");
    await prompt(page).getByTestId("api-endpoints-import-discovery-review").click();
    const failed = importSheet(page).getByTestId("api-endpoint-import-scan-error");
    await expect(failed).toContainText("endpoints.json could not be parsed");
    scan.fails = false;
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(pickOf(page, "claude/team")).toBeChecked();
  });

  test("Ignore hides that batch, also after reopening the page; a new one brings the prompt back", async ({
    page,
  }) => {
    await writeDiscoverySources({ extra: false });
    await openApiEndpointsPage(page);
    await expect(prompt(page)).toContainText("Found 1 local configuration");
    await prompt(page).getByTestId("api-endpoints-import-discovery-ignore").click();
    await expect(prompt(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("api-endpoints-list")).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);

    await writeDiscoverySources({ extra: true });
    await page.reload();
    await expect(prompt(page)).toContainText("Found 1 local configuration");
    await prompt(page).getByTestId("api-endpoints-import-discovery-review").click();
    await expect(pickOf(page, "claude/second")).toBeChecked();
    await expect(pickOf(page, "claude/team")).not.toBeChecked();
  });

  test("a failed Ignore keeps the prompt and says why in the app's words; trying again hides it", async ({
    page,
  }) => {
    await writeDiscoverySources({ extra: false });
    const ignore: { error: Record<string, unknown> | null } = {
      error: {
        code: "import_ignore_failed",
        params: { reason: "EACCES" },
        message: "Osuna couldn't save the ignored entries (EACCES)",
      },
    };
    await answerImportRpc(page, {
      type: "provider.api_endpoint.import_ignore",
      isAnswering: () => ignore.error !== null,
      payload: {
        get error() {
          return ignore.error;
        },
      },
    });
    await openApiEndpointsPage(page);
    const ignoreButton = prompt(page).getByTestId("api-endpoints-import-discovery-ignore");
    const error = prompt(page).getByTestId("api-endpoints-import-discovery-error");
    await ignoreButton.click();
    await expect(error).toHaveText("Couldn't ignore them (EACCES). Try again.");
    // 认不出的原因不露主机的英文。
    ignore.error = { code: "something_new", message: "a host sentence in English" };
    await ignoreButton.click();
    await expect(error).toHaveText("Couldn't ignore them. Try again.");
    ignore.error = null;
    await ignoreButton.click();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("at 390 the prompt reads in full and both buttons show", async ({ page }) => {
    await writeDiscoverySources({ extra: true });
    await openApiEndpointsPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(prompt(page)).toContainText("Found 2 local configurations");
    for (const id of ["review", "ignore"]) {
      const button = prompt(page).getByTestId(`api-endpoints-import-discovery-${id}`);
      await expect(button).toBeInViewport({ ratio: 1 });
    }
  });

  test("a host without apiEndpointManagement has no prompt", async ({ page }) => {
    await writeDiscoverySources({ extra: false });
    await hideManagementCapability(page);
    await openApiEndpointsPage(page);
    await expect(page.getByTestId("api-endpoints-list")).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("a prompt the host can't answer just isn't shown", async ({ page }) => {
    await writeDiscoverySources({ extra: false });
    await answerImportRpc(page, {
      type: "provider.api_endpoint.import_discovery",
      isAnswering: () => true,
      payload: {
        candidates: [],
        error: { code: "endpoints_unparsable", message: "endpoints.json could not be parsed" },
      },
    });
    await openApiEndpointsPage(page);
    await expect(page.getByTestId("api-endpoints-import-button")).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });
});

const ImportRequestSchema = z
  .object({
    message: z
      .object({
        picks: z.array(z.object({ fingerprint: z.string(), action: z.string() }).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();

/** 导入请求照常送到 daemon，只把第 index 条改成替换：它不和谁重名，daemon 会停在这一条（之前的照常加上）。 */
async function failImportPickAt(page: Page, index: number): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage((message) => {
      const isImport =
        typeof message === "string" && message.includes('"provider.api_endpoint.import.request"');
      if (!isImport) {
        server.send(message);
        return;
      }
      const request = ImportRequestSchema.parse(JSON.parse(message));
      const picks = request.message.picks.map((pick, at) =>
        at === index ? { ...pick, action: "replace" } : pick,
      );
      server.send(JSON.stringify({ ...request, message: { ...request.message, picks } }));
    });
  });
}

// 被省略号截断的文字：scrollWidth 比可见宽度大；多 1 像素是取整误差。
async function clippedTextsOf(locator: Locator): Promise<string[]> {
  return locator.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent ?? ""),
  );
}

// 按渲染出来的行切文字：逐字取位置，纵坐标变了就是新的一行；空白不算。
async function linesOf(locator: Locator): Promise<string[]> {
  return locator.evaluate((root) => {
    const lines: { top: number; text: string }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (let i = 0; i < text.length; i += 1) {
        if (/\s/.test(text[i])) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        const last = lines.at(-1);
        // 同一行里的字纵坐标差不过几像素，换行要差一整个行高。
        if (last && Math.abs(last.top - top) < 4) last.text += text[i];
        else lines.push({ top, text: text[i] });
      }
    }
    return lines.map((line) => line.text);
  });
}

async function boxOf(locator: Locator): Promise<{ y: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not laid out");
  return box;
}

test.describe("Balance", () => {
  // 测试 daemon 的封条只让 DeepSeek 的余额接口回这份文件里写的回复（JSON），绝不真的去问；没写的连不上。
  const fakeSites = path.join(cliHome, "fake-sites.json");
  const DEEPSEEK_BALANCE = "https://api.deepseek.com/user/balance";

  async function deepseekAnswers(status: number, body: unknown): Promise<void> {
    await writeFile(
      fakeSites,
      JSON.stringify({ [DEEPSEEK_BALANCE]: { status, body: JSON.stringify(body) } }),
    );
  }

  function balanceOf(total: string) {
    return { is_available: true, balance_infos: [{ currency: "CNY", total_balance: total }] };
  }

  test.afterEach(async () => {
    await rm(fakeSites, { force: true });
  });

  function seedDeepSeek(name: string): Promise<string> {
    return seedApiEndpoint(client, {
      name,
      baseUrls: [{ format: "openai_chat", url: "https://api.deepseek.com/v1" }],
      models: ["deepseek-chat"],
    });
  }

  function seedRelay(): Promise<string> {
    return seedApiEndpoint(client, {
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5"],
    });
  }

  function balanceSection(page: Page): Locator {
    return page.getByTestId("api-endpoint-balance-section").filter({ visible: true });
  }

  test("a row shows the balance it read, or that it is unavailable; a vendor with no known balance query adds nothing", async ({
    page,
  }) => {
    await deepseekAnswers(200, balanceOf("110.00"));
    const deepseek = await seedDeepSeek("DeepSeek");
    const relayOnly = await seedRelay();
    await openApiEndpointsPage(page);

    await expect(row(page, deepseek).getByTestId("api-endpoint-row-balance")).toHaveText(
      "Balance ¥110.00",
    );
    await expect(row(page, relayOnly).getByTestId("api-endpoint-row-balance")).toHaveCount(0);

    await deepseekAnswers(401, { error: { message: "Authentication Fails" } });
    // daemon 留着读数一分钟；保存这家后作废，重开页面才再问。
    await client.apiEndpointSave({
      provider: "claude",
      endpointId: deepseek,
      name: "DeepSeek",
      baseUrls: [{ format: "openai_chat", url: "https://api.deepseek.com/v1" }],
      models: [{ id: "deepseek-chat" }],
    });
    await page.reload();
    await expect(row(page, deepseek).getByTestId("api-endpoint-row-balance")).toHaveText(
      "Balance unavailable",
    );
  });

  /** 页面发出的一次读余额：读哪几家、算不算用户要求、是不是刷新。 */
  interface BalanceRead {
    endpointIds: string[];
    asked: boolean;
    force: boolean;
  }

  function recordBalanceReads(page: Page): BalanceRead[] {
    const reads: BalanceRead[] = [];
    page.on("websocket", (socket) =>
      socket.on("framesent", ({ payload }) => {
        if (typeof payload !== "string" || !payload.includes("read_balance.request")) return;
        const request = (
          JSON.parse(payload) as {
            message: { endpointIds: string[]; asked?: boolean; force?: boolean };
          }
        ).message;
        reads.push({
          endpointIds: request.endpointIds,
          asked: request.asked === true,
          force: request.force === true,
        });
      }),
    );
    return reads;
  }

  test("auto refresh on: the list reads its enabled endpoints when opened and every minute; off: only when a page is opened or Refresh is pressed", async ({
    page,
  }) => {
    await deepseekAnswers(200, balanceOf("110.00"));
    const on = await seedDeepSeek("DeepSeek");
    const off = await seedDeepSeek("DeepSeek off");
    await client.apiEndpointSetEndpointState({ endpointId: off, enabled: false });
    await page.clock.install();
    const reads = recordBalanceReads(page);
    await openApiEndpointsPage(page);

    const autoRefresh = page.getByTestId("api-endpoints-balance-auto-refresh-switch");
    await expect(autoRefresh).toBeChecked();
    await expect(row(page, on).getByTestId("api-endpoint-row-balance")).toHaveText(
      "Balance ¥110.00",
    );
    // 关着的接口不随列表读。
    await expect(row(page, off).getByTestId("api-endpoint-row-balance")).toHaveCount(0);
    expect(reads).toEqual([{ endpointIds: [on], asked: true, force: false }]);
    await page.clock.fastForward("01:00");
    await expect.poll(() => reads.length).toBe(2);
    expect(reads[1]).toEqual({ endpointIds: [on], asked: false, force: false });

    await autoRefresh.click();
    await expect(autoRefresh).not.toBeChecked();
    // 等存好、列表读回来：开关不再是灰的。
    await expect(autoRefresh).toBeEnabled();
    expect((await client.apiEndpointList("claude")).balanceAutoRefresh).toBe(false);
    await page.clock.fastForward("03:00");
    // 关着的接口的详情页：打开就读这家，点刷新强制重读；开着的时候不再每分钟读。
    await openEndpointRow(page, off);
    await expect.poll(() => reads.length).toBe(3);
    expect(reads[2]).toEqual({ endpointIds: [off], asked: true, force: false });
    await page.clock.fastForward("03:00");
    expect(reads).toHaveLength(3);
    await balanceSection(page).getByTestId("api-endpoint-balance-refresh").click();
    await expect.poll(() => reads.length).toBe(4);
    expect(reads[3]).toEqual({ endpointIds: [off], asked: true, force: true });

    // 回到列表再打开开关：列表恢复每分钟读一次。
    await page.goBack();
    await expect(page.getByTestId("api-endpoints-list")).toBeVisible();
    await autoRefresh.click();
    await expect(autoRefresh).toBeChecked();
    await expect(autoRefresh).toBeEnabled();
    const before = reads.length;
    await page.clock.fastForward("01:00");
    await expect.poll(() => reads.length).toBeGreaterThan(before);
    expect(reads.at(-1)).toEqual({ endpointIds: [on], asked: false, force: false });
  });

  test("the endpoint page shows each balance with when it was read, and Refresh reads again", async ({
    page,
  }) => {
    await deepseekAnswers(200, balanceOf("110.00"));
    const id = await seedDeepSeek("DeepSeek");
    await openEndpointDetail(page, id);

    const section = balanceSection(page);
    await expect(section).toContainText("Balance and plan usage");
    const item = section.getByTestId("api-endpoint-balance-item");
    await expect(item).toHaveText(/Balance.*¥110\.00/);
    await expect(section.getByTestId("api-endpoint-balance-read-at")).toHaveText("Read just now");

    await deepseekAnswers(200, balanceOf("98.50"));
    await section.getByTestId("api-endpoint-balance-refresh").click();
    await expect(item).toHaveText(/Balance.*¥98\.50/);
  });

  test("a temporary failure keeps showing the last reading, marked as last time's, on the page and the row", async ({
    page,
  }) => {
    await deepseekAnswers(200, balanceOf("110.00"));
    const id = await seedDeepSeek("DeepSeek");
    await openEndpointDetail(page, id);
    const section = balanceSection(page);
    await expect(section.getByTestId("api-endpoint-balance-read-at")).toHaveText("Read just now");

    await deepseekAnswers(503, { error: { message: "busy" } });
    await section.getByTestId("api-endpoint-balance-refresh").click();
    await expect(section.getByTestId("api-endpoint-balance-stale")).toHaveText(
      "Couldn't read just now · last read a moment ago",
    );
    await expect(section.getByTestId("api-endpoint-balance-item")).toHaveText(/Balance.*¥110\.00/);
    await expect(section.getByTestId("api-endpoint-balance-failure")).toHaveCount(0);

    await openApiEndpointsPage(page);
    await expect(row(page, id).getByTestId("api-endpoint-row-balance")).toHaveText(
      "Balance ¥110.00",
    );
  });

  test("a failed read says why on the endpoint page, with the vendor's own words and the key masked", async ({
    page,
  }) => {
    await deepseekAnswers(401, {
      error: { message: `Authentication Fails, Your api key: ${RELAY_KEY} is invalid` },
    });
    const id = await seedDeepSeek("DeepSeek");
    await openEndpointDetail(page, id);

    const failure = balanceSection(page).getByTestId("api-endpoint-balance-failure");
    await expect(failure.getByTestId("api-endpoint-balance-failure-reason")).toHaveText(
      "Token rejected: the vendor refused the key (HTTP 401)",
    );
    await expect(failure.getByTestId("api-endpoint-balance-failure-detail")).toHaveText(
      "Authentication Fails, Your api key: *** is invalid",
    );
  });

  test("a relay it cannot read says so, a DeepSeek endpoint with no key says it has none, and DeepSeek that cannot be reached is temporarily unavailable", async ({
    page,
  }) => {
    const relayOnly = await seedRelay();
    const keyless = await client.apiEndpointSave({
      provider: "claude",
      name: "DeepSeek no key",
      baseUrls: [{ format: "openai_chat", url: "https://api.deepseek.com/v1" }],
      models: [{ id: "deepseek-chat" }],
    });
    const keylessId = keyless.endpoint?.id ?? "";
    // 没写假回复：封条让它连不上。
    const unreachable = await seedDeepSeek("DeepSeek");

    await openEndpointDetail(page, relayOnly);
    await expect(balanceSection(page).getByTestId("api-endpoint-balance-unsupported")).toHaveText(
      "No known way to read this vendor's balance",
    );
    await openEndpointDetail(page, keylessId);
    await expect(balanceSection(page).getByTestId("api-endpoint-balance-unsupported")).toHaveText(
      "This endpoint has no key, so its balance can't be read",
    );
    await openEndpointDetail(page, unreachable);
    await expect(
      balanceSection(page).getByTestId("api-endpoint-balance-failure-reason"),
    ).toHaveText("Temporarily unavailable: try again later");
  });
  test("Check balance asks the form's unsaved address and field and shows the balance in place; a refused key says why", async ({
    page,
  }) => {
    const id = await seedRelay();
    await openEndpointDetail(page, id);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    await page
      .getByTestId("api-endpoint-connection-balance-url-input")
      .fill(`${relay.origin}/balance/usage`);
    await expect(page.getByTestId("api-endpoint-connection-balance-field-input")).toHaveAttribute(
      "placeholder",
      "data.balance",
    );
    await page.getByTestId("api-endpoint-connection-balance-field-input").fill("$data.left");
    const check = page.getByTestId("api-endpoint-connection-check-balance");
    const result = page.getByTestId("api-endpoint-connection-balance-result");

    await check.click();
    await expect(result).toHaveText("Balance $7.50");

    await page.getByTestId("api-endpoint-connection-api-key").fill("sk-wrong");
    await check.click();
    await expect(result).toContainText("Token rejected: the vendor refused the key (HTTP 401)");
    await expect(result).toContainText("Invalid API key");

    // 只看不存：取消后这家没有余额设置。
    await page.getByRole("button", { name: "Cancel" }).click();
    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints.find((endpoint) => endpoint.id === id)?.balance).toBeUndefined();
  });

  test("Detect URL fills in the balance URL it found and shows the balance; neither answering says why for each", async ({
    page,
  }) => {
    const id = await seedRelay();
    await openEndpointDetail(page, id);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    const detect = page.getByTestId("api-endpoint-connection-detect-balance-url");
    const result = page.getByTestId("api-endpoint-connection-detect-balance-result");

    // 假中转站没有 new-api 的 /api/usage/token，sub2api 的 /v1/usage 只给限额窗口：余额是剩得最少的 5 小时窗口。
    await detect.click();
    await expect(result).toContainText("Found a sub2api site; the Balance URL is filled in");
    await expect(result).toContainText("Balance $5.00");
    await expect(page.getByTestId("api-endpoint-connection-balance-url-input")).toHaveValue(
      `${relay.origin}/v1/usage`,
    );
    await expect(page.getByTestId("api-endpoint-connection-balance-field-input")).toHaveAttribute(
      "placeholder",
      "$remaining",
    );

    await page.getByTestId("api-endpoint-connection-api-key").fill("sk-wrong");
    await detect.click();
    await expect(result).toContainText(
      "Neither new-api's nor sub2api's balance query answered with a balance",
    );
    const attempts = result.getByTestId("api-endpoint-connection-detect-balance-attempt");
    await expect(attempts).toHaveCount(2);
    await expect(attempts.nth(0)).toContainText("/api/usage/token: Token rejected");
    await expect(attempts.nth(1)).toContainText("/v1/usage: Token rejected");
    await expect(attempts.nth(1)).toContainText("Invalid API key");

    // 只填不存：取消后这家没有余额设置。
    await page.getByRole("button", { name: "Cancel" }).click();
    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints.find((endpoint) => endpoint.id === id)?.balance).toBeUndefined();
  });

  test("an endpoint with no known balance query offers to fill in its balance URL, opening the editor at it", async ({
    page,
  }) => {
    const id = await seedRelay();
    await openEndpointDetail(page, id);
    await balanceSection(page).getByTestId("api-endpoint-balance-fill-url").click();
    const urlInput = page.getByTestId("api-endpoint-connection-balance-url-input");
    await expect(urlInput).toBeFocused();
    await urlInput.fill(`${relay.origin}/balance/usage`);
    await page.getByTestId("api-endpoint-connection-balance-field-input").fill("$data.left");
    await page.getByTestId("api-endpoint-connection-save").click();
    await expect(page.getByTestId("api-endpoint-connection-form")).toHaveCount(0);

    await balanceSection(page).getByTestId("api-endpoint-balance-refresh").click();
    await expect(balanceSection(page).getByTestId("api-endpoint-balance-item")).toHaveText(
      /Balance.*\$7\.50/,
    );
  });

  test("a token beside the key's own query offers the account query; Use … fills it, the missing user ID is said, and the account's balance shows once saved", async ({
    page,
  }) => {
    const id = await seedRelay();
    await openEndpointDetail(page, id);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    await page
      .getByTestId("api-endpoint-connection-balance-url-input")
      .fill(`${relay.origin}/api/usage/token`);
    await page.getByTestId("api-endpoint-connection-balance-token-input").fill(RELAY_ACCOUNT_TOKEN);
    const fix = page.getByTestId("api-endpoint-connection-balance-fix");
    await expect(fix).toContainText("…/api/usage/token takes the API key, not this token.");
    const useButtons = page.getByTestId("api-endpoint-connection-balance-use-url");
    await expect(useButtons).toHaveText([
      `Use ${relay.origin}/api/user/self`,
      `Use ${relay.origin}/api/v1/user/profile`,
    ]);

    await useButtons.first().click();
    await expect(page.getByTestId("api-endpoint-connection-balance-url-input")).toHaveValue(
      `${relay.origin}/api/user/self`,
    );
    await expect(page.getByTestId("api-endpoint-connection-balance-field-input")).toHaveAttribute(
      "placeholder",
      "$data.quota / 500000",
    );
    await expect(fix).toHaveText(
      "A new-api relay also wants your user ID (shown in the site's personal settings): fill in User ID below.",
    );

    // 没填用户 ID 就查：中转站拒绝，并说要补用户 ID。
    const check = page.getByTestId("api-endpoint-connection-check-balance");
    const result = page.getByTestId("api-endpoint-connection-balance-result");
    await check.click();
    await expect(result).toContainText("(HTTP 200)");
    await expect(result).toContainText("The relay wants your user ID");

    await page.getByTestId("api-endpoint-connection-balance-user-id-input").fill("42");
    await expect(fix).toHaveCount(0);
    await check.click();
    await expect(result).toHaveText("Balance $12.00");

    await page.getByTestId("api-endpoint-connection-save").click();
    await expect(page.getByTestId("api-endpoint-connection-form")).toHaveCount(0);
    const listed = (await client.apiEndpointList("claude")).endpoints.find(
      (endpoint) => endpoint.id === id,
    );
    expect(listed?.balance).toEqual({ url: `${relay.origin}/api/user/self`, userId: "42" });
    expect(listed?.balanceTokenMask).toBe("rela…0042");
    await balanceSection(page).getByTestId("api-endpoint-balance-refresh").click();
    await expect(balanceSection(page).getByTestId("api-endpoint-balance-item")).toHaveText(
      /Balance.*\$12\.00/,
    );

    // 再打开编辑：令牌打码，「显示」读回原文。
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    const token = page.getByTestId("api-endpoint-connection-balance-token-input");
    await expect(token).toHaveAttribute("placeholder", "Saved: rela…0042");
    await page.getByTestId("api-endpoint-connection-balance-token-show").click();
    await expect(token).toHaveValue(RELAY_ACCOUNT_TOKEN);
  });

  test("sub2api's key query shows its 5-hour, day and week windows with what is used of each", async ({
    page,
  }) => {
    const id = await seedRelay();
    const saved = await client.apiEndpointSave({
      provider: "claude",
      endpointId: id,
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: `${relay.origin}/good/v1` }],
      models: [{ id: "gpt-5" }],
      balance: { url: `${relay.origin}/v1/usage` },
    });
    expect(saved.error).toBeNull();
    await openEndpointDetail(page, id);

    // 没有 remaining：余额是剩得最少的窗口（5 小时还剩 $5）。
    await expect(balanceSection(page).getByTestId("api-endpoint-balance-item")).toHaveText(
      /Balance.*\$5\.00/,
    );
    const windows = balanceSection(page).getByTestId("api-endpoint-balance-windows");
    await expect(windows).toContainText("5 hours");
    await expect(windows).toContainText("$15.00 / $20.00 · 75%");
    await expect(windows).toContainText("1 day");
    await expect(windows).toContainText("$10.00 / $50.00 · 20%");
    await expect(windows).toContainText("7 days");
    await expect(windows).toContainText("$200.00 / $800.00 · 25%");
  });

  // 工单 08：GLM Coding Plan 的套餐窗口。重置时间从写回复这一刻算起，配速跟着真实时钟走。
  const GLM_QUOTA = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";

  async function glmAnswers(status: number, body: unknown): Promise<void> {
    await writeFile(
      fakeSites,
      JSON.stringify({ [GLM_QUOTA]: { status, body: JSON.stringify(body) } }),
    );
  }

  function glmQuota() {
    const inHours = (hours: number) => Date.now() + hours * 60 * 60 * 1000;
    return {
      code: 200,
      success: true,
      data: {
        level: "pro",
        limits: [
          { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 12, nextResetTime: inHours(2) },
          { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 40, nextResetTime: inHours(96) },
          { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 3, nextResetTime: inHours(240) },
        ],
      },
    };
  }

  function seedGlm(): Promise<string> {
    return seedApiEndpoint(client, {
      name: "GLM Coding",
      baseUrls: [{ format: "openai_chat", url: "https://open.bigmodel.cn/api/coding/paas/v4" }],
      models: ["glm-4.6"],
    });
  }

  test("a GLM Coding Plan key shows its windows with pace, the MCP month aside; used or left is one choice for the page and the row", async ({
    page,
  }) => {
    await glmAnswers(200, glmQuota());
    const id = await seedGlm();
    await openApiEndpointsPage(page);
    // 行上是剩得最少的窗口（7 天用了 40%），不是放一旁的 MCP 月度。
    await expect(row(page, id).getByTestId("api-endpoint-row-balance")).toHaveText(
      "7 days 40% used",
    );

    await openEndpointDetail(page, id);
    const section = balanceSection(page);
    const fiveHours = section.getByTestId("api-endpoint-balance-window-5h");
    // 5 小时窗口过了 3 小时（60%），只用了 12%：配速 −48%。
    await expect(fiveHours).toContainText("5 hours");
    await expect(fiveHours).toContainText("12%");
    await expect(fiveHours).toContainText("Pace −48%");
    await expect(section.getByTestId("api-endpoint-balance-window-7d")).toContainText("40%");
    const aside = section.getByTestId("api-endpoint-balance-windows-aside");
    await expect(aside).toContainText("Doesn't stop the models");
    await expect(aside).toContainText("MCP · Month");
    await expect(section.getByTestId("api-endpoint-balance-item")).toHaveCount(0);

    await section.getByTestId("api-endpoint-balance-display-remaining").click();
    await expect(fiveHours).toContainText("88% left");
    // 看剩余时配速的符号反过来。
    await expect(fiveHours).toContainText("Pace +48%");
    await openApiEndpointsPage(page);
    await expect(row(page, id).getByTestId("api-endpoint-row-balance")).toHaveText(
      "7 days 60% left",
    );
  });

  test("a GLM key it refuses says to paste a current one, with its console", async ({ page }) => {
    await glmAnswers(401, { error: { code: "1000", message: "Authentication failed" } });
    const id = await seedGlm();
    await openEndpointDetail(page, id);
    const failure = balanceSection(page).getByTestId("api-endpoint-balance-failure");
    await expect(failure.getByTestId("api-endpoint-balance-failure-reason")).toContainText(
      "(HTTP 401)",
    );
    await expect(failure.getByTestId("api-endpoint-balance-failure-hint")).toContainText(
      "This key has expired, was deleted, or is mistyped",
    );
    await expect(failure.getByTestId("api-endpoint-balance-failure-console")).toBeVisible();
  });

  // 工单 09：智谱团队套餐。个人的查询没有窗口，填了团队组织 ID 与项目 ID 才问团队的窗口与重置次数。
  async function glmTeamAnswers(): Promise<void> {
    const inHours = (hours: number) => Date.now() + hours * 60 * 60 * 1000;
    const team = {
      code: 200,
      success: true,
      data: {
        limits: [
          { type: "CREDIT_LIMIT", unit: 3, percentage: 20, nextResetTime: inHours(2) },
          { type: "CREDIT_LIMIT", unit: 6, number: 1, percentage: 50, nextResetTime: inHours(96) },
        ],
      },
    };
    const resets = {
      code: 200,
      success: true,
      data: {
        fiveHourResets: [
          { available: true, expireTime: inHours(48) },
          { available: true, expireTime: inHours(72) },
        ],
        weekResets: [{ available: true, expireTime: inHours(120) }],
      },
    };
    const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });
    await writeFile(
      fakeSites,
      JSON.stringify({
        [GLM_QUOTA]: reply({ code: 200, success: true, data: { limits: [] } }),
        [`${GLM_QUOTA}?type=2`]: reply(team),
        "https://open.bigmodel.cn/api/biz/customer-package-reset/list?targetType=TEAM":
          reply(resets),
      }),
    );
  }

  test("a GLM team's IDs are asked for at Zhipu's address only, both or neither; with them the team's windows and resets show", async ({
    page,
  }) => {
    await glmTeamAnswers();
    const relayId = await seedRelay();
    await openEndpointDetail(page, relayId);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    await expect(page.getByTestId("api-endpoint-connection-balance-url")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-balance-team-org")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();

    const id = await seedGlm();
    await openEndpointDetail(page, id);
    // 个人没有窗口、还没填团队 ID：什么都读不到。
    await expect(balanceSection(page).getByTestId("api-endpoint-balance-windows")).toHaveCount(0);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    await page.getByTestId("api-endpoint-connection-balance-team-org-input").fill("org-1");
    const both = page.getByTestId("api-endpoint-connection-balance-team-both");
    await expect(both).toHaveText("Team plan: give both the organization ID and the project ID");
    await expect(page.getByTestId("api-endpoint-connection-save")).toBeDisabled();
    await page.getByTestId("api-endpoint-connection-balance-team-project-input").fill("proj-1");
    await expect(both).toHaveCount(0);
    await page.getByTestId("api-endpoint-connection-save").click();
    await expect(page.getByTestId("api-endpoint-connection-form")).toHaveCount(0);
    const listed = (await client.apiEndpointList("claude")).endpoints.find(
      (endpoint) => endpoint.id === id,
    );
    expect(listed?.balance).toEqual({ teamOrgId: "org-1", teamProjectId: "proj-1" });

    const section = balanceSection(page);
    await section.getByTestId("api-endpoint-balance-refresh").click();
    await expect(section.getByTestId("api-endpoint-balance-team")).toHaveText("Team plan");
    await expect(section.getByTestId("api-endpoint-balance-window-5h")).toContainText("20%");
    await expect(section.getByTestId("api-endpoint-balance-window-7d")).toContainText("50%");
    await expect(section.getByTestId("api-endpoint-balance-resets-count")).toHaveText(
      "2 five-hour resets · 1 weekly reset left",
    );
    await expect(section.getByTestId("api-endpoint-balance-resets")).toContainText(
      "Soonest expires",
    );
    await openApiEndpointsPage(page);
    await expect(row(page, id).getByTestId("api-endpoint-row-balance")).toHaveText(
      "7 days 50% used",
    );
  });

  test("DeepSeek lists each currency and splits the granted from the topped up; OpenCode Zen says to read its console", async ({
    page,
  }) => {
    await deepseekAnswers(200, {
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "5.00",
          granted_balance: "0.00",
          topped_up_balance: "5.00",
        },
        {
          currency: "CNY",
          total_balance: "110.00",
          granted_balance: "10.00",
          topped_up_balance: "100.00",
        },
      ],
    });
    const deepseek = await seedDeepSeek("DeepSeek");
    const zen = await seedApiEndpoint(client, {
      name: "OpenCode Zen",
      baseUrls: [{ format: "openai_chat", url: "https://opencode.ai/zen/v1" }],
      models: ["kimi-k2"],
    });

    await openEndpointDetail(page, deepseek);
    const items = balanceSection(page).getByTestId("api-endpoint-balance-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText(/Balance.*¥110\.00 · \$5\.00/);
    await expect(items.nth(1)).toHaveText(/Granted.*¥10\.00/);
    await expect(items.nth(2)).toHaveText(/Topped up.*¥100\.00/);

    await openEndpointDetail(page, zen);
    const failure = balanceSection(page).getByTestId("api-endpoint-balance-failure");
    await expect(failure.getByTestId("api-endpoint-balance-failure-reason")).toHaveText(
      "This vendor doesn't offer a balance query",
    );
    await expect(failure.getByTestId("api-endpoint-balance-failure-hint")).toContainText(
      "Overview → Credits",
    );
    await expect(failure.getByTestId("api-endpoint-balance-failure-console")).toHaveText(
      "Open console ↗",
    );
  });

  // 工单 10：火山方舟与腾讯云 Token Plan 企业版的窗口要云账号密钥，问的是两家的开放平台（封条回假回复）。
  const VOLC_OPEN = "https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01";
  const TENCENT_OPEN = "https://tokenhub.tencentcloudapi.com/";

  async function openPlatformAnswers(): Promise<void> {
    const inHours = (hours: number) => Math.floor(Date.now() / 1000) + hours * 60 * 60;
    const volc = {
      Result: {
        QuotaUsage: [
          { Level: "session", Percent: 18, ResetTimestamp: inHours(3) },
          { Level: "weekly", Percent: 35, ResetTimestamp: inHours(100) },
          { Level: "monthly", Percent: 62, ResetTimestamp: inHours(400) },
        ],
      },
    };
    const cycleEnd = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString();
    const cycleStart = new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString();
    // 列表与套餐自己的查询都问同一个地址：清单里的套餐包就够读出月窗口。
    const tencent = {
      Response: {
        TokenPlanSet: [
          {
            TeamId: "team-1",
            Name: "Core",
            ProductType: "enterprise",
            // 用完了：照 magpie 在分区里写出停用与原因。
            Status: "exhausted",
            StopReason: "QUOTA_USED_UP",
            PackageInfo: { CycleQuota: "1000000", TotalUsed: "420000" },
            TokenSummary: { CycleStartTime: cycleStart, CycleEndTime: cycleEnd },
          },
        ],
      },
    };
    await writeFile(
      fakeSites,
      JSON.stringify({
        [VOLC_OPEN]: { status: 200, body: JSON.stringify(volc) },
        [TENCENT_OPEN]: { status: 200, body: JSON.stringify(tencent) },
      }),
    );
  }

  test("a Volcengine Ark plan with no access key says one is needed; Fill in AccessKey opens the two fields, both or neither, and then the windows show", async ({
    page,
  }) => {
    await openPlatformAnswers();
    const id = await seedApiEndpoint(client, {
      name: "Ark Coding",
      baseUrls: [{ format: "openai_chat", url: "https://ark.cn-beijing.volces.com/api/coding/v3" }],
      models: ["ark-code-latest"],
    });
    await openApiEndpointsPage(page);
    await expect(row(page, id).getByTestId("api-endpoint-row-balance")).toHaveText(
      "Needs AccessKey",
    );

    await openEndpointDetail(page, id);
    const section = balanceSection(page);
    await expect(section.getByTestId("api-endpoint-balance-needs-access-key")).toContainText(
      "AccessKey ID and Secret Access Key",
    );
    await section.getByTestId("api-endpoint-balance-fill-access-key").click();
    const idInput = page.getByTestId("api-endpoint-connection-access-key-id-input");
    await expect(idInput).toBeFocused();
    await expect(page.getByTestId("api-endpoint-connection-access-key-id")).toContainText(
      "AccessKey ID",
    );
    await idInput.fill("AKLTexample0001");
    const both = page.getByTestId("api-endpoint-connection-access-key-both");
    await expect(both).toHaveText("Give the Secret Access Key too");
    await expect(page.getByTestId("api-endpoint-connection-save")).toBeDisabled();
    await page.getByTestId("api-endpoint-connection-secret-access-key-input").fill("volc-secret");
    await expect(both).toHaveCount(0);
    await page.getByTestId("api-endpoint-connection-save").click();
    await expect(page.getByTestId("api-endpoint-connection-form")).toHaveCount(0);
    const listed = (await client.apiEndpointList("claude")).endpoints.find(
      (endpoint) => endpoint.id === id,
    );
    expect(listed?.accessKeyIdMask).toBe("AKLT…0001");
    expect(listed?.secretAccessKeyMask).toBeDefined();

    await section.getByTestId("api-endpoint-balance-refresh").click();
    await expect(section.getByTestId("api-endpoint-balance-window-5h")).toContainText("18%");
    await expect(section.getByTestId("api-endpoint-balance-window-7d")).toContainText("35%");
    await expect(section.getByTestId("api-endpoint-balance-window-month")).toContainText("62%");

    // 编辑窗口里两栏打码；「显示」读回原文。
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    const secretInput = page.getByTestId("api-endpoint-connection-secret-access-key-input");
    await expect(secretInput).toHaveAttribute("placeholder", /^Saved: /);
    await page.getByTestId("api-endpoint-connection-secret-access-key-show").click();
    await expect(secretInput).toHaveValue("volc-secret");
  });

  test("a Tencent Cloud Token Plan Enterprise asks for the SecretId and SecretKey, then shows its month in credits; elsewhere there are no such fields", async ({
    page,
  }) => {
    await openPlatformAnswers();
    const relayId = await seedRelay();
    await openEndpointDetail(page, relayId);
    await page.getByTestId("api-endpoint-edit-connection").filter({ visible: true }).click();
    await page.getByTestId("api-endpoint-connection-advanced-toggle").click();
    await expect(page.getByTestId("api-endpoint-connection-balance-url")).toBeVisible();
    await expect(page.getByTestId("api-endpoint-connection-access-key-id")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();

    const id = await seedApiEndpoint(client, {
      name: "Token Plan",
      baseUrls: [{ format: "openai_chat", url: "https://tokenhub.tencentmaas.com/plan/v3" }],
      models: ["auto"],
    });
    await openEndpointDetail(page, id);
    const section = balanceSection(page);
    await expect(section.getByTestId("api-endpoint-balance-needs-access-key")).toContainText(
      "SecretId and SecretKey",
    );
    await section.getByTestId("api-endpoint-balance-fill-access-key").click();
    await expect(page.getByTestId("api-endpoint-connection-access-key-id")).toContainText(
      "SecretId",
    );
    await page.getByTestId("api-endpoint-connection-access-key-id-input").fill("AKIDexample");
    await page.getByTestId("api-endpoint-connection-secret-access-key-input").fill("tc-secret");
    await page.getByTestId("api-endpoint-connection-save").click();
    await expect(page.getByTestId("api-endpoint-connection-form")).toHaveCount(0);
    await section.getByTestId("api-endpoint-balance-refresh").click();
    const month = section.getByTestId("api-endpoint-balance-window-month");
    await expect(month).toContainText("Month");
    await expect(month).toContainText("420,000 / 1,000,000 credits");
    await expect(section.getByTestId("api-endpoint-balance-plan-stopped")).toHaveText(
      "Plan stopped: exhausted, QUOTA_USED_UP",
    );
  });
});
