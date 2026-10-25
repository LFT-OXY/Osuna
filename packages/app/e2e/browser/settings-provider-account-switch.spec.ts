import { mkdirSync, mkdtempSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
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
 * Codex 手动换号（多号轮换工单 04）：行菜单的立即使用、设为第一、排序、移除，拖动排序，「最近换号」。
 * CLI 的登录只在临时 CODEX_HOME 里；加号走真的流程，换 token 由封条的假外网回答。绝不连 OpenAI。
 */

const cliHome = mkdtempSync(path.join(tmpdir(), "paseo-e2e-account-switch-"));
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
const THIRD = { accountId: "acct-third", email: "third@example.com", plan: "plus" };
const WINDOWS = [
  { id: "five_hour", label: "Session", usedPct: 35, resetsAt: "2026-10-25T18:00:00.000Z" },
];

async function openCodexPage(page: Page, width = 1280): Promise<void> {
  const serverId = getServerId();
  // 设置页从桌面宽度打开（窄窗口的入口在侧栏里），再按用例缩窄。
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

async function daemonOrder(): Promise<(string | undefined)[]> {
  return withAccountsClient(async (client) =>
    (await client.providerAccountList({ provider: "codex" })).accounts.map(
      (account) => account.email,
    ),
  );
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

/** 列表上各行的邮箱，从上到下。 */
async function shownOrder(page: Page): Promise<string[]> {
  const list = accountsSection(page).getByTestId("provider-accounts-list");
  // 行的 testID 是 provider-account-<号的 UUID>；行里别的 testID 不算。
  const texts = await list
    .locator('[data-testid^="provider-account-"]')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) =>
          /^provider-account-[0-9a-f-]{36}$/.test(node.getAttribute("data-testid") ?? ""),
        )
        .map((node) => node.textContent ?? ""),
    );
  return texts.map((text) => /[a-z]+@example\.com/.exec(text)?.[0] ?? "");
}

let ids: { cli: string; second: string; third: string };

test.describe("Codex account switching", () => {
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
    const third = await addCodexAccountOnDaemon({ sitesPath: fakeSites, account: THIRD });
    const listed = await withAccountsClient((client) =>
      client.providerAccountList({ provider: "codex" }),
    );
    ids = { cli: listed.accounts[0]!.id, second, third };
  });
  test.afterEach(async () => {
    await chmod(codexHome, 0o700);
    await resetProviderAccounts();
    await rm(fakeSites, { force: true });
  });

  test("Use now switches the CLI and lists the switch with its reason", async ({ page }) => {
    await installProviderAccountsRoute(page, { windows: WINDOWS });
    await openCodexPage(page);
    await openMenu(page, ids.second);
    await menuItem(page, "provider-account-use").click();
    await expect(accountRow(page, ids.second)).toContainText("In use");
    await expect(accountRow(page, ids.cli)).not.toContainText("In use");
    const switches = accountsSection(page).getByTestId("provider-accounts-switches");
    await expect(switches).toContainText("dev@example.com → second@example.com");
    await expect(switches).toContainText("You chose Use now");
    expect(await cliAccountId()).toBe("acct-second");
    // 已经在用的号，菜单里的「立即使用」不能点。
    await openMenu(page, ids.second);
    await expect(menuItem(page, "provider-account-use")).toHaveAttribute("aria-disabled", "true");
  });

  test("a switch that can't be written shows why in the section", async ({ page }) => {
    await openCodexPage(page);
    await chmod(codexHome, 0o500);
    await openMenu(page, ids.second);
    await menuItem(page, "provider-account-use").click();
    const notice = accountsSection(page).getByTestId("provider-accounts-switch-failure");
    await expect(notice).toContainText("Couldn't switch accounts");
    await expect(notice).toContainText("Codex couldn't be switched to second@example.com");
    await chmod(codexHome, 0o700);
    expect(await cliAccountId()).toBe("acct-cli");

    // 再试一次成功，提示消失。
    await openMenu(page, ids.second);
    await menuItem(page, "provider-account-use").click();
    await expect(accountRow(page, ids.second)).toContainText("In use");
    await expect(notice).toHaveCount(0);
  });

  test("Remove asks first and never signs the CLI out", async ({ page }) => {
    await openCodexPage(page);
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("The CLI won't be signed out");
      await dialog.dismiss();
    });
    await openMenu(page, ids.cli);
    await menuItem(page, "provider-account-remove").click();
    await expect(accountRow(page, ids.cli)).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await openMenu(page, ids.cli);
    await menuItem(page, "provider-account-remove").click();
    await expect(accountRow(page, ids.cli)).toHaveCount(0);
    expect(await cliAccountId()).toBe("acct-cli");
    expect(await daemonOrder()).toEqual(["second@example.com", "third@example.com"]);
  });

  test("a failed remove keeps the account and says why on its row", async ({ page }) => {
    await installProviderAccountsRoute(page, {
      failRequest: { type: "provider.account.remove.request", reason: "disk is full", times: 1 },
    });
    await openCodexPage(page);
    page.once("dialog", (dialog) => void dialog.accept());
    await openMenu(page, ids.third);
    await menuItem(page, "provider-account-remove").click();
    await expect(accountRow(page, ids.third).getByTestId("provider-account-error")).toContainText(
      "disk is full",
    );
    expect(await daemonOrder()).toContain("third@example.com");
  });

  test("the row menu and dragging reorder the accounts", async ({ page }) => {
    await openCodexPage(page);
    await openMenu(page, ids.third);
    await menuItem(page, "provider-account-make-first").click();
    await expect
      .poll(() => shownOrder(page))
      .toEqual(["third@example.com", "dev@example.com", "second@example.com"]);
    await expect(accountRow(page, ids.third)).toContainText("First");

    await openMenu(page, ids.third);
    await menuItem(page, "provider-account-order-down").click();
    await expect
      .poll(() => daemonOrder())
      .toEqual(["dev@example.com", "third@example.com", "second@example.com"]);

    // 拖动：把 second 拖到最上面。
    const handle = accountRow(page, ids.second).getByTestId("api-endpoint-drag-handle");
    const from = await handle.boundingBox();
    const onto = await accountRow(page, ids.cli).boundingBox();
    if (!from || !onto) throw new Error("Rows to drag are not on screen");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 4 });
    await expect(page.getByTestId("provider-account-row-dragging")).toBeVisible();
    await page.mouse.move(from.x + from.width / 2, onto.y + onto.height / 2, { steps: 12 });
    await expect
      .poll(async () => (await page.getByTestId("provider-account-row-drop-slot").boundingBox())?.y)
      .toBeCloseTo(onto.y, -1);
    await page.mouse.up();
    await expect
      .poll(() => daemonOrder())
      .toEqual(["second@example.com", "dev@example.com", "third@example.com"]);
  });

  test("a failed reorder puts the host's order back and says why", async ({ page }) => {
    await installProviderAccountsRoute(page, {
      failRequest: { type: "provider.account.set_order.request", reason: "disk is full", times: 1 },
    });
    await openCodexPage(page);
    await openMenu(page, ids.third);
    await menuItem(page, "provider-account-order-top").click();
    await expect(accountsSection(page).getByTestId("provider-accounts-order-error")).toContainText(
      "Couldn't save the order: disk is full",
    );
    await expect
      .poll(() => shownOrder(page))
      .toEqual(["dev@example.com", "second@example.com", "third@example.com"]);
  });

  test("recent switches show five and expand to all", async ({ page }) => {
    await withAccountsClient(async (client) => {
      for (const id of [ids.second, ids.third, ids.second, ids.third, ids.second, ids.cli]) {
        const payload = await client.providerAccountUse({ provider: "codex", accountId: id });
        expect(payload.error).toBeNull();
      }
    });
    await openCodexPage(page);
    const switches = accountsSection(page).getByTestId("provider-accounts-switches");
    await expect(switches.getByTestId("provider-accounts-switch")).toHaveCount(5);
    // 最新的在上。
    await expect(switches.getByTestId("provider-accounts-switch").first()).toContainText(
      "second@example.com → dev@example.com",
    );
    await switches.getByTestId("provider-accounts-switches-toggle").click();
    await expect(switches.getByTestId("provider-accounts-switch")).toHaveCount(6);
  });

  test("a view-only device sees accounts and switches but no row actions", async ({ page }) => {
    await withAccountsClient((client) =>
      client.providerAccountUse({ provider: "codex", accountId: ids.second }),
    );
    await installProviderAccountsRoute(page, { readOnly: true });
    await openCodexPage(page);
    await expect(accountRow(page, ids.second)).toContainText("In use");
    await expect(accountsSection(page).getByTestId("provider-accounts-switches")).toBeVisible();
    await expect(page.getByTestId(`provider-account-menu-${ids.second}`)).toHaveCount(0);
    await expect(page.getByTestId("api-endpoint-drag-handle")).toHaveCount(0);
  });

  test("on a narrow window the row menu opens as a sheet with every item", async ({ page }) => {
    await openCodexPage(page, 390);
    await openMenu(page, ids.second);
    for (const item of [
      "provider-account-use",
      "provider-account-make-first",
      "provider-account-order-up",
      "provider-account-order-down",
      "provider-account-order-top",
      "provider-account-order-bottom",
      "provider-account-remove",
    ]) {
      await expect(menuItem(page, item)).toBeInViewport();
    }
    await menuItem(page, "provider-account-use").click();
    await expect(accountRow(page, ids.second)).toContainText("In use");
  });
});
