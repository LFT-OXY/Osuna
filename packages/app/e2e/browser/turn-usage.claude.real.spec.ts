import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import {
  cleanupRewindFlow,
  launchAgent,
  sendMessage,
  type AgentHandle,
  type RewindFlowProvider,
} from "../support/helpers/rewind-flow";

/**
 * The daemon and the Claude CLI it spawns share this directory, so the only
 * transcript the usage scanner can find is the one this test just produced —
 * the developer's own history never enters the numbers being asserted.
 */
const claudeConfigDirectory = mkdtempSync(path.join(tmpdir(), "paseo-turn-usage-claude-"));

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const PROMPT = "Reply with exactly TURN_USAGE_OK and nothing else. Do not use any tools.";

test.use({
  e2eDaemonEnvironment: {
    CLAUDE_CONFIG_DIR: claudeConfigDirectory,
    // The footer waits on `usage.updated`; a one-second scan keeps that wait
    // inside a test's patience instead of the default idle cadence.
    OSUNA_USAGE_SCAN_INTERVAL_MS: "1000",
    OSUNA_USAGE_PRICING_AUTO_UPDATE: "0",
  },
});

function turnUsageSegment(page: Page): Locator {
  return page.getByTestId("turn-usage-segment");
}

async function readTokens(locator: Locator): Promise<string> {
  const text = (await locator.innerText()).replace(/\s+/gu, " ");
  const match = /↑\S+ ↓\S+/u.exec(text);
  if (!match) throw new Error(`Expected an arrow token pair in ${JSON.stringify(text)}`);
  return match[0];
}

test.describe("turn usage from a real Claude turn", () => {
  test.describe.configure({ timeout: 300_000 });

  test("reports the turn in the footer and the same tokens in the session total", async ({
    page,
  }, testInfo) => {
    const provider = "claude" satisfies RewindFlowProvider;
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-turn-usage-")));
    let handle: AgentHandle | undefined;

    try {
      handle = await launchAgent({ page, provider, cwd, mode: "full-access" });
      await sendMessage(handle, PROMPT);

      await test.step("the finished turn's footer grows a usage tail", async () => {
        await expect(turnUsageSegment(page)).toBeVisible({ timeout: 120_000 });
        await expect(turnUsageSegment(page)).toHaveText(/·\s*↑\S+\s*↓\S+\s*·\s*\$\d/u);
      });

      await test.step("its popover breaks the turn down by model and says how long it took", async () => {
        await turnUsageSegment(page).hover();
        await expect(page.getByText("Turn usage", { exact: true })).toBeVisible({
          timeout: 10_000,
        });
        await expect(page.getByText(/^claude-/u).first()).toBeVisible();
        await expect(page.getByText("Duration", { exact: true })).toBeVisible();
        await expect(
          page.getByText("Estimated cost · priced at public API rates", { exact: true }),
        ).toBeVisible();
      });

      await test.step("the context meter spells out used and limit beside the ring", async () => {
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("context-window-token-label")).toHaveText(/^\S+ \/ \S+$/u, {
          timeout: 30_000,
        });
      });

      await test.step("the session total reports the same tokens as the only turn", async () => {
        const turnTokens = await readTokens(turnUsageSegment(page));
        await page.getByTestId("context-window-meter").hover();
        const sessionTotal = page.getByTestId("context-window-session-total");
        await expect(sessionTotal).toBeVisible({ timeout: 10_000 });
        await expect(sessionTotal).toContainText("Session total");
        expect(await readTokens(sessionTotal)).toBe(turnTokens);
      });

      await test.step("a phone drops the usage tail to a second line and the ring's label", async () => {
        await page.keyboard.press("Escape");
        await page.setViewportSize(MOBILE_VIEWPORT);
        await expect(page.getByTestId("context-window-token-label")).toHaveCount(0);
        const workedFor = page.getByRole("button", { name: /^Worked for/u }).last();
        const [labelBox, usageBox] = await Promise.all([
          workedFor.boundingBox(),
          turnUsageSegment(page).last().boundingBox(),
        ]);
        expect(labelBox).not.toBe(null);
        expect(usageBox).not.toBe(null);
        expect(usageBox!.y).toBeGreaterThan(labelBox!.y + labelBox!.height - 1);

        const screenshotPath = testInfo.outputPath("turn-usage-compact.png");
        await page.screenshot({ path: screenshotPath });
        await testInfo.attach("Turn usage at phone width", {
          path: screenshotPath,
          contentType: "image/png",
        });
      });
    } finally {
      await cleanupRewindFlow({ handle, cwd });
    }
  });
});
