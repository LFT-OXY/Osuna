import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type {
  ProviderAccountSignIn,
  ProviderAccountWindow,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import type {
  AccountUsageQuery,
  AccountUsageReader,
  AccountUsageResult,
} from "../provider-accounts/service.js";
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
 * Codex 自动换号（工单 05）：定时检查按各号的额度换走、换回，上限、固定登录到。
 * 登录只在临时目录里，续期打本机的假 OpenAI 登录服务，各号的额度由用例拨；
 * 绝不碰真实的 ~/.codex 与钥匙串，不连 OpenAI，不运行真的 CLI。
 */

const ONE: FakeOpenAiAccount = { accountId: "acct-1", email: "one@example.com", plan: "plus" };
const TWO: FakeOpenAiAccount = { accountId: "acct-2", email: "two@example.com", plan: "pro" };
const THREE: FakeOpenAiAccount = { accountId: "acct-3", email: "three@example.com", plan: "plus" };
const HOUR_MS = 60 * 60_000;
// 测试里的检查：启动后 50 毫秒第一次，之后每 100 毫秒。
const FAST_CHECKS = { firstDelayMs: 50, intervalMs: 100 };

const tempRoots: string[] = [];

/** 一个号的读数：5 小时与每周两个窗口，另可带模型专属的窗口。 */
function reading(input: {
  session: number;
  weekly?: number;
  sessionResetsAt?: string | null;
  extra?: ProviderAccountWindow[];
  held?: boolean;
}): AccountUsageResult {
  return {
    status: "read",
    fetchedAt: new Date().toISOString(),
    windows: [
      {
        id: "five_hour",
        label: "5-hour",
        usedPct: input.session,
        resetsAt: input.sessionResetsAt ?? new Date(Date.now() + HOUR_MS).toISOString(),
      },
      {
        id: "weekly",
        label: "Weekly",
        usedPct: input.weekly ?? 10,
        resetsAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
      },
      ...(input.extra ?? []),
    ],
    ...(input.held ? { held: true } : {}),
  };
}

describe.skipIf(process.platform === "win32")("Codex automatic account rotation", () => {
  let root: string;
  let codexHome: string;
  let auth: FakeOpenAiAuth;
  let keychain: FakeCliKeychain;
  // 各号（按 ChatGPT 账号 ID）现在的读数；没有的号读不到。
  let readings: Map<string, AccountUsageResult>;
  let usageReads: AccountUsageQuery[];
  // 拨快 daemon 的时钟：每号的读数缓存 5 分钟，拨过去下一次检查就重读。
  let clock: { offsetMs: number };
  let daemons: TestPaseoDaemon[];
  let clients: DaemonClient[];
  let client: DaemonClient;

  const usage: AccountUsageReader = {
    async read(query) {
      usageReads.push(query);
      const id = query.login?.accountId ?? query.identity;
      return (
        readings.get(id) ?? { status: "failed", reason: "The fake has no reading for this account" }
      );
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-account-rotation-"));
    tempRoots.push(root);
    codexHome = path.join(root, "codex-home");
    await mkdir(codexHome, { recursive: true });
    auth = new FakeOpenAiAuth();
    await auth.start();
    keychain = new FakeCliKeychain();
    readings = new Map();
    usageReads = [];
    clock = { offsetMs: 0 };
    auth.now = () => Date.now() + clock.offsetMs;
    daemons = [];
    clients = [];
  });

  afterEach(async () => {
    await Promise.all(clients.map((each) => each.close()));
    await Promise.all(daemons.map((each) => each.close()));
    await auth.close();
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

  async function cliAccount(): Promise<string | undefined> {
    const text = await readFile(authJsonPath(), "utf8");
    return (JSON.parse(text) as { tokens?: { account_id?: string } }).tokens?.account_id;
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

  /**
   * CLI 登录着 ONE、打开轮换（ONE 成为第 1 个号），加上存着的号；然后重启成快检查的 daemon。
   * 加号时的 daemon 不检查，免得用例还没拨好读数就换了号。
   */
  async function setUp(
    saved: FakeOpenAiAccount[] = [TWO],
    cliExpiresAt = Date.now() + HOUR_MS,
  ): Promise<Record<string, string>> {
    await writeFile(authJsonPath(), cliLogin(ONE, cliExpiresAt), { mode: 0o600 });
    await startDaemon();
    const on = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(on.error).toBeNull();
    const ids: Record<string, string> = { [ONE.accountId]: on.accounts[0]!.id };
    for (const account of saved) ids[account.accountId] = await addAccount(account);
    return ids;
  }

  /**
   * 等快检查至少再跑完一整轮：每轮把时钟拨快 6 分钟（读数过期），等它重读当前号的额度。
   * 检查一轮接一轮地跑，第二轮开始读时，第一轮的判断一定已经做完。
   */
  async function checksRan(rounds = 2): Promise<void> {
    const signedInReads = () => usageReads.filter((query) => !query.login).length;
    for (let round = 0; round < rounds; round += 1) {
      const before = signedInReads();
      clock.offsetMs += 6 * 60_000;
      await expect.poll(signedInReads, { timeout: 5000 }).toBeGreaterThan(before);
    }
  }

  /** 等到这家多了一次换号，回那时的列表。 */
  async function switched(count = 1) {
    await expect
      .poll(
        async () => (await client.providerAccountList({ provider: "codex" })).switches?.length ?? 0,
        { timeout: 5000 },
      )
      .toBeGreaterThanOrEqual(count);
    return client.providerAccountList({ provider: "codex" });
  }

  test("an account at 98% of a window is switched off to the next account with room", async () => {
    const ids = await setUp();
    readings.set("acct-1", reading({ session: 98 }));
    readings.set("acct-2", reading({ session: 20 }));
    await restart({ checks: FAST_CHECKS });

    const listed = await switched();
    expect(await cliAccount()).toBe("acct-2");
    expect(listed.switches?.[0]).toMatchObject({
      from: { accountId: ids["acct-1"], email: "one@example.com" },
      to: { accountId: ids["acct-2"], email: "two@example.com" },
      reason: "used_up",
      window: { id: "five_hour", label: "5-hour", usedPct: 98 },
    });
    expect(listed.accounts.map((account) => [account.email, account.standing ?? null])).toEqual([
      ["one@example.com", "first_when_room"],
      ["two@example.com", "temporarily_first"],
    ]);
  });
  test("a window at the user's limit switches the account off, though it's below 98%", async () => {
    const ids = await setUp();
    readings.set("acct-1", reading({ session: 72 }));
    readings.set("acct-2", reading({ session: 20 }));
    const saved = await client.providerAccountSetLimits({
      provider: "codex",
      accountId: ids["acct-1"]!,
      limits: { five_hour: 70 },
    });
    expect(saved.error).toBeNull();
    expect(saved.accounts[0]?.limits).toEqual({ five_hour: 70 });
    await restart({ checks: FAST_CHECKS });

    const listed = await switched();
    expect(await cliAccount()).toBe("acct-2");
    expect(listed.switches?.[0]).toMatchObject({
      reason: "limit",
      window: { id: "five_hour", usedPct: 72, limitPct: 70 },
    });
    // 上限重启后还在。
    expect(listed.accounts[0]?.limits).toEqual({ five_hour: 70 });
  });

  test("a limit outside 1–99 is refused and nothing is saved", async () => {
    const ids = await setUp();
    for (const value of [0, 100, 12.5]) {
      const refused = await client.providerAccountSetLimits({
        provider: "codex",
        accountId: ids["acct-1"]!,
        limits: { five_hour: value },
      });
      expect(refused.error?.code).toBe("invalid_limit");
      expect(refused.accounts[0]?.limits).toBeUndefined();
    }
    const missing = await client.providerAccountSetLimits({
      provider: "codex",
      accountId: "gone",
      limits: { five_hour: 50 },
    });
    expect(missing.error?.code).toBe("not_found");
    // 清空就是都不设。
    await client.providerAccountSetLimits({
      provider: "codex",
      accountId: ids["acct-1"]!,
      limits: { five_hour: 50 },
    });
    const cleared = await client.providerAccountSetLimits({
      provider: "codex",
      accountId: ids["acct-1"]!,
      limits: {},
    });
    expect(cleared.accounts[0]?.limits).toBeUndefined();
  });

  test("once the first account is below 90% again, Osuna switches back to it", async () => {
    const ids = await setUp();
    readings.set("acct-1", reading({ session: 99 }));
    readings.set("acct-2", reading({ session: 20 }));
    await restart({ checks: FAST_CHECKS });
    await switched();

    // 91% 还不换回：免得在边上来回换。
    readings.set("acct-1", reading({ session: 91 }));
    await checksRan();
    expect(await cliAccount()).toBe("acct-2");

    readings.set("acct-1", reading({ session: 89 }));
    clock.offsetMs += 6 * 60_000;
    const listed = await switched(2);
    expect(await cliAccount()).toBe("acct-1");
    expect(listed.switches?.[0]).toMatchObject({
      from: { accountId: ids["acct-2"] },
      to: { accountId: ids["acct-1"] },
      reason: "room_again",
    });
    expect(listed.accounts.map((account) => account.standing ?? null)).toEqual([null, null]);
  });

  test("with no account that has room, Osuna stays on the account in use", async () => {
    await setUp([TWO, THREE]);
    readings.set("acct-1", reading({ session: 100 }));
    readings.set("acct-2", reading({ session: 40, weekly: 99 }));
    readings.set("acct-3", reading({ session: 98 }));
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await cliAccount()).toBe("acct-1");
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.switches ?? []).toEqual([]);
  });

  test("an account never read or read with an error is never switched to", async () => {
    const ids = await setUp([TWO, THREE]);
    readings.set("acct-1", reading({ session: 99 }));
    // TWO 读不到；THREE 读出错。
    readings.set("acct-3", { status: "failed", reason: "Codex usage API returned 500" });
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await cliAccount()).toBe("acct-1");

    // THREE 读到了且有余量：这才换过去。
    readings.set("acct-3", reading({ session: 30 }));
    clock.offsetMs += 6 * 60_000;
    const listed = await switched();
    expect(listed.switches?.[0]).toMatchObject({
      to: { accountId: ids["acct-3"] },
      reason: "used_up",
    });
  });

  test("an account that needs signing in again is never switched to", async () => {
    // CLI 自己的登录离到期还远，不跟着续。
    await setUp([TWO], Date.now() + 4 * HOUR_MS);
    readings.set("acct-1", reading({ session: 99 }));
    readings.set("acct-2", reading({ session: 10 }));
    // TWO 的 token 快到期，读额度前要续，续期被拒：它标「需要重新登录」。
    auth.refuseRefresh = "invalid_grant";
    clock.offsetMs = 59 * 60_000;
    await restart({ checks: FAST_CHECKS });
    await expect
      .poll(
        async () =>
          (await client.providerAccountList({ provider: "codex" })).accounts[1]?.needsSignIn,
        { timeout: 5000 },
      )
      .toMatchObject({ code: "invalid_grant" });
    await checksRan();
    expect(await cliAccount()).toBe("acct-1");
  });

  test("an account the Codex app won't send for is switched off, whatever its windows read", async () => {
    await setUp();
    readings.set("acct-1", reading({ session: 40, held: true }));
    readings.set("acct-2", reading({ session: 20 }));
    await restart({ checks: FAST_CHECKS });
    const listed = await switched();
    expect(listed.switches?.[0]).toMatchObject({ reason: "held" });
    expect(await cliAccount()).toBe("acct-2");
  });

  test("a window whose reset time has passed counts as started again", async () => {
    await setUp();
    readings.set(
      "acct-1",
      reading({ session: 100, sessionResetsAt: new Date(Date.now() - 60_000).toISOString() }),
    );
    readings.set("acct-2", reading({ session: 20 }));
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await cliAccount()).toBe("acct-1");
  });

  test("a model's own window doesn't count for the account", async () => {
    await setUp();
    readings.set(
      "acct-1",
      reading({
        session: 30,
        extra: [{ id: "code_review:weekly", label: "Code review · Weekly", usedPct: 100 }],
      }),
    );
    readings.set("acct-2", reading({ session: 20 }));
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await cliAccount()).toBe("acct-1");
  });

  test("Keep signed in to never switches off that account, even used up, until it's unpinned", async () => {
    const ids = await setUp();
    readings.set("acct-1", reading({ session: 100 }));
    readings.set("acct-2", reading({ session: 20 }));
    const pinned = await client.providerAccountSetKeepSignedIn({
      provider: "codex",
      accountId: ids["acct-1"]!,
    });
    expect(pinned.error).toBeNull();
    expect(pinned.settings.keepSignedInTo).toBe(ids["acct-1"]);
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await cliAccount()).toBe("acct-1");

    const unpinned = await client.providerAccountSetKeepSignedIn({
      provider: "codex",
      accountId: null,
    });
    expect(unpinned.settings.keepSignedInTo).toBeNull();
    await switched();
    expect(await cliAccount()).toBe("acct-2");
  });

  test("pinning another account signs the CLI in to it right away", async () => {
    const ids = await setUp();
    readings.set("acct-1", reading({ session: 10 }));
    readings.set("acct-2", reading({ session: 99 }));
    await client.providerAccountSetKeepSignedIn({ provider: "codex", accountId: ids["acct-2"]! });
    const listed = await switched();
    expect(await cliAccount()).toBe("acct-2");
    expect(listed.switches?.[0]).toMatchObject({ reason: "keep_signed_in" });
  });

  test("Use now is followed by a check at once: a used-up account is switched off without waiting", async () => {
    const ids = await setUp([TWO, THREE]);
    readings.set("acct-1", reading({ session: 10 }));
    readings.set("acct-2", reading({ session: 99 }));
    readings.set("acct-3", reading({ session: 10 }));
    const used = await client.providerAccountUse({ provider: "codex", accountId: ids["acct-2"]! });
    expect(used.error).toBeNull();
    const listed = await switched(2);
    expect(listed.switches?.[0]).toMatchObject({
      from: { accountId: ids["acct-2"] },
      to: { accountId: ids["acct-1"] },
      reason: "used_up",
    });
  });

  test("an account the user switched to by hand is not switched back", async () => {
    const ids = await setUp();
    readings.set("acct-1", reading({ session: 10 }));
    readings.set("acct-2", reading({ session: 10 }));
    await client.providerAccountUse({ provider: "codex", accountId: ids["acct-2"]! });
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await cliAccount()).toBe("acct-2");
  });

  test("after the account in use is removed, the next check moves to the first account with room", async () => {
    const ids = await setUp([TWO, THREE]);
    readings.set("acct-1", reading({ session: 10 }));
    readings.set("acct-2", reading({ session: 99 }));
    readings.set("acct-3", reading({ session: 10 }));
    await client.providerAccountRemove({ provider: "codex", accountId: ids["acct-1"]! });
    await restart({ checks: FAST_CHECKS });
    const listed = await switched();
    expect(await cliAccount()).toBe("acct-3");
    expect(listed.switches?.[0]).toMatchObject({ reason: "not_listed" });
  });

  test("an account moved off because it lapsed is switched back once signed in again", async () => {
    // CLI 的 token 快到期，续期被拒：ONE 失效，换到 TWO。
    const ids = await setUp([TWO], Date.now() + 2 * 60_000);
    readings.set("acct-1", reading({ session: 10 }));
    readings.set("acct-2", reading({ session: 10 }));
    auth.refuseRefresh = "invalid_grant";
    await restart({ checks: FAST_CHECKS });
    const lapsed = await switched();
    expect(lapsed.switches?.[0]).toMatchObject({ reason: "lapsed" });
    expect(lapsed.accounts[0]).toMatchObject({ standing: "first_when_room" });

    // 「重新登录」修好 ONE：马上检查，它有余量，换回去。
    auth.refuseRefresh = null;
    const started = await client.providerAccountSignInStart({
      provider: "codex",
      accountId: ids["acct-1"]!,
    });
    const code = `code-again-${Math.random()}`;
    auth.issueCode(code, ONE);
    const done = await client.providerAccountSignInSubmit({
      signInId: started.signIn!.id,
      callbackUrl: callbackUrl(started.signIn!, code),
    });
    expect(done.signIn?.status).toBe("done");
    const back = await switched(2);
    expect(back.switches?.[0]).toMatchObject({
      to: { accountId: ids["acct-1"] },
      reason: "room_again",
    });
    expect(await cliAccount()).toBe("acct-1");
  });

  test("nothing is read or switched while Read CLI sign-ins is off", async () => {
    await setUp();
    readings.set("acct-1", reading({ session: 100 }));
    readings.set("acct-2", reading({ session: 10 }));
    await client.patchDaemonConfig({ readCliSignIns: false });
    await restart({ checks: FAST_CHECKS });
    usageReads = [];
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(usageReads).toEqual([]);
    expect(await cliAccount()).toBe("acct-1");
  });
});
