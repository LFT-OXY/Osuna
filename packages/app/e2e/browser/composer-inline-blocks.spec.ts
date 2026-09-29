import { expect, test, type Page } from "../support/fixtures";
import {
  composerLocator,
  expectComposerText,
  expectComposerVisible,
  fillComposerDraft,
  sendDraftToQueue,
  startRunningMockAgent,
  submitMessage,
} from "../support/helpers/composer";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { expectInlineBlocks, installAgentCommandsStub } from "../support/helpers/inline-blocks";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const COMMANDS = [
  { name: "atw-tdd", description: "Red, green, refactor", argumentHint: "", kind: "skill" },
  { name: "compact", description: "Compact the conversation", argumentHint: "", kind: "command" },
] as const;

// A leading known skill, a file, a directory, an image, a link that is not a file mention, and
// an agent mention. The message ends in plain words so no `@` or `/` list is open on Enter.
const MESSAGE =
  "/atw-tdd read [x.ts](src/x.ts), [components](src/components/), [logo.png](assets/logo.png)" +
  ' and [the helper](src/y.ts) not "src/z.ts" with [@Claude](paseo://agent/claude) please';

const MESSAGE_BLOCKS = [
  { variant: "skill", label: "Skill: atw-tdd" },
  { variant: "file", label: "File: x.ts" },
  { variant: "directory", label: "Folder: components" },
  { variant: "image", label: "Image: logo.png" },
  { variant: "agent", label: "Agent: Claude" },
] as const;

function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Types `@query` and clicks the workspace entry whose path is `path`. */
async function pickFileMention(page: Page, query: string, path: string): Promise<void> {
  await page.keyboard.type(`@${query}`);
  const option = page
    .getByTestId("composer-autocomplete-popover")
    .getByText(path, { exact: true })
    .first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
}

test.describe("Inline blocks in sent messages", () => {
  test("the user bubble shows blocks, keeps other text as written, and copies the raw text", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await installAgentCommandsStub(page, COMMANDS);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `inline-blocks-bubble-${testInfo.workerIndex}-`,
      title: "Inline blocks bubble",
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await expectComposerVisible(page);
      await submitMessage(page, MESSAGE);
      await expectAgentIdle(page);

      const bubble = page.getByTestId("user-message").filter({ hasText: "please" }).last();
      await expectInlineBlocks(bubble, MESSAGE_BLOCKS);
      await expect(bubble).toContainText('[the helper](src/y.ts) not "src/z.ts"');
      await expect(bubble).not.toContainText("](src/x.ts)");
      await expect(bubble).not.toContainText("/atw-tdd");

      await bubble.getByTestId("user-message-bubble").hover();
      await bubble.getByRole("button", { name: "Copy message" }).click();
      await expect.poll(() => readClipboardText(page)).toBe(MESSAGE);

      await page.reload();
      await expectComposerVisible(page);
      const reloadedBubble = page.getByTestId("user-message").filter({ hasText: "please" }).last();
      await expectInlineBlocks(reloadedBubble, MESSAGE_BLOCKS);
      await expect(reloadedBubble).toContainText('[the helper](src/y.ts) not "src/z.ts"');
    } finally {
      await agent.cleanup();
    }
  });

  test("a leading /name that is not a skill stays text", async ({ page }, testInfo) => {
    await installAgentCommandsStub(page, COMMANDS);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `inline-blocks-command-${testInfo.workerIndex}-`,
      title: "Inline blocks command",
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await expectComposerVisible(page);
      await submitMessage(page, "/compact keep [notes.md](docs/notes.md) short");
      await expectAgentIdle(page);

      const bubble = page.getByTestId("user-message").filter({ hasText: "short" }).last();
      await expectInlineBlocks(bubble, [{ variant: "file", label: "File: notes.md" }]);
      await expect(bubble).toContainText("/compact keep");
    } finally {
      await agent.cleanup();
    }
  });

  test("a queued message shows blocks in the queue track", async ({ page }, testInfo) => {
    await installAgentCommandsStub(page, COMMANDS);
    const agent = await startRunningMockAgent(page, {
      prefix: `inline-blocks-queue-${testInfo.workerIndex}-`,
      model: "one-minute-stream",
      prompt: "Keep this turn running while a message waits in the queue.",
    });
    try {
      // 排队项目前只有文本，按"无结构的旧项"解析显示。工单 04 起排队项带分段结构，
      // 手打的 `/atw-tdd` 发出前保持文字，届时这里改用选中产生的块。
      await fillComposerDraft(page, "/atw-tdd then [components](src/components/) next");
      await sendDraftToQueue(page);

      const queued = page.getByTestId("queued-message");
      await expect(queued).toHaveCount(1);
      await expectInlineBlocks(queued, [
        { variant: "skill", label: "Skill: atw-tdd" },
        { variant: "directory", label: "Folder: components" },
      ]);
      await expect(queued).toContainText("then");
    } finally {
      await agent.cleanup();
    }
  });
});

test.describe("Inline blocks in the composer", () => {
  test("files and directories picked from the @ list become blocks and send as links", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `inline-blocks-mention-${testInfo.workerIndex}-`,
      title: "Inline blocks mention",
      repo: {
        files: [
          { path: "src/widget.ts", content: "export {};\n" },
          { path: "src/components/button.tsx", content: "export {};\n" },
          { path: "assets/logo.png", content: "png\n" },
        ],
      },
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await expectComposerVisible(page);
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });
      await input.click();

      await page.keyboard.type("read ");
      await pickFileMention(page, "widget", "src/widget.ts");
      await page.keyboard.type("and ");
      await pickFileMention(page, "logo", "assets/logo.png");
      await page.keyboard.type("in ");
      await pickFileMention(page, "components", "src/components");
      await pickFileMention(page, "button", "src/components/button.tsx");
      const pickedBlocks = [
        { variant: "file", label: "File: widget.ts" },
        { variant: "image", label: "Image: logo.png" },
        { variant: "directory", label: "Folder: components" },
      ] as const;
      await expectInlineBlocks(input, [
        ...pickedBlocks,
        { variant: "file", label: "File: button.tsx" },
      ]);

      // The caret sits after the space the pick added: one Backspace for the space, one for the
      // whole block.
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await expectInlineBlocks(input, pickedBlocks);
      await page.keyboard.type("please");

      const sent =
        "read [widget.ts](src/widget.ts) and [logo.png](assets/logo.png) in " +
        "[components](src/components/) please";

      // Copying puts the link text on the clipboard; pasting inside the composer keeps the
      // blocks: paste once after the draft, then clear the draft and paste it back alone.
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("ControlOrMeta+c");
      await expect.poll(() => readClipboardText(page)).toBe(sent);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ControlOrMeta+v");
      await expectInlineBlocks(input, [...pickedBlocks, ...pickedBlocks]);
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("ControlOrMeta+v");
      await expectInlineBlocks(input, pickedBlocks);
      await page.keyboard.press("Enter");
      await expectAgentIdle(page);

      const bubble = page.getByTestId("user-message").filter({ hasText: "please" }).last();
      await expectInlineBlocks(bubble, pickedBlocks);
      await bubble.getByTestId("user-message-bubble").hover();
      await bubble.getByRole("button", { name: "Copy message" }).click();
      await expect.poll(() => readClipboardText(page)).toBe(sent);

      // The copy button put plain link text on the clipboard; pasted from outside, it stays text.
      await input.click();
      await page.keyboard.press("ControlOrMeta+v");
      await expectComposerText(input, sent);
      await expect(input.getByTestId("inline-block")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
