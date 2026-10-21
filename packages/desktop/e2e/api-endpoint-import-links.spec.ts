import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../../app/e2e/support/fixtures";
import {
  answerImportRpc,
  connectApiEndpointClient,
  hideManagementCapability,
  openApiEndpointsPage,
  RELAY_KEY,
  resetApiEndpoints,
  seedApiEndpoint,
  startFakeRelay,
  type FakeRelay,
} from "../../app/e2e/support/helpers/api-endpoints";
import { getServerId } from "../../app/e2e/support/helpers/server-id";

// 只有桌面端收导入链接（paseo://import），用例要装桌面端的桥，所以放在桌面端测试里。
// daemon 读写的 CLI 配置、进程表、系统代理与别的软件的目录都指到临时目录，绝不碰开发者真实的。
const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-import-links-"));
test.use({
  e2eDaemonEnvironment: {
    CLAUDE_CONFIG_DIR: path.join(cliHome, "claude"),
    CODEX_HOME: path.join(cliHome, "codex"),
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_PROCESS_TABLE_PATH: path.join(cliHome, "process-table.txt"),
    PASEO_E2E_SYSTEM_PROXY_PATH: path.join(cliHome, "system-proxy.json"),
    // 导入链接的图片只经封条的假外网（这份文件里写了的网址才有回复），绝不上网。
    PASEO_E2E_FAKE_SITES_PATH: path.join(cliHome, "fake-sites.json"),
    HOME: path.join(cliHome, "import-home"),
    XDG_CONFIG_HOME: path.join(cliHome, "import-home", ".config"),
    XDG_DATA_HOME: path.join(cliHome, "import-home", ".local", "share"),
  },
});

let relay: FakeRelay;
let client: Awaited<ReturnType<typeof connectApiEndpointClient>>;

test.beforeEach(async ({ page }) => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
  await resetApiEndpoints(client);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(async () => {
  await resetApiEndpoints(client);
  await client.close();
  await relay.close();
});

function row(page: Page, endpointId: string): Locator {
  return page.getByTestId(`api-endpoint-row-${endpointId}`).filter({ visible: true });
}

test.describe("Import links", () => {
  /**
   * 桌面端的桥（只有它收导入链接）：主进程把链接交给窗口时发 import-link 事件。用例里派发
   * 「e2e-import-link」就当主进程交来了一条。本机 daemon 就是 e2e 的那台，不由桌面端管。
   */
  async function installDesktopLinkBridge(page: Page): Promise<void> {
    await page.addInitScript((localServerId) => {
      const handlers: ((payload: unknown) => void)[] = [];
      window.addEventListener("e2e-import-link", (event) => {
        const link = event instanceof CustomEvent ? event.detail : null;
        for (const handler of handlers) handler(link);
      });
      Object.assign(window, {
        paseoDesktop: {
          platform: "darwin",
          invoke: async (command: string) => {
            if (command === "desktop_daemon_status") {
              return {
                serverId: localServerId,
                status: "running",
                listen: null,
                hostname: null,
                pid: null,
                home: "",
                version: null,
                desktopManaged: true,
                error: null,
              };
            }
            if (command === "desktop_daemon_logs") return { logPath: "", contents: "" };
            if (command === "get_desktop_settings") {
              return {
                releaseChannel: "stable",
                daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
              };
            }
            return null;
          },
          getPendingOpenProject: async () => null,
          importLinks: { ready: async () => null },
          events: {
            on: async (event: string, handler: (payload: unknown) => void) => {
              if (event === "import-link") handlers.push(handler);
              return () => undefined;
            },
          },
          opener: { openUrl: async () => undefined },
        },
      });
    }, getServerId());
  }

  async function openLink(page: Page, link: string): Promise<void> {
    await page.evaluate((value) => {
      window.dispatchEvent(new CustomEvent("e2e-import-link", { detail: value }));
    }, link);
  }

  function linkSheet(page: Page): Locator {
    return page.getByTestId("api-endpoint-import-link-sheet").filter({ visible: true });
  }

  function relayLink(input: { name: string; id?: string }): string {
    const params = new URLSearchParams({
      name: input.name,
      chat: `${relay.origin}/good/v1`,
      anthropic: `${relay.origin}/good`,
      key: RELAY_KEY,
      models: "relay-a,relay-b",
    });
    if (input.id) params.set("id", input.id);
    return `paseo://import?${params.toString()}`;
  }

  test.beforeEach(async ({ page }) => {
    await installDesktopLinkBridge(page);
  });

  test("a link asks first: it names where the prompts and the key go, the name and key can be changed, and Add adds it", async ({
    page,
  }) => {
    await openApiEndpointsPage(page);
    await openLink(page, relayLink({ name: "Link Relay" }));
    const sheet = linkSheet(page);
    const relayHost = new URL(relay.origin).host;
    await expect(sheet.getByTestId("api-endpoint-import-link-risk")).toContainText(
      `Your prompts and this key will go to ${relayHost}`,
    );
    await expect(sheet).toContainText("relay-a, relay-b");
    // 链接自己不存东西：确认之前什么都没加。
    expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(0);
    await sheet.getByTestId("api-endpoint-import-link-name").fill("My Link Relay");
    await sheet.getByTestId("api-endpoint-import-link-key").fill("sk-e2e-mine");
    await sheet.getByTestId("api-endpoint-import-link-add").click();
    await expect(page.getByText("My Link Relay added")).toBeVisible();
    await expect(linkSheet(page)).toHaveCount(0);
    const listed = (await client.apiEndpointList("claude")).endpoints;
    expect(listed.map((endpoint) => endpoint.name)).toEqual(["My Link Relay"]);
    const added = listed[0];
    if (!added) throw new Error("Expected the added endpoint");
    await expect(row(page, added.id)).toBeVisible();
    expect((await client.apiEndpointRevealKey(added.id)).apiKey).toBe("sk-e2e-mine");
  });

  test("icon= shows up in the dialog once the host has fetched it, and the added endpoint keeps it", async ({
    page,
  }) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="#2a6" d="M0 0h1v1H0z"/></svg>';
    const fakeSites = path.join(cliHome, "fake-sites.json");
    await writeFile(
      fakeSites,
      JSON.stringify({ "https://brand.example/logo.svg": { status: 200, body: svg } }),
    );
    try {
      await openApiEndpointsPage(page);
      const params = new URLSearchParams({
        name: "Brand Relay",
        chat: `${relay.origin}/good/v1`,
        key: RELAY_KEY,
        icon: "https://brand.example/logo.svg",
      });
      await openLink(page, `paseo://import?${params.toString()}`);
      const icon = page.getByTestId("api-endpoint-import-link-icon").filter({ visible: true });
      await expect(icon.locator("img")).toHaveCount(1);
      await page.getByTestId("api-endpoint-import-link-add").filter({ visible: true }).click();
      await expect(page.getByText("Brand Relay added")).toBeVisible();
      const [added] = (await client.apiEndpointList("claude")).endpoints;
      expect(added?.icon).toMatch(/^file:[0-9a-f]{16}\.svg$/);
    } finally {
      await rm(fakeSites, { force: true });
    }
  });

  test("Cancel adds nothing", async ({ page }) => {
    await openApiEndpointsPage(page);
    await openLink(page, relayLink({ name: "Link Relay" }));
    await linkSheet(page).getByTestId("api-endpoint-import-link-cancel").click();
    await expect(linkSheet(page)).toHaveCount(0);
    expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(0);
  });

  test("a link that would replace an endpoint says so, and Replace keeps its place", async ({
    page,
  }) => {
    const existingId = await seedApiEndpoint(client, {
      name: "Link Relay",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["old-model"],
      apiKey: "sk-e2e-old",
    });
    await openApiEndpointsPage(page);
    await openLink(page, relayLink({ name: "Link Relay" }));
    const sheet = linkSheet(page);
    await expect(sheet.getByTestId("api-endpoint-import-link-replaces")).toContainText(
      "Replaces your Link Relay, key and all.",
    );
    await sheet.getByTestId("api-endpoint-import-link-add").filter({ hasText: "Replace" }).click();
    await expect(linkSheet(page)).toHaveCount(0);
    const listed = (await client.apiEndpointList("claude")).endpoints;
    expect(listed.map((endpoint) => endpoint.id)).toEqual([existingId]);
    expect(listed[0]?.models.map((model) => model.id)).toEqual(["relay-a", "relay-b"]);
    expect((await client.apiEndpointRevealKey(existingId)).apiKey).toBe(RELAY_KEY);
  });

  test("an unsafe link is refused with the reason, and nothing is added", async ({ page }) => {
    await openApiEndpointsPage(page);
    await openLink(page, "paseo://import?name=Evil&chat=http://relay.example/v1&key=sk-e2e-evil");
    const refused = linkSheet(page).getByTestId("api-endpoint-import-link-refused");
    await expect(refused).toContainText(
      "This link can't be imported. Its OpenAI Chat base URL must use https.",
    );
    await expect(linkSheet(page).getByTestId("api-endpoint-import-link-add")).toHaveCount(0);
    await linkSheet(page).getByTestId("api-endpoint-import-link-close").click();
    await expect(linkSheet(page)).toHaveCount(0);
    expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(0);
  });

  test("an Add the host turns down stays in the dialog and says why", async ({ page }) => {
    await answerImportRpc(page, {
      type: "provider.api_endpoint.import_link",
      isAnswering: () => true,
      payload: {
        endpoint: null,
        error: { code: "endpoints_unparsable", message: "endpoints.json could not be parsed" },
      },
    });
    await openApiEndpointsPage(page);
    await openLink(page, relayLink({ name: "Link Relay" }));
    await linkSheet(page).getByTestId("api-endpoint-import-link-add").click();
    await expect(linkSheet(page).getByTestId("api-endpoint-import-link-error")).toHaveText(
      "The host's endpoints file can't be read, so nothing was added.",
    );
    await expect(linkSheet(page).getByTestId("api-endpoint-import-link-name")).toHaveValue(
      "Link Relay",
    );
  });

  test("at 390 the warning reads in full and Add is not covered", async ({ page }) => {
    await openApiEndpointsPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openLink(page, relayLink({ name: "Link Relay" }));
    // 窄窗口里确认框是底部弹层：按可见的那一份找。
    const risk = page.getByTestId("api-endpoint-import-link-risk").filter({ visible: true });
    await expect(risk).toBeInViewport({ ratio: 1 });
    await expect(risk).toContainText("Add it only if you trust the site that sent you here.");
    const add = page.getByTestId("api-endpoint-import-link-add").filter({ visible: true });
    await expect(add).toBeInViewport({ ratio: 1 });
  });

  test("a host without apiEndpointManagement asks for an update", async ({ page }) => {
    await hideManagementCapability(page);
    await openApiEndpointsPage(page);
    await openLink(page, relayLink({ name: "Link Relay" }));
    await expect(linkSheet(page).getByTestId("api-endpoint-import-link-update-host")).toContainText(
      "Update the host, then open the link again.",
    );
    expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(0);
  });
});
