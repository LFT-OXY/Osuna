import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { expect, type Page } from "@playwright/test";
import { connectDaemonClient } from "./daemon-client-loader";
import { daemonWsRoutePattern } from "./daemon-port";

export async function withPrivacyClient<T>(run: (client: DaemonClient) => Promise<T>): Promise<T> {
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "host-privacy-e2e" });
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function readCliSignInsOnDaemon(): Promise<boolean | undefined> {
  return withPrivacyClient(
    async (client) => (await client.getDaemonConfig()).config.readCliSignIns,
  );
}

export async function setReadCliSignInsOnDaemon(value: boolean): Promise<void> {
  await withPrivacyClient((client) => client.patchDaemonConfig({ readCliSignIns: value }));
}

interface ServerInfoPayload {
  status?: unknown;
  features?: Record<string, unknown>;
  permissions?: unknown;
}

/** 改写 daemon 发来的 server_info，模拟老 Host 或只有查看权限的设备。 */
export async function rewriteServerInfo(
  page: Page,
  rewrite: (payload: ServerInfoPayload) => void,
): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string" || !message.includes('"server_info"')) {
        ws.send(message);
        return;
      }
      const envelope = JSON.parse(message) as { message?: { payload?: ServerInfoPayload } };
      const payload = envelope.message?.payload;
      if (payload?.status === "server_info") rewrite(payload);
      ws.send(JSON.stringify(envelope));
    });
  });
}

export function readCliSignInsSwitch(page: Page) {
  return page.getByTestId("host-privacy-read-cli-sign-ins-switch").filter({ visible: true });
}

export async function expectReadCliSignIns(
  page: Page,
  state: { checked: boolean; disabled: boolean },
): Promise<void> {
  const control = readCliSignInsSwitch(page);
  await expect(control).toHaveAttribute("aria-checked", String(state.checked));
  // react-native-web 不可操作时才写 aria-disabled。
  if (state.disabled) await expect(control).toHaveAttribute("aria-disabled", "true");
  else await expect(control).not.toHaveAttribute("aria-disabled", "true");
}

/** 关「读取 CLI 登录凭证」前的确认框。 */
export function turnOffSheet(page: Page) {
  return page.getByTestId("host-privacy-turn-off-sheet").filter({ visible: true });
}

/** 关开关：点开关，在确认框里按「关闭」。 */
export async function turnOffReadCliSignIns(page: Page): Promise<void> {
  await readCliSignInsSwitch(page).click();
  await turnOffSheet(page).getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(turnOffSheet(page)).toHaveCount(0);
}
