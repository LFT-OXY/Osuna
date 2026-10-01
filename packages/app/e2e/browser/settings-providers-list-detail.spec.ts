import { expect, test, type Page } from "../support/fixtures";
import { seedModelProvider, type HostSeed } from "../support/helpers/agent-profiles";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  expectProviderDetail,
  expectProvidersList,
  goBackInSettings,
  openCompactSettings,
  openSettingsHost,
  openSettingsHostSection,
  providerRow,
  returnToProvidersList,
  readProviderRowIds,
} from "../support/helpers/settings";
import { buildOpenProjectRoute, buildProviderSettingsRoute } from "@/utils/host-routes";

const WIDE_VIEWPORT = { width: 1280, height: 800 };
// 设置侧栏 320，内容区 580，又不到紧凑断点。
const NARROW_DESKTOP_VIEWPORT = { width: 900, height: 800 };
const PHONE_VIEWPORT = { width: 390, height: 844 };

// 前两行取自"已启用"组，要能跑诊断；e2e daemon 自带的只有 mock 一定就绪，再补一家。
let secondListedProvider: HostSeed | null = null;

test.beforeEach(async () => {
  secondListedProvider = await seedModelProvider({
    id: "list-detail-studio",
    label: "List Detail Studio",
    models: [{ id: "studio-fast", label: "Studio fast", description: "Studio quick pass" }],
  });
});

test.afterEach(async () => {
  await secondListedProvider?.restore();
  secondListedProvider = null;
});

async function readTwoProviderIds(page: Page): Promise<[string, string]> {
  const [first, second] = await readProviderRowIds(page);
  if (!first || !second) {
    throw new Error("Expected the e2e daemon to report at least two providers.");
  }
  return [first, second];
}

// ⋯ 菜单的「诊断」让详情滚到最底部的诊断节并运行，结果就地出现。
async function diagnoseFromMenu(page: Page, provider: string): Promise<void> {
  await page.getByTestId(`provider-actions-${provider}`).click();
  await page.getByTestId(`provider-diagnose-${provider}`).click();
  await expect(page.getByTestId("provider-diagnostic-output")).toBeInViewport({
    timeout: 30_000,
  });
  await expect(page.getByTestId("provider-diagnostic-sheet")).toHaveCount(0);
}

test.describe("Settings providers list and detail", () => {
  test("pushes the detail and returns through the breadcrumb on a wide window", async ({
    page,
  }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openSettingsHostSection(page, serverId, "providers");

    await test.step("entering the section shows only the list", async () => {
      await expectProvidersList(page, serverId);
    });

    const [first, second] = await readTwoProviderIds(page);

    await test.step("pressing a row pushes its detail", async () => {
      await providerRow(page, second).click();
      await expectProviderDetail(page, serverId, second);
      await expect(page.getByTestId("settings-providers-breadcrumb")).toBeVisible();
    });

    await test.step("Diagnostic in the ⋯ menu runs the diagnostic in place", async () => {
      await diagnoseFromMenu(page, second);
    });

    await test.step("the breadcrumb returns to the list", async () => {
      await returnToProvidersList(page);
      await expectProvidersList(page, serverId);
    });

    await test.step("browser Back returns from the detail to the list", async () => {
      await providerRow(page, first).click();
      await expectProviderDetail(page, serverId, first);
      await page.goBack();
      await expectProvidersList(page, serverId);
    });

    await test.step("opening a provider address directly shows its detail", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, second));
      await expectProviderDetail(page, serverId, second);
    });

    await test.step("an unknown provider address returns to the list", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, "no-such-provider"));
      await expectProvidersList(page, serverId);
    });
  });
});

// 详情页头的启用开关（宽屏在头部块里，带状态文字）。
function detailEnabledSwitch(page: Page, label: string) {
  return page.getByRole("switch", { name: `Enable ${label}`, exact: true }).filter({
    visible: true,
  });
}

function detailRefreshButton(page: Page, provider: string) {
  return page
    .getByTestId(`provider-detail-header-${provider}`)
    .getByRole("button", { name: "Refresh", exact: true });
}

async function openProviderDetail(page: Page, provider: string): Promise<void> {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "providers");
  await expectProvidersList(page, serverId);
  await providerRow(page, provider).click();
  await expectProviderDetail(page, serverId, provider);
}

test.describe("Settings provider detail enable switch", () => {
  test("turns a provider off and back on from the detail header", async ({ page }) => {
    const provider = "list-detail-studio";
    const label = "List Detail Studio";
    await openProviderDetail(page, provider);
    const header = page.getByTestId(`provider-detail-header-${provider}`);
    const enabledSwitch = detailEnabledSwitch(page, label);

    await test.step("the header shows the switch on, with its state beside it", async () => {
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
      await expect(header.getByText("Enabled", { exact: true })).toBeVisible();
      await expect(page.getByTestId("provider-models-section")).toBeVisible();
    });

    await test.step("turning it off leaves only the disabled card and disables Refresh", async () => {
      await enabledSwitch.click();
      await expect(page.getByTestId("provider-disabled-card")).toContainText(
        `${label} is disabled`,
      );
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
      await expect(header.getByText("Disabled", { exact: true }).first()).toBeVisible();
      await expect(detailRefreshButton(page, provider)).toBeDisabled();
      await expect(page.getByTestId("provider-models-section")).toHaveCount(0);
      await expect(page.getByTestId("provider-diagnostic-section")).toHaveCount(0);
    });

    await test.step("turning it back on shows the checked provider in place", async () => {
      await enabledSwitch.click();
      await expect(page.getByTestId("provider-disabled-card")).toHaveCount(0);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("provider-models-section")).toContainText("Studio fast", {
        timeout: 30_000,
      });
      await expect(detailRefreshButton(page, provider)).toBeEnabled();
    });
  });

  // daemon 拒绝写 providers.mock.*，用它造一次真实的写入失败。
  test("keeps a failed switch at the top of the detail until dismissed", async ({ page }) => {
    await openProviderDetail(page, "mock");
    const label = (
      await page.getByTestId("settings-detail-header-title").filter({ visible: true }).innerText()
    ).trim();
    const enabledSwitch = detailEnabledSwitch(page, label);
    await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");

    await enabledSwitch.click();

    const failure = page.getByTestId("provider-enablement-error");
    await expect(failure).toContainText(`Unable to disable ${label}`);
    await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("provider-disabled-card")).toHaveCount(0);
    await expect(page.getByTestId("provider-models-section")).toBeVisible();

    await failure.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(failure).toHaveCount(0);
  });
});

test.describe("Settings providers list and detail on a narrow desktop window", () => {
  test.use({ viewport: NARROW_DESKTOP_VIEWPORT });

  test("pushes the detail and returns through the breadcrumb", async ({ page }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await openSettingsHostSection(page, serverId, "providers");
    await expectProvidersList(page, serverId);
    const [, second] = await readTwoProviderIds(page);

    await test.step("pressing a row pushes its detail", async () => {
      await providerRow(page, second).click();
      await expectProviderDetail(page, serverId, second);
      await expect(page.getByTestId("settings-providers-breadcrumb")).toBeVisible();
    });

    await test.step("the breadcrumb returns to the list", async () => {
      await returnToProvidersList(page);
      await expectProvidersList(page, serverId);
    });

    await test.step("resizing keeps the detail", async () => {
      await providerRow(page, second).click();
      await expectProviderDetail(page, serverId, second);
      await page.setViewportSize(WIDE_VIEWPORT);
      await expectProviderDetail(page, serverId, second);
      await page.setViewportSize(NARROW_DESKTOP_VIEWPORT);
      await expectProviderDetail(page, serverId, second);
    });

    await test.step("an unknown provider address returns to the list", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, "no-such-provider"));
      await expectProvidersList(page, serverId);
    });
  });
});

test.describe("Settings providers list and detail on a phone", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("pushes the detail and Back returns to the list", async ({ page }) => {
    const serverId = getServerId();
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());
    await openSettingsHostSection(page, serverId, "providers");
    await expectProvidersList(page, serverId);
    const [first] = await readTwoProviderIds(page);

    await test.step("pressing a row pushes its full-screen detail", async () => {
      const [label] = (await providerRow(page, first).innerText()).split("\n");
      await providerRow(page, first).click();
      await expectProviderDetail(page, serverId, first);
      await expect(page.getByTestId("provider-detail-refresh")).toBeVisible();
      // 顶栏标题与页内头部块各显示一次名称。
      await expect(
        page.getByText(label ?? "", { exact: true }).filter({ visible: true }),
      ).toHaveCount(2);
      await expect(detailRefreshButton(page, first)).toHaveCount(0);
      // 顶栏只放开关，不写状态文字。
      await expect(detailEnabledSwitch(page, label ?? "")).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByTestId(`provider-detail-header-${first}`).getByRole("switch"),
      ).toHaveCount(0);
      await expect(
        page.getByText("Enabled", { exact: true }).filter({ visible: true }),
      ).toHaveCount(0);
    });

    await test.step("Diagnostic in the screen header ⋯ runs the diagnostic in the body", async () => {
      await diagnoseFromMenu(page, first);
    });

    await test.step("Back returns to the list", async () => {
      await goBackInSettings(page);
      await expectProvidersList(page, serverId);
    });

    await test.step("an unknown provider address returns to the list", async () => {
      await page.goto(buildProviderSettingsRoute(serverId, "no-such-provider"));
      await expectProvidersList(page, serverId);
    });
  });
});
