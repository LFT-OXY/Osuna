import { mkdirSync, mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { setReadCliSignInsOnDaemon } from "../support/helpers/host-privacy";
import {
  accountsSection,
  callbackFor,
  codexAuthJson,
  fakeOpenAiTokens,
  installProviderAccountsRoute,
  resetProviderAccounts,
  setFakeOpenAiToken,
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
 * Codex 加号对话框（多号轮换工单 03）。测试 daemon 的回调端口经封条换成空端口，换 token 由封条的假外网回答；
 * 浏览器里的「OpenAI 登录页」由 Playwright 拦下，直接把浏览器送回 daemon 的回调地址。绝不连 OpenAI。
 * 浏览器测试的页面不是主机上的桌面端，所以对话框里总有粘贴地址的输入框。
 */

const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-account-sign-in-"));
const codexHome = path.join(cliHome, "codex");
const fakeSites = path.join(cliHome, "fake-sites.json");
mkdirSync(codexHome, { recursive: true });
test.use({
  e2eDaemonEnvironment: {
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: path.join(cliHome, "claude"),
    PASEO_CLAUDE_MANAGED_SETTINGS_DIR: path.join(cliHome, "managed"),
    PASEO_E2E_KEYCHAIN_PATH: path.join(cliHome, "keychain.json"),
    PASEO_E2E_FAKE_SITES_PATH: fakeSites,
    HOME: path.join(cliHome, "home"),
  },
});

const SIGNED_IN = { accountId: "acct-cli", email: "dev@example.com", plan: "plus" };
const ADDED = { accountId: "acct-added", email: "second@example.com", plan: "pro" };

async function openCodexPage(page: Page): Promise<void> {
  const serverId = getServerId();
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, "codex");
  await expectProviderDetail(page, serverId, "codex");
  await expect(accountsSection(page)).toBeVisible();
}

async function turnOnRotation(): Promise<void> {
  await withAccountsClient(async (client) => {
    const payload = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(payload.error).toBeNull();
  });
}

/** 点「打开登录页」：拦下 OpenAI 的登录页，拿到它的地址；redirect 为真时像登录完一样把浏览器送回回调地址。 */
async function openSignInPage(page: Page, input: { redirect: boolean }): Promise<string> {
  let authUrl = "";
  await page.context().route("https://auth.openai.com/oauth/authorize**", async (route) => {
    authUrl = route.request().url();
    if (input.redirect) {
      await route.fulfill({ status: 302, headers: { location: callbackFor(authUrl, "e2e-code") } });
    } else {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<p>OpenAI</p>" });
    }
  });
  const popup = page.context().waitForEvent("page");
  await page.getByTestId("account-sign-in-open").filter({ visible: true }).click();
  const opened = await popup;
  await expect.poll(() => authUrl).not.toBe("");
  if (input.redirect) await expect(opened.locator("body")).toContainText("signed in");
  await opened.close();
  await page.context().unroute("https://auth.openai.com/oauth/authorize**");
  return authUrl;
}

async function paste(page: Page, address: string): Promise<void> {
  await page.getByTestId("account-sign-in-paste-input").filter({ visible: true }).fill(address);
  await page.getByTestId("account-sign-in-paste-submit").filter({ visible: true }).click();
}

test.describe("Codex add account", () => {
  test.beforeEach(async () => {
    await resetProviderAccounts();
    await setReadCliSignInsOnDaemon(true);
    await writeFile(path.join(codexHome, "auth.json"), codexAuthJson(SIGNED_IN));
    await setFakeOpenAiToken(fakeSites, { status: 200, body: fakeOpenAiTokens(ADDED) });
    await turnOnRotation();
  });
  test.afterEach(async () => {
    await resetProviderAccounts();
    await rm(fakeSites, { force: true });
  });

  test("signing in through the browser adds the account", async ({ page }) => {
    await openCodexPage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    const sheet = signInSheet(page);
    await expect(sheet).toContainText("Add a Codex account");
    await expect(sheet.getByTestId("account-sign-in-waiting")).toContainText(
      "Finish signing in in your browser",
    );
    await expect(sheet.getByTestId("account-sign-in-copy")).toBeVisible();
    await expect(sheet.getByTestId("account-sign-in-paste-input")).toBeVisible();

    const authUrl = await openSignInPage(page, { redirect: true });
    expect(new URL(authUrl).searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    await expect(sheet).toHaveCount(0);
    const list = accountsSection(page).getByTestId("provider-accounts-list");
    await expect(list).toContainText("second@example.com");
    await expect(list).toContainText("dev@example.com");
  });

  test("a pasted address finishes the sign-in; a wrong one stays in the box", async ({ page }) => {
    await openCodexPage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    const authUrl = await openSignInPage(page, { redirect: false });
    const sheet = signInSheet(page);

    await paste(page, "https://example.com/somewhere");
    await expect(sheet.getByTestId("account-sign-in-paste-error")).toHaveText(
      "Paste the whole address, starting with http://",
    );
    await expect(sheet.getByTestId("account-sign-in-waiting")).toBeVisible();

    await paste(page, callbackFor(authUrl, "e2e-code"));
    await expect(sheet).toHaveCount(0);
    await expect(accountsSection(page).getByTestId("provider-accounts-list")).toContainText(
      "second@example.com",
    );
  });

  test("a failed sign-in keeps its reason in the box until a retry works", async ({ page }) => {
    await setFakeOpenAiToken(fakeSites, { status: 400, body: { error: "invalid_grant" } });
    await openCodexPage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    const authUrl = await openSignInPage(page, { redirect: false });
    await paste(page, callbackFor(authUrl, "e2e-code"));
    const sheet = signInSheet(page);
    await expect(sheet.getByTestId("account-sign-in-failed")).toContainText(
      "ChatGPT didn't complete the sign-in (HTTP 400: invalid_grant).",
    );

    await setFakeOpenAiToken(fakeSites, { status: 200, body: fakeOpenAiTokens(ADDED) });
    await sheet.getByTestId("account-sign-in-retry").click();
    await expect(sheet.getByTestId("account-sign-in-waiting")).toBeVisible();
    const again = await openSignInPage(page, { redirect: false });
    await paste(page, callbackFor(again, "e2e-code"));
    await expect(sheet).toHaveCount(0);
    await expect(accountsSection(page).getByTestId("provider-accounts-list")).toContainText(
      "second@example.com",
    );
  });

  test("a sign-in that timed out says so and offers a retry", async ({ page }) => {
    await installProviderAccountsRoute(page, {
      signInFailsWith: { code: "timed_out", message: "The sign-in timed out; start it again" },
    });
    await openCodexPage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    const sheet = signInSheet(page);
    const failed = sheet.getByTestId("account-sign-in-failed");
    await expect(failed).toContainText("Couldn't add this account");
    await expect(failed).toContainText("The sign-in wasn't finished within 10 minutes.");
    await expect(sheet.getByTestId("account-sign-in-retry")).toBeVisible();
    await sheet.getByTestId("account-sign-in-close").click();
    await expect(sheet).toHaveCount(0);
  });

  test("an account that needs signing in again is fixed by Sign in again", async ({ page }) => {
    await openCodexPage(page);
    await accountsSection(page).getByTestId("provider-accounts-add").click();
    await openSignInPage(page, { redirect: true });
    await expect(accountsSection(page).getByTestId("provider-accounts-list")).toContainText(
      "second@example.com",
    );

    await installProviderAccountsRoute(page, {
      needsSignIn: { reason: "Codex token refresh failed", code: "invalid_grant" },
    });
    await page.reload();
    const list = accountsSection(page).getByTestId("provider-accounts-list");
    const rows = list.getByTestId("provider-account-needs-sign-in");
    await expect(rows.first()).toBeVisible();
    await expect(list).toContainText("Needs sign-in");
    // 列表的顺序：CLI 登录的号在前，刚加的号在后。
    await list.getByTestId("provider-account-sign-in-again").nth(1).click();
    const sheet = signInSheet(page);
    await expect(sheet).toContainText("Sign in again to second@example.com");
    await openSignInPage(page, { redirect: true });
    await expect(sheet).toHaveCount(0);
    await expect(accountsSection(page).getByTestId("provider-accounts-already-added")).toHaveText(
      "second@example.com was already in the list, so its sign-in was updated.",
    );
  });

  test("a view-only device can't add accounts", async ({ page }) => {
    await installProviderAccountsRoute(page, { readOnly: true });
    await openCodexPage(page);
    await expect(accountsSection(page).getByTestId("provider-accounts-add")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
