import { expect, test, type Page } from "../support/fixtures";
import {
  expectNearBottom,
  scrollAgentChatToBottom,
  waitForScrollableChat,
} from "../support/helpers/agent-bottom-anchor";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import {
  composerLocator,
  expectComposerText,
  expectComposerVisible,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

async function composerHeight(page: Page): Promise<number> {
  return composerLocator(page).evaluate((element) => element.getBoundingClientRect().height);
}

async function expectComposerHeight(page: Page, expected: number): Promise<void> {
  await expect.poll(() => composerHeight(page)).toBe(expected);
}

async function pressComposerKeyAndMeasureNextPaint(page: Page, key: string): Promise<number> {
  const composer = composerLocator(page);
  await installNextComposerPaintProbe(page);
  await composer.press(key);
  return readNextComposerPaintHeight(page);
}

async function typeComposerTextAndMeasureNextPaint(page: Page, text: string): Promise<number> {
  const composer = composerLocator(page);
  await installNextComposerPaintProbe(page);
  await composer.pressSequentially(text);
  return readNextComposerPaintHeight(page);
}

async function installNextComposerPaintProbe(page: Page): Promise<void> {
  await composerLocator(page).evaluate((element) => {
    Reflect.set(
      globalThis,
      "__composerNextPaintHeight",
      new Promise<number>((resolve) => {
        // Shift+Enter 由编辑器自己插入，不触发 input 事件，改为观察 DOM 变更。
        const observer = new MutationObserver(() => {
          observer.disconnect();
          requestAnimationFrame(() => resolve(element.getBoundingClientRect().height));
        });
        observer.observe(element, { childList: true, characterData: true, subtree: true });
      }),
    );
  });
}

async function readNextComposerPaintHeight(page: Page): Promise<number> {
  return page.evaluate(() => Reflect.get(globalThis, "__composerNextPaintHeight"));
}

test("blank composer lines remain present and keep their measured height", async ({ page }) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-whitespace-",
    title: "Composer whitespace",
  });

  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    const composer = composerLocator(page);
    const blankLines = "\n\n\n\n\n";
    const collapsedHeight = await composerHeight(page);

    await test.step("remeasure the current draft when the window narrows", async () => {
      await page.setViewportSize({ width: 1280, height: 1200 });
      const text = "A sentence that wraps when the editor becomes narrower. ".repeat(8);
      await composer.fill(text);
      await expectComposerText(composer, text);
      await expect.poll(() => composerHeight(page)).toBeGreaterThan(collapsedHeight);
      const wideHeight = await composerHeight(page);
      await page.setViewportSize({ width: 480, height: 1200 });
      await expect.poll(() => composerHeight(page)).toBeGreaterThan(wideHeight);
      await expectComposerText(composer, text);
      await page.setViewportSize({ width: 1280, height: 720 });
    });

    await test.step("grow the composer with blank lines followed by text", async () => {
      await composer.fill(`${blankLines}x`);
      await expectComposerText(composer, `${blankLines}x`);
      await expect.poll(() => composerHeight(page)).toBeGreaterThan(collapsedHeight);
    });

    await test.step("delete only the text without losing the blank lines or height", async () => {
      const expandedHeight = await composerHeight(page);
      await composer.press("Backspace");
      await expectComposerText(composer, blankLines);
      await expectComposerHeight(page, expandedHeight);
    });

    await test.step("grow on the first paint of a newline and stay stable when it receives a glyph", async () => {
      await composer.fill("alpha\nbeta");
      const filledLineHeight = await composerHeight(page);
      const trailingLineHeight = await pressComposerKeyAndMeasureNextPaint(page, "Shift+Enter");
      expect(trailingLineHeight).toBeGreaterThan(filledLineHeight);

      const filledTrailingLineHeight = await typeComposerTextAndMeasureNextPaint(page, "x");
      await expectComposerText(composer, "alpha\nbeta\nx");
      expect(filledTrailingLineHeight).toBe(trailingLineHeight);
    });

    await test.step("stop growing at the maximum height and scroll inside", async () => {
      const text = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n");
      await composer.fill(text);
      await expectComposerText(composer, text);
      // 最大高度是视口高度的一半（至少 160），720 高的视口为 360。
      const scroller = await composer.evaluate((element) => {
        const box = element.closest("[data-composer-input]");
        if (!(box instanceof HTMLElement)) throw new Error("Composer scroll box is unavailable");
        return {
          height: box.getBoundingClientRect().height,
          scrollHeight: box.scrollHeight,
          clientHeight: box.clientHeight,
        };
      });
      expect(scroller.height).toBeLessThanOrEqual(360);
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    });
  } finally {
    await agent.cleanup();
  }
});

test("composer growth keeps a bottom-pinned chat at the bottom", async ({ page }) => {
  test.setTimeout(90_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-bottom-anchor-",
    title: "Composer bottom anchor",
    initialPrompt: "Produce enough content to make the chat scrollable.",
    model: "ten-second-stream",
  });

  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await waitForScrollableChat(page, { minScrollableDistance: 200, timeout: 30_000 });
    await scrollAgentChatToBottom(page);

    const composer = composerLocator(page);
    await composer.fill("alpha");
    for (let line = 0; line < 8; line += 1) {
      await composer.press("Shift+Enter");
    }

    await expectNearBottom(page);
  } finally {
    await agent.cleanup();
  }
});
