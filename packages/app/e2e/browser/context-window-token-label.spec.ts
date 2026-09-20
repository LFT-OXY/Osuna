import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function openMockAgent(page: Page) {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "context-window-token-label-",
    title: "Context window token label e2e",
    initialPrompt: "emit 1 coalesced agent stream update for the context window meter.",
  });
  await openAgentRoute(page, session);
  await expectComposerVisible(page);
  await expect(page.getByTestId("context-window-meter")).toBeVisible({ timeout: 30_000 });
  return session;
}

test("the context meter spells out used and limit on a desktop and keeps the ring alone on a phone", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const session = await openMockAgent(page);
  try {
    const label = page.getByTestId("context-window-token-label");
    await expect(label).toHaveText(/^\S+ \/ \S+$/u, { timeout: 30_000 });

    await page.setViewportSize(MOBILE_VIEWPORT);
    await expect(label).toHaveCount(0);
    await expect(page.getByTestId("context-window-meter")).toBeVisible();

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(label).toHaveText(/^\S+ \/ \S+$/u);
  } finally {
    await session.cleanup();
  }
});
