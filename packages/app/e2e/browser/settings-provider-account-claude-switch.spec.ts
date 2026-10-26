import { mkdirSync, mkdtempSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
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
 * Claude Code 换号（多号轮换工单 08）：「立即使用」把存着的号的登录移进 Claude Code 的 .credentials.json，
 * 写不进时在这一节说明；开着「使用第三方接口」时这一节顶上说明订阅号用不上。测试 daemon 经封条只运行
 * 这里放的假 claude，绝不运行真的 Claude Code、不碰真实的 ~/.claude 与钥匙串、不连 Anthropic。
 */

const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-claude-switch-"));
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

async function cliAccessToken(): Promise<string | undefined> {
  const text = await readFile(path.join(claudeConfig, ".credentials.json"), "utf8");
  return (JSON.parse(text) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth
    ?.accessToken;
}

/** 在测试 daemon 上加一个存着的 Claude 号：走真的加号流程，假 claude 收下粘贴的代码。 */
async function addClaudeAccountOnDaemon(): Promise<string> {
  return withAccountsClient(async (client) => {
    const started = await client.providerAccountSignInStart({ provider: "claude" });
    if (!started.signIn) throw new Error(started.error?.message ?? "sign-in didn't start");
    const done = await client.providerAccountSignInSubmit({
      signInId: started.signIn.id,
      code: "abc123#st1",
    });
    if (done.signIn?.status !== "done") throw new Error(`sign-in ${done.signIn?.status}`);
    return done.signIn.result.accountId;
  });
}

async function openClaudePage(page: Page, width = 1280): Promise<void> {
  const serverId = getServerId();
  // 设置页从桌面宽度打开（窄窗口的入口在侧栏里），再按用例缩窄。
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, "claude");
  await expectProviderDetail(page, serverId, "claude");
  await expect(accountsSection(page)).toBeVisible();
  if (width !== 1280) {
    await page.setViewportSize({ width, height: 844 });
    await expect(accountsSection(page)).toBeVisible();
  }
}

function accountRow(page: Page, id: string) {
  return page.getByTestId(`provider-account-${id}`).filter({ visible: true });
}

async function openMenu(page: Page, id: string): Promise<void> {
  await page.getByTestId(`provider-account-menu-${id}`).filter({ visible: true }).click();
}

function menuItem(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

let ids: { cli: string; added: string };

test.describe("Claude Code account switching", () => {
  test.beforeEach(async () => {
    await resetProviderAccounts();
    await setReadCliSignInsOnDaemon(true);
    await signInCli();
    await claude.setState({ login: ADDED, usage: { [ADDED.email]: USAGE } });
    const cli = await withAccountsClient(async (client) => {
      const payload = await client.providerAccountSetRotation({
        provider: "claude",
        enabled: true,
        acknowledgeRiskNotice: true,
      });
      expect(payload.error).toBeNull();
      return payload.accounts[0]!.id;
    });
    ids = { cli, added: await addClaudeAccountOnDaemon() };
  });
  test.afterEach(async () => {
    await chmod(claudeConfig, 0o700);
    await resetProviderAccounts();
  });

  test("Use now signs Claude Code in to the account and lists the switch", async ({ page }) => {
    await openClaudePage(page);
    await expect(accountsSection(page).getByTestId("provider-accounts-rotate-hint")).toHaveText(
      "Switching only applies to new sessions; Claude Code sessions already open may also move to the new account when their sign-in expires.",
    );
    await openMenu(page, ids.added);
    await menuItem(page, "provider-account-use").click();
    await expect(accountRow(page, ids.added)).toContainText("In use");
    await expect(accountRow(page, ids.cli)).not.toContainText("In use");
    const switches = accountsSection(page).getByTestId("provider-accounts-switches");
    await expect(switches).toContainText("dev@example.com → second@example.com");
    await expect(switches).toContainText("You chose Use now");
    expect(await cliAccessToken()).toBe("access-uuid-added");
  });

  test("a switch that can't be written shows why in the section", async ({ page }) => {
    await openClaudePage(page);
    await chmod(claudeConfig, 0o500);
    await openMenu(page, ids.added);
    await menuItem(page, "provider-account-use").click();
    const notice = accountsSection(page).getByTestId("provider-accounts-switch-failure");
    await expect(notice).toContainText("Couldn't switch accounts");
    await expect(notice).toContainText("second@example.com");
    await chmod(claudeConfig, 0o700);
    expect(await cliAccessToken()).toBe("cli-access");

    // 再试一次成功，提示消失。
    await openMenu(page, ids.added);
    await menuItem(page, "provider-account-use").click();
    await expect(accountRow(page, ids.added)).toContainText("In use");
    await expect(notice).toHaveCount(0);
  });

  test("while Claude Code goes through API endpoints the section says so", async ({ page }) => {
    await installProviderAccountsRoute(page, { throughEndpoints: true });
    await openClaudePage(page);
    await expect(
      accountsSection(page).getByTestId("provider-accounts-through-endpoints"),
    ).toHaveText(
      "Claude Code is going through “Use API endpoints” now; your subscription accounts are used once you turn that switch off.",
    );
    // 轮换照常：开关仍可用、号照常列着。
    await expect(accountsSection(page).getByTestId("provider-accounts-list")).toContainText(
      "second@example.com",
    );
  });

  test("on a narrow window the row menu opens as a sheet with every item", async ({ page }) => {
    await openClaudePage(page, 390);
    await openMenu(page, ids.added);
    for (const item of [
      "provider-account-use",
      "provider-account-make-first",
      "provider-account-order-up",
      "provider-account-order-down",
      "provider-account-order-top",
      "provider-account-order-bottom",
      "provider-account-set-limits",
      "provider-account-remove",
    ]) {
      await expect(menuItem(page, item)).toBeInViewport();
    }
    await menuItem(page, "provider-account-use").click();
    await expect(accountRow(page, ids.added)).toContainText("In use");
  });
});
