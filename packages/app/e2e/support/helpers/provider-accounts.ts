import { rm, writeFile } from "node:fs/promises";
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
  // 按邮箱给号各自的窗口，优先于 windows。
  windowsByEmail?: Record<string, FakeWindow[]>;
  // 前几次「多号自动轮换」的保存直接回这个失败。
  failSetRotation?: { reason: string; times: number };
  // 前几次这一种请求（如 provider.account.remove.request）不送到 daemon，直接回这个失败。
  failRequest?: { type: string; reason: string; times: number };
  // 改写 server_info：去掉 daemon.manage 模拟只能查看的设备。
  readOnly?: boolean;
  // 列表里的号标成登录失效（「需要重新登录」）；给了 email 只标那个号。
  needsSignIn?: { reason: string; code?: string; email?: string };
  // 开始加号的回复里，这次登录改成已经失败（模拟 10 分钟超时）。
  signInFailsWith?: { code: string; message: string };
  // 按邮箱给号标上自动换号后的位置（first_when_room、temporarily_first），模拟第一个号用完、暂时换到别的号。
  standing?: Record<string, string>;
  // 回复里标上 Claude Code 开着「使用第三方接口」。
  throughEndpoints?: boolean;
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
  let requestFailuresLeft = options.failRequest?.times ?? 0;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const sessionMessage = parse(message)?.message;
      let reason: string | null = null;
      if (
        sessionMessage?.type === "provider.account.set_rotation.request" &&
        failuresLeft > 0 &&
        options.failSetRotation
      ) {
        failuresLeft -= 1;
        reason = options.failSetRotation.reason;
      } else if (
        options.failRequest &&
        sessionMessage?.type === options.failRequest.type &&
        requestFailuresLeft > 0
      ) {
        requestFailuresLeft -= 1;
        reason = options.failRequest.reason;
      }
      if (reason !== null && sessionMessage) {
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: sessionMessage.requestId,
                requestType: sessionMessage.type,
                error: reason,
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
      rewriteAccountsMessage({ type: inner.type, payload, options });
      ws.send(JSON.stringify(envelope));
    });
  });
}

const ACCOUNT_STATE_REPLIES = new Set([
  "provider.account.list.response",
  "provider.account.set_rotation.response",
  "provider.account.use.response",
  "provider.account.remove.response",
  "provider.account.set_order.response",
  "provider.account.set_limits.response",
  "provider.account.set_keep_signed_in.response",
  "provider.account.set_switch_only.response",
]);

/** 这一节的回复按用例改写：额度换成假读数、号标成失效、加号的回复改成已失败。 */
function rewriteAccountsMessage(input: {
  type: unknown;
  payload: Record<string, unknown> | undefined;
  options: AccountsRouteOptions;
}): void {
  const { type, payload, options } = input;
  const isAccountsReply = typeof type === "string" && ACCOUNT_STATE_REPLIES.has(type);
  if (isAccountsReply && payload && options.throughEndpoints) payload.throughEndpoints = true;
  if (isAccountsReply && Array.isArray(payload?.accounts)) {
    for (const account of payload.accounts as Array<Record<string, unknown>>) {
      rewriteAccount({ account, options });
    }
  }
  const signIn = payload?.signIn as Record<string, unknown> | null | undefined;
  if (type === "provider.account.sign_in.start.response" && options.signInFailsWith && signIn) {
    signIn.status = "failed";
    signIn.error = options.signInFailsWith;
  }
}

/** 一个号：额度换成假读数、标上自动换号后的位置、标成失效。 */
function rewriteAccount(input: {
  account: Record<string, unknown>;
  options: AccountsRouteOptions;
}): void {
  const { account, options } = input;
  const windows = options.windowsByEmail?.[String(account.email)] ?? options.windows;
  if (windows) {
    account.usage = { status: "read", fetchedAt: new Date().toISOString(), windows };
  }
  const standing = options.standing?.[String(account.email)];
  if (standing) account.standing = standing;
  const lapse = options.needsSignIn;
  if (lapse && (lapse.email === undefined || lapse.email === account.email)) {
    account.needsSignIn = { reason: lapse.reason, ...(lapse.code ? { code: lapse.code } : {}) };
  }
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
  // 存着的 Claude 号的私有配置目录。
  await rm(path.join(home, "accounts", "claude"), { recursive: true, force: true });
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

export function signInSheet(page: Page) {
  return page.getByTestId("account-sign-in").filter({ visible: true });
}

/** OpenAI 换 token 的回复：经封条的假外网（PASEO_E2E_FAKE_SITES_PATH）回给测试 daemon。 */
export async function setFakeOpenAiToken(
  sitesPath: string,
  reply: { status: number; body: Record<string, unknown> },
): Promise<void> {
  await writeFile(
    sitesPath,
    JSON.stringify({
      "https://auth.openai.com/oauth/token": {
        status: reply.status,
        body: JSON.stringify(reply.body),
      },
    }),
  );
}

/** 换 token 成功时 OpenAI 回的 token；access token 一年后才到期，不会马上去续。 */
export function fakeOpenAiTokens(input: { accountId: string; email: string; plan: string }) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const jwt = (claims: Record<string, unknown>) => `${part({ alg: "none" })}.${part(claims)}.sig`;
  return {
    id_token: jwt({
      email: input.email,
      "https://api.openai.com/auth": {
        chatgpt_account_id: input.accountId,
        chatgpt_plan_type: input.plan,
      },
    }),
    access_token: jwt({ sub: input.accountId, exp: Math.floor(Date.now() / 1000) + 365 * 86400 }),
    refresh_token: `e2e-refresh-${input.accountId}`,
  };
}

/** 浏览器最后跳到的地址：登录页里写的回调地址，带上 code 与这次登录的 state。 */
export function callbackFor(authUrl: string, code: string): string {
  const page = new URL(authUrl);
  const redirect = new URL(page.searchParams.get("redirect_uri") ?? "");
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", page.searchParams.get("state") ?? "");
  return redirect.toString();
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

/**
 * 在测试 daemon 上加一个存着的 Codex 号：走真的加号流程，换 token 由封条的假外网（sitesPath）回答。
 * 返回号的 ID。
 */
export async function addCodexAccountOnDaemon(input: {
  sitesPath: string;
  account: { accountId: string; email: string; plan: string };
}): Promise<string> {
  await setFakeOpenAiToken(input.sitesPath, { status: 200, body: fakeOpenAiTokens(input.account) });
  return withAccountsClient(async (client) => {
    const started = await client.providerAccountSignInStart({ provider: "codex" });
    if (!started.signIn) throw new Error(started.error?.message ?? "sign-in didn't start");
    const done = await client.providerAccountSignInSubmit({
      signInId: started.signIn.id,
      callbackUrl: callbackFor(started.signIn.authUrl, `code-${input.account.accountId}`),
    });
    if (done.signIn?.status !== "done") throw new Error(`sign-in ${done.signIn?.status}`);
    return done.signIn.result.accountId;
  });
}
