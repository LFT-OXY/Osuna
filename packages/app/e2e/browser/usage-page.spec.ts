import { expect, test } from "../support/fixtures";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsagePage, waitForUsageTotal } from "../support/helpers/usage-page";

const fixtures = createUsageFixtureRoots("paseo-usage-page-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

/** Token totals come only from the parsers, so they are exact. */
const FIXTURE_TOKENS = "180,248";

/**
 * Costs depend on the bundled price snapshot, which is refreshed before a
 * release, so the shape is asserted rather than the amount. How many models
 * the snapshot misses is asserted instead, which is what the page tells the
 * user.
 */
const COST_PATTERN = /^\$\d+\.\d{2}$/;

/**
 * Every fixture line is stamped on the same day, which the derived panels all
 * read. The statistics footer and the heatmap count the report's trailing
 * 26-week window, so these assertions hold until the fixture day ages out of it.
 */
const FIXTURE_DAY = "2026-09-18";
const FIXTURE_DAY_LABEL = "Sep 18, 2026";
const FIXTURE_MONTH = "2026-09";
const FIXTURE_MONTH_LABEL = "Sep 2026";

const FIXTURE_SESSIONS = "13";

/** The three models the statistics panel ranks, largest first. */
const FIXTURE_TOP_MODELS = ["claude-fable-5-1", "gpt-5.5", "gpt-5.6-luna"] as const;

/** Trend group keys by source: the CLI, plus the backend where Pi and OMP have one. */
const FIXTURE_TREND_SOURCES = [
  "claude",
  "codex",
  "pi:anthropic",
  "omp:3oxy-openai",
  "omp:anthropic",
  "pi:openai-codex",
] as const;

/** `(testID suffix, label, share, model count)` for every fixture source, in rendered order. */
const SOURCE_CARDS = [
  // The "All" card counts distinct model ids, so a model two CLIs both used counts once.
  ["all", "All", "100.00%", "7 models"],
  ["claude", "Claude Code", "92.23%", "2 models"],
  ["codex", "Codex", "4.92%", "4 models"],
  ["pi:anthropic", "Pi · Anthropic", "1.06%", "2 models"],
  ["omp:3oxy-openai", "OMP · 3oxy-openai", "0.69%", "1 model"],
  ["omp:anthropic", "OMP · Anthropic", "0.68%", "1 model"],
  ["pi:openai-codex", "Pi · OpenAI Codex", "0.42%", "1 model"],
] as const;

test.describe("Usage page", () => {
  test("owner reads the fixture totals, sources and model breakdown", async ({ page }) => {
    await openUsagePage(page);

    await test.step("the overview totals every fixture source", async () => {
      await waitForUsageTotal(page, FIXTURE_TOKENS);
      await expect(page.getByTestId("usage-total-cost")).toHaveText(COST_PATTERN);
      await expect(page.getByTestId("usage-range")).toHaveText("All time");
      await expect(page.getByTestId("usage-unpriced-summary")).toHaveText(
        "1 model has no price data",
      );

      for (const [key, label, share, models] of SOURCE_CARDS) {
        const card = page.getByTestId(`usage-source-card-${key}`);
        await expect(card).toContainText(label);
        await expect(card).toContainText(share);
        await expect(card).toContainText(models);
      }
    });

    await test.step("a source card expands its model breakdown and collapses again", async () => {
      await expect(page.getByTestId("usage-model-breakdown")).toHaveCount(0);

      await page.getByTestId("usage-source-card-claude").click();
      const breakdown = page.getByTestId("usage-model-breakdown");
      await expect(breakdown).toContainText("Claude Code · models");
      await expect(breakdown).toContainText("claude-fable-5-1");
      await expect(breakdown).toContainText("claude-opus-5");

      await page.getByTestId("usage-source-card-claude").click();
      await expect(page.getByTestId("usage-model-breakdown")).toHaveCount(0);
    });

    await test.step("the model the price table misses carries its own label", async () => {
      await page.getByTestId("usage-source-card-all").click();
      const breakdown = page.getByTestId("usage-model-breakdown");
      await expect(breakdown).toContainText("All · models");
      await expect(breakdown.getByText("No price data", { exact: true })).toHaveCount(1);
    });
  });

  test("owner narrows the period and pages back through it", async ({ page }) => {
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    await test.step("switching to Day narrows the range to today", async () => {
      await page.getByTestId("usage-period-tab-day").click();
      await expect(page.getByTestId("usage-period-next")).toBeDisabled();
      // Every fixture is dated in the past, so today holds nothing.
      await expect(page.getByTestId("usage-total-tokens")).toHaveText("0");
    });

    await test.step("the back arrow moves to the previous day", async () => {
      const rangeBefore = await page.getByTestId("usage-range").textContent();
      await page.getByTestId("usage-period-prev").click();
      await expect(page.getByTestId("usage-range")).not.toHaveText(rangeBefore ?? "");
      await expect(page.getByTestId("usage-period-next")).toBeEnabled();
    });

    await test.step("a custom range covering the fixtures restores the full total", async () => {
      await page.getByTestId("usage-period-tab-custom").click();
      await page.getByTestId("usage-custom-from").fill("2026-01-01");
      await page.getByTestId("usage-custom-to").fill("2026-12-31");
      await expect(page.getByTestId("usage-period-tab-custom")).toHaveText("1/1 – 12/31");
      await waitForUsageTotal(page, FIXTURE_TOKENS);
    });

    await test.step("refresh keeps the same totals", async () => {
      await page.getByTestId("usage-refresh").click();
      await waitForUsageTotal(page, FIXTURE_TOKENS);
    });
  });

  test("owner reads the statistics panel, the heatmap and the trend", async ({ page }) => {
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    await test.step("the statistics panel counts the sessions and ranks the models", async () => {
      await expect(page.getByTestId("usage-stat-sessions")).toHaveText(FIXTURE_SESSIONS);
      const topModels = page.getByTestId("usage-stats-top-models");
      for (const model of FIXTURE_TOP_MODELS) {
        await expect(topModels).toContainText(model);
      }
      await expect(page.getByTestId("usage-stat-first-used")).toContainText(FIXTURE_DAY_LABEL);
      await expect(page.getByTestId("usage-stat-active-days")).toContainText("1 day");
    });

    await test.step("hovering the fixture day names it and its token count", async () => {
      await page.getByTestId(`usage-heatmap-cell-${FIXTURE_DAY}`).hover();
      await expect(page.getByTestId("usage-heatmap-caption")).toHaveText(
        `${FIXTURE_DAY_LABEL} · ${FIXTURE_TOKENS} tokens`,
      );
    });

    await test.step("the trend stacks the fixture month by source", async () => {
      await expect(page.getByTestId("usage-trend-last")).toHaveText(FIXTURE_MONTH_LABEL);
      for (const source of FIXTURE_TREND_SOURCES) {
        await expect(
          page.getByTestId(`usage-trend-segment-${FIXTURE_MONTH}-${source}`),
        ).toBeAttached();
      }
    });

    await test.step("switching the stack to By model bands the same bar by model", async () => {
      await page.getByTestId("usage-trend-stack-model").click();
      for (const model of FIXTURE_TOP_MODELS) {
        await expect(
          page.getByTestId(`usage-trend-segment-${FIXTURE_MONTH}-${model}`),
        ).toBeAttached();
      }
      await expect(page.getByTestId(`usage-trend-segment-${FIXTURE_MONTH}-claude`)).toHaveCount(0);
    });

    await test.step("the Day period turns the trend axis into hours", async () => {
      await page.getByTestId("usage-period-tab-day").click();
      await expect(page.getByTestId("usage-trend-first")).toHaveText("00:00");
      await expect(page.getByTestId("usage-trend-last")).toHaveText("23:00");
    });
  });
});
