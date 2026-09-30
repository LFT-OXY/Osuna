import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { composerLocator, expectComposerVisible } from "../support/helpers/composer";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { expectInlineBlocks } from "../support/helpers/inline-blocks";
import { seedAgentProfiles } from "../support/helpers/agent-profiles";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { installHostWithoutAgentMentions } from "../support/helpers/mention-defaults";
import { getServerId } from "../support/helpers/server-id";

// 本文件的 worker daemon 注入 Osuna tools，mock 智能体可以派发。置灰用例在建智能体前关掉注入：
// daemon 只在会话启动时判定一次。
test.use({ e2eInjectPaseoTools: true });

interface DaemonConfigClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  patchDaemonConfig(config: { mcp: { injectIntoAgents: boolean } }): Promise<unknown>;
}

async function withOsunaToolsOff<T>(run: () => Promise<T>): Promise<T> {
  const client = await connectDaemonClient<DaemonConfigClient>({
    clientIdPrefix: "agent-mentions-e2e",
  });
  try {
    await client.patchDaemonConfig({ mcp: { injectIntoAgents: false } });
    return await run();
  } finally {
    await client.patchDaemonConfig({ mcp: { injectIntoAgents: true } }).catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

const REPO_FILES = [
  { path: "src/mock-server.ts", content: "export {};\n" },
  { path: "src/widget.ts", content: "export {};\n" },
  { path: "README.md", content: "# repo\n" },
];

function popover(page: Page): Locator {
  return page.getByTestId("composer-autocomplete-popover");
}

/** 打开的 `@` 列表里从上到下的组标题与行名。 */
async function readList(page: Page): Promise<string[]> {
  return popover(page)
    .locator('[data-testid="autocomplete-group-title"], [data-testid="autocomplete-option-label"]')
    .allTextContents();
}

function agentRow(page: Page, label: string): Locator {
  return popover(page).getByRole("option").filter({ hasText: label });
}

async function openAgentComposer(page: Page, input: { agentId: string; workspaceId: string }) {
  await openAgentRoute(page, input);
  await expectComposerVisible(page);
  const composer = composerLocator(page);
  await expect(composer).toBeEditable({ timeout: 30_000 });
  await composer.click();
  return composer;
}

/** 行首图标画出来的几何形状（各图元的标签与 `d`），不含颜色。 */
function iconShape(row: Locator): Promise<string[]> {
  return row
    .locator("svg")
    .first()
    .evaluate((svg) =>
      Array.from(
        svg.querySelectorAll("*"),
        (node) => `${node.tagName}:${node.getAttribute("d") ?? ""}`,
      ),
    );
}

function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("@ list agent group", () => {
  test("sits above the files, narrows with them, and a picked agent sends as a provider link", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `agent-mentions-${testInfo.workerIndex}-`,
      title: "Agent mentions",
      repo: { files: REPO_FILES },
    });
    try {
      const composer = await openAgentComposer(page, agent);

      await page.keyboard.type("ask @");
      await expect(agentRow(page, "Mock Load Test")).toBeVisible({ timeout: 30_000 });
      await expect(popover(page).getByTestId("autocomplete-group-notice")).toHaveCount(0);
      await expect.poll(() => readList(page)).toContain("README.md");
      const unfiltered = await readList(page);
      expect(unfiltered[0]).toBe("Agents");
      expect(unfiltered.indexOf("Files")).toBeGreaterThan(unfiltered.indexOf("Mock Load Test"));

      // 同一个查询同时收窄两组，智能体组仍在上面。
      await page.keyboard.type("mock");
      await expect
        .poll(() => readList(page))
        .toEqual(
          expect.arrayContaining(["Agents", "Mock Load Test", "Files", "src/mock-server.ts"]),
        );
      const filtered = await readList(page);
      expect(filtered).not.toContain("README.md");
      expect(filtered).not.toContain("src/widget.ts");
      expect(filtered[0]).toBe("Agents");
      expect(filtered.indexOf("Files")).toBeGreaterThan(filtered.indexOf("Mock Load Test"));

      await agentRow(page, "Mock Load Test").click();
      await expectInlineBlocks(composer, [{ variant: "agent", label: "Agent: Mock Load Test" }]);
      await page.keyboard.type("to check the build");
      await page.keyboard.press("Enter");
      await expectAgentIdle(page);

      const sent = "ask [@Mock Load Test](paseo://agent/provider/mock) to check the build";
      const bubble = page.getByTestId("user-message").filter({ hasText: "check the build" }).last();
      await expectInlineBlocks(bubble, [{ variant: "agent", label: "Agent: Mock Load Test" }]);
      await bubble.getByTestId("user-message-bubble").hover();
      await bubble.getByRole("button", { name: "Copy message" }).click();
      await expect.poll(() => readClipboardText(page)).toBe(sent);
    } finally {
      await agent.cleanup();
    }
  });
});

test.describe("@ list agent profiles", () => {
  test("lists enabled providers' profiles after the providers, with their glyph, and sends a profile link", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const profiles = await seedAgentProfiles([
      {
        id: "e2e-reviewer",
        name: "Careful reviewer",
        provider: "mock",
        icon: "eye",
        color: "emerald",
      },
      // 没写图标：画所属 provider 的图标。
      { id: "e2e-plain", name: "Plain helper", provider: "mock" },
      // provider 没注册：不列出。
      { id: "e2e-orphan", name: "Orphan helper", provider: "not-installed" },
    ]);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `agent-mentions-profile-${testInfo.workerIndex}-`,
      title: "Agent profile mentions",
      repo: { files: REPO_FILES },
    });
    try {
      const composer = await openAgentComposer(page, agent);

      await page.keyboard.type("ask @");
      const reviewer = agentRow(page, "Careful reviewer");
      await expect(reviewer).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => readList(page)).toContain("README.md");
      const list = await readList(page);
      expect(list).not.toContain("Orphan helper");
      expect(list.indexOf("Careful reviewer")).toBeGreaterThan(list.indexOf("Mock Load Test"));
      expect(list.indexOf("Files")).toBeGreaterThan(list.indexOf("Careful reviewer"));
      // 副文字写所属 provider，图标与颜色取自 profile。
      await expect(reviewer).toContainText("Mock Load Test");
      const glyph = reviewer.getByTestId("agent-profile-glyph");
      await expect(glyph).toHaveAttribute("data-icon", "eye");
      await expect(glyph).toHaveAttribute("data-color", "emerald");
      const providerShape = await iconShape(agentRow(page, "Mock Load Test").first());
      expect(providerShape.length).toBeGreaterThan(0);
      expect(await iconShape(reviewer)).not.toEqual(providerShape);
      expect(await iconShape(agentRow(page, "Plain helper"))).toEqual(providerShape);

      // 过滤匹配 profile 名，provider 行随之消失。
      await page.keyboard.type("careful");
      await expect.poll(() => readList(page)).not.toContain("Mock Load Test");
      await expect(reviewer).toBeVisible();

      await reviewer.click();
      await expectInlineBlocks(composer, [{ variant: "agent", label: "Agent: Careful reviewer" }]);
      await page.keyboard.type("to review the diff");
      await page.keyboard.press("Enter");
      await expectAgentIdle(page);

      const sent = "ask [@Careful reviewer](paseo://agent/profile/e2e-reviewer) to review the diff";
      const bubble = page.getByTestId("user-message").filter({ hasText: "review the diff" }).last();
      await expectInlineBlocks(bubble, [{ variant: "agent", label: "Agent: Careful reviewer" }]);
      await bubble.getByTestId("user-message-bubble").hover();
      await bubble.getByRole("button", { name: "Copy message" }).click();
      await expect.poll(() => readClipboardText(page)).toBe(sent);
    } finally {
      await agent.cleanup();
      await profiles.restore();
    }
  });
});

test.describe("@ list agent group when the agent cannot dispatch", () => {
  test("grays the group out, says Osuna tools are off, and opens the Agents settings", async ({
    page,
  }, testInfo) => {
    const agent = await withOsunaToolsOff(() =>
      seedMockAgentWorkspace({
        repoPrefix: `agent-mentions-off-${testInfo.workerIndex}-`,
        title: "Agent mentions off",
        repo: { files: REPO_FILES },
      }),
    );
    try {
      await openAgentComposer(page, agent);

      await page.keyboard.type("@");
      const notice = popover(page).getByTestId("autocomplete-group-notice");
      await expect(notice).toContainText("Osuna tools are off for this agent", { timeout: 30_000 });
      await expect(notice).toContainText("Turn them on in Settings → Host → Agents");
      await expect(agentRow(page, "Mock Load Test")).toHaveAttribute("aria-disabled", "true");
      // 高亮跳过置灰的智能体，落在第一个文件上。
      await expect.poll(() => readList(page)).toContain("README.md");
      await expect(popover(page).getByRole("option", { selected: true })).not.toContainText(
        "Mock Load Test",
      );

      await popover(page).getByTestId("autocomplete-group-notice-action").click();
      await expect(page).toHaveURL(
        new RegExp(`/settings/hosts/${encodeURIComponent(getServerId())}/agents$`),
        { timeout: 30_000 },
      );
    } finally {
      await agent.cleanup();
    }
  });

  test("grays the group out and asks for a host update on a host without agent mentions", async ({
    page,
  }, testInfo) => {
    await installHostWithoutAgentMentions(page);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: `agent-mentions-old-${testInfo.workerIndex}-`,
      title: "Agent mentions old host",
      repo: { files: REPO_FILES },
    });
    try {
      await openAgentComposer(page, agent);

      await page.keyboard.type("@");
      const notice = popover(page).getByTestId("autocomplete-group-notice");
      await expect(notice).toHaveText("Update the host to mention agents", { timeout: 30_000 });
      await expect(agentRow(page, "Mock Load Test")).toHaveAttribute("aria-disabled", "true");
      await expect(popover(page).getByTestId("autocomplete-group-notice-action")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
