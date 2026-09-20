import { expect, test } from "../support/fixtures";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsagePage, waitForUsageTotal } from "../support/helpers/usage-page";

const fixtures = createUsageFixtureRoots("paseo-usage-details-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

/** Token totals come only from the parsers, so they are exact. */
const FIXTURE_TOKENS = "180,248";
const FIXTURE_SESSIONS = "13";
const FIXTURE_DAY = fixtures.day;
const FIXTURE_MONTH = FIXTURE_DAY.slice(0, 7);
/**
 * Costs depend on the bundled price snapshot, which is refreshed before a
 * release, so the shape is asserted rather than the amount.
 */
const COST_PATTERN = /\$\d+\.\d{2}/;

const FIXTURE_DAY_LABEL = formatUtc(FIXTURE_DAY, {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const FIXTURE_MONTH_LABEL = formatUtc(FIXTURE_DAY, { year: "numeric", month: "short" });

function formatUtc(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(
    new Date(`${day}T00:00:00.000Z`),
  );
}

test.describe("Usage page data details", () => {
  test("owner reads the daily table and expands a day into its sessions", async ({ page }) => {
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    const dayRow = page.getByTestId(`usage-details-day-${FIXTURE_DAY}`);

    await test.step("the fixture day is one row carrying the whole total", async () => {
      await expect(dayRow).toContainText(FIXTURE_DAY_LABEL);
      await expect(dayRow).toContainText(FIXTURE_TOKENS);
      await expect(dayRow).toContainText(FIXTURE_SESSIONS);
      await expect(dayRow).toContainText(COST_PATTERN);
    });

    await test.step("expanding it lists that day's sessions, newest first", async () => {
      await expect(page.getByTestId(`usage-sessions-${FIXTURE_DAY}`)).toHaveCount(0);
      await dayRow.click();
      const sessions = page.getByTestId(`usage-sessions-${FIXTURE_DAY}`);
      await expect(sessions).toBeVisible();
      const rows = page.locator('[data-testid^="usage-session-open-"]');
      await expect(rows).toHaveCount(Number(FIXTURE_SESSIONS));
      // Every row names its source and the models it ran, which is what tells
      // two same-project sessions apart.
      await expect(sessions).toContainText("Claude Code");
      await expect(sessions).toContainText("claude-fable-5-1");
      await expect(sessions).toContainText("Codex");
    });

    await test.step("clicking the day again folds the sessions away", async () => {
      await dayRow.click();
      await expect(page.getByTestId(`usage-sessions-${FIXTURE_DAY}`)).toHaveCount(0);
    });
  });

  test("owner reads the same totals by month", async ({ page }) => {
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    await page.getByTestId("usage-details-tab-monthly").click();
    const monthRow = page.getByTestId(`usage-details-month-${FIXTURE_MONTH}`);
    await expect(monthRow).toContainText(FIXTURE_MONTH_LABEL);
    // Every fixture line lands in one month, so the month is the whole total.
    await expect(monthRow).toContainText(FIXTURE_TOKENS);
    await expect(monthRow).toContainText(FIXTURE_SESSIONS);
    await expect(page.getByTestId("usage-details-daily")).toHaveCount(0);
  });

  test("owner narrows the project list and opens one to its directories", async ({ page }) => {
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    await page.getByTestId("usage-details-tab-projects").click();
    const projectRows = page.locator('[data-testid^="usage-details-project-"]');

    await test.step("Top 3 keeps the three largest projects", async () => {
      await page.getByTestId("usage-details-projects-top-3").click();
      await expect(projectRows).toHaveCount(3);
    });

    await test.step("Top 10 widens the same list", async () => {
      await page.getByTestId("usage-details-projects-top-10").click();
      expect(await projectRows.count()).toBeGreaterThan(3);
    });

    await test.step("a project opens to the directories it ran in", async () => {
      await expect(page.locator('[data-testid^="usage-details-cwds-"]')).toHaveCount(0);
      await projectRows.first().click();
      const cwds = page.locator('[data-testid^="usage-details-cwds-"]');
      await expect(cwds).toHaveCount(1);
      await expect(cwds).toContainText("/work/");
    });
  });
});
