import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProviderAccountSignIn } from "@getpaseo/protocol/provider-account/rpc-schemas";
import { FakeCliKeychain } from "../test-utils/fake-cli-keychain.js";
import {
  createFakeClaudeCli,
  type FakeClaudeAccount,
  type FakeClaudeCli,
} from "../test-utils/fake-claude-cli.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * Claude Code 加号与存着的号的额度（多号轮换工单 07）：Osuna 在每个号的私有 CLAUDE_CONFIG_DIR 里运行
 * 假的 claude（只答 `auth login` 与 `/usage`），绝不运行真的 Claude Code、不碰真实的 ~/.claude 与钥匙串、
 * 不连 Anthropic。登录存在文件里（platform 为 linux），钥匙串是假的。
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

const USAGE_TEXT = [
  "Current session: 13% used · resets 3pm (UTC)",
  "Current week (all models): 41% used · resets Oct 30 at 2pm (UTC)",
  "Current week (Fable): 5% used",
].join("\n");

const tempRoots: string[] = [];

describe.skipIf(process.platform === "win32")("Claude Code sign-in and saved accounts", () => {
  let root: string;
  let paseoHome: string;
  let claudeConfig: string;
  let claude: FakeClaudeCli;
  let keychain: FakeCliKeychain;
  let daemons: TestPaseoDaemon[];
  let clients: DaemonClient[];
  let client: DaemonClient;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-claude-accounts-"));
    tempRoots.push(root);
    claudeConfig = path.join(root, "claude");
    await mkdir(claudeConfig, { recursive: true });
    await signInCli(CLI);
    claude = createFakeClaudeCli(path.join(root, "fake-claude"));
    await claude.setState({ login: ADDED, usage: { [String(ADDED.email)]: USAGE_TEXT } });
    keychain = new FakeCliKeychain();
    daemons = [];
    clients = [];
    client = await startDaemon();
  });

  afterEach(async () => {
    await Promise.all(clients.map((each) => each.close()));
    await Promise.all(daemons.map((each) => each.close()));
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function signInCli(account: FakeClaudeAccount): Promise<void> {
    await writeFile(
      path.join(claudeConfig, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { accessToken: "cli-access", subscriptionType: account.plan },
      }),
    );
    await writeFile(
      path.join(claudeConfig, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          accountUuid: account.accountUuid,
          organizationUuid: account.organizationUuid,
          emailAddress: account.email,
        },
      }),
    );
  }

  async function startDaemon(
    options: { signInTimeoutMs?: number; linkWaitMs?: number } = {},
  ): Promise<DaemonClient> {
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      cliSignInsLaunchEnv: {},
      providerAccounts: {
        env: { CLAUDE_CONFIG_DIR: claudeConfig, USER: "t", ...claude.env },
        homeDir: root,
        platform: "linux",
        keychain,
        claude: { command: claude.command, ...options },
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
    return next;
  }

  async function turnOnRotation(): Promise<void> {
    const payload = await client.providerAccountSetRotation({
      provider: "claude",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(payload.error).toBeNull();
  }

  async function startSignIn(accountId?: string): Promise<ProviderAccountSignIn> {
    const started = await client.providerAccountSignInStart({
      provider: "claude",
      ...(accountId ? { accountId } : {}),
    });
    expect(started.error).toBeNull();
    expect(started.signIn?.status).toBe("waiting");
    return started.signIn!;
  }

  async function settled(signInId: string): Promise<ProviderAccountSignIn> {
    let latest: ProviderAccountSignIn | null = null;
    await expect
      .poll(
        async () => {
          latest = (await client.providerAccountSignInGet({ signInId })).signIn;
          return latest?.status;
        },
        { timeout: 10_000 },
      )
      .not.toBe("waiting");
    return latest!;
  }

  /** 浏览器在 Claude 登录完跳回 Claude Code 在本机等着的地址。 */
  async function browserComesBack(authUrl: string): Promise<void> {
    const redirect = new URL(authUrl).searchParams.get("redirect_uri");
    expect(redirect).toMatch(/^http:\/\/localhost:\d+\/callback$/);
    await fetch(`${redirect}?code=e2e-code&state=x`, { redirect: "manual" });
  }

  async function listed() {
    const payload = await client.providerAccountList({ provider: "claude" });
    expect(payload.error).toBeNull();
    return payload.accounts;
  }

  test("signing in through the link Claude Code opens adds the account", async () => {
    await turnOnRotation();
    const signIn = await startSignIn();
    expect(signIn.callbackBlocked).toBe(false);
    expect(signIn.codeUrl).toMatch(/^https:\/\/claude\.ai\/oauth\/authorize\?code=true/);

    await browserComesBack(signIn.authUrl);
    const done = await settled(signIn.id);
    expect(done).toMatchObject({
      status: "done",
      result: { email: "second@example.com", alreadyAdded: false },
    });

    const accounts = await listed();
    expect(accounts.map((account) => [account.email, account.plan, account.signedIn])).toEqual([
      ["dev@example.com", "Max", true],
      ["second@example.com", "Pro", false],
    ]);
    const [run] = await claude.runs();
    expect(run?.args).toEqual(["auth", "login", "--claudeai"]);
    // 登录在账号存储下这个号自己的配置目录里，不在 CLI 的目录。
    expect(path.dirname(run?.configDir ?? "")).toBe(path.join(paseoHome, "accounts", "claude"));
    expect(run?.browser).not.toBeNull();
    const credentials = await readFile(path.join(run!.configDir!, ".credentials.json"), "utf8");
    expect(credentials).toContain("access-uuid-added");
    // CLI 自己的登录没被动过。
    expect(await readFile(path.join(claudeConfig, ".credentials.json"), "utf8")).toContain(
      "cli-access",
    );
  });
  async function savedDirs(): Promise<string[]> {
    return readdir(path.join(paseoHome, "accounts", "claude")).catch(() => []);
  }

  async function addAccount(): Promise<string> {
    const signIn = await startSignIn();
    await browserComesBack(signIn.authUrl);
    const done = await settled(signIn.id);
    if (done.status !== "done") throw new Error(`sign-in ended ${done.status}`);
    return done.result.accountId;
  }

  async function usageOf(accountId: string) {
    let usage: unknown;
    await expect
      .poll(
        async () => {
          const account = (await listed()).find((each) => each.id === accountId);
          usage = account?.usage;
          return account?.usage.status;
        },
        { timeout: 10_000 },
      )
      .not.toBe("reading");
    return usage;
  }

  test("on another device the code Claude's page shows finishes the sign-in", async () => {
    await turnOnRotation();
    const signIn = await startSignIn();

    const wrong = await client.providerAccountSignInSubmit({ signInId: signIn.id, code: "nope" });
    expect(wrong.error?.code).toBe("code_invalid");
    expect(wrong.signIn?.status).toBe("waiting");

    const pasted = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      code: "abc123#st1",
    });
    expect(pasted.error).toBeNull();
    expect(pasted.signIn).toMatchObject({
      status: "done",
      result: { email: "second@example.com" },
    });
  });

  test("when Claude Code opens no page, only pasting the code finishes it", async () => {
    await claude.setState({ login: ADDED, loginMode: "no_browser" });
    const signIn = await startSignIn();
    expect(signIn.callbackBlocked).toBe(true);
    expect(signIn.authUrl).toBe(signIn.codeUrl);
    const pasted = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      code: "abc123#st1",
    });
    expect(pasted.signIn?.status).toBe("done");
  });

  test("a canceled sign-in stops claude auth login and leaves nothing behind", async () => {
    const signIn = await startSignIn();
    const canceled = await client.providerAccountSignInCancel({ signInId: signIn.id });
    expect(canceled.signIn?.status).toBe("canceled");
    await expect.poll(savedDirs).toEqual([]);
    expect(await listed()).toHaveLength(0);
  });

  test("a sign-in not finished in time fails as timed out and can be retried", async () => {
    await Promise.all(clients.splice(0).map((each) => each.close()));
    await Promise.all(daemons.splice(0).map((each) => each.close()));
    client = await startDaemon({ signInTimeoutMs: 300 });
    const signIn = await startSignIn();
    const failed = await settled(signIn.id);
    expect(failed).toMatchObject({ status: "failed", error: { code: "timed_out" } });
    await expect.poll(savedDirs).toEqual([]);

    await addAccount();
    expect((await listed()).map((account) => account.email)).toContain("second@example.com");
  });

  test("a claude auth login that gives no link fails to start with what it said", async () => {
    await Promise.all(clients.splice(0).map((each) => each.close()));
    await Promise.all(daemons.splice(0).map((each) => each.close()));
    client = await startDaemon({ linkWaitMs: 300 });
    await claude.setState({ loginMode: "silent" });
    const started = await client.providerAccountSignInStart({ provider: "claude" });
    expect(started.signIn).toBeNull();
    expect(started.error?.message).toContain("claude auth login gave no link to open");
    await expect.poll(savedDirs).toEqual([]);
  });

  test("a claude auth login that fails ends the sign-in with its last words", async () => {
    await claude.setState({ loginMode: "fail", failMessage: "OAuth error: access_denied" });
    const started = await client.providerAccountSignInStart({ provider: "claude" });
    expect(started.signIn).toBeNull();
    expect(started.error?.message).toBe("OAuth error: access_denied");
  });

  test("signing in to an account already in the list updates it and says so", async () => {
    await turnOnRotation();
    const first = await addAccount();
    const [firstDir] = await savedDirs();
    const signIn = await startSignIn();
    await browserComesBack(signIn.authUrl);
    expect(await settled(signIn.id)).toMatchObject({
      status: "done",
      result: { accountId: first, alreadyAdded: true },
    });
    expect(await listed()).toHaveLength(2);
    // 用新登录的目录，旧目录清掉。
    const dirs = await savedDirs();
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).not.toBe(firstDir);
  });

  test("adding the account Claude Code is signed in to keeps no second sign-in", async () => {
    await turnOnRotation();
    await claude.setState({ login: CLI });
    const signIn = await startSignIn();
    await browserComesBack(signIn.authUrl);
    expect(await settled(signIn.id)).toMatchObject({
      status: "done",
      result: { email: "dev@example.com", alreadyAdded: true },
    });
    expect(await listed()).toHaveLength(1);
    await expect.poll(savedDirs).toEqual([]);
  });

  test("pasting the address a browser ended on finishes a sign-in Claude Code opened", async () => {
    const signIn = await startSignIn();
    const redirect = new URL(signIn.authUrl).searchParams.get("redirect_uri")!;

    const elsewhere = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      code: "http://localhost:1/callback?code=x",
    });
    expect(elsewhere.error?.code).toBe("paste_mismatch");

    const pasted = await client.providerAccountSignInSubmit({
      signInId: signIn.id,
      code: `${redirect}?code=e2e-code&state=x`,
    });
    expect(pasted.error).toBeNull();
    expect(pasted.signIn).toMatchObject({
      status: "done",
      result: { email: "second@example.com" },
    });
  });

  test("an email .claude.json didn't record is taken from claude auth status", async () => {
    await claude.setState({
      login: { ...ADDED, email: undefined },
      statusEmail: "status@example.com",
    });
    const signIn = await startSignIn();
    await browserComesBack(signIn.authUrl);
    expect(await settled(signIn.id)).toMatchObject({
      status: "done",
      result: { email: "status@example.com", alreadyAdded: false },
    });
    expect((await claude.runs()).map((run) => run.args.slice(0, 2))).toContainEqual([
      "auth",
      "status",
    ]);
  });

  test("a sign-in that recorded no email is refused", async () => {
    await claude.setState({ login: { ...ADDED, email: undefined } });
    const signIn = await startSignIn();
    await browserComesBack(signIn.authUrl);
    expect(await settled(signIn.id)).toMatchObject({
      status: "failed",
      error: { code: "no_email" },
    });
    expect(await listed()).toHaveLength(0);
    await expect.poll(savedDirs).toEqual([]);
  });

  test("a saved account's usage is read by running /usage in its own directory", async () => {
    await turnOnRotation();
    const added = await addAccount();
    const usage = await usageOf(added);
    expect(usage).toMatchObject({
      status: "read",
      windows: [
        { id: "five_hour", label: "Session", usedPct: 13 },
        { id: "weekly", label: "Weekly", usedPct: 41 },
        { id: "weekly_model_fable", label: "Weekly · Fable", usedPct: 5, resetsAt: null },
      ],
    });
    const run = (await claude.runs()).find((each) => each.args[1] === "/usage");
    expect(run?.args).toEqual([
      "-p",
      "/usage",
      "--output-format",
      "json",
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--no-session-persistence",
    ]);
    expect(path.basename(run?.configDir ?? "")).toBe((await savedDirs())[0]);
    // 临时工作目录，不在号的目录里。
    expect(run?.cwd.startsWith(run?.configDir ?? "")).toBe(false);
  });

  test("a saved account /usage says is signed out needs signing in again until it does", async () => {
    await turnOnRotation();
    const added = await addAccount();
    await claude.setState({ login: ADDED, revoked: ["second@example.com"] });
    expect(await usageOf(added)).toMatchObject({ status: "failed", code: "needs_sign_in" });
    const lapsed = (await listed()).find((account) => account.id === added);
    expect(lapsed?.needsSignIn?.code).toBe("signed_out");

    await claude.setState({ login: ADDED, usage: { "second@example.com": USAGE_TEXT } });
    const again = await startSignIn(added);
    await browserComesBack(again.authUrl);
    expect(await settled(again.id)).toMatchObject({ status: "done", result: { accountId: added } });
    const fixed = (await listed()).find((account) => account.id === added);
    expect(fixed?.needsSignIn).toBeUndefined();
  });

  test("signing in again to another account changes nothing", async () => {
    const added = await addAccount();
    await claude.setState({
      login: { accountUuid: "u3", organizationUuid: "o3", email: "third@example.com" },
    });
    const again = await startSignIn(added);
    await browserComesBack(again.authUrl);
    expect(await settled(again.id)).toMatchObject({
      status: "failed",
      error: { code: "different_account" },
    });
    expect((await listed()).map((account) => account.email)).toEqual(["second@example.com"]);
  });

  test("removing a saved account removes its directory", async () => {
    const added = await addAccount();
    expect(await savedDirs()).toHaveLength(1);
    const removed = await client.providerAccountRemove({ provider: "claude", accountId: added });
    expect(removed.error).toBeNull();
    expect(await savedDirs()).toEqual([]);
  });

  test("with Read CLI sign-ins off nothing is added and claude never runs", async () => {
    await turnOnRotation();
    await addAccount();
    await client.patchDaemonConfig({ readCliSignIns: false });
    const runsBefore = (await claude.runs()).length;
    const started = await client.providerAccountSignInStart({ provider: "claude" });
    expect(started.error?.code).toBe("cli_sign_ins_off");
    const payload = await client.providerAccountList({ provider: "claude" });
    expect(payload.blocked).toEqual({ kind: "cli_sign_ins_off" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await claude.runs()).toHaveLength(runsBefore);
  });
});
