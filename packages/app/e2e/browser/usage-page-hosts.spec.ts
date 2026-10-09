import { randomUUID } from "node:crypto";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker-constants";
import { expect, test } from "../support/fixtures";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import {
  openUsageHostFilter,
  openUsagePage,
  openUsagePageFromShell,
  waitForUsageTotal,
} from "../support/helpers/usage-page";

const primaryFixtures = createUsageFixtureRoots("osuna-usage-hosts-primary-");
const secondaryFixtures = createUsageFixtureRoots("osuna-usage-hosts-secondary-");

test.use({ e2eDaemonEnvironment: primaryFixtures.environment });

/** Token totals come only from the parsers, so they are exact. */
const ONE_HOST_TOKENS = "180,248";
/** Both hosts hold the same fixture tree, so two counted hosts double the total. */
const TWO_HOST_TOKENS = "360,496";

const PRIMARY_LABEL = "Primary box";
const SECONDARY_LABEL = "Secondary box";

/** The last version published without `features.usage`. */
const PRE_USAGE_DAEMON_VERSION = "0.8.0";

test.describe("Usage page across hosts", () => {
  test.describe.configure({ timeout: 420_000 });

  test("adds every counted host together and narrows to the one that is picked", async ({
    page,
  }) => {
    const secondaryServerId = `srv_usage_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const secondaryDaemon = await startIsolatedHostDaemon(secondaryServerId, {
      environment: secondaryFixtures.environment,
    });

    try {
      await test.step("one host leaves nothing to filter by", async () => {
        await openUsagePage(page);
        await waitForUsageTotal(page, ONE_HOST_TOKENS);
        await expect(page.getByTestId("usage-host-filter-trigger")).toHaveCount(0);
      });

      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: SECONDARY_LABEL,
        port: secondaryDaemon.port,
        primaryLabel: PRIMARY_LABEL,
      });
      await openUsagePageFromShell(page);

      await test.step("the overview totals both hosts and still merges sources", async () => {
        await waitForUsageTotal(page, TWO_HOST_TOKENS);
        // A source is `(cli, backend)`, never `(cli, backend, host)`: the same
        // CLI on two machines stays one card, so the shares do not move.
        const claudeCard = page.getByTestId("usage-source-card-claude");
        await expect(claudeCard).toContainText("Claude Code");
        await expect(claudeCard).toContainText("92.23%");
        await expect(claudeCard).toContainText("2 models");
      });

      await test.step("the All row says how many hosts it counts", async () => {
        await openUsageHostFilter(page);
        await expect(page.getByTestId("usage-host-filter-counted")).toHaveText("2 hosts counted");
      });

      await test.step("picking a host shows that host's own numbers", async () => {
        await page.getByTestId(`usage-host-filter-item-${secondaryDaemon.serverId}`).click();
        await expect(page.getByTestId("usage-host-filter-trigger")).toContainText(SECONDARY_LABEL);
        await waitForUsageTotal(page, ONE_HOST_TOKENS);
      });

      await test.step("going back to all hosts restores the sum", async () => {
        await openUsageHostFilter(page);
        await page.getByTestId(`usage-host-filter-item-${ALL_HOSTS_OPTION_ID}`).click();
        await expect(page.getByTestId("usage-host-filter-trigger")).toContainText("All hosts");
        await waitForUsageTotal(page, TWO_HOST_TOKENS);
      });

      await test.step("a host that goes away stops counting instead of freezing its share", async () => {
        // Picked again first: a selection that survives its own host would leave
        // the page waiting on a machine that can no longer answer.
        await openUsageHostFilter(page);
        await page.getByTestId(`usage-host-filter-item-${secondaryDaemon.serverId}`).click();
        await waitForUsageTotal(page, ONE_HOST_TOKENS);
        await secondaryDaemon.close();
        await expect(page.getByTestId("usage-host-filter-trigger")).toContainText("All hosts", {
          timeout: 30_000,
        });
        await waitForUsageTotal(page, ONE_HOST_TOKENS);
        await openUsageHostFilter(page);
        await expect(page.getByTestId("usage-host-filter-counted")).toHaveText("1 host counted");
        await expect(
          page.getByTestId(`usage-host-filter-status-${secondaryDaemon.serverId}`),
        ).toHaveText("Not counted");
        await expect(
          page.getByTestId(`usage-host-filter-item-${secondaryDaemon.serverId}`),
        ).toBeDisabled();
      });
    } finally {
      await secondaryDaemon.close().catch(() => undefined);
    }
  });

  test("leaves a host without the usage feature out of the total", async ({ page }) => {
    const outdatedServerId = `srv_usage_old_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const outdatedDaemon = await startIsolatedHostDaemon(outdatedServerId, {
      publishedVersion: PRE_USAGE_DAEMON_VERSION,
    });

    try {
      await openUsagePage(page);
      await addConnectedHostAndReload(page, {
        serverId: outdatedDaemon.serverId,
        label: "Outdated box",
        port: outdatedDaemon.port,
        primaryLabel: PRIMARY_LABEL,
      });
      await openUsagePageFromShell(page);

      await test.step("the total is the one host that can answer", async () => {
        await waitForUsageTotal(page, ONE_HOST_TOKENS);
      });

      await test.step("the host behind on versions asks to be updated and cannot be picked", async () => {
        await openUsageHostFilter(page);
        await expect(page.getByTestId("usage-host-filter-counted")).toHaveText("1 host counted");
        await expect(
          page.getByTestId(`usage-host-filter-status-${outdatedDaemon.serverId}`),
        ).toHaveText("Update host", { timeout: 30_000 });
        await expect(
          page.getByTestId(`usage-host-filter-item-${outdatedDaemon.serverId}`),
        ).toBeDisabled();
      });
    } finally {
      await outdatedDaemon.close().catch(() => undefined);
    }
  });
});
