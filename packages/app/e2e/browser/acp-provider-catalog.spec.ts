import { test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import {
  expectProviderDetail,
  expectProviderInstalledInSettings,
  expectProvidersList,
  goBackInSettings,
  installAcpCatalogProvider,
  openCompactSettings,
  openProviderCatalog,
  openSettingsHost,
  openSettingsHostSection,
  returnToProvidersList,
} from "../support/helpers/settings";
import { buildOpenProjectRoute } from "@/utils/host-routes";

const PHONE_VIEWPORT = { width: 390, height: 844 };

const ACP_PROVIDER = {
  id: "minimax-code",
  name: "MiniMax Code",
};

interface ProviderCatalogDaemonClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  patchDaemonConfig(config: { removeProviders?: string[] }): Promise<unknown>;
}

test.describe("ACP provider catalog", () => {
  test("adds MiniMax Code from the providers list's + dialog and pushes its detail", async ({
    page,
  }) => {
    const client = await connectDaemonClient<ProviderCatalogDaemonClient>({
      clientIdPrefix: "provider-catalog-e2e",
    });
    try {
      await gotoAppShell(page);
      await openSettings(page);
      await openSettingsHost(page, getServerId());
      await openSettingsHostSection(page, getServerId(), "providers");
      await openProviderCatalog(page);

      await installAcpCatalogProvider(page, ACP_PROVIDER.name);
      await expectProviderDetail(page, getServerId(), ACP_PROVIDER.id);

      await returnToProvidersList(page);
      await expectProvidersList(page, getServerId());
      await expectProviderInstalledInSettings(page, ACP_PROVIDER.name);
    } finally {
      await client.patchDaemonConfig({ removeProviders: [ACP_PROVIDER.id] }).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});

test.describe("ACP provider catalog on a phone", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("adds MiniMax Code from the bottom sheet and pushes its detail", async ({ page }) => {
    const serverId = getServerId();
    const client = await connectDaemonClient<ProviderCatalogDaemonClient>({
      clientIdPrefix: "provider-catalog-phone-e2e",
    });
    try {
      await gotoAppShell(page);
      await openCompactSettings(page, buildOpenProjectRoute());
      await openSettingsHostSection(page, serverId, "providers");
      await expectProvidersList(page, serverId);
      await openProviderCatalog(page);

      await installAcpCatalogProvider(page, ACP_PROVIDER.name);
      await expectProviderDetail(page, serverId, ACP_PROVIDER.id);

      await goBackInSettings(page);
      await expectProvidersList(page, serverId);
      await expectProviderInstalledInSettings(page, ACP_PROVIDER.name);
    } finally {
      await client.patchDaemonConfig({ removeProviders: [ACP_PROVIDER.id] }).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});
