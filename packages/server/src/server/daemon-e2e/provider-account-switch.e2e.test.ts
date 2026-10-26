import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProviderAccountSignIn } from "@getpaseo/protocol/provider-account/rpc-schemas";
import type { AccountUsageQuery, AccountUsageReader } from "../provider-accounts/service.js";
import { codexKeyringAccount } from "../provider-accounts/codex-login.js";
import { FakeCliKeychain } from "../test-utils/fake-cli-keychain.js";
import {
  FakeOpenAiAuth,
  accessToken,
  idToken,
  type FakeOpenAiAccount,
} from "../test-utils/fake-openai-auth.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * Codex 手动换号（工单 04）：立即使用、移除、排序、换号记录、当前号续期写回。
 * 登录只在临时目录与假钥匙串里，续期打本机的假 OpenAI 登录服务，额度用假的读法；
 * 绝不碰真实的 ~/.codex 与钥匙串，不连 OpenAI，不运行真的 CLI。
 */

const ONE: FakeOpenAiAccount = { accountId: "acct-1", email: "one@example.com", plan: "plus" };
const TWO: FakeOpenAiAccount = { accountId: "acct-2", email: "two@example.com", plan: "pro" };
const THREE: FakeOpenAiAccount = { accountId: "acct-3", email: "three@example.com", plan: "plus" };
const HOUR_MS = 60 * 60_000;
const KEYRING_SERVICE = "Codex Auth";

const tempRoots: string[] = [];

describe.skipIf(process.platform === "win32")("Codex account switching", () => {
  let root: string;
  let codexHome: string;
  let auth: FakeOpenAiAuth;
  let keychain: FakeCliKeychain;
  let usageReads: AccountUsageQuery[];
  let rejectSignedInUsage: number;
  let clock: { offsetMs: number };
  let daemons: TestPaseoDaemon[];
  let clients: DaemonClient[];
  let client: DaemonClient;

  const usage: AccountUsageReader = {
    async read(query) {
      usageReads.push(query);
      if (!query.login && rejectSignedInUsage > 0) {
        rejectSignedInUsage -= 1;
        return { status: "failed", code: "rejected", reason: "The login was rejected (HTTP 401)" };
      }
      return {
        status: "read",
        fetchedAt: "2026-10-25T08:00:00.000Z",
        windows: [{ id: "five_hour", label: "Session", usedPct: 10, resetsAt: null }],
      };
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-account-switch-"));
    tempRoots.push(root);
    codexHome = path.join(root, "codex-home");
    await mkdir(codexHome, { recursive: true });
    auth = new FakeOpenAiAuth();
    clock = { offsetMs: 0 };
    auth.now = () => Date.now() + clock.offsetMs;
    await auth.start();
    keychain = new FakeCliKeychain();
    usageReads = [];
    rejectSignedInUsage = 0;
    daemons = [];
    clients = [];
  });

  afterEach(async () => {
    await Promise.all(clients.map((each) => each.close()));
    await Promise.all(daemons.map((each) => each.close()));
    await auth.close();
    await chmod(codexHome, 0o700).catch(() => undefined);
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function startDaemon(
    options: { checks?: { firstDelayMs: number; intervalMs: number } } = {},
  ): Promise<DaemonClient> {
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      cliSignInsLaunchEnv: {},
      providerAccounts: {
        env: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: path.join(root, "claude"), USER: "t" },
        homeDir: root,
        platform: "darwin",
        keychain,
        usage,
        codexSignIn: {
          endpoints: { authorizeUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl },
          callbackPort: 0,
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
    client = next;
    return next;
  }

  async function restart(options: Parameters<typeof startDaemon>[0] = {}): Promise<void> {
    await Promise.all(clients.splice(0).map((each) => each.close()));
    await Promise.all(daemons.splice(0).map((each) => each.close()));
    await startDaemon(options);
  }

  /** CLI 自己登录的样子：auth.json 形状，refresh token 是假登录服务认的。 */
  function cliLogin(account: FakeOpenAiAccount, expiresAt = Date.now() + HOUR_MS): string {
    return JSON.stringify({
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      tokens: {
        id_token: idToken(account),
        access_token: accessToken({ name: `cli-${account.accountId}`, expiresAt }),
        refresh_token: auth.issueRefreshToken(account),
        account_id: account.accountId,
      },
      last_refresh: new Date().toISOString(),
    });
  }

  const authJsonPath = () => path.join(codexHome, "auth.json");
  const keyringAccount = () => codexKeyringAccount(codexHome);

  async function storeText(): Promise<string> {
    return readFile(path.join(daemons[0]!.paseoHome, "accounts", "accounts.json"), "utf8");
  }

  function refreshTokenIn(text: string | null): string | undefined {
    if (!text) return undefined;
    return (JSON.parse(text) as { tokens?: { refresh_token?: string } }).tokens?.refresh_token;
  }

  async function cliAccount(): Promise<string | undefined> {
    const text = await readFile(authJsonPath(), "utf8");
    return (JSON.parse(text) as { tokens?: { account_id?: string } }).tokens?.account_id;
  }

  async function turnOnRotation(): Promise<void> {
    const payload = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(payload.error).toBeNull();
  }

  function callbackUrl(signIn: ProviderAccountSignIn, code: string): string {
    const page = new URL(signIn.authUrl);
    const redirect = new URL(page.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", page.searchParams.get("state") ?? "");
    return redirect.toString();
  }

  async function addAccount(account: FakeOpenAiAccount): Promise<string> {
    const started = await client.providerAccountSignInStart({ provider: "codex" });
    if (!started.signIn) throw new Error("no sign-in");
    const code = `code-${account.accountId}-${Math.random()}`;
    auth.issueCode(code, account);
    const done = await client.providerAccountSignInSubmit({
      signInId: started.signIn.id,
      callbackUrl: callbackUrl(started.signIn, code),
    });
    if (done.signIn?.status !== "done") throw new Error(`sign-in ${done.signIn?.status}`);
    return done.signIn.result.accountId;
  }

  /** CLI 登录着 ONE、打开轮换（ONE 成为第 1 个号），再加上存着的号。 */
  async function setUp(saved: FakeOpenAiAccount[] = [TWO]): Promise<Record<string, string>> {
    await writeFile(authJsonPath(), cliLogin(ONE), { mode: 0o600 });
    await startDaemon();
    await turnOnRotation();
    const listed = await client.providerAccountList({ provider: "codex" });
    const ids: Record<string, string> = { [ONE.accountId]: listed.accounts[0]!.id };
    for (const account of saved) ids[account.accountId] = await addAccount(account);
    return ids;
  }

  test("Use now puts the account into auth.json and takes the old login back", async () => {
    const ids = await setUp();
    const oldRefresh = refreshTokenIn(await readFile(authJsonPath(), "utf8"));
    const twoRefresh = /refresh-acct-2-\d+/.exec(await storeText())?.[0];
    expect(twoRefresh).toBeDefined();

    const used = await client.providerAccountUse({ provider: "codex", accountId: ids["acct-2"]! });
    expect(used.error).toBeNull();
    expect(used.accounts.map((account) => [account.email, account.signedIn])).toEqual([
      ["one@example.com", false],
      ["two@example.com", true],
    ]);
    expect(used.switches).toMatchObject([
      {
        from: { accountId: ids["acct-1"], email: "one@example.com" },
        to: { accountId: ids["acct-2"], email: "two@example.com" },
        reason: "use_now",
      },
    ]);
    expect(used.switchFailure ?? null).toBeNull();

    // CLI 现在是 TWO；ONE 的登录（最新一份）收回 Osuna；每个 token 只在一处。
    const cliText = await readFile(authJsonPath(), "utf8");
    expect(await cliAccount()).toBe("acct-2");
    expect(refreshTokenIn(cliText)).toBe(twoRefresh);
    const store = await storeText();
    expect(store).toContain(oldRefresh!);
    expect(store).not.toContain(twoRefresh!);
    expect(cliText).not.toContain(oldRefresh!);
    expect((await stat(authJsonPath())).mode & 0o777).toBe(0o600);

    // 再换回去：同样只在一处。
    const back = await client.providerAccountUse({ provider: "codex", accountId: ids["acct-1"]! });
    expect(back.error).toBeNull();
    expect(await cliAccount()).toBe("acct-1");
    expect(refreshTokenIn(await readFile(authJsonPath(), "utf8"))).toBe(oldRefresh);
    expect(await storeText()).toContain(twoRefresh!);
    expect(await storeText()).not.toContain(oldRefresh!);
    expect(back.switches?.map((entry) => entry.to.email)).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
  });

  test("Use now writes Codex's keychain item when Codex keeps its login there", async () => {
    await writeFile(
      path.join(codexHome, "config.toml"),
      'cli_auth_credentials_store = "keyring"\n',
    );
    keychain.set(KEYRING_SERVICE, keyringAccount(), cliLogin(ONE));
    const oldRefresh = refreshTokenIn(await keychain.read(KEYRING_SERVICE, keyringAccount()));
    await startDaemon();
    await turnOnRotation();
    const twoId = await addAccount(TWO);

    const used = await client.providerAccountUse({ provider: "codex", accountId: twoId });
    expect(used.error).toBeNull();
    const item = await keychain.read(KEYRING_SERVICE, keyringAccount());
    expect(JSON.parse(item ?? "{}")).toMatchObject({ tokens: { account_id: "acct-2" } });
    // 钥匙串里那一项是一行，与 Codex 自己写的一样。
    expect(item).not.toContain("\n");
    await expect(stat(authJsonPath())).rejects.toThrow();
    expect(await storeText()).toContain(oldRefresh!);
    expect(await storeText()).not.toContain(refreshTokenIn(item)!);
  });

  test("Use now is refused for a login Osuna can't switch, and nothing changes", async () => {
    const ids = await setUp();
    await writeFile(
      path.join(codexHome, "config.toml"),
      'cli_auth_credentials_store = "ephemeral"\n',
    );
    const before = await readFile(authJsonPath(), "utf8");
    const store = await storeText();
    const refused = await client.providerAccountUse({
      provider: "codex",
      accountId: ids["acct-2"]!,
    });
    expect(refused.error?.code).toBe("login_unsupported");
    expect(await readFile(authJsonPath(), "utf8")).toBe(before);
    expect(await storeText()).toContain(/refresh-acct-2-\d+/.exec(store)![0]);
  });

  test("Use now never replaces a Codex signed in with an API key", async () => {
    const apiKeyLogin = JSON.stringify({ OPENAI_API_KEY: "sk-test", tokens: null });
    await writeFile(authJsonPath(), apiKeyLogin, { mode: 0o600 });
    await startDaemon();
    await turnOnRotation();
    const twoId = await addAccount(TWO);
    const refused = await client.providerAccountUse({ provider: "codex", accountId: twoId });
    expect(refused.error?.code).toBe("login_unsupported");
    expect(refused.switchFailure).toMatchObject({ code: "login_unsupported" });
    expect(await readFile(authJsonPath(), "utf8")).toBe(apiKeyLogin);
  });

  test("a login that can't be written is reported in the section and keeps every token", async () => {
    const ids = await setUp();
    const before = await readFile(authJsonPath(), "utf8");
    const twoRefresh = /refresh-acct-2-\d+/.exec(await storeText())![0];
    // CLI 的目录写不进去：原子替换要在同一目录里建临时文件。
    await chmod(codexHome, 0o500);
    const failed = await client.providerAccountUse({
      provider: "codex",
      accountId: ids["acct-2"]!,
    });
    await chmod(codexHome, 0o700);
    expect(failed.error?.code).toBe("write_failed");
    expect(failed.switchFailure).toMatchObject({
      code: "write_failed",
      to: { accountId: ids["acct-2"], email: "two@example.com" },
    });
    // 原因只带错误码，不带临时文件的路径。
    expect(failed.switchFailure?.message).toBe("Codex's login couldn't be written (EACCES)");
    expect(failed.switches ?? []).toEqual([]);
    expect(await readFile(authJsonPath(), "utf8")).toBe(before);
    // ONE 的登录还只在 CLI 那里，TWO 的还在 Osuna 这边。
    const store = await storeText();
    expect(store).not.toContain(refreshTokenIn(before)!);
    expect(store).toContain(twoRefresh);

    // 下次换成了，失败的提示就清掉。
    const used = await client.providerAccountUse({ provider: "codex", accountId: ids["acct-2"]! });
    expect(used.error).toBeNull();
    expect(used.switchFailure ?? null).toBeNull();
  });

  test("Use now on an account that needs signing in again is refused", async () => {
    const ids = await setUp();
    // 让 TWO 的 token 快到期，换上去前要续，续期被拒。
    auth.refuseRefresh = "invalid_grant";
    clock.offsetMs = 59 * 60_000;
    const refused = await client.providerAccountUse({
      provider: "codex",
      accountId: ids["acct-2"]!,
    });
    expect(refused.error?.code).toBe("needs_sign_in");
    expect(refused.accounts.find((account) => account.id === ids["acct-2"])).toMatchObject({
      needsSignIn: { code: "invalid_grant" },
    });
    expect(await cliAccount()).toBe("acct-1");
  });

  test("Use now does nothing while Read CLI sign-ins is off", async () => {
    const ids = await setUp();
    const before = await readFile(authJsonPath(), "utf8");
    await client.patchDaemonConfig({ readCliSignIns: false });
    const refused = await client.providerAccountUse({
      provider: "codex",
      accountId: ids["acct-2"]!,
    });
    expect(refused.error?.code).toBe("cli_sign_ins_off");
    expect(await readFile(authJsonPath(), "utf8")).toBe(before);
  });

  test("the switch log survives a restart and keeps the latest 50", async () => {
    const ids = await setUp();
    for (let round = 0; round < 26; round += 1) {
      await client.providerAccountUse({ provider: "codex", accountId: ids["acct-2"]! });
      await client.providerAccountUse({ provider: "codex", accountId: ids["acct-1"]! });
    }
    await restart();
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.switches).toHaveLength(50);
    // 最新的在前：最后一次换回了 ONE。
    expect(listed.switches?.[0]).toMatchObject({
      to: { email: "one@example.com" },
      reason: "use_now",
    });
    expect(listed.accounts.find((account) => account.signedIn)?.email).toBe("one@example.com");
  });

  test("removing the account in use forgets it without signing the CLI out", async () => {
    const ids = await setUp();
    const before = await readFile(authJsonPath(), "utf8");
    const removed = await client.providerAccountRemove({
      provider: "codex",
      accountId: ids["acct-1"]!,
    });
    expect(removed.error).toBeNull();
    expect(removed.accounts.map((account) => account.email)).toEqual(["two@example.com"]);
    expect(await readFile(authJsonPath(), "utf8")).toBe(before);

    // 移除存着的号：它的 token 也从 Osuna 这边删掉。
    const gone = await client.providerAccountRemove({
      provider: "codex",
      accountId: ids["acct-2"]!,
    });
    expect(gone.error).toBeNull();
    expect(await storeText()).not.toContain("refresh-acct-2-");
    const again = await client.providerAccountRemove({
      provider: "codex",
      accountId: ids["acct-2"]!,
    });
    expect(again.error?.code).toBe("not_found");
  });

  test("the order is saved, and an order that doesn't match the host's accounts is refused", async () => {
    const ids = await setUp([TWO, THREE]);
    const order = [ids["acct-3"]!, ids["acct-1"]!, ids["acct-2"]!];
    const saved = await client.providerAccountSetOrder({ provider: "codex", accountIds: order });
    expect(saved.error).toBeNull();
    expect(saved.accounts.map((account) => account.id)).toEqual(order);
    await restart();
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.accounts.map((account) => account.id)).toEqual(order);

    const stale = await client.providerAccountSetOrder({
      provider: "codex",
      accountIds: [ids["acct-1"]!, ids["acct-2"]!],
    });
    expect(stale.error?.code).toBe("order_mismatch");
    expect(stale.accounts.map((account) => account.id)).toEqual(order);
  });

  test("the account in use is renewed before it expires and written back to the CLI", async () => {
    await writeFile(authJsonPath(), cliLogin(ONE, Date.now() + 2 * 60_000), { mode: 0o600 });
    const oldRefresh = refreshTokenIn(await readFile(authJsonPath(), "utf8"));
    await startDaemon({ checks: { firstDelayMs: 50, intervalMs: 100 } });
    await turnOnRotation();
    await expect.poll(() => auth.refreshRequests().length).toBeGreaterThanOrEqual(1);
    expect(auth.refreshRequests()[0]?.body.refresh_token).toBe(oldRefresh);
    await expect
      .poll(async () => refreshTokenIn(await readFile(authJsonPath(), "utf8")))
      .not.toBe(oldRefresh);
    const cliText = await readFile(authJsonPath(), "utf8");
    expect(await cliAccount()).toBe("acct-1");
    expect((await stat(authJsonPath())).mode & 0o777).toBe(0o600);
    // 续出来的只在 CLI 那里。
    expect(await storeText()).not.toContain(refreshTokenIn(cliText)!);
    // 续完离到期还远，下次检查不再续。
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(auth.refreshRequests()).toHaveLength(1);
  });

  test("the account in use is renewed once when its usage read is rejected", async () => {
    await writeFile(authJsonPath(), cliLogin(ONE), { mode: 0o600 });
    const oldRefresh = refreshTokenIn(await readFile(authJsonPath(), "utf8"));
    rejectSignedInUsage = 1;
    await startDaemon();
    await turnOnRotation();
    await client.providerAccountList({ provider: "codex" });
    await expect.poll(() => auth.refreshRequests().length).toBe(1);
    await expect
      .poll(async () => refreshTokenIn(await readFile(authJsonPath(), "utf8")))
      .not.toBe(oldRefresh);
    await expect
      .poll(
        async () => (await client.providerAccountList({ provider: "codex" })).accounts[0]?.usage,
      )
      .toMatchObject({ status: "read" });
  });

  test("when the account in use is refused, Osuna switches to the next account", async () => {
    await writeFile(authJsonPath(), cliLogin(ONE, Date.now() + 2 * 60_000), { mode: 0o600 });
    await startDaemon();
    await turnOnRotation();
    const twoId = await addAccount(TWO);
    auth.refuseRefresh = "refresh_token_reused";
    await restart({ checks: { firstDelayMs: 50, intervalMs: 100 } });
    await expect.poll(async () => cliAccount()).toBe("acct-2");
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.accounts.map((account) => [account.email, account.signedIn])).toEqual([
      ["one@example.com", false],
      ["two@example.com", true],
    ]);
    expect(listed.accounts[0]?.needsSignIn).toMatchObject({ code: "refresh_token_reused" });
    expect(listed.switches?.[0]).toMatchObject({
      from: { email: "one@example.com" },
      to: { accountId: twoId },
      reason: "lapsed",
    });
  });

  test("a refused account that wasn't in the list is taken back as needing sign-in", async () => {
    await writeFile(authJsonPath(), cliLogin(ONE, Date.now() + 2 * 60_000), { mode: 0o600 });
    await startDaemon();
    await turnOnRotation();
    const twoId = await addAccount(TWO);
    const listed = await client.providerAccountList({ provider: "codex" });
    const oneId = listed.accounts.find((account) => account.email === "one@example.com")!.id;
    await client.providerAccountRemove({ provider: "codex", accountId: oneId });
    auth.refuseRefresh = "invalid_grant";
    await restart({ checks: { firstDelayMs: 50, intervalMs: 100 } });
    await expect.poll(async () => cliAccount()).toBe("acct-2");
    const after = await client.providerAccountList({ provider: "codex" });
    expect(after.accounts.map((account) => [account.email, account.signedIn])).toEqual([
      ["two@example.com", true],
      ["one@example.com", false],
    ]);
    expect(after.accounts[1]?.needsSignIn).toMatchObject({ code: "invalid_grant" });
    expect(after.switches?.[0]).toMatchObject({ to: { accountId: twoId }, reason: "lapsed" });
  });

  test("when the account in use is refused and no account can take over, the section says so", async () => {
    await writeFile(authJsonPath(), cliLogin(ONE, Date.now() + 2 * 60_000), { mode: 0o600 });
    auth.refuseRefresh = "invalid_grant";
    await startDaemon({ checks: { firstDelayMs: 50, intervalMs: 100 } });
    await turnOnRotation();
    await expect
      .poll(async () => (await client.providerAccountList({ provider: "codex" })).switchFailure)
      .toMatchObject({ code: "no_account" });
    expect(await cliAccount()).toBe("acct-1");
  });
});
