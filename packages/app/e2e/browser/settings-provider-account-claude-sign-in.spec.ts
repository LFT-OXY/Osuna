import { mkdirSync, mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFakeClaudeCli } from "../../../server/src/server/test-utils/fake-claude-cli";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { setReadCliSignInsOnDaemon } from "../support/helpers/host-privacy";
import {
  accountsSection,
  installProviderAccountsRoute,
  resetProviderAccounts,
  signInSheet,
  withAccountsClient,
} from "../support/helpers/provider-accounts";
import { getServerId } from "../support/helpers/server-id";
import {
  clickProviderRow,
  expectProviderDetail,
  expectProvidersList,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";

/*
 * Claude Code 加号对话框（多号轮换工单 07）。测试 daemon 经封条只运行这里放的假 claude（只答 `auth login` 与
 * `/usage`），绝不运行真的 Claude Code、不连 Anthropic。浏览器测试的页面不是主机上的桌面端，所以对话框里
 * 是 Claude 登录页显示代码的那个链接和粘贴代码的输入框。
 */

const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-claude-sign-in-"));
const claudeConfig = path.join(cliHome, "claude");
mkdirSync(claudeConfig, { recursive: true });
const claude = createFakeClaudeCli(path.join(cliHome, "fake-claude"));
test.use({
  e2eDaemonEnvironment: {
    CODEX_HOME: path.join(cliHome, "codex"),
    CLAUDE_CONFIG_DIR: claudeConfig,
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_KEYCHAIN_PATH: path.join(cliHome, "keychain.json"),
    PASEO_E2E_CLAUDE_COMMAND: claude.command,
    ...claude.env,
    HOME: path.join(cliHome, "home"),
  },
});

const ADDED = {
  accountUuid: "uuid-added",
  organizationUuid: "org-added",
  email: "second@example.com",
  plan: "pro",
};
const USAGE = "Current session: 13% used\nCurrent week (all models): 41% used";

async function signInCli(): Promise<void> {
  await writeFile(
    path.join(claudeConfig, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "cli-access", subscriptionType: "max" } }),
  );
  await writeFile(
    path.join(claudeConfig, ".claude.json"),
    JSON.stringify({
      oauthAccount: {
        accountUuid: "uuid-cli",
        organizationUuid: "org-cli",
        emailAddress: "dev@example.com",
      },
    }),
  );
}

async function openClaudePage(page: Page): Promise<void> {
  const serverId = getServerId();
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, "claude");
  await expectProviderDetail(page, serverId, "claude");
  await expect(accountsSection(page)).toBeVisible();
}

async function paste(page: Page, code: string): Promise<void> {
  await page.getByTestId("account-sign-in-paste-input").filter({ visible: true }).fill(code);
  await page.getByTestId("account-sign-in-paste-submit").filter({ visible: true }).click();
}

test.describe("Claude Code add account", () => {
  test.beforeEach(async () => {
    await resetProviderAccounts();
    await setReadCliSignInsOnDaemon(true);
    await signInCli();
    await claude.setState({ login: ADDED, usage: { [ADDED.email]: USAGE } });
    await withAccountsClient(async (client) => {
      const payload = await client.providerAccountSetRotation({
        provider: "claude",
        enabled: true,
        acknowledgeRiskNotice: true,
      });
      expect(payload.error).toBeNull();
    });
  });
  test.afterEach(async () => {
    await resetProviderAccounts();
  });

  test("pasting the code Claude's page shows adds the account", async ({ page }) => {
    await openClaudePage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    const sheet = signInSheet(page);
    await expect(sheet).toContainText("Add a Claude account");
    await expect(sheet.getByTestId("account-sign-in-waiting")).toContainText(
      "Sign in with the Claude account you want to add.",
    );
    await expect(sheet.getByTestId("account-sign-in-copy")).toBeVisible();
    await expect(sheet).toContainText("Code from the sign-in page");

    // 远程设备打开的是 Claude 打印的那个链接（登录完显示代码），不是跳回主机的那个。
    const popup = page.context().waitForEvent("page");
    await page.route("https://claude.ai/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<p>Claude</p>" }),
    );
    await sheet.getByTestId("account-sign-in-open").click();
    const opened = await popup;
    expect(opened.url()).toContain("https://claude.ai/oauth/authorize?code=true");
    await opened.close();

    await paste(page, "not a code");
    await expect(sheet.getByTestId("account-sign-in-paste-error")).toHaveText(
      "Paste the code the sign-in page shows.",
    );
    await paste(page, "abc123#st1");
    await expect(sheet).toHaveCount(0);
    const list = accountsSection(page).getByTestId("provider-accounts-list");
    await expect(list).toContainText("second@example.com");
    await expect(list).toContainText("dev@example.com");
  });

  test("a failed sign-in keeps its reason in the box until a retry works", async ({ page }) => {
    await claude.setState({ loginMode: "fail", failMessage: "OAuth error: access_denied" });
    await openClaudePage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    const sheet = signInSheet(page);
    await expect(sheet.getByTestId("account-sign-in-failed")).toContainText(
      "OAuth error: access_denied",
    );

    await claude.setState({ login: ADDED, usage: { [ADDED.email]: USAGE } });
    await sheet.getByTestId("account-sign-in-retry").click();
    await expect(sheet.getByTestId("account-sign-in-waiting")).toBeVisible();
    await paste(page, "abc123#st1");
    await expect(sheet).toHaveCount(0);
    await expect(accountsSection(page).getByTestId("provider-accounts-list")).toContainText(
      "second@example.com",
    );
  });

  test("a sign-in that recorded no email says why it wasn't added", async ({ page }) => {
    await claude.setState({ login: { ...ADDED, email: undefined } });
    await openClaudePage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    await paste(page, "abc123#st1");
    await expect(signInSheet(page).getByTestId("account-sign-in-failed")).toContainText(
      "Claude Code didn't record the account's email, so it wasn't added.",
    );
  });

  test("an account that needs signing in again is fixed by Sign in again", async ({ page }) => {
    await openClaudePage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    await paste(page, "abc123#st1");
    await expect(accountsSection(page).getByTestId("provider-accounts-list")).toContainText(
      "second@example.com",
    );

    await installProviderAccountsRoute(page, {
      needsSignIn: { reason: "Not logged in", code: "signed_out", email: "second@example.com" },
    });
    await page.reload();
    const list = accountsSection(page).getByTestId("provider-accounts-list");
    await expect(list).toContainText("Needs sign-in");
    await list.getByTestId("provider-account-sign-in-again").click();
    const sheet = signInSheet(page);
    await expect(sheet).toContainText("Sign in again to second@example.com");
    await paste(page, "abc123#st1");
    await expect(sheet).toHaveCount(0);
    await expect(accountsSection(page).getByTestId("provider-accounts-already-added")).toHaveText(
      "second@example.com was already in the list, so its sign-in was updated.",
    );
  });
});
