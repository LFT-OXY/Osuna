import { mkdirSync, mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { setReadCliSignInsOnDaemon } from "../support/helpers/host-privacy";
import {
  accountsSection,
  codexAuthJson,
  expectRotateSwitch,
  installProviderAccountsRoute,
  resetProviderAccounts,
  riskNotice,
  rotateSwitch,
  rotationOnDaemon,
} from "../support/helpers/provider-accounts";
import { getServerId } from "../support/helpers/server-id";
import {
  clickProviderRow,
  expectProviderDetail,
  expectProvidersList,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";

// 「账号」一节读 CLI 自己的登录：指到临时目录，钥匙串经封条读假的，绝不碰开发者真实的登录。
const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-provider-accounts-"));
const codexHome = path.join(cliHome, "codex");
const claudeDir = path.join(cliHome, "claude");
mkdirSync(codexHome, { recursive: true });
mkdirSync(claudeDir, { recursive: true });
test.use({
  e2eDaemonEnvironment: {
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeDir,
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_KEYCHAIN_PATH: path.join(cliHome, "keychain.json"),
    HOME: path.join(cliHome, "home"),
  },
});

const WIDE_VIEWPORT = { width: 1280, height: 800 };

const CODEX_ACCOUNT = { accountId: "acct-e2e-1", email: "dev@example.com", plan: "plus" };

async function signInCodex(): Promise<void> {
  await writeFile(path.join(codexHome, "auth.json"), codexAuthJson(CODEX_ACCOUNT));
}

async function signInClaude(): Promise<void> {
  await writeFile(
    path.join(claudeDir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "e2e-claude", subscriptionType: "max" } }),
  );
  await writeFile(
    path.join(claudeDir, ".claude.json"),
    JSON.stringify({
      oauthAccount: {
        accountUuid: "user-e2e",
        organizationUuid: "org-e2e",
        emailAddress: "claude@example.com",
      },
    }),
  );
}

async function openProviderPage(page: Page, provider: "codex" | "claude"): Promise<void> {
  const serverId = getServerId();
  await page.setViewportSize(WIDE_VIEWPORT);
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, provider);
  await expectProviderDetail(page, serverId, provider);
  await expect(accountsSection(page)).toBeVisible();
}

test.describe("Provider page Accounts section", () => {
  test.beforeEach(async () => {
    await resetProviderAccounts();
    await setReadCliSignInsOnDaemon(true);
    await rm(path.join(codexHome, "auth.json"), { force: true });
    await rm(path.join(claudeDir, ".credentials.json"), { force: true });
    await rm(path.join(claudeDir, ".claude.json"), { force: true });
  });
  test.afterEach(async () => {
    await setReadCliSignInsOnDaemon(true);
    await resetProviderAccounts();
  });

  test("Cancel in the risk notice keeps rotation off; confirming turns it on with the signed-in account first", async ({
    page,
  }) => {
    await signInCodex();
    await installProviderAccountsRoute(page, {
      windows: [
        { id: "five_hour", label: "Session", usedPct: 42, resetsAt: "2026-10-25T12:00:00.000Z" },
      ],
    });
    await openProviderPage(page, "codex");
    const section = accountsSection(page);
    await expect(section).toContainText("Accounts");
    await expect(section.getByTestId("provider-accounts-rotate-hint")).toHaveText(
      "Switching only applies to new sessions; open sessions stay on their account. Requests go through Osuna, so while Osuna isn't running, Codex in a terminal can't connect.",
    );
    await expectRotateSwitch(page, { checked: false, disabled: false });

    await rotateSwitch(page).click();
    const notice = riskNotice(page);
    await expect(notice).toContainText(
      "Rotating accounts may get your ChatGPT account limited or banned",
    );
    await expect(notice.getByRole("link", { name: /Sign in with ChatGPT terms/ })).toBeVisible();
    await expect(notice.getByRole("link", { name: /The maintainer's words/ })).toBeVisible();
    await notice.getByTestId("provider-accounts-risk-cancel").click();
    await expect(notice).toHaveCount(0);
    await expectRotateSwitch(page, { checked: false, disabled: false });
    expect(await rotationOnDaemon("codex")).toBe(false);

    await rotateSwitch(page).click();
    await riskNotice(page).getByTestId("provider-accounts-risk-confirm").click();
    await expectRotateSwitch(page, { checked: true, disabled: false });
    await expect.poll(() => rotationOnDaemon("codex")).toBe(true);
    const list = section.getByTestId("provider-accounts-list");
    await expect(list).toContainText("dev@example.com");
    await expect(list).toContainText("Plus");
    await expect(list).toContainText("In use");
    await expect(list).toContainText("First");
    await expect(list.getByTestId("provider-account-usage")).toContainText("Session");
    await expect(section.getByTestId("provider-accounts-single")).toHaveText(
      "Add another account to start rotating.",
    );

    // 关掉再打开不再问。
    await rotateSwitch(page).click();
    await expectRotateSwitch(page, { checked: false, disabled: false });
    await rotateSwitch(page).click();
    await expect(riskNotice(page)).toHaveCount(0);
    await expectRotateSwitch(page, { checked: true, disabled: false });
  });

  test("Claude Code shows Anthropic's notice, and with no sign-in the list says so", async ({
    page,
  }) => {
    await openProviderPage(page, "claude");
    await rotateSwitch(page).click();
    const notice = riskNotice(page);
    await expect(notice).toContainText(
      "Rotating accounts may get your Claude account limited or banned",
    );
    await expect(notice.getByRole("link", { name: /Usage policy/ })).toBeVisible();
    await expect(notice.getByRole("link", { name: /Claude Code legal page/ })).toBeVisible();
    await notice.getByTestId("provider-accounts-risk-confirm").click();
    await expectRotateSwitch(page, { checked: true, disabled: false });
    await expect(accountsSection(page).getByTestId("provider-accounts-empty")).toContainText(
      "No accounts yet.",
    );

    // CLI 后来登录了：重读时那个号成为第一个号。
    await signInClaude();
    await page.reload();
    await expect(accountsSection(page).getByTestId("provider-accounts-list")).toContainText(
      "claude@example.com",
    );
  });

  test("a refused save puts the switch back and keeps the reason until a retry", async ({
    page,
  }) => {
    await signInCodex();
    await installProviderAccountsRoute(page, {
      failSetRotation: { reason: "daemon is busy", times: 1 },
    });
    await openProviderPage(page, "codex");
    await rotateSwitch(page).click();
    await riskNotice(page).getByTestId("provider-accounts-risk-confirm").click();
    const error = page.getByTestId("provider-accounts-rotate-error").filter({ visible: true });
    await expect(error).toHaveText("Couldn't save Rotate accounts: daemon is busy");
    await expectRotateSwitch(page, { checked: false, disabled: false });
    expect(await rotationOnDaemon("codex")).toBe(false);

    await rotateSwitch(page).click();
    await riskNotice(page).getByTestId("provider-accounts-risk-confirm").click();
    await expectRotateSwitch(page, { checked: true, disabled: false });
    await expect(error).toHaveCount(0);
  });

  test("a view-only device sees the section but can't change the switch", async ({ page }) => {
    await installProviderAccountsRoute(page, { readOnly: true });
    await openProviderPage(page, "codex");
    await expectRotateSwitch(page, { checked: false, disabled: true });
  });

  test("with Read CLI sign-ins off the section says so and links to the switch", async ({
    page,
  }) => {
    await setReadCliSignInsOnDaemon(false);
    await openProviderPage(page, "codex");
    const notice = accountsSection(page).getByTestId("provider-accounts-cli-sign-ins-off");
    await expect(notice).toContainText(
      "“Read CLI sign-ins” is off, so Rotate accounts has stopped",
    );
    await expectRotateSwitch(page, { checked: false, disabled: true });
    await notice.getByTestId("provider-accounts-open-privacy").click();
    await expect(page.getByTestId("host-privacy-section").filter({ visible: true })).toBeVisible();
  });
});
