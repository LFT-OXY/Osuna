import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AccountUsageReader } from "../provider-accounts/service.js";
import { codexKeyringAccount } from "../provider-accounts/codex-login.js";
import { claudeKeychainService } from "../provider-accounts/claude-login.js";
import { FakeCliKeychain } from "../test-utils/fake-cli-keychain.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 「账号」一节与「多号自动轮换」开关（工单 02）：登录只从临时目录与假钥匙串读，额度用假的读法，
 * 绝不碰真实的 ~/.codex、~/.claude 与钥匙串，也不运行真的 CLI。
 */

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

function codexAuth(input: { accountId: string; email: string; plan: string }): string {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt({
        email: input.email,
        "https://api.openai.com/auth": {
          chatgpt_account_id: input.accountId,
          chatgpt_plan_type: input.plan,
        },
      }),
      access_token: "access-secret",
      refresh_token: "refresh-single-use",
      account_id: input.accountId,
    },
  });
}

const tempRoots: string[] = [];

describe.skipIf(process.platform === "win32")("provider accounts section", () => {
  let root: string;
  let codexHome: string;
  let claudeDir: string;
  let keychain: FakeCliKeychain;
  let usageReads: string[];
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;

  const usage: AccountUsageReader = {
    async read({ provider, identity }) {
      usageReads.push(`${provider}:${identity}`);
      return {
        status: "read",
        fetchedAt: "2026-10-25T08:00:00.000Z",
        windows: [
          {
            id: "five_hour",
            label: "Session",
            usedPct: 42,
            resetsAt: "2026-10-25T10:00:00.000Z",
          },
        ],
      };
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-provider-accounts-"));
    tempRoots.push(root);
    codexHome = path.join(root, "codex-home");
    claudeDir = path.join(root, "claude-config");
    await mkdir(codexHome, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    keychain = new FakeCliKeychain();
    usageReads = [];
    await start();
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function start(): Promise<void> {
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      cliSignInsLaunchEnv: {},
      providerAccounts: {
        env: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeDir, USER: "tester" },
        homeDir: root,
        platform: "darwin",
        keychain,
        usage,
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
  }

  async function restart(): Promise<void> {
    await client.close();
    await daemon.close();
    await start();
  }

  test("advertises accountRotation and starts with rotation off and no accounts", async () => {
    await writeFile(
      path.join(codexHome, "auth.json"),
      codexAuth({ accountId: "acct-1", email: "one@example.com", plan: "plus" }),
    );
    expect(client.getLastServerInfoMessage()?.features?.accountRotation).toBe(true);
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed).toMatchObject({
      provider: "codex",
      settings: { rotationEnabled: false, riskNoticeSeen: false },
      accounts: [],
      blocked: null,
      error: null,
    });
  });

  test("turning on first asks for the risk notice, then registers the signed-in Codex account", async () => {
    await writeFile(
      path.join(codexHome, "auth.json"),
      codexAuth({ accountId: "acct-1", email: "one@example.com", plan: "plus" }),
    );
    const refused = await client.providerAccountSetRotation({ provider: "codex", enabled: true });
    expect(refused.error?.code).toBe("risk_notice_required");
    expect(refused.settings.rotationEnabled).toBe(false);
    expect(refused.accounts).toEqual([]);

    const turnedOn = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(turnedOn.error).toBeNull();
    expect(turnedOn.settings).toEqual({ rotationEnabled: true, riskNoticeSeen: true });
    expect(turnedOn.accounts).toEqual([
      {
        id: expect.any(String),
        email: "one@example.com",
        plan: "Plus",
        signedIn: true,
        usage: { status: "reading" },
      },
    ]);

    // 额度读完后，列表带上当前号的窗口。
    await expect
      .poll(
        async () => (await client.providerAccountList({ provider: "codex" })).accounts[0]?.usage,
      )
      .toEqual({
        status: "read",
        fetchedAt: "2026-10-25T08:00:00.000Z",
        windows: [
          { id: "five_hour", label: "Session", usedPct: 42, resetsAt: "2026-10-25T10:00:00.000Z" },
        ],
      });
    expect(usageReads).toEqual(["codex:acct-1"]);

    // Osuna 只记资料：账号存储里没有 token，文件与目录只有自己能读。
    const storePath = path.join(daemon.paseoHome, "accounts", "accounts.json");
    const stored = await readFile(storePath, "utf8");
    expect(stored).toContain("one@example.com");
    expect(stored).not.toContain("access-secret");
    expect(stored).not.toContain("refresh-single-use");
    expect((await stat(storePath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(storePath))).mode & 0o777).toBe(0o700);
  });

  test("the risk notice is remembered on the host and per provider", async () => {
    await writeFile(
      path.join(codexHome, "auth.json"),
      codexAuth({ accountId: "acct-1", email: "one@example.com", plan: "plus" }),
    );
    await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    await client.providerAccountSetRotation({ provider: "codex", enabled: false });
    await restart();

    // 关掉再打开、换了连接也不再问。
    const again = await client.providerAccountSetRotation({ provider: "codex", enabled: true });
    expect(again.error).toBeNull();
    expect(again.settings).toEqual({ rotationEnabled: true, riskNoticeSeen: true });

    // Claude Code 那家还没看过。
    const claude = await client.providerAccountSetRotation({ provider: "claude", enabled: true });
    expect(claude.error?.code).toBe("risk_notice_required");
    expect(claude.settings).toEqual({ rotationEnabled: false, riskNoticeSeen: false });
  });

  test("reads a Codex login kept in the keyring", async () => {
    await writeFile(
      path.join(codexHome, "config.toml"),
      'cli_auth_credentials_store = "keyring"\n',
    );
    keychain.set(
      "Codex Auth",
      codexKeyringAccount(codexHome),
      codexAuth({ accountId: "acct-k", email: "key@example.com", plan: "pro" }),
    );
    const turnedOn = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(turnedOn.accounts).toMatchObject([
      { email: "key@example.com", plan: "Pro", signedIn: true },
    ]);
  });

  test("an ephemeral Codex login can't be rotated", async () => {
    await writeFile(
      path.join(codexHome, "config.toml"),
      'cli_auth_credentials_store = "ephemeral"\n',
    );
    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.blocked).toMatchObject({ kind: "login_unsupported", code: "ephemeral" });
    const refused = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(refused.error?.code).toBe("login_unsupported");
    expect(refused.settings.rotationEnabled).toBe(false);
  });

  test("registers the signed-in Claude Code account from the keychain and .claude.json", async () => {
    keychain.set(
      claudeKeychainService(claudeDir),
      "tester",
      JSON.stringify({ claudeAiOauth: { accessToken: "claude-secret", subscriptionType: "max" } }),
    );
    await writeFile(
      path.join(claudeDir, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          accountUuid: "user-1",
          organizationUuid: "org-1",
          emailAddress: "claude@example.com",
        },
      }),
    );
    const turnedOn = await client.providerAccountSetRotation({
      provider: "claude",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(turnedOn.accounts).toMatchObject([
      { email: "claude@example.com", plan: "Max", signedIn: true },
    ]);
    await expect.poll(() => usageReads).toEqual(["claude:user-1.org-1"]);
    const stored = await readFile(path.join(daemon.paseoHome, "accounts", "accounts.json"), "utf8");
    expect(stored).not.toContain("claude-secret");
  });

  test("with Read CLI sign-ins off nothing is read and rotation can't be turned on", async () => {
    await writeFile(
      path.join(codexHome, "auth.json"),
      codexAuth({ accountId: "acct-1", email: "one@example.com", plan: "plus" }),
    );
    await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    await expect.poll(() => usageReads.length).toBe(1);
    await client.providerAccountSetRotation({ provider: "codex", enabled: false });
    await client.patchDaemonConfig({ readCliSignIns: false });
    // 登录换成读不懂的：关着时根本不读，所以照样不报读不懂。
    await writeFile(path.join(codexHome, "auth.json"), "not json");

    const listed = await client.providerAccountList({ provider: "codex" });
    expect(listed.blocked).toEqual({ kind: "cli_sign_ins_off" });
    // 存着的号保留，只是不再认得它是不是 CLI 现在登录的。
    expect(listed.accounts).toMatchObject([{ email: "one@example.com", signedIn: false }]);
    const refused = await client.providerAccountSetRotation({ provider: "codex", enabled: true });
    expect(refused.error?.code).toBe("cli_sign_ins_off");
    expect(usageReads).toHaveLength(1);
  });

  test("an unknown provider is refused", async () => {
    const listed = await client.providerAccountList({ provider: "pi" });
    expect(listed.error?.code).toBe("unsupported_provider");
  });
});
