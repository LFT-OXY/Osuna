import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { ProviderMentionDefaults } from "@osuna/protocol/provider-config";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { gotoAppShell, openSettings } from "./app";
import { connectDaemonClient } from "./daemon-client-loader";
import { daemonWsRoutePattern } from "./daemon-port";
import { expectAppRoute } from "./route-assertions";
import { getServerId } from "./server-id";
import { openSettingsHost } from "./settings";

type MentionDefaultsField = keyof ProviderMentionDefaults;

interface MentionDefaultsDaemonClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(): Promise<{
    config: {
      mcp: { injectIntoAgents: boolean };
      providers: Record<string, { mentionDefaults?: ProviderMentionDefaults }>;
    };
  }>;
  patchDaemonConfig(config: {
    mcp?: { injectIntoAgents: boolean };
    providers?: Record<string, Record<string, unknown>>;
    removeProviders?: string[];
  }): Promise<unknown>;
  getProvidersSnapshot(input: {
    cwd?: string;
  }): Promise<{ entries: { provider: string; status: string }[] }>;
}

async function withClient<T>(run: (client: MentionDefaultsDaemonClient) => Promise<T>): Promise<T> {
  const client = await connectDaemonClient<MentionDefaultsDaemonClient>({
    clientIdPrefix: "mention-defaults-e2e",
  });
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * 注册一个自定义 ACP provider，目录里有两个模型、一组思考档位和两个模式；删除时它的配置
 * （含 Mention defaults）一并清掉。dev 的 `mock` provider 不在内置 id 里，daemon 拒绝为它保存
 * `providers.mock.*`，所以卡片的保存路径用它来测。
 */
export const THINKING_MODES_PROVIDER = { id: "mention-acp", label: "Mention ACP" } as const;

export async function installThinkingModesProvider(): Promise<{ remove(): Promise<void> }> {
  await withClient(async (client) => {
    await client.patchDaemonConfig({
      providers: {
        [THINKING_MODES_PROVIDER.id]: {
          extends: "acp",
          label: THINKING_MODES_PROVIDER.label,
          enabled: true,
          command: [
            process.execPath,
            path.resolve(__dirname, "../fixtures/thinking-modes-acp.cjs"),
          ],
        },
      },
    });
    await expect
      .poll(
        async () =>
          (await client.getProvidersSnapshot({})).entries.find(
            (entry) => entry.provider === THINKING_MODES_PROVIDER.id,
          )?.status,
        { timeout: 30_000 },
      )
      .toBe("ready");
  });
  return {
    remove: () =>
      withClient((client) =>
        client.patchDaemonConfig({ removeProviders: [THINKING_MODES_PROVIDER.id] }),
      ).then(() => undefined),
  };
}

/** 写入一个 provider 的 Mention defaults（整体替换）。 */
export async function writeMentionDefaults(
  provider: string,
  mentionDefaults: ProviderMentionDefaults,
): Promise<void> {
  await withClient((client) =>
    client.patchDaemonConfig({ providers: { [provider]: { mentionDefaults } } }),
  );
}

export async function readMentionDefaults(
  provider: string,
): Promise<ProviderMentionDefaults | undefined> {
  return withClient(async (client) => {
    const { config } = await client.getDaemonConfig();
    return config.providers[provider]?.mentionDefaults;
  });
}

export async function expectStoredMentionDefaults(
  provider: string,
  expected: ProviderMentionDefaults,
): Promise<void> {
  await expect.poll(async () => (await readMentionDefaults(provider)) ?? {}).toEqual(expected);
}

/** 关掉 Osuna tools 注入跑完 `run`，结束后恢复原值。 */
export async function withOsunaToolsOff<T>(run: () => Promise<T>): Promise<T> {
  const previous = await withClient(async (client) => {
    const { config } = await client.getDaemonConfig();
    await client.patchDaemonConfig({ mcp: { injectIntoAgents: false } });
    return config.mcp.injectIntoAgents;
  });
  try {
    return await run();
  } finally {
    await withClient((client) =>
      client.patchDaemonConfig({ mcp: { injectIntoAgents: previous } }),
    ).catch(() => undefined);
  }
}

export async function openMentionDefaultsSettings(page: Page): Promise<void> {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await expectAppRoute(page, buildSettingsHostSectionRoute(serverId, "agents"));
  await expect(page.getByTestId("mention-defaults-section")).toBeVisible({ timeout: 30_000 });
}

export function mentionDefaultsSummary(page: Page, provider: string): Locator {
  return page.getByTestId(`mention-defaults-summary-${provider}`);
}

export function mentionDefaultsTrigger(
  page: Page,
  provider: string,
  field: MentionDefaultsField,
): Locator {
  return page.getByTestId(`mention-defaults-${provider}-${field}`);
}

export function mentionDefaultsRow(page: Page, provider: string): Locator {
  return page.getByTestId(`mention-defaults-row-${provider}`);
}

/** 展开一个 provider 行，并等它的目录就绪（模型下拉可用）。 */
export async function expandMentionDefaults(page: Page, provider: string): Promise<void> {
  await page.getByTestId(`mention-defaults-toggle-${provider}`).click();
  await expect(mentionDefaultsTrigger(page, provider, "model")).toBeEnabled({ timeout: 30_000 });
}

export async function pickMentionDefault(
  page: Page,
  input: { provider: string; field: MentionDefaultsField; option: string },
): Promise<void> {
  await mentionDefaultsTrigger(page, input.provider, input.field).click();
  await page.getByRole("menuitem", { name: input.option, exact: true }).click();
}

/** 打开下拉后从上到下的选项名，读完关掉菜单。 */
export async function readMentionDefaultOptions(
  page: Page,
  input: { provider: string; field: MentionDefaultsField },
): Promise<string[]> {
  await mentionDefaultsTrigger(page, input.provider, input.field).click();
  const items = page.getByRole("menuitem");
  await expect(items.first()).toBeVisible();
  const labels = await items.allTextContents();
  await page.keyboard.press("Escape");
  await expect(items).toHaveCount(0);
  return labels.map((label) => label.trim());
}

/** 从 server_info 去掉 `agentMentions`，模拟没有 Agent mention 的老 Host。 */
export async function installHostWithoutAgentMentions(page: Page): Promise<void> {
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
        delete payload.features.agentMentions;
      }
      ws.send(JSON.stringify(envelope));
    });
  });
}
