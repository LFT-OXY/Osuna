import { mkdirSync, mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { setReadCliSignInsOnDaemon } from "../support/helpers/host-privacy";
import {
  accountsSection,
  addCodexAccountOnDaemon,
  codexAuthJson,
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
 * Codex 自动换号（多号轮换工单 05）：「设上限」对话框与用量条上的上限、「固定登录到」、自动换号后的状态标签。
 * CLI 的登录只在临时 CODEX_HOME 里；加号走真的流程，换 token 由封条的假外网回答；额度是改写进回复的假读数。
 * 绝不连 OpenAI。
 */

const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-account-rotation-"));
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
const SECOND = { accountId: "acct-second", email: "second@example.com", plan: "pro" };
const WINDOWS = [
  { id: "five_hour", label: "5-hour", usedPct: 64, resetsAt: "2026-10-25T18:00:00.000Z" },
  { id: "weekly", label: "Weekly", usedPct: 31, resetsAt: "2026-10-30T09:00:00.000Z" },
  {
    id: "code_review:weekly",
    label: "Code review · Weekly",
    usedPct: 5,
    resetsAt: "2026-10-30T09:00:00.000Z",
  },
];

async function openCodexPage(page: Page, width = 1280): Promise<void> {
  const serverId = getServerId();
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await clickProviderRow(page, "codex");
  await expectProviderDetail(page, serverId, "codex");
  await expect(accountsSection(page)).toBeVisible();
  if (width !== 1280) {
    await page.setViewportSize({ width, height: 844 });
    await expect(accountsSection(page)).toBeVisible();
  }
}

async function cliAccountId(): Promise<string | undefined> {
  const text = await readFile(path.join(codexHome, "auth.json"), "utf8");
  return (JSON.parse(text) as { tokens?: { account_id?: string } }).tokens?.account_id;
}

async function daemonState() {
  return withAccountsClient((client) => client.providerAccountList({ provider: "codex" }));
}

function accountRow(page: Page, id: string) {
  return page.getByTestId(`provider-account-${id}`).filter({ visible: true });
}

async function openLimits(page: Page, id: string): Promise<void> {
  await page.getByTestId(`provider-account-menu-${id}`).filter({ visible: true }).click();
  await page.getByTestId("provider-account-set-limits").filter({ visible: true }).click();
  await expect(limitsSheet(page)).toBeVisible();
}

function limitsSheet(page: Page) {
  return page.getByTestId("account-limits").filter({ visible: true });
}

/** 对话框里的东西：窄窗口下 testID 只在标题栏上，正文不在它里面，所以从整页找。 */
function limitsPart(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

let ids: { cli: string; second: string };

test.describe("Codex automatic account rotation", () => {
  test.beforeEach(async () => {
    await resetProviderAccounts();
    await setReadCliSignInsOnDaemon(true);
    await writeFile(path.join(codexHome, "auth.json"), codexAuthJson(SIGNED_IN), { mode: 0o600 });
    await withAccountsClient(async (client) => {
      const payload = await client.providerAccountSetRotation({
        provider: "codex",
        enabled: true,
        acknowledgeRiskNotice: true,
      });
      expect(payload.error).toBeNull();
    });
    const second = await addCodexAccountOnDaemon({ sitesPath: fakeSites, account: SECOND });
    const listed = await daemonState();
    ids = { cli: listed.accounts[0]!.id, second };
  });
  test.afterEach(async () => {
    await resetProviderAccounts();
    await rm(fakeSites, { force: true });
  });

  test("Set limits saves a limit per window and marks it on the bar", async ({ page }) => {
    await installProviderAccountsRoute(page, { windows: WINDOWS });
    await openCodexPage(page);
    await openLimits(page, ids.cli);
    // 只有整个号的窗口能设上限：Code review 自己的窗口不在框里。
    await expect(limitsPart(page, "account-limits-input-five_hour")).toBeVisible();
    await expect(limitsPart(page, "account-limits-input-weekly")).toBeVisible();
    await expect(page.getByTestId("account-limits-field-code_review:weekly")).toHaveCount(0);

    const input = limitsPart(page, "account-limits-input-five_hour");
    await input.fill("100");
    await expect(limitsPart(page, "account-limits-field-five_hour-error")).toHaveText(
      "Enter a whole number from 1 to 99",
    );
    await expect(limitsPart(page, "account-limits-save")).toBeDisabled();
    await input.fill("70");
    await limitsPart(page, "account-limits-save").click();
    await expect(limitsSheet(page)).toHaveCount(0);

    await expect(accountRow(page, ids.cli)).toContainText("limit 70%");
    await expect(accountRow(page, ids.cli).getByTestId("usage-meter-marker")).toHaveCount(1);
    expect((await daemonState()).accounts[0]?.limits).toEqual({ five_hour: 70 });

    // 清空就是不设。
    await openLimits(page, ids.cli);
    await limitsPart(page, "account-limits-input-five_hour").fill("");
    await limitsPart(page, "account-limits-save").click();
    await expect(limitsSheet(page)).toHaveCount(0);
    await expect(accountRow(page, ids.cli).getByTestId("usage-meter-marker")).toHaveCount(0);
    expect((await daemonState()).accounts[0]?.limits).toBeUndefined();
  });

  test("a limit that can't be saved stays in the dialog with the reason", async ({ page }) => {
    await installProviderAccountsRoute(page, {
      windows: WINDOWS,
      failRequest: {
        type: "provider.account.set_limits.request",
        reason: "disk is full",
        times: 1,
      },
    });
    await openCodexPage(page);
    await openLimits(page, ids.second);
    await limitsPart(page, "account-limits-input-weekly").fill("50");
    await limitsPart(page, "account-limits-save").click();
    await expect(limitsPart(page, "account-limits-error")).toHaveText(
      "Couldn't save the limits: disk is full",
    );
    // 输入还在，再按一次就存上。
    await expect(limitsPart(page, "account-limits-input-weekly")).toHaveValue("50");
    await limitsPart(page, "account-limits-save").click();
    await expect(limitsSheet(page)).toHaveCount(0);
    expect((await daemonState()).accounts[1]?.limits).toEqual({ weekly: 50 });
  });

  test("Keep signed in to signs the CLI in to that account, and can be cleared", async ({
    page,
  }) => {
    await installProviderAccountsRoute(page, { windows: WINDOWS });
    await openCodexPage(page);
    const trigger = accountsSection(page).getByTestId("provider-accounts-keep-trigger");
    await expect(trigger).toHaveText("Don't keep");
    await trigger.click();
    await page.getByTestId(`provider-accounts-keep-${ids.second}`).click();
    await expect(trigger).toHaveText("second@example.com");
    await expect.poll(cliAccountId).toBe("acct-second");
    await expect(accountRow(page, ids.second)).toContainText("In use");
    const switches = accountsSection(page).getByTestId("provider-accounts-switches");
    await expect(switches).toContainText("You chose Keep signed in to second@example.com");

    await trigger.click();
    await page.getByTestId("provider-accounts-keep-none").click();
    await expect(trigger).toHaveText("Don't keep");
    await expect.poll(async () => (await daemonState()).settings.keepSignedInTo).toBeNull();
  });

  test("a Keep signed in to that can't be saved says why and keeps the host's choice", async ({
    page,
  }) => {
    await installProviderAccountsRoute(page, {
      windows: WINDOWS,
      failRequest: {
        type: "provider.account.set_keep_signed_in.request",
        reason: "disk is full",
        times: 1,
      },
    });
    await openCodexPage(page);
    const trigger = accountsSection(page).getByTestId("provider-accounts-keep-trigger");
    await trigger.click();
    await page.getByTestId(`provider-accounts-keep-${ids.second}`).click();
    await expect(accountsSection(page).getByTestId("provider-accounts-keep-error")).toHaveText(
      "Couldn't save Keep signed in to: disk is full",
    );
    await expect(trigger).toHaveText("Don't keep");
    expect(await cliAccountId()).toBe("acct-cli");
  });

  test("after the first account runs out, the rows say who is first for now", async ({ page }) => {
    await installProviderAccountsRoute(page, {
      windows: WINDOWS,
      standing: {
        "dev@example.com": "first_when_room",
        "second@example.com": "temporarily_first",
      },
    });
    await openCodexPage(page);
    await expect(accountRow(page, ids.cli)).toContainText("First again when it has room");
    await expect(accountRow(page, ids.cli)).not.toContainText(/\bFirst\b(?! again)/);
    await expect(accountRow(page, ids.second)).toContainText("Temporarily first");
  });

  test("on a narrow window the limits dialog is fully usable", async ({ page }) => {
    await installProviderAccountsRoute(page, { windows: WINDOWS });
    await openCodexPage(page, 390);
    await openLimits(page, ids.cli);
    await expect(limitsPart(page, "account-limits-input-weekly")).toBeInViewport();
    await expect(limitsPart(page, "account-limits-save")).toBeInViewport();
    await limitsPart(page, "account-limits-input-weekly").fill("80");
    await limitsPart(page, "account-limits-save").click();
    await expect(limitsSheet(page)).toHaveCount(0);
    await expect(accountRow(page, ids.cli)).toContainText("limit 80%");
  });
});
