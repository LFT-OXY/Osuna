import { expect, test, type Page } from "../support/fixtures";
import {
  composerLocator,
  expectComposerText,
  expectComposerVisible,
  sendDraftToQueue,
  submitMessage,
} from "../support/helpers/composer";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { createMockIdleAgent, openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import { expectInlineBlocks, installAgentCommandsStub } from "../support/helpers/inline-blocks";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  seedRunningMockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";

const COMMANDS = [
  { name: "atw-tdd", description: "Red, green, refactor", argumentHint: "", kind: "skill" },
  { name: "atw-askme", description: "Ask me first", argumentHint: "", kind: "skill" },
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

/** Focuses the visible composer once it accepts input. */
async function focusComposer(page: Page) {
  const input = composerLocator(page);
  await expect(input).toBeEditable({ timeout: 30_000 });
  await input.click();
  return input;
}

/** Types `/query` and clicks the Command menu entry `/name`. */
async function pickSkill(page: Page, query: string, name: string): Promise<void> {
  await page.keyboard.type(`/${query}`);
  const option = page
    .getByTestId("composer-autocomplete-popover")
    .getByText(`/${name}`, { exact: true })
    .first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
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

  test("skills picked mid-text lead the message as blocks and send as a /name prefix", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await installAgentCommandsStub(page, COMMANDS);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `inline-blocks-skill-${testInfo.workerIndex}-`,
      title: "Inline blocks skill",
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await expectComposerVisible(page);
      const input = await focusComposer(page);
      await page.keyboard.type("fix it ");
      await pickSkill(page, "atw-t", "atw-tdd");

      // The block leads the message; the /query is gone and the caret stays where it was.
      await expectInlineBlocks(input, [{ variant: "skill", label: "Skill: atw-tdd" }]);
      await expectComposerText(input, "atw-tdd fix it ");
      await expect(page.getByTestId("composer-attachment-tray")).toHaveCount(0);
      await pickSkill(page, "atw-a", "atw-askme");
      await page.keyboard.type("now");
      const skillBlocks = [
        { variant: "skill", label: "Skill: atw-tdd" },
        { variant: "skill", label: "Skill: atw-askme" },
      ] as const;
      await expectInlineBlocks(input, skillBlocks);
      await expectComposerText(input, "atw-tdd atw-askme fix it now");
      await page.keyboard.press("Enter");
      await expectAgentIdle(page);

      const bubble = page.getByTestId("user-message").filter({ hasText: "fix it now" }).last();
      await expectInlineBlocks(bubble, skillBlocks);
      await bubble.getByTestId("user-message-bubble").hover();
      await bubble.getByRole("button", { name: "Copy message" }).click();
      await expect.poll(() => readClipboardText(page)).toBe("/atw-tdd /atw-askme fix it now");
    } finally {
      await agent.cleanup();
    }
  });

  test("picked blocks stay blocks and typed links stay text after switching tabs", async ({
    page,
  }, testInfo) => {
    await installAgentCommandsStub(page, COMMANDS);
    const workspace = await seedWorkspace({
      repoPrefix: `inline-blocks-draft-${testInfo.workerIndex}-`,
      repo: { files: [{ path: "src/widget.ts", content: "export {};\n" }] },
    });
    try {
      const drafting = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Drafting agent",
      });
      const other = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Other agent",
      });
      await openWorkspaceWithAgents(page, [other, drafting]);
      const input = await focusComposer(page);
      // A typed known /skill stays text, even once a later pick puts a Skill block before it
      // and it reads like a leading skill. Escape closes the Command menu it opens.
      await page.keyboard.type("/atw-askme");
      await page.keyboard.press("Escape");
      await page.keyboard.type(" read ");
      await pickFileMention(page, "widget", "src/widget.ts");
      await page.keyboard.type("not [notes.md](docs/notes.md) ");
      await pickSkill(page, "atw-t", "atw-tdd");
      // The composer shows each picked block by its name and typed text as written.
      const draft = "atw-tdd /atw-askme read widget.ts not [notes.md](docs/notes.md) ";
      const draftBlocks = [
        { variant: "skill", label: "Skill: atw-tdd" },
        { variant: "file", label: "File: widget.ts" },
      ] as const;
      await expectInlineBlocks(input, draftBlocks);

      await page.getByTestId(`workspace-tab-agent_${other.id}`).filter({ visible: true }).click();
      await expectComposerText(composerLocator(page), "");
      await page
        .getByTestId(`workspace-tab-agent_${drafting.id}`)
        .filter({ visible: true })
        .click();

      const restored = composerLocator(page);
      await expectComposerText(restored, draft);
      await expectInlineBlocks(restored, draftBlocks);
    } finally {
      await workspace.cleanup();
    }
  });

  test("a queued message keeps its blocks in the queue track and back in the composer", async ({
    page,
  }, testInfo) => {
    await installAgentCommandsStub(page, COMMANDS);
    const agent = await seedRunningMockAgentWorkspace({
      repoPrefix: `inline-blocks-queue-${testInfo.workerIndex}-`,
      title: "Inline blocks queue",
      model: "one-minute-stream",
      initialPrompt: "Keep this turn running while a message waits in the queue.",
      repo: { files: [{ path: "src/components/button.tsx", content: "export {};\n" }] },
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await expectComposerVisible(page);
      await focusComposer(page);
      // A typed leading /name stays text until it is sent, even for a known skill.
      await page.keyboard.type("/atw-tdd then ");
      await pickFileMention(page, "components", "src/components");
      await page.keyboard.type("next");
      await sendDraftToQueue(page);

      const queued = page.getByTestId("queued-message");
      await expect(queued).toHaveCount(1);
      await expectInlineBlocks(queued, [{ variant: "directory", label: "Folder: components" }]);
      await expect(queued).toContainText("/atw-tdd then");

      await queued.getByRole("button", { name: "Edit queued message" }).click();
      await expect(queued).toHaveCount(0);
      const input = composerLocator(page);
      await expectComposerText(input, "/atw-tdd then components next");
      await expectInlineBlocks(input, [{ variant: "directory", label: "Folder: components" }]);
    } finally {
      await agent.cleanup();
    }
  });

  test("rewinding a message puts its blocks back in the composer", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const prompt = "ask [@Claude](paseo://agent/claude) about [x.ts](src/x.ts) please";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `inline-blocks-rewind-${testInfo.workerIndex}-`,
      title: "Inline blocks rewind",
      model: "ten-second-stream",
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await expectComposerVisible(page);
      await submitMessage(page, prompt);
      const userMessage = page.getByTestId("user-message").filter({ hasText: "please" }).last();
      await expect(userMessage).toBeVisible();
      const finish = await agent.client.waitForFinish(agent.agentId, 30_000);
      expect(finish.status).toBe("idle");
      await expect(userMessage).toHaveAttribute("aria-busy", "false");

      await userMessage.getByTestId("user-message-bubble").hover();
      await userMessage
        .getByRole("button", { name: "Rewind to this message", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Rewind conversation", exact: true }).click();

      // The composer shows each block by its name.
      const input = composerLocator(page);
      await expectComposerText(input, "ask Claude about x.ts please");
      await expectInlineBlocks(input, [
        { variant: "agent", label: "Agent: Claude" },
        { variant: "file", label: "File: x.ts" },
      ]);
    } finally {
      await agent.cleanup();
    }
  });
});
