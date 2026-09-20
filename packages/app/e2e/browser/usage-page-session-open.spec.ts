import { expect, test } from "../support/fixtures";
import {
  createUsageFixtureRoots,
  writeUsageClaudeSession,
} from "../support/helpers/usage-fixtures";
import { openUsagePage, waitForUsageTotal } from "../support/helpers/usage-page";

const fixtures = createUsageFixtureRoots("osuna-usage-open-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

/** The session this spec writes, big enough to stand out among the fixtures. */
const WORKSPACE_SESSION = "sess-workspace-open";
const WORKSPACE_SESSION_OUTPUT = 424_242;
/** Its compact form, which is how the session row shows the same number. */
const WORKSPACE_SESSION_TOKENS = "424.2K";
/** The checked-in fixtures (180,248) plus this session's prompt and answer. */
const TOTAL_WITH_WORKSPACE_SESSION = "604,491";

test.describe("Usage page session row", () => {
  test("owner resumes an external session in the workspace that holds it", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace();
    // The session has to have run in a directory this host really has a
    // workspace for, which only the test knows.
    writeUsageClaudeSession({
      roots: fixtures,
      sessionId: WORKSPACE_SESSION,
      cwd: workspace.repoPath,
      output: WORKSPACE_SESSION_OUTPUT,
    });

    await openUsagePage(page);
    // The scan is periodic, so the workspace's session arrives a beat later.
    await waitForUsageTotal(page, TOTAL_WITH_WORKSPACE_SESSION);

    await page.getByTestId(`usage-details-day-${fixtures.day}`).click();
    const row = page
      .locator('[data-testid^="usage-session-row-"]')
      .filter({ hasText: WORKSPACE_SESSION_TOKENS });
    await expect(row).toHaveCount(1);

    await row.locator('[data-testid^="usage-session-open-"]').click();

    // Resuming lands in that workspace, on the terminal the daemon just started.
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
    await expect(page.getByTestId("terminal-surface").first()).toBeVisible({ timeout: 30_000 });
  });
});
