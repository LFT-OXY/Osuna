import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProviderAccountWindow } from "@getpaseo/protocol/provider-account/rpc-schemas";
import { claudeKeychainService } from "../provider-accounts/claude-login.js";
import type {
  AccountUsageQuery,
  AccountUsageReader,
  AccountUsageResult,
} from "../provider-accounts/service.js";
import { FakeCliKeychain } from "../test-utils/fake-cli-keychain.js";
import {
  createFakeClaudeCli,
  type FakeClaudeAccount,
  type FakeClaudeCli,
} from "../test-utils/fake-claude-cli.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * Claude Code 换号（多号轮换工单 08）：「立即使用」与自动换号把存着的号的登录移进 Claude Code 的默认存储
 * （假钥匙串或 .credentials.json）、换下的号收回到它新的私有目录，.claude.json 只换 oauthAccount。
 * 存着的号的额度由假的 claude 回答 `/usage`，当前号的额度由用例拨；绝不运行真的 Claude Code、
 * 不碰真实的 ~/.claude 与钥匙串、不连 Anthropic。
 */

const CLI: FakeClaudeAccount = {
  accountUuid: "uuid-cli",
  organizationUuid: "org-cli",
  email: "dev@example.com",
  plan: "max",
};
const ADDED: FakeClaudeAccount = {
  accountUuid: "uuid-added",
  organizationUuid: "org-added",
  email: "second@example.com",
  plan: "pro",
};
const CLI_IDENTITY = "uuid-cli.org-cli";
const ADDED_IDENTITY = "uuid-added.org-added";
const CLI_CREDENTIALS = JSON.stringify({
  claudeAiOauth: {
    accessToken: "cli-access",
    refreshToken: "cli-refresh",
    subscriptionType: "max",
  },
});
// .claude.json 里 oauthAccount 之外的东西：换号时原样留着。
const OTHER_STATE = { numStartups: 7, projects: { "/work": { allowedTools: ["Bash"] } } };
const HOUR_MS = 60 * 60_000;
// 测试里的检查：启动后 50 毫秒第一次，之后每 100 毫秒。
const FAST_CHECKS = { firstDelayMs: 50, intervalMs: 100 };
const USER = "t";

const tempRoots: string[] = [];

/** 当前号的读数：5 小时与每周两个窗口，另可带模型专属的窗口。 */
function reading(input: { session: number; extra?: ProviderAccountWindow[] }): AccountUsageResult {
  return {
    status: "read",
    fetchedAt: new Date().toISOString(),
    windows: [
      {
        id: "five_hour",
        label: "Session",
        usedPct: input.session,
        resetsAt: new Date(Date.now() + HOUR_MS).toISOString(),
      },
      {
        id: "weekly",
        label: "Weekly",
        usedPct: 10,
        resetsAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
      },
      ...(input.extra ?? []),
    ],
  };
}

/** 存着的号的 `/usage` 输出（不带重置时间，免得和时钟较劲）。 */
function usageText(session: number): string {
  return [`Current session: ${session}% used`, "Current week (all models): 10% used"].join("\n");
}

describe.skipIf(process.platform === "win32")("Claude Code account switching", () => {
  let root: string;
  let paseoHome: string;
  let claudeConfig: string;
  let claude: FakeClaudeCli;
  let keychain: FakeCliKeychain;
  let platform: NodeJS.Platform;
  // 当前号（按身份）现在的读数；没有的号读不到。
  let readings: Map<string, AccountUsageResult>;
  let usageReads: AccountUsageQuery[];
  let clock: { offsetMs: number };
  let daemons: TestPaseoDaemon[];
  let clients: DaemonClient[];
  let client: DaemonClient;

  const usage: AccountUsageReader = {
    async read(query) {
      usageReads.push(query);
      return (
        readings.get(query.identity) ?? {
          status: "failed",
          reason: "The fake has no reading for this account",
        }
      );
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-claude-switch-"));
    tempRoots.push(root);
    claudeConfig = path.join(root, "claude");
    await mkdir(claudeConfig, { recursive: true });
    claude = createFakeClaudeCli(path.join(root, "fake-claude"));
    await claude.setState({ login: ADDED, usage: { [String(ADDED.email)]: usageText(20) } });
    keychain = new FakeCliKeychain();
    platform = "linux";
    readings = new Map();
    usageReads = [];
    clock = { offsetMs: 0 };
    daemons = [];
    clients = [];
  });

  afterEach(async () => {
    await Promise.all(clients.map((each) => each.close()));
    await Promise.all(daemons.map((each) => each.close()));
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function startDaemon(
    options: { checks?: { firstDelayMs: number; intervalMs: number } } = {},
  ): Promise<void> {
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      cliSignInsLaunchEnv: {},
      apiEndpoints: { env: { CLAUDE_CONFIG_DIR: claudeConfig }, homeDir: root },
      providerAccounts: {
        env: { CLAUDE_CONFIG_DIR: claudeConfig, USER, ...claude.env },
        homeDir: root,
        platform,
        keychain,
        usage,
        claude: { command: claude.command },
        now: () => Date.now() + clock.offsetMs,
        ...(options.checks ? { checks: options.checks } : {}),
      },
    });
    daemons.push(daemon);
    paseoHome = daemon.config.paseoHome;
    const next = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.17.0",
    });
    await next.connect();
    clients.push(next);
    client = next;
  }

  async function restart(options: Parameters<typeof startDaemon>[0] = {}): Promise<void> {
    await Promise.all(clients.splice(0).map((each) => each.close()));
    await Promise.all(daemons.splice(0).map((each) => each.close()));
    await startDaemon(options);
  }

  const cliCredentialsPath = () => path.join(claudeConfig, ".credentials.json");
  const keychainService = () => claudeKeychainService(claudeConfig);

  /** Claude Code 登录着 CLI 这个号：Linux 存在文件里，macOS 存在钥匙串里。 */
  async function signInCli(): Promise<void> {
    if (platform === "darwin") keychain.set(keychainService(), USER, CLI_CREDENTIALS);
    else await writeFile(cliCredentialsPath(), CLI_CREDENTIALS, { mode: 0o600 });
    await writeFile(
      path.join(claudeConfig, ".claude.json"),
      JSON.stringify(
        {
          ...OTHER_STATE,
          oauthAccount: {
            accountUuid: CLI.accountUuid,
            organizationUuid: CLI.organizationUuid,
            emailAddress: CLI.email,
          },
        },
        null,
        2,
      ),
    );
  }

  async function cliCredentials(): Promise<string | null> {
    if (platform === "darwin") return keychain.read(keychainService(), USER);
    return readFile(cliCredentialsPath(), "utf8").catch(() => null);
  }

  async function cliState(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path.join(claudeConfig, ".claude.json"), "utf8"));
  }

  async function savedDirs(): Promise<string[]> {
    const dir = path.join(paseoHome, "accounts", "claude");
    const names = await readdir(dir).catch(() => []);
    return names.map((name) => path.join(dir, name));
  }

  /** 收着某段文字的文件（在临时根目录下找，含账号存储、私有目录与 CLI 的目录）。 */
  async function filesContaining(needle: string): Promise<string[]> {
    const found: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && (await readFile(full, "utf8")).includes(needle)) {
          found.push(path.relative(root, full));
        }
      }
    }
    await walk(root);
    return found.filter((file) => !file.startsWith("fake-claude"));
  }

  async function browserComesBack(authUrl: string): Promise<void> {
    const redirect = new URL(authUrl).searchParams.get("redirect_uri");
    await fetch(`${redirect}?code=e2e-code&state=x`, { redirect: "manual" });
  }

  async function addAccount(): Promise<string> {
    const started = await client.providerAccountSignInStart({ provider: "claude" });
    if (!started.signIn) throw new Error(`no sign-in: ${started.error?.message}`);
    await browserComesBack(started.signIn.authUrl);
    let accountId: string | null = null;
    await expect
      .poll(
        async () => {
          const signIn = (await client.providerAccountSignInGet({ signInId: started.signIn!.id }))
            .signIn;
          if (signIn?.status === "done") accountId = signIn.result.accountId;
          return signIn?.status;
        },
        { timeout: 10_000 },
      )
      .toBe("done");
    return accountId!;
  }

  /** CLI 登录着 CLI 这个号、打开轮换（它成为第 1 个号），再加上 ADDED；回两个号的 ID。 */
  async function setUp(): Promise<{ cli: string; added: string }> {
    await signInCli();
    await startDaemon();
    const on = await client.providerAccountSetRotation({
      provider: "claude",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(on.error).toBeNull();
    const cli = on.accounts[0]!.id;
    const added = await addAccount();
    return { cli, added };
  }

  async function list() {
    const payload = await client.providerAccountList({ provider: "claude" });
    expect(payload.error).toBeNull();
    return payload;
  }

  async function signedInEmail(): Promise<string | undefined> {
    return (await list()).accounts.find((account) => account.signedIn)?.email;
  }

  /** 等快检查至少再跑完几整轮：每轮把时钟拨快 6 分钟（读数过期），等它重读当前号的额度。 */
  async function checksRan(rounds = 2): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      const before = usageReads.length;
      clock.offsetMs += 6 * 60_000;
      await expect.poll(() => usageReads.length, { timeout: 5000 }).toBeGreaterThan(before);
    }
  }

  async function switched(count = 1) {
    await expect
      .poll(async () => (await list()).switches?.length ?? 0, { timeout: 8000 })
      .toBeGreaterThanOrEqual(count);
    return list();
  }

  test("Use now moves the saved sign-in into .credentials.json and takes the old one back", async () => {
    const ids = await setUp();
    const [addedDir] = await savedDirs();

    const used = await client.providerAccountUse({ provider: "claude", accountId: ids.added });
    expect(used.error).toBeNull();
    expect(used.accounts.map((account) => [account.email, account.signedIn])).toEqual([
      ["dev@example.com", false],
      ["second@example.com", true],
    ]);
    expect(used.switches?.[0]).toMatchObject({
      from: { accountId: ids.cli, email: "dev@example.com" },
      to: { accountId: ids.added, email: "second@example.com" },
      reason: "use_now",
    });

    // Claude Code 的默认存储现在是目标号；.claude.json 只换了 oauthAccount。
    expect(await cliCredentials()).toContain("access-uuid-added");
    const state = await cliState();
    expect(state).toMatchObject({
      ...OTHER_STATE,
      oauthAccount: { accountUuid: "uuid-added", emailAddress: "second@example.com" },
    });
    // 目标号的私有目录清掉；换下的号收回到它新的私有目录。
    const dirs = await savedDirs();
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).not.toBe(addedDir);
    expect(await readFile(path.join(dirs[0]!, ".credentials.json"), "utf8")).toContain(
      "cli-refresh",
    );
    expect(JSON.parse(await readFile(path.join(dirs[0]!, ".claude.json"), "utf8"))).toMatchObject({
      oauthAccount: { accountUuid: "uuid-cli", emailAddress: "dev@example.com" },
    });
    // 一个登录只有一个持有者：每个 refresh token 只在一处，账号存储里没有。
    expect(await filesContaining("refresh-uuid-added")).toEqual(["claude/.credentials.json"]);
    expect(await filesContaining("cli-refresh")).toEqual([
      path.relative(root, path.join(dirs[0]!, ".credentials.json")),
    ]);

    // 换回去：两份登录各回原处。
    const back = await client.providerAccountUse({ provider: "claude", accountId: ids.cli });
    expect(back.error).toBeNull();
    expect(await cliCredentials()).toContain("cli-refresh");
    expect((await cliState()).oauthAccount).toMatchObject({ accountUuid: "uuid-cli" });
    expect(await filesContaining("cli-refresh")).toEqual(["claude/.credentials.json"]);
    expect(await filesContaining("refresh-uuid-added")).toHaveLength(1);
  });

  test("Use now on macOS writes Claude Code's keychain item on one line", async () => {
    platform = "darwin";
    const ids = await setUp();

    const used = await client.providerAccountUse({ provider: "claude", accountId: ids.added });
    expect(used.error).toBeNull();
    const item = await cliCredentials();
    expect(item).toContain("access-uuid-added");
    expect(item).not.toContain("\n");
    // 钥匙串里有登录时 Claude Code 不看文件：Osuna 也不在那里另写一份。
    expect(await readFile(cliCredentialsPath(), "utf8").catch(() => null)).toBeNull();
    expect((await cliState()).oauthAccount).toMatchObject({ accountUuid: "uuid-added" });
    const [takenBack] = await savedDirs();
    expect(await readFile(path.join(takenBack!, ".credentials.json"), "utf8")).toContain(
      "cli-refresh",
    );
    expect(await filesContaining("refresh-uuid-added")).toEqual([]);
  });

  test("a sign-in that can't be written is reported and every token stays where it was", async () => {
    const ids = await setUp();
    const [addedDir] = await savedDirs();
    await chmod(claudeConfig, 0o500);
    try {
      const used = await client.providerAccountUse({ provider: "claude", accountId: ids.added });
      expect(used.error?.code).toBe("write_failed");
      expect(used.switchFailure).toMatchObject({
        code: "write_failed",
        to: { accountId: ids.added },
      });
    } finally {
      await chmod(claudeConfig, 0o700);
    }
    expect(await cliCredentials()).toBe(CLI_CREDENTIALS);
    expect((await cliState()).oauthAccount).toMatchObject({ accountUuid: "uuid-cli" });
    expect(await savedDirs()).toEqual([addedDir]);
    expect(await signedInEmail()).toBe("dev@example.com");
  });

  test("Use now on an account whose private sign-in is gone is refused", async () => {
    const ids = await setUp();
    const [addedDir] = await savedDirs();
    await rm(path.join(addedDir!, ".credentials.json"));
    const used = await client.providerAccountUse({ provider: "claude", accountId: ids.added });
    expect(used.error?.code).toBe("needs_sign_in");
    expect(await cliCredentials()).toBe(CLI_CREDENTIALS);
  });

  test("Use now does nothing while Read CLI sign-ins is off", async () => {
    const ids = await setUp();
    await client.patchDaemonConfig({ readCliSignIns: false });
    const used = await client.providerAccountUse({ provider: "claude", accountId: ids.added });
    expect(used.error?.code).toBe("cli_sign_ins_off");
    expect(await cliCredentials()).toBe(CLI_CREDENTIALS);
  });

  test("an account at 98% is switched off to the saved account with room, and back below 90%", async () => {
    const ids = await setUp();
    readings.set(CLI_IDENTITY, reading({ session: 98 }));
    await restart({ checks: FAST_CHECKS });

    const away = await switched();
    expect(away.switches?.[0]).toMatchObject({
      from: { accountId: ids.cli },
      to: { accountId: ids.added },
      reason: "used_up",
      window: { id: "five_hour", usedPct: 98 },
    });
    expect(await cliCredentials()).toContain("access-uuid-added");

    // 换下的号现在是存着的号：它的额度由它的私有目录里的 /usage 读。
    readings.set(ADDED_IDENTITY, reading({ session: 20 }));
    await claude.setState({
      login: ADDED,
      usage: { "dev@example.com": usageText(89), "second@example.com": usageText(20) },
    });
    clock.offsetMs += 6 * 60_000;
    const back = await switched(2);
    expect(back.switches?.[0]).toMatchObject({ to: { accountId: ids.cli }, reason: "room_again" });
    expect(await cliCredentials()).toContain("cli-refresh");
  });

  test("Keep signed in to never switches off that account, even used up", async () => {
    const ids = await setUp();
    readings.set(CLI_IDENTITY, reading({ session: 100 }));
    const pinned = await client.providerAccountSetKeepSignedIn({
      provider: "claude",
      accountId: ids.cli,
    });
    expect(pinned.error).toBeNull();
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await signedInEmail()).toBe("dev@example.com");
    expect(await cliCredentials()).toBe(CLI_CREDENTIALS);
  });

  test("a saved account whose usage was never read is never switched to", async () => {
    await setUp();
    await claude.setState({ login: ADDED, usage: {} });
    readings.set(CLI_IDENTITY, reading({ session: 100 }));
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await signedInEmail()).toBe("dev@example.com");
  });

  test("a model's own weekly window doesn't count for the account", async () => {
    await setUp();
    readings.set(
      CLI_IDENTITY,
      reading({
        session: 30,
        extra: [{ id: "weekly_model_opus", label: "Weekly · Opus", usedPct: 100, resetsAt: null }],
      }),
    );
    await restart({ checks: FAST_CHECKS });
    await checksRan();
    expect(await signedInEmail()).toBe("dev@example.com");
  });

  test("nothing is switched while Read CLI sign-ins is off", async () => {
    await setUp();
    readings.set(CLI_IDENTITY, reading({ session: 100 }));
    await client.patchDaemonConfig({ readCliSignIns: false });
    await restart({ checks: FAST_CHECKS });
    usageReads = [];
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(usageReads).toEqual([]);
    expect(await cliCredentials()).toBe(CLI_CREDENTIALS);
  });

  test("the section says when Claude Code goes through a third-party endpoint", async () => {
    await setUp();
    expect((await list()).throughEndpoints).toBeUndefined();
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example/api/",
      apiKey: "sk-relay",
      models: [{ id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
    });
    if (!saved.endpoint) throw new Error(`Saving failed: ${saved.error?.message}`);
    await client.apiEndpointSetActive("claude", saved.endpoint.id);
    expect((await list()).throughEndpoints).toBe(true);
    await client.apiEndpointSetActive("claude", null);
    expect((await list()).throughEndpoints).toBeUndefined();
  });
});
