import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProviderAccountSignIn } from "@getpaseo/protocol/provider-account/rpc-schemas";
import type { AccountUsageQuery, AccountUsageReader } from "../provider-accounts/service.js";
import { FakeCliKeychain } from "../test-utils/fake-cli-keychain.js";
import {
  FakeOpenAiAuth,
  idToken,
  pkceChallenge,
  type FakeOpenAiAccount,
} from "../test-utils/fake-openai-auth.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * Codex 加号与存着的号保持能用（工单 03）：登录与续期打本机的假 OpenAI 登录服务，额度用假的读法，
 * 登录只在临时目录与假钥匙串里，绝不碰真实的 ~/.codex 与钥匙串，不连 OpenAI，不运行真的 CLI。
 */

const ONE: FakeOpenAiAccount = { accountId: "acct-1", email: "one@example.com", plan: "plus" };
const TWO: FakeOpenAiAccount = { accountId: "acct-2", email: "two@example.com", plan: "pro" };
const HOUR_MS = 60 * 60_000;

function codexAuthJson(account: FakeOpenAiAccount): string {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      id_token: idToken(account),
      access_token: "cli-access",
      refresh_token: "cli-refresh",
      account_id: account.accountId,
    },
  });
}

const tempRoots: string[] = [];

describe.skipIf(process.platform === "win32")("Codex sign-in and saved accounts", () => {
  let root: string;
  let codexHome: string;
  let auth: FakeOpenAiAuth;
  let usageReads: AccountUsageQuery[];
  let clock: { offsetMs: number };
  let daemons: TestPaseoDaemon[];
  let clients: DaemonClient[];
  let client: DaemonClient;

  const usage: AccountUsageReader = {
    async read(query) {
      usageReads.push(query);
      return {
        status: "read",
        fetchedAt: "2026-10-25T08:00:00.000Z",
        windows: [{ id: "five_hour", label: "Session", usedPct: 10, resetsAt: null }],
      };
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-account-sign-in-"));
    tempRoots.push(root);
    codexHome = path.join(root, "codex-home");
    await mkdir(codexHome, { recursive: true });
    auth = new FakeOpenAiAuth();
    clock = { offsetMs: 0 };
    auth.now = () => Date.now() + clock.offsetMs;
    await auth.start();
    usageReads = [];
    daemons = [];
    clients = [];
    client = await startDaemon();
  });

  afterEach(async () => {
    await Promise.all(clients.map((each) => each.close()));
    await Promise.all(daemons.map((each) => each.close()));
    await auth.close();
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function startDaemon(
    options: {
      timeoutMs?: number;
      callbackPort?: number;
      checks?: { firstDelayMs: number; intervalMs: number };
    } = {},
  ): Promise<DaemonClient> {
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      cliSignInsLaunchEnv: {},
      providerAccounts: {
        env: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: path.join(root, "claude"), USER: "t" },
        homeDir: root,
        platform: "darwin",
        keychain: new FakeCliKeychain(),
        usage,
        codexSignIn: {
          endpoints: { authorizeUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl },
          callbackPort: options.callbackPort ?? 0,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        },
        now: () => Date.now() + clock.offsetMs,
        ...(options.checks ? { checks: options.checks } : {}),
      },
    });
    daemons.push(daemon);
    const next = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.17.0",
    });
    await next.connect();
    clients.push(next);
    return next;
  }

  async function restartWith(options: Parameters<typeof startDaemon>[0]): Promise<void> {
    await Promise.all(clients.splice(0).map((each) => each.close()));
    await Promise.all(daemons.splice(0).map((each) => each.close()));
    client = await startDaemon(options);
  }

  async function turnOnRotation(): Promise<void> {
    const payload = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(payload.error).toBeNull();
  }

  async function startSignIn(accountId?: string): Promise<ProviderAccountSignIn> {
    const started = await client.providerAccountSignInStart({
      provider: "codex",
      ...(accountId ? { accountId } : {}),
    });
    expect(started.error).toBeNull();
    if (!started.signIn) throw new Error("no sign-in");
    return started.signIn;
  }

  /** 浏览器在 OpenAI 登录完，被送回登录页里写的回调地址。 */
  function callbackUrl(signIn: ProviderAccountSignIn, code: string, state?: string): string {
    const page = new URL(signIn.authUrl);
    const redirect = new URL(page.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", state ?? page.searchParams.get("state") ?? "");
    return redirect.toString();
  }

  async function signInById(id: string): Promise<ProviderAccountSignIn | null> {
    return (await client.providerAccountSignInGet({ signInId: id })).signIn;
  }

  async function addAccount(account: FakeOpenAiAccount, code: string): Promise<string> {
    const signIn = await startSignIn();
    auth.issueCode(code, account);
    const done = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      callbackUrl: callbackUrl(signIn, code),
    });
    if (done.signIn?.status !== "done") throw new Error(`sign-in ${done.signIn?.status}`);
    return done.signIn.result.accountId;
  }

  /** 用存着的号自己的 token 读过额度的那些号。 */
  function savedAccountsRead(): (string | undefined)[] {
    return usageReads.map((read) => read.login?.accountId);
  }

  async function storeText(): Promise<string> {
    return readFile(path.join(daemons[0]!.paseoHome, "accounts", "accounts.json"), "utf8");
  }

  test("the browser coming back to the callback adds the account with its own login", async () => {
    await turnOnRotation();
    const signIn = await startSignIn();
    expect(signIn.status).toBe("waiting");
    expect(signIn.callbackBlocked).toBe(false);
    const page = new URL(signIn.authUrl);
    expect(`${page.origin}${page.pathname}`).toBe(auth.authorizeUrl);
    expect(Object.fromEntries(page.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      code_challenge_method: "S256",
      originator: "codex_cli_rs",
    });
    expect(page.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/localhost:\d+\/auth\/callback$/,
    );

    auth.issueCode("code-1", ONE);
    const browser = await fetch(callbackUrl(signIn, "code-1"));
    expect(browser.status).toBe(200);
    expect(await browser.text()).toContain("signed in");

    const done = await signInById(signIn.id);
    expect(done).toMatchObject({
      status: "done",
      result: { email: "one@example.com", alreadyAdded: false },
    });
    // 换 token 带着与登录页 code_challenge 对得上的 code_verifier。
    const exchange = auth.requests.find((request) => request.grantType === "authorization_code");
    expect(pkceChallenge(exchange?.body.code_verifier ?? "")).toBe(
      page.searchParams.get("code_challenge"),
    );

    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.accounts).toMatchObject([
      { email: "one@example.com", plan: "Plus", signedIn: false },
    ]);
    // 存着的号的 token 只在 Osuna 的存储里。
    expect(await storeText()).toContain("refresh-acct-1-");
    // 列表读它的额度时用它自己的 token。
    await expect.poll(savedAccountsRead).toContain("acct-1");
  });

  test("a pasted address finishes the sign-in; a wrong or partial one is refused", async () => {
    const signIn = await startSignIn();
    auth.issueCode("code-2", TWO);

    const garbage = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      callbackUrl: "not an address",
    });
    expect(garbage.error?.code).toBe("paste_invalid");
    const otherState = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      callbackUrl: callbackUrl(signIn, "code-2", "someone-elses-state"),
    });
    expect(otherState.error?.code).toBe("paste_mismatch");
    expect(otherState.signIn?.status).toBe("waiting");

    const done = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      callbackUrl: callbackUrl(signIn, "code-2"),
    });
    expect(done.error).toBeNull();
    expect(done.signIn).toMatchObject({ status: "done", result: { email: "two@example.com" } });
  });

  test("with the callback port taken the sign-in is finished by pasting the address", async () => {
    // 别的程序占着回调端口（如另一个 codex login），它不肯让出来。
    const holder = createServer((_request, response) => response.writeHead(404).end());
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const address = holder.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      await restartWith({ callbackPort: port });
      const signIn = await startSignIn();
      expect(signIn.callbackBlocked).toBe(true);
      const redirect = new URL(signIn.authUrl).searchParams.get("redirect_uri");
      expect(redirect).toBe(`http://localhost:${port}/auth/callback`);
      auth.issueCode("code-blocked", ONE);
      const done = await client.providerAccountSignInSubmit({
        signInId: signIn.id,
        callbackUrl: callbackUrl(signIn, "code-blocked"),
      });
      expect(done.signIn).toMatchObject({ status: "done", result: { email: "one@example.com" } });
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  test("turning Read CLI sign-ins off mid sign-in trades no code", async () => {
    const signIn = await startSignIn();
    auth.issueCode("code-off-mid", ONE);
    await client.patchDaemonConfig({ readCliSignIns: false });
    const reply = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      callbackUrl: callbackUrl(signIn, "code-off-mid"),
    });
    expect(reply.signIn).toMatchObject({ status: "failed", error: { code: "cli_sign_ins_off" } });
    expect(auth.requests).toEqual([]);
  });

  test("a sign-in times out and a canceled one keeps nothing", async () => {
    await restartWith({ timeoutMs: 200 });
    const timedOut = await startSignIn();
    await expect
      .poll(async () => (await signInById(timedOut.id))?.status, { timeout: 5000 })
      .toBe("failed");
    expect(await signInById(timedOut.id)).toMatchObject({ error: { code: "timed_out" } });

    await restartWith({});
    const canceled = await startSignIn();
    const reply = await client.providerAccountSignInCancel({ signInId: canceled.id });
    expect(reply.signIn?.status).toBe("canceled");
    auth.issueCode("code-late", ONE);
    const late = await client.providerAccountSignInSubmit({
      signInId: canceled.id,
      callbackUrl: callbackUrl(canceled, "code-late"),
    });
    expect(late.error?.code).toBe("not_waiting");
    expect((await client.providerAccountList({ provider: "codex" })).accounts).toEqual([]);
  });

  test("a refused sign-in page fails with the page's reason", async () => {
    const signIn = await startSignIn();
    const page = new URL(signIn.authUrl);
    const redirect = new URL(page.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("error_description", "The user said no");
    redirect.searchParams.set("state", page.searchParams.get("state") ?? "");
    await fetch(redirect);
    expect(await signInById(signIn.id)).toMatchObject({
      status: "failed",
      error: { code: "refused", message: "The user said no" },
    });
  });

  test("signing in to an account already listed updates it instead of adding another", async () => {
    const first = await addAccount(ONE, "code-a");
    const before = await storeText();
    const signIn = await startSignIn();
    auth.issueCode("code-b", ONE);
    const again = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      callbackUrl: callbackUrl(signIn, "code-b"),
    });
    expect(again.signIn).toMatchObject({
      status: "done",
      result: { accountId: first, alreadyAdded: true },
    });
    expect((await client.providerAccountList({ provider: "codex" })).accounts).toHaveLength(1);
    const after = await storeText();
    const refreshOf = (text: string) => /refresh-acct-1-\d+/.exec(text)?.[0];
    expect(refreshOf(after)).not.toBe(refreshOf(before));
  });

  test("signing in to the account the CLI holds keeps no second copy of its login", async () => {
    await writeFile(path.join(codexHome, "auth.json"), codexAuthJson(ONE));
    await turnOnRotation();
    const signIn = await startSignIn();
    auth.issueCode("code-cli", ONE);
    const done = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      callbackUrl: callbackUrl(signIn, "code-cli"),
    });
    expect(done.signIn).toMatchObject({ status: "done", result: { alreadyAdded: true } });
    expect(await storeText()).not.toContain("refresh-acct-1-");
    expect((await client.providerAccountList({ provider: "codex" })).accounts).toMatchObject([
      { email: "one@example.com", signedIn: true },
    ]);
  });

  test("re-adding a saved account the CLI now holds drops Osuna's copy of its login", async () => {
    await addAccount(ONE, "code-held-1");
    expect(await storeText()).toContain("refresh-acct-1-");
    // 用户后来在终端里 `codex login` 了同一个号。
    await writeFile(path.join(codexHome, "auth.json"), codexAuthJson(ONE));
    await addAccount(ONE, "code-held-2");
    expect(await storeText()).not.toContain("refresh-acct-1-");
    expect((await client.providerAccountList({ provider: "codex" })).accounts).toMatchObject([
      { email: "one@example.com", signedIn: true },
    ]);
  });

  test("a saved login close to expiry is renewed before its usage is read", async () => {
    auth.accessTtlMs = 60_000;
    const accountId = await addAccount(ONE, "code-r");
    await turnOnRotation();
    await client.providerAccountList({ provider: "codex" });
    await expect.poll(() => auth.refreshRequests().length).toBe(1);
    await expect.poll(() => usageReads.length).toBeGreaterThan(0);
    // 读额度用的是续出来的 access token，存储里是新的 refresh token。
    expect(usageReads.at(-1)?.login?.accessToken).toMatch(/^ey/);
    expect(auth.refreshRequests()[0]?.body).toMatchObject({
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant_type: "refresh_token",
      refresh_token: "refresh-acct-1-1",
    });
    expect(await storeText()).toContain("refresh-acct-1-2");
    expect(await storeText()).not.toContain("refresh-acct-1-1");
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(
      listed.accounts.find((account) => account.id === accountId)?.needsSignIn,
    ).toBeUndefined();
  });

  test("a refused renewal marks the account as needing sign-in, and signing in again fixes it", async () => {
    auth.accessTtlMs = 60_000;
    const accountId = await addAccount(ONE, "code-x");
    auth.refuseRefresh = "invalid_grant";
    await turnOnRotation();
    await client.providerAccountList({ provider: "codex" });
    await expect
      .poll(async () => (await client.providerAccountList({ provider: "codex" })).accounts[0])
      .toMatchObject({ id: accountId, needsSignIn: { code: "invalid_grant" } });
    // 失效的号不再拿它的 token 去读额度。
    expect(usageReads).toEqual([]);

    // 重新登录登成了别的号：不写进这个号。
    const wrong = await startSignIn(accountId);
    auth.issueCode("code-wrong", TWO);
    const refused = await client.providerAccountSignInSubmit({
      signInId: wrong.id,
      callbackUrl: callbackUrl(wrong, "code-wrong"),
    });
    expect(refused.signIn).toMatchObject({
      status: "failed",
      error: { code: "different_account" },
    });

    auth.refuseRefresh = null;
    auth.accessTtlMs = HOUR_MS;
    const again = await startSignIn(accountId);
    expect(again.accountId).toBe(accountId);
    auth.issueCode("code-fix", ONE);
    const fixed = await client.providerAccountSignInSubmit({
      signInId: again.id,
      callbackUrl: callbackUrl(again, "code-fix"),
    });
    expect(fixed.signIn).toMatchObject({
      status: "done",
      result: { accountId, alreadyAdded: true },
    });
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.accounts).toHaveLength(1);
    expect(listed.accounts[0]?.needsSignIn).toBeUndefined();
  });

  test("two daemons renewing the same saved account at once spend its refresh token once", async () => {
    await addAccount(ONE, "code-c");
    await turnOnRotation();
    // 第二个 daemon 用同一个 $PASEO_HOME（桌面端与终端里起的各一个）。
    const second = await startDaemon();
    await expect.poll(() => usageReads.length).toBeGreaterThan(0);
    expect(auth.refreshRequests()).toHaveLength(0);
    // 一小时的 access token 只剩两分钟：两个 daemon 同时要读额度，都要先续。
    clock.offsetMs = 58 * 60_000;
    usageReads = [];
    auth.refreshDelayMs = 300;
    await Promise.all([
      client.providerAccountList({ provider: "codex" }),
      second.providerAccountList({ provider: "codex" }),
    ]);
    await expect.poll(() => usageReads.length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    expect(auth.refreshRequests()).toHaveLength(1);
    expect(await storeText()).toContain("refresh-acct-1-2");
    const listed = await second.providerAccountList({ provider: "codex" });
    expect(listed.accounts[0]?.needsSignIn).toBeUndefined();
  });

  test("a saved account untouched for a day is renewed by the keep-alive", async () => {
    await addAccount(ONE, "code-k");
    await restartWith({ checks: { firstDelayMs: 50, intervalMs: 100 } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // 刚加的号不到 24 小时，不续。
    expect(auth.refreshRequests()).toHaveLength(0);
    clock.offsetMs = 25 * HOUR_MS;
    await expect.poll(() => auth.refreshRequests().length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // 续完重新算 24 小时，不会每次检查都续。
    expect(auth.refreshRequests()).toHaveLength(1);
  });

  test("with Read CLI sign-ins off nothing is added, renewed or read", async () => {
    auth.accessTtlMs = 60_000;
    await addAccount(ONE, "code-off");
    await client.patchDaemonConfig({ readCliSignIns: false });
    const refused = await client.providerAccountSignInStart({ provider: "codex" });
    expect(refused.error?.code).toBe("cli_sign_ins_off");
    await restartWith({ checks: { firstDelayMs: 50, intervalMs: 100 } });
    clock.offsetMs = 25 * HOUR_MS;
    await client.providerAccountList({ provider: "codex" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(auth.refreshRequests()).toHaveLength(0);
    expect(usageReads).toEqual([]);
    // 存着的号保留。
    expect(await storeText()).toContain("refresh-acct-1-1");
  });
});
