import { rm } from "node:fs/promises";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { expect, type Page } from "@playwright/test";
import { connectDaemonClient } from "./daemon-client-loader";
import { daemonWsRoutePattern } from "./daemon-port";

/*
 * 「账号」一节的 e2e 夹具。CLI 的登录只放在用例给的临时 CODEX_HOME / CLAUDE_CONFIG_DIR 里，钥匙串经封条读假的；
 * 额度用 WebSocket 改写成假读数（测试 daemon 绝不带着登录去问 ChatGPT 或 Anthropic）。
 */

export interface FakeWindow {
  id: string;
  label: string;
  usedPct: number;
  resetsAt: string;
}

interface AccountsRouteOptions {
  // 每个读到了的号都换成这组窗口；不给就照主机回的。
  windows?: FakeWindow[];
  // 前几次「多号自动轮换」的保存直接回这个失败。
  failSetRotation?: { reason: string; times: number };
  // 改写 server_info：去掉 daemon.manage 模拟只能查看的设备。
  readOnly?: boolean;
}

interface Envelope {
  type?: string;
  message?: Record<string, unknown>;
}

function parse(message: string | Buffer): Envelope | null {
  if (typeof message !== "string") return null;
  try {
    return JSON.parse(message) as Envelope;
  } catch {
    return null;
  }
}

/** 一条路由装下这一节要的改写：Playwright 同一个页面只认最后装的 WebSocket 路由。 */
export async function installProviderAccountsRoute(
  page: Page,
  options: AccountsRouteOptions,
): Promise<void> {
  let failuresLeft = options.failSetRotation?.times ?? 0;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const sessionMessage = parse(message)?.message;
      if (
        sessionMessage?.type === "provider.account.set_rotation.request" &&
        failuresLeft > 0 &&
        options.failSetRotation
      ) {
        failuresLeft -= 1;
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: sessionMessage.requestId,
                requestType: sessionMessage.type,
                error: options.failSetRotation.reason,
                code: "handler_error",
              },
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const envelope = parse(message);
      const inner = envelope?.message;
      if (!envelope || !inner) {
        ws.send(message);
        return;
      }
      const payload = inner.payload as Record<string, unknown> | undefined;
      if (options.readOnly && inner.type === "status" && payload?.status === "server_info") {
        const permissions = payload.permissions;
        if (Array.isArray(permissions)) {
          payload.permissions = permissions.filter((permission) => permission !== "daemon.manage");
        }
      }
      const isAccountsReply =
        inner.type === "provider.account.list.response" ||
        inner.type === "provider.account.set_rotation.response";
      if (isAccountsReply && options.windows && Array.isArray(payload?.accounts)) {
        for (const account of payload.accounts as Array<Record<string, unknown>>) {
          account.usage = {
            status: "read",
            fetchedAt: new Date().toISOString(),
            windows: options.windows,
          };
        }
      }
      ws.send(JSON.stringify(envelope));
    });
  });
}

export async function withAccountsClient<T>(run: (client: DaemonClient) => Promise<T>): Promise<T> {
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "provider-accounts-e2e",
  });
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** 删掉测试 daemon 的账号存储：号、开关与「看过风险提示」都回到初始。 */
export async function resetProviderAccounts(): Promise<void> {
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("E2E_PASEO_HOME is not set (expected from the Playwright worker).");
  const file = path.join(home, "accounts", "accounts.json");
  await rm(file, { force: true });
  await rm(`${file}.bak`, { force: true });
}

export async function rotationOnDaemon(provider: "codex" | "claude"): Promise<boolean> {
  return withAccountsClient(
    async (client) => (await client.providerAccountList({ provider })).settings.rotationEnabled,
  );
}

export function accountsSection(page: Page) {
  return page.getByTestId("provider-accounts").filter({ visible: true });
}

export function rotateSwitch(page: Page) {
  return page.getByTestId("provider-accounts-rotate-switch").filter({ visible: true });
}

export function riskNotice(page: Page) {
  return page.getByTestId("provider-accounts-risk-notice").filter({ visible: true });
}

export async function expectRotateSwitch(
  page: Page,
  state: { checked: boolean; disabled: boolean },
): Promise<void> {
  const control = rotateSwitch(page);
  await expect(control).toHaveAttribute("aria-checked", String(state.checked));
  if (state.disabled) await expect(control).toHaveAttribute("aria-disabled", "true");
  else await expect(control).not.toHaveAttribute("aria-disabled", "true");
}

/** 与 Codex 的 auth.json 同形；id_token 只在本机解，签名不校验。 */
export function codexAuthJson(input: { accountId: string; email: string; plan: string }): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const idToken = `${part({ alg: "none" })}.${part({
    email: input.email,
    "https://api.openai.com/auth": {
      chatgpt_account_id: input.accountId,
      chatgpt_plan_type: input.plan,
    },
  })}.sig`;
  return JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      id_token: idToken,
      access_token: "e2e-access",
      refresh_token: "e2e-refresh",
      account_id: input.accountId,
    },
  });
}
