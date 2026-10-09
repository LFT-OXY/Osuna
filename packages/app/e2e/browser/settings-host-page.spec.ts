import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { TEST_HOST_LABEL } from "../support/helpers/daemon-registry";
import { getServerId } from "../support/helpers/server-id";
import {
  expectSettingsHeader,
  openSettingsHost,
  openHostSection,
  expectHostLabelDisplayed,
  clickEditHostLabel,
  expectHostLabelEditMode,
  expectHostConnectionsCard,
  expectHostInjectMcpCard,
  expectHostActionCards,
  expectHostProvidersCard,
  expectProvidersList,
  expectHostNoDaemonLifecycleRow,
  expectRetiredSidebarSectionsAbsent,
  expectHostPageVisible,
  seedSavedSettingsHosts,
  selectSettingsHost,
} from "../support/helpers/settings";

// 应用会把回环地址规范成 localhost，所以按端口认这台主机的连接。
function recordSentFrameTypes(page: Page, endpoint: string): string[] {
  const port = endpoint.split(":").at(-1);
  const types: string[] = [];
  const record = (frame: { payload: string | Buffer }) => {
    types.push(JSON.parse(String(frame.payload)).type);
  };
  page.on("websocket", (socket) => {
    if (socket.url().includes(`:${port}/`)) socket.on("framesent", record);
  });
  return types;
}

test.describe("Settings host page", () => {
  test("visits host settings and opens the label editor", async ({ page }) => {
    const serverId = getServerId();
    const port = getE2EDaemonPort();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await test.step("connections section shows the seeded connection endpoint", async () => {
      await expectSettingsHeader(page, "Connections");
      await expectHostConnectionsCard(page, port);
    });
    await test.step("agents section shows the inject MCP toggle", async () => {
      await openHostSection(page, serverId, "agents");
      await expectSettingsHeader(page, "Agents");
      await expectHostInjectMcpCard(page);
    });
    await test.step("providers section shows only the providers list", async () => {
      await expectHostProvidersCard(page, serverId);
      await expectSettingsHeader(page, "Providers");
      await expectProvidersList(page, serverId);
    });
    await test.step("host section shows the host label and restart/remove action cards", async () => {
      await openHostSection(page, serverId, "host");
      await expectSettingsHeader(page, "Overview");
      await expectHostLabelDisplayed(page);
      await expectHostActionCards(page, serverId);
    });
    await test.step("clicking the label pencil reveals the inline editor", async () => {
      await openHostSection(page, serverId, "host");

      await expectHostLabelDisplayed(page);
      await clickEditHostLabel(page);
      await expectHostLabelEditMode(page, TEST_HOST_LABEL);
      await page.keyboard.press("Escape");
    });
    await test.step("host section does not render daemon lifecycle controls for a remote daemon", async () => {
      await openHostSection(page, serverId, "host");

      await expectHostNoDaemonLifecycleRow(page);
    });
    await test.step("settings sidebar exposes the flat App and Host section rows", async () => {
      await expectRetiredSidebarSectionsAbsent(page);
    });
  });

  test("an outdated remote daemon offers no daemon update entry", async ({
    page,
    outdatedDaemon,
  }) => {
    await seedSavedSettingsHosts(page, [outdatedDaemon]);
    await page.reload();
    await openSettings(page);
    await openSettingsHost(page, outdatedDaemon.serverId);
    await openHostSection(page, outdatedDaemon.serverId, "host");

    // 版本徽标出现说明 server_info 已到，此时再断言缺席才有意义。
    await expect(page.getByTestId("host-page-identity")).toContainText("1.0.0-alpha.0");
    await expect(page.getByTestId("host-page-restart-card")).toBeVisible();
    await expect(page.getByTestId("host-page-update-card")).toHaveCount(0);
  });

  test("a host below the 1.0.0 floor asks for an update while the current host stays online", async ({
    page,
    belowFloorDaemon,
  }) => {
    const currentHost = {
      serverId: getServerId(),
      label: TEST_HOST_LABEL,
      endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
    };
    // 被拒之后客户端不该再发任何请求：记下发往这台主机的每一帧的类型。
    const sentFrameTypes = recordSentFrameTypes(page, belowFloorDaemon.endpoint);

    await seedSavedSettingsHosts(page, [belowFloorDaemon, currentHost]);
    await page.reload();
    await openSettings(page);
    await selectSettingsHost(page, belowFloorDaemon.serverId);
    await openSettingsHost(page, belowFloorDaemon.serverId);

    await test.step("the connections page names the host and the version to update to", async () => {
      const notice = page.getByTestId("host-page-outdated-notice");
      await expect(notice).toContainText(`${belowFloorDaemon.label} needs an update`);
      await expect(notice).toContainText("Update Osuna on the host to 1.0.0 or later");
      await expect(page.getByTestId("host-page-connections-card")).not.toContainText("Timeout");
    });
    await test.step("the overview shows the state instead of a connection error", async () => {
      await openHostSection(page, belowFloorDaemon.serverId, "host");
      await expect(page.getByTestId("host-page-identity")).toContainText("Needs update");
      await expect(page.getByTestId("host-page-outdated-notice")).toBeVisible();
    });
    await test.step("the host on the current version is unaffected", async () => {
      await selectSettingsHost(page, currentHost.serverId);
      await openHostSection(page, currentHost.serverId, "host");
      await expect(page.getByTestId("host-page-identity")).toContainText("Online");
      await expect(page.getByTestId("host-page-outdated-notice")).toHaveCount(0);
    });
    expect(new Set(sentFrameTypes)).toEqual(new Set(["hello"]));
  });

  test("navigating to /settings/hosts/[serverId] redirects to the connections section", async ({
    page,
  }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await page.goto(`/settings/hosts/${encodeURIComponent(serverId)}`);

    await expectHostPageVisible(page, serverId);
    await expectSettingsHeader(page, "Connections");
    await openHostSection(page, serverId, "host");
    await expectHostLabelDisplayed(page);
    await expectHostActionCards(page, serverId);
  });
});
