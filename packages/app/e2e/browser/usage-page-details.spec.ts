import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";
import { openUsagePage, waitForUsageTotal } from "../support/helpers/usage-page";

const fixtures = createUsageFixtureRoots("paseo-usage-details-");

test.use({ e2eDaemonEnvironment: fixtures.environment });

/** Token totals come only from the parsers, so they are exact. */
const FIXTURE_TOKENS = "180,248";
/**
 * At the default 1280 the card is narrower than the full table, so the rows
 * shorten their counts; a window this wide fits the full table.
 */
const FIXTURE_TOKENS_SHORT = "180.2K";
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
const FULL_TABLE_VIEWPORT = { width: 1680, height: 900 };
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
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    const dayRow = page.getByTestId(`usage-details-day-${FIXTURE_DAY}`);

    await test.step("the fixture day is one row carrying the whole total", async () => {
      await expect(dayRow).toContainText(FIXTURE_DAY_LABEL);
      await expect(dayRow).toContainText(FIXTURE_TOKENS_SHORT);
      await expect(dayRow).toContainText(FIXTURE_SESSIONS);
      await expect(dayRow).toContainText(COST_PATTERN);
    });

    await test.step("a window wide enough for the full table shows the exact count", async () => {
      await page.setViewportSize(FULL_TABLE_VIEWPORT);
      await expect(dayRow).toContainText(FIXTURE_TOKENS);
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
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await openUsagePage(page);
    await waitForUsageTotal(page, FIXTURE_TOKENS);

    await page.getByTestId("usage-details-tab-monthly").click();
    const monthRow = page.getByTestId(`usage-details-month-${FIXTURE_MONTH}`);
    await expect(monthRow).toContainText(FIXTURE_MONTH_LABEL);
    // Every fixture line lands in one month, so the month is the whole total.
    await expect(monthRow).toContainText(FIXTURE_TOKENS_SHORT);
    await page.setViewportSize(FULL_TABLE_VIEWPORT);
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

const DAILY_HEADERS = {
  en: ["Date", "Total", "Input", "Output", "Cache", "Reasoning", "Sessions", "Cost"],
  "zh-CN": ["日期", "总计", "输入", "输出", "缓存", "推理", "会话", "估算成本"],
} as const;

/** Narrower than this and two header words would read as one. */
const MIN_HEADER_GAP = 4;

interface HorizontalSpan {
  left: number;
  right: number;
}

interface DailyHeaderLayout {
  texts: string[];
  /** Where each header's text is drawn, not its cell. */
  spans: HorizontalSpan[];
  /** The part of the table the scroller shows. */
  visible: HorizontalSpan;
  hiddenWidth: number;
}

/** `scrollToEnd` slides the table all the way right before measuring. */
async function readDailyHeaders(
  page: Page,
  { scrollToEnd = false }: { scrollToEnd?: boolean } = {},
): Promise<DailyHeaderLayout> {
  return page.getByTestId("usage-details-daily-head").evaluate((head, toEnd) => {
    let scroller = head.parentElement;
    while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowX)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error("The daily table has no horizontal scroller");
    if (toEnd) scroller.scrollLeft = scroller.scrollWidth;
    const cells = [...head.children];
    const spans = cells.map((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    const box = scroller.getBoundingClientRect();
    return {
      texts: cells.map((cell) => cell.textContent ?? ""),
      spans,
      visible: { left: box.left, right: box.right },
      hiddenWidth: scroller.scrollWidth - scroller.clientWidth,
    };
  }, scrollToEnd);
}

/** Narrows to a phone and waits for the table to start sliding sideways. */
async function narrowToPhone(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => readHiddenWidthWhileRebuilding(page)).toBeGreaterThan(0);
}

/**
 * The page rebuilds for the phone layout, so a read can land while the table
 * has no scroller around it yet; that reads as nothing hidden.
 */
async function readHiddenWidthWhileRebuilding(page: Page): Promise<number> {
  return page.getByTestId("usage-details-daily-head").evaluate((head) => {
    let scroller = head.parentElement;
    while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowX)) {
      scroller = scroller.parentElement;
    }
    return scroller ? scroller.scrollWidth - scroller.clientWidth : 0;
  });
}

/** Every header in order, none run into the next, and the last one is in view whole. */
function expectHeadersReadable(layout: DailyHeaderLayout, expected: readonly string[]): void {
  expect(layout.texts).toEqual(expected);
  for (let index = 1; index < layout.spans.length; index += 1) {
    const gap = layout.spans[index].left - layout.spans[index - 1].right;
    expect(gap, `${layout.texts[index - 1]} → ${layout.texts[index]}`).toBeGreaterThanOrEqual(
      MIN_HEADER_GAP,
    );
  }
  const last = layout.spans.at(-1);
  if (!last) throw new Error("The daily table has no headers");
  expect(last.left).toBeGreaterThanOrEqual(layout.visible.left);
  expect(last.right).toBeLessThanOrEqual(layout.visible.right);
}

test.describe("Usage page daily table headers", () => {
  for (const language of ["en", "zh-CN"] as const) {
    test(`every header reads in full, wide and narrow (${language})`, async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem("@paseo:app-settings", JSON.stringify({ language: value }));
      }, language);
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await openUsagePage(page);
      await waitForUsageTotal(page, FIXTURE_TOKENS);
      await page.getByTestId("usage-details-daily-head").scrollIntoViewIfNeeded();

      await test.step("at 1280 the whole table fits, nothing is left to slide to", async () => {
        const layout = await readDailyHeaders(page);
        expect(layout.hiddenWidth).toBeLessThanOrEqual(0);
        expectHeadersReadable(layout, DAILY_HEADERS[language]);
      });

      await test.step("at 390 sliding to the end shows the last header in full", async () => {
        await narrowToPhone(page);
        const layout = await readDailyHeaders(page, { scrollToEnd: true });
        expectHeadersReadable(layout, DAILY_HEADERS[language]);
      });
    });
  }
});
