import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker-constants";
import { expect, test, type Page } from "../support/fixtures";
import {
  connectApiEndpointClient,
  GOOD_REPLY_TOKENS,
  GOOD_RESPONSES_TOKENS,
  resetApiEndpoints,
  seedApiEndpoint,
  sendCodexThroughGateway,
  sendThroughGateway,
  startFakeRelay,
  type FakeRelay,
} from "../support/helpers/api-endpoints";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import {
  openUsageHostFilter,
  openUsagePage,
  openUsagePageFromShell,
  waitForUsageTotal,
} from "../support/helpers/usage-page";

/*
 * 用量页按接口分（任务 10-16-gateway-ledger-usage 工单 01–03）：真实 daemon 读用量夹具的会话记录，
 * 再像 Claude Code 那样经真实中转站问本机的假中转服务一次，中转站把这次记进账。
 */
const fixtures = createUsageFixtureRoots("paseo-usage-endpoints-");
const cliHome = fixtures.root;

// 打开 Claude Code 的总开关会改写 CLI 自己的配置：全都指到夹具的临时目录，绝不碰开发者的。
test.use({
  e2eDaemonEnvironment: {
    ...fixtures.environment,
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_PROCESS_TABLE_PATH: path.join(cliHome, "process-table.txt"),
    PASEO_E2E_SYSTEM_PROXY_PATH: path.join(cliHome, "system-proxy.json"),
    PASEO_E2E_FAKE_SITES_PATH: path.join(cliHome, "fake-sites.json"),
    HOME: path.join(cliHome, "home"),
    XDG_CONFIG_HOME: path.join(cliHome, "home", ".config"),
    XDG_DATA_HOME: path.join(cliHome, "home", ".local", "share"),
  },
});

/** 夹具会话记录的 token 总数（usage-page.spec.ts 同一份），加上经中转站的那一次。 */
const FIXTURE_TOKENS = 180_248;
const ALL_TOKENS = (FIXTURE_TOKENS + GOOD_REPLY_TOKENS).toLocaleString("en");

let relay: FakeRelay;
let client: Awaited<ReturnType<typeof connectApiEndpointClient>>;

test.beforeAll(async () => {
  relay = await startFakeRelay();
  client = await connectApiEndpointClient();
});

test.afterAll(async () => {
  await resetApiEndpoints(client);
  await client.close();
  await relay.close();
});

/** 从 server_info 去掉 gatewayLedger，模拟没有中转站账本的旧 daemon。 */
async function hideGatewayLedger(page: Page): Promise<void> {
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
        delete payload.features.gatewayLedger;
      }
      ws.send(JSON.stringify(envelope));
    });
  });
}

test.describe("Usage page by endpoint", () => {
  test("the Endpoints split shows Official and the endpoint, and a card narrows the page to it", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Relay Alpha",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-sonnet-4-5"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(await sendThroughGateway("claude-sonnet-4-5")).toBe(200);

    await openUsagePage(page);
    await waitForUsageTotal(page, ALL_TOKENS);

    await test.step("the split shows Official and the endpoint with tokens, cost and share", async () => {
      await page.getByTestId("usage-breakdown-endpoints").click();
      const official = page.getByTestId("usage-endpoint-card-official");
      await expect(official).toContainText("Official");
      await expect(official).toContainText("180.2K · $");
      const endpoint = page.getByTestId(`usage-endpoint-card-${endpointId}`);
      await expect(endpoint).toContainText("Relay Alpha");
      await expect(endpoint).toContainText(`${GOOD_REPLY_TOKENS} · $`);
      await expect(endpoint).toContainText("0.08%");
    });

    await test.step("a card narrows the page to that endpoint, and again widens it back", async () => {
      const endpoint = page.getByTestId(`usage-endpoint-card-${endpointId}`);
      await endpoint.click();
      await waitForUsageTotal(page, String(GOOD_REPLY_TOKENS));
      // 别家的卡片还在，好换过去。
      await expect(page.getByTestId("usage-endpoint-card-official")).toBeVisible();
      await page.getByTestId("usage-endpoint-card-official").click();
      await waitForUsageTotal(page, FIXTURE_TOKENS.toLocaleString("en"));
      await page.getByTestId("usage-endpoint-card-official").click();
      await waitForUsageTotal(page, ALL_TOKENS);
    });

    await test.step("back on Sources the source cards return", async () => {
      await page.getByTestId("usage-breakdown-sources").click();
      await expect(page.getByTestId("usage-source-card-claude")).toBeVisible();
      await expect(page.getByTestId("usage-endpoint-cards")).toHaveCount(0);
    });
  });

  test("Codex's gateway usage is on its endpoint's card, and requests no log names are the unknown project", async ({
    page,
  }) => {
    const endpointId = await seedApiEndpoint(client, {
      name: "Relay Beta",
      baseUrls: [{ format: "openai_responses", url: `${relay.origin}/good/v1` }],
      models: ["gpt-5.5"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });
    expect(await sendCodexThroughGateway("gpt-5.5")).toBe(200);

    await openUsagePage(page);

    await test.step("the endpoint's card counts the Codex request", async () => {
      await page.getByTestId("usage-breakdown-endpoints").click();
      const endpoint = page.getByTestId(`usage-endpoint-card-${endpointId}`);
      await expect(endpoint).toContainText("Relay Beta", { timeout: 30_000 });
      await expect(endpoint).toContainText(`${GOOD_RESPONSES_TOKENS} · $`);
    });

    await test.step("the Projects tab has the unknown project row, with no directory", async () => {
      await page.getByTestId("usage-details-tab-projects").click();
      const unknown = page.getByTestId(/^usage-details-project-.+:$/);
      await expect(unknown).toContainText("Unknown project");
      await expect(unknown).toContainText("Gateway requests not found in session logs");
      await expect(unknown).not.toContainText("Directory");
    });
  });

  test("a renamed endpoint shows its new name and balance; a deleted one keeps its usage, marked deleted, with no balance", async ({
    page,
  }) => {
    const renamedId = await seedApiEndpoint(client, {
      name: "Relay Gamma",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-gamma-1"],
    });
    const balance = { url: `${relay.origin}/balance/usage`, field: "$data.left" };
    const withBalance = await client.apiEndpointSave({
      provider: "claude",
      endpointId: renamedId,
      name: "Relay Gamma",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: [{ id: "claude-gamma-1" }],
      balance,
    });
    expect(withBalance.error).toBeNull();
    const deletedId = await seedApiEndpoint(client, {
      name: "Relay Delta",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-delta-1"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(await sendThroughGateway("claude-gamma-1")).toBe(200);
    expect(await sendThroughGateway("claude-delta-1")).toBe(200);
    await client.apiEndpointSave({
      provider: "claude",
      endpointId: renamedId,
      name: "Relay Gamma Prime",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: [{ id: "claude-gamma-1" }],
    });
    await client.apiEndpointDelete("claude", deletedId);

    await openUsagePage(page);
    await page.getByTestId("usage-breakdown-endpoints").click();

    await test.step("the renamed endpoint is one card under its new name, with its balance", async () => {
      const renamed = page.getByTestId(`usage-endpoint-card-${renamedId}`);
      await expect(renamed).toContainText("Relay Gamma Prime", { timeout: 30_000 });
      await expect(renamed).toContainText(`${GOOD_REPLY_TOKENS} · $`);
      await expect(page.getByTestId(`usage-endpoint-balance-${renamedId}`)).toHaveText(
        "Balance $7.50",
      );
    });

    await test.step("the deleted endpoint keeps its tokens, says so, and reads no balance", async () => {
      const deleted = page.getByTestId(`usage-endpoint-card-${deletedId}`);
      await expect(deleted).toContainText("Relay Delta");
      await expect(deleted).toContainText("(deleted)");
      await expect(deleted).toContainText(`${GOOD_REPLY_TOKENS} · $`);
      await expect(page.getByTestId(`usage-endpoint-balance-${deletedId}`)).toHaveCount(0);
    });

    await test.step("an endpoint whose balance can't be read has no balance line", async () => {
      const official = page.getByTestId("usage-endpoint-card-official");
      await expect(official).toBeVisible();
      await expect(official.getByTestId(/^usage-endpoint-balance-/)).toHaveCount(0);
    });
  });

  test("endpoints of one name on two hosts are one card; picking a host splits them", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const primaryId = await seedApiEndpoint(client, {
      name: "Relay Shared",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/good` }],
      models: ["claude-shared-1"],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(await sendThroughGateway("claude-shared-1")).toBe(200);

    const secondaryServerId = `srv_usage_ep_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const secondary = await seedSecondaryHost();
    const secondaryDaemon = await startIsolatedHostDaemon(secondaryServerId, {
      paseoHome: secondary.paseoHome,
      environment: secondary.environment,
    });
    try {
      await openUsagePage(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: "Secondary box",
        port: secondaryDaemon.port,
        primaryLabel: "Primary box",
      });
      await openUsagePageFromShell(page);
      await page.getByTestId("usage-breakdown-endpoints").click();

      const shared = page.getByTestId(`usage-endpoint-card-${primaryId}`);
      await test.step("both hosts' usage is on the one card", async () => {
        await expect(shared).toContainText("Relay Shared", { timeout: 60_000 });
        await expect(shared).toContainText(`${SHARED_CARD_TOKENS} · $`, { timeout: 60_000 });
        await expect(page.getByTestId(`usage-endpoint-card-${SECONDARY_ENDPOINT_ID}`)).toHaveCount(
          0,
        );
        await shared.click();
        await waitForUsageTotal(page, SHARED_TOTAL_TOKENS);
      });

      await test.step("picking the other host shows its own endpoint alone", async () => {
        await shared.click();
        await openUsageHostFilter(page);
        await page.getByTestId(`usage-host-filter-item-${secondaryDaemon.serverId}`).click();
        const own = page.getByTestId(`usage-endpoint-card-${SECONDARY_ENDPOINT_ID}`);
        await expect(own).toContainText("Relay Shared", { timeout: 30_000 });
        await expect(own).toContainText(`${SECONDARY_TOKENS} · $`);
        await openUsageHostFilter(page);
        await page.getByTestId(`usage-host-filter-item-${ALL_HOSTS_OPTION_ID}`).click();
        await expect(shared).toContainText(`${SHARED_CARD_TOKENS} · $`);
      });
    } finally {
      await secondaryDaemon.close();
    }
  });

  test("a daemon without the gateway ledger shows no Endpoints split", async ({ page }) => {
    await hideGatewayLedger(page);
    await openUsagePage(page);
    await expect(page.getByTestId("usage-source-card-claude")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("usage-breakdown")).toHaveCount(0);
  });
});

const SECONDARY_ENDPOINT_ID = "ep_secondary_shared";
/** What the second host's ledger booked at its "Relay Shared"; with the primary's request it makes 1,000. */
const SECONDARY_TOKENS = 1_000 - GOOD_REPLY_TOKENS;
const SHARED_TOTAL_TOKENS = "1,000";
const SHARED_CARD_TOKENS = "1.0K";

/**
 * A second host's home: an endpoint named like the primary's, and the usage its
 * gateway booked there as the daemon stores it (one 15-minute row), so no CLI or
 * relay has to run on it. Its CLI log roots are empty temp dirs.
 */
async function seedSecondaryHost(): Promise<{
  paseoHome: string;
  environment: Record<string, string>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-usage-endpoints-secondary-"));
  const paseoHome = path.join(root, "home");
  await mkdir(path.join(paseoHome, "api-endpoints"), { recursive: true });
  await mkdir(path.join(paseoHome, "usage"), { recursive: true });
  await writeFile(
    path.join(paseoHome, "api-endpoints", "endpoints.json"),
    JSON.stringify({
      endpoints: [
        {
          id: SECONDARY_ENDPOINT_ID,
          slug: "relay-shared",
          name: "Relay Shared",
          baseUrls: [{ format: "anthropic_messages", url: "http://127.0.0.1:9" }],
          models: [{ id: "claude-shared-1" }],
          enabled: false,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      agents: {},
    }),
    { mode: 0o600 },
  );
  const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  at.setUTCHours(10, 0, 0, 0);
  const bucket = {
    cli: "claude",
    backend: null,
    model: "claude-shared-1",
    sessionId: "",
    cwd: "",
    bucket: at.toISOString(),
    input: SECONDARY_TOKENS,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    turns: 0,
    durationMs: 0,
    endpointId: SECONDARY_ENDPOINT_ID,
  };
  await writeFile(
    path.join(paseoHome, "usage", `buckets-${at.toISOString().slice(0, 7)}.jsonl`),
    `${JSON.stringify(bucket)}\n`,
  );
  const empty = path.join(root, "cli");
  return {
    paseoHome,
    environment: {
      HOME: path.join(root, "user"),
      CLAUDE_CONFIG_DIR: path.join(empty, "claude"),
      CODEX_HOME: path.join(empty, "codex"),
      PI_CODING_AGENT_SESSION_DIR: path.join(empty, "pi"),
      PI_CODING_AGENT_DIR: path.join(empty, "omp"),
      PASEO_USAGE_PRICING_AUTO_UPDATE: "0",
      PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(root, "managed"),
    },
  };
}
