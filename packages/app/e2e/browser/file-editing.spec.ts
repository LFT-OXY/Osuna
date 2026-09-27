import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import {
  openFileExplorer,
  openFileFromExplorer,
  expectFileTabOpen,
} from "../support/helpers/file-explorer";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectDiagramWithLabels } from "../support/helpers/diagram";

const APP_SETTINGS_KEY = "@paseo:app-settings";

const RED_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);
const BLUE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const BLOCKED_PREVIEW_URL = "https://html-preview.invalid/leak";
const README_BADGE_ORIGIN = "https://badges.readme.test";
const README_LINK_ORIGIN = "https://docs.readme.test";
const README_BASH_CODE = [
  "# Install deps",
  `npm install --save "osuna" ${"--long-flag ".repeat(40)}`,
].join("\n");
const README_FIXTURE = [
  "---",
  "title: Fixture title",
  "---",
  '<p align="center">',
  `  <a href="${README_LINK_ORIGIN}/docs"><img src="${README_BADGE_ORIGIN}/docs.png" alt="Docs badge" width="60" height="20"></a>`,
  `  <a href="${README_LINK_ORIGIN}/ci"><img src="${README_BADGE_ORIGIN}/ci.png" alt="CI badge" width="60" height="20"></a>`,
  `  <img src="${README_BADGE_ORIGIN}/license.png" alt="License badge" width="60" height="20">`,
  "</p>",
  "",
  '<h1 align="center">Readme fixture</h1>',
  "",
  "[Jump to setup](#setup-guide)",
  "",
  "See the [Contributing guide](docs/CONTRIBUTING.md) and the [Target line](src/target.ts#L42).",
  "",
  "![Markdown screenshot](docs/shots/pixel.png)",
  "",
  '<img src="./docs/shots/pixel.png" alt="Html screenshot" width="20" height="20">',
  "",
  "![Missing screenshot](docs/shots/missing.png)",
  "",
  "<script>window.readmeScriptRan = true;</script>",
  "",
  `<img src="${README_BADGE_ORIGIN}/missing.png" alt="Handler image" width="10" height="10" onerror="window.readmeHandlerRan = true">`,
  "",
  '<iframe srcdoc="<script>parent.readmeFrameRan = true;</script>"></iframe>',
  "",
  "<style>body { display: none; }</style>",
  "",
  '<p><span style="color: red">Styled text</span></p>',
  "",
  "[Unsafe link](javascript:window.readmeLinkRan=true)",
  "",
  '<a href="javascript:window.readmeLinkRan=true">Unsafe html link</a>',
  "",
  "> [!NOTE]",
  "> Alert body text",
  "",
  "| Name | Status |",
  "| --- | :---: |",
  "| Table cell | ~~Removed~~ |",
  "",
  "- [x] Done task",
  "- [ ] Open task",
  "",
  "```bash",
  README_BASH_CODE,
  "```",
  "",
  "```ts",
  "const answer: number = 42;",
  "```",
  "",
  "```json",
  '{ "answer": 42 }',
  "```",
  "",
  "```",
  "plain fence text",
  "```",
  "",
  "```mermaid",
  "graph TD",
  "  Alpha --> Beta",
  "```",
  "",
  "## Setup guide",
  "",
  "Setup body text",
  "",
].join("\n");
const README_LINKED_TARGET = Array.from(
  { length: 80 },
  (_, index) => `export const line${index + 1} = ${index + 1};`,
).join("\n");

interface LinkedFile {
  target: string;
  fileName: string;
  content: string;
}

// Chromium 把 align="center" 计算为 -webkit-center（连同块级子元素一起居中）。
const CENTERED = /^(-webkit-)?center$/;
const README_UNSAFE_FLAGS = [
  "readmeScriptRan",
  "readmeHandlerRan",
  "readmeLinkRan",
  "readmeFrameRan",
];

function readSetWindowFlags(page: Page, names: readonly string[]): Promise<string[]> {
  return page.evaluate((flagNames) => {
    const flags = window as unknown as Record<string, unknown>;
    return flagNames.filter((flag) => flags[flag] !== undefined);
  }, names);
}

function editor(page: Page) {
  return page.getByTestId("file-source-editor").filter({ visible: true }).locator(".cm-content");
}

function hasHorizontalOverflow(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}

function readBorderLeftColors(elements: Element[]): string[] {
  return elements.map((element) => getComputedStyle(element).borderLeftColor);
}

function readNaturalWidth(image: HTMLImageElement): number {
  return image.naturalWidth;
}

function readInnerHtml(elements: Element[]): string[] {
  return elements.map((element) => element.innerHTML);
}

function readPlainClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

function breakClipboardWrites(): void {
  navigator.clipboard.writeText = () => Promise.reject(new Error("Clipboard blocked"));
  document.execCommand = () => {
    throw new Error("Clipboard blocked");
  };
}

function fitsViewportWidth(element: HTMLElement): boolean {
  return element.scrollWidth === element.clientWidth;
}

async function replaceEditorText(page: Page, content: string): Promise<void> {
  await editor(page).fill(content);
}

async function openWorkspaceFile(page: Page, filename: string): Promise<void> {
  const tree = page.getByTestId("file-explorer-tree-scroll");
  if (!(await tree.isVisible())) await openFileExplorer(page);
  await openFileFromExplorer(page, filename);
  await expectFileTabOpen(page, filename);
}

function htmlPreview(page: Page) {
  return {
    host: page.getByTestId("file-html-preview"),
    document: page.frameLocator('[data-testid="file-html-preview"]'),
  };
}

async function selectFileView(page: Page, view: "Preview" | "Source"): Promise<void> {
  const option = page.getByTestId("file-panel-bar").getByRole("button", {
    name: view,
    exact: true,
  });
  await option.click();
  await expect(option).toHaveAttribute("aria-selected", "true");
}

function watchRequestsTo(page: Page, origin: string): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(origin)) requests.push(request.url());
  });
  return requests;
}

async function seedAgentWithFileLink(input: LinkedFile) {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "file-editing-chat-link-",
    title: "Chat file link e2e",
    initialPrompt: [
      "Generate a title and a git branch name for a coding agent from the user prompt and attachments.",
      "Return JSON only with fields 'title' and 'branch'.",
      "",
      "<user-prompt>",
      `Open \`${input.target}\` now`,
      "</user-prompt>",
    ].join("\n"),
  });
  await writeFile(path.join(session.cwd, input.fileName), input.content, "utf8");
  return session;
}

test.describe("CodeMirror workspace file editing", () => {
  test("renders a lockfile-sized read-only source with a bounded CodeMirror DOM", async ({
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "file-source-lockfile-",
      title: "Large source",
      initialPrompt: "Generate a title and a git branch name. Return JSON only.",
    });
    const lockfile = `${'{"packages":['}${Array.from({ length: 42_000 }, (_, index) => `{"name":"package-${index}","version":"1.0.0"}`).join(",")}]}`;
    await writeFile(path.join(session.cwd, "package-lock.json"), lockfile, "utf8");

    try {
      await openAgentRoute(page, session);
      await openWorkspaceFile(page, "package-lock.json");

      await expect(page.getByTestId("file-source-editor")).toBeVisible();
      await expect(editor(page)).toContainText('"package-0"');
      await expect.poll(() => page.locator(".cm-line").count()).toBeLessThan(200);
    } finally {
      await session.cleanup();
    }
  });

  test("keeps the app interactive around a plain 11 MB source", async ({ page }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "file-source-plain-",
      title: "Plain large source",
      initialPrompt: "Generate a title and a git branch name. Return JSON only.",
    });
    await writeFile(
      path.join(session.cwd, "plain.txt"),
      "plain source\n".repeat(1_050_000),
      "utf8",
    );

    try {
      await openAgentRoute(page, session);
      await openWorkspaceFile(page, "plain.txt");
      await expect(page.getByTestId("file-source-editor")).toBeVisible();
      await expect(editor(page)).toContainText("plain source");
      await expect.poll(() => page.locator(".cm-line").count()).toBeLessThan(200);

      await page.getByTestId(`workspace-tab-agent_${session.agentId}`).first().click();
      await expect(page.getByTestId("message-input-root")).toBeVisible();
      await page.getByTestId("workspace-tab-file_plain.txt").first().click();
      await expect(page.getByTestId("file-source-editor")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("refuses a file above the display budget and keeps its tab recoverable", async ({
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "file-source-unsupported-",
      title: "Unsupported large source",
      initialPrompt: "Generate a title and a git branch name. Return JSON only.",
    });
    await writeFile(
      path.join(session.cwd, "too-large.txt"),
      Buffer.alloc(51 * 1024 * 1024),
      "utf8",
    );

    try {
      await openAgentRoute(page, session);
      await openWorkspaceFile(page, "too-large.txt");
      await expect(page.getByTestId("file-source-too-large")).toContainText(
        "This file is too large to display",
      );

      await page.getByTestId(`workspace-tab-agent_${session.agentId}`).first().click();
      await expect(page.getByTestId("message-input-root")).toBeVisible();
      await page.getByTestId("workspace-tab-file_too-large.txt").first().click();
      await expect(page.getByTestId("file-source-too-large")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("opens an assistant file link at its referenced line", async ({ page }) => {
    const target = "target.ts:42";
    const session = await seedAgentWithFileLink({
      target,
      fileName: "target.ts",
      content: Array.from(
        { length: 80 },
        (_, index) => `export const line${index + 1} = ${index + 1};`,
      ).join("\n"),
    });

    try {
      await openAgentRoute(page, session);

      const fileLink = page.getByText(target, { exact: true });
      await expect(fileLink).toBeVisible({ timeout: 15_000 });
      await fileLink.click();

      await expectFileTabOpen(page, "target.ts");
      await expect(page.getByTestId("file-source-editor")).toBeVisible();
      await expect(page.getByLabel("Line 42, column 1")).toBeVisible();
      await expect(
        page.getByTestId("file-source-editor").locator(".cm-line", { hasText: "line42 = 42" }),
      ).toBeVisible();

      const sourceEditor = editor(page);
      await sourceEditor.click();
      await sourceEditor.press("ControlOrMeta+Home");
      await expect(page.getByLabel(/^Line 1, column \d+$/)).toBeVisible();

      await page
        .getByTestId(`workspace-tab-agent_${session.agentId}`)
        .filter({ visible: true })
        .click();
      await expect(fileLink).toBeVisible();
      await fileLink.click();

      await expect(page.getByLabel("Line 42, column 1")).toBeVisible();
      await expect(
        page.getByTestId("file-source-editor").locator(".cm-line", { hasText: "line42 = 42" }),
      ).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("clicking the editor focuses its pane beside an agent", async ({ page }) => {
    await page.addInitScript((settingsKey) => {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({ openInSidePane: { explorerFiles: true } }),
      );
    }, APP_SETTINGS_KEY);
    const target = "target.ts:42";
    const session = await seedAgentWithFileLink({
      target,
      fileName: "target.ts",
      content: Array.from(
        { length: 80 },
        (_, index) => `export const line${index + 1} = ${index + 1};`,
      ).join("\n"),
    });

    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openAgentRoute(page, session);

      await openWorkspaceFile(page, "target.ts");
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);

      await page
        .getByTestId(`workspace-tab-agent_${session.agentId}`)
        .filter({ visible: true })
        .click();
      await editor(page).click();
      await page.keyboard.press("Alt+Shift+W");

      await expect(page.getByTestId("workspace-tab-file_target.ts")).not.toBeVisible();
      await expect(
        page.getByTestId(`workspace-tab-agent_${session.agentId}`).filter({ visible: true }),
      ).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("opens an HTML line target as source", async ({ page }) => {
    const target = "plan.html:2";
    const session = await seedAgentWithFileLink({
      target,
      fileName: "plan.html",
      content: [
        "<!doctype html>",
        "<h1>Review this source line</h1>",
        '<script>document.body.textContent = "This HTML executed";</script>',
      ].join("\n"),
    });

    try {
      await openAgentRoute(page, session);
      await page.getByText(target, { exact: true }).click();

      await expectFileTabOpen(page, "plan.html");
      await expect(page.getByTestId("file-source-editor")).toBeVisible();
      await expect(page.getByLabel("Line 2, column 1")).toBeVisible();
      await expect(page.getByTestId("file-html-preview")).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });

  test("shows the full file path and keeps editor controls stable", async ({
    page,
    withWorkspace,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const workspace = await withWorkspace({ prefix: "file-editing-visuals-" });
    const relativePath = "src/deep/visuals.md";
    const sourcePath = path.join(workspace.repoPath, relativePath);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      sourcePath,
      [...Array.from({ length: 11 }, (_, index) => `line ${index + 1}`), "abcdefghijklmnop"].join(
        "\n",
      ),
      "utf8",
    );
    await workspace.navigateTo();
    await openFileExplorer(page);
    await page.getByTestId("file-explorer-tree-scroll").getByText("src", { exact: true }).click();
    await page.getByTestId("file-explorer-tree-scroll").getByText("deep", { exact: true }).click();
    await openFileFromExplorer(page, "visuals.md");
    await expectFileTabOpen(page, relativePath);

    const fileTab = page.getByTestId(`workspace-tab-file_${relativePath}`).first();
    await fileTab.hover();
    await expect(page.getByTestId(`workspace-tab-tooltip-file_${relativePath}`)).toHaveText(
      relativePath,
    );
    await expect(page.getByTestId("file-panel-bar")).not.toContainText("visuals.md");
    const modeControl = page.getByTestId("file-preview-mode");
    await expect(modeControl).toBeVisible();
    await selectFileView(page, "Source");

    const editorHost = page.getByTestId("file-source-editor");
    const content = editor(page);
    await expect(editorHost).toHaveAttribute("data-pmono", "");
    await expect(content).toHaveCSS("font-family", /SFMono-Regular/);

    await content.click();
    const cursor = editorHost.locator(".cm-cursor-primary");
    await expect(cursor).toBeVisible();
    await expect(cursor).toHaveCSS("border-left-color", "rgb(245, 245, 245)");

    const initialModeBox = await modeControl.boundingBox();
    expect(initialModeBox).not.toBeNull();
    const initialModeX = initialModeBox!.x;
    await content.press("ControlOrMeta+End");
    await expect(page.getByLabel(/Line 12, column \d+/)).toBeVisible();
    const movedModeBox = await modeControl.boundingBox();
    expect(movedModeBox).not.toBeNull();
    expect(movedModeBox!.x).toBe(initialModeX);

    await content.press("ControlOrMeta+a");
    const selection = editorHost.locator(".cm-selectionBackground").first();
    await expect(selection).toBeVisible();
    await expect(selection).toHaveCSS("background-color", "rgba(255, 255, 255, 0.2)");
  });

  test("applies the interface font to portaled tooltips", async ({ page, withWorkspace }) => {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ uiFontFamily: "monospace" }));
    });
    const workspace = await withWorkspace({ prefix: "file-tooltip-font-" });
    const relativePath = "tooltip-font.txt";
    await writeFile(path.join(workspace.repoPath, relativePath), "tooltip font\n", "utf8");
    await workspace.navigateTo();
    await openFileExplorer(page);
    await openFileFromExplorer(page, relativePath);
    await expectFileTabOpen(page, relativePath);

    await page.getByTestId(`workspace-tab-file_${relativePath}`).first().hover();

    await expect(
      page
        .getByTestId(`workspace-tab-tooltip-file_${relativePath}`)
        .getByText(relativePath, { exact: true }),
    ).toHaveCSS("font-family", "monospace");
  });

  test("wraps Markdown while source code remains horizontally scrollable", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-wrap-" });
    const longLine = "word ".repeat(300);
    await writeFile(path.join(workspace.repoPath, "notes.md"), `${longLine}\n`, "utf8");
    await writeFile(
      path.join(workspace.repoPath, "source.ts"),
      `const value = "${longLine}";\n`,
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "notes.md");
    await selectFileView(page, "Source");

    const markdownScroller = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-scroller");
    await expect.poll(() => markdownScroller.evaluate(fitsViewportWidth)).toBe(true);

    await openWorkspaceFile(page, "source.ts");
    const sourceScroller = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-scroller");
    await expect.poll(() => sourceScroller.evaluate(hasHorizontalOverflow)).toBe(true);
  });

  test("autosaves, saves immediately, resolves conflicts, and restores live updates after reconnect", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const workspace = await withWorkspace({ prefix: "file-editing-source-" });
    const sourcePath = path.join(workspace.repoPath, "source.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await Promise.all(
      ["one.ts", "two.ts", "three.ts", "four.ts"].map((fileName) =>
        writeFile(path.join(workspace.repoPath, fileName), `// ${fileName}\n`, "utf8"),
      ),
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "source.ts");

    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(page.getByLabel(/File size/)).toBeVisible();
    await expect(page.getByLabel(/lines/)).toBeVisible();

    await replaceEditorText(page, "const autosaved = 2;\n");
    await expect(page.getByTestId("workspace-tab-modified-file_source.ts")).toBeVisible();
    await expect(page.getByLabel("Editor status dirty")).toBeVisible();
    await expect(page.getByLabel("Editor status clean")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("workspace-tab-modified-file_source.ts")).not.toBeVisible();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const autosaved = 2;\n");

    await replaceEditorText(page, "const immediate = 3;\n");
    await editor(page).press("Control+s");
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const immediate = 3;\n");

    await writeFile(sourcePath, "const external = 4;\nconst line = 2;\n", "utf8");
    await expect(editor(page)).toContainText("const external = 4;");
    await expect(page.getByLabel("3 lines")).toBeVisible();

    await replaceEditorText(page, "const localWins = 5;\n");
    await writeFile(sourcePath, "const diskLoses = 6;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await page.getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const localWins = 5;\n");
    for (const fileName of ["one.ts", "two.ts", "three.ts", "four.ts"]) {
      await openWorkspaceFile(page, fileName);
    }
    await openWorkspaceFile(page, "source.ts");
    await expect(editor(page)).toContainText("const localWins = 5;");

    await replaceEditorText(page, "const discarded = 7;\n");
    await writeFile(sourcePath, "const diskWins = 8;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(editor(page)).toContainText("const diskWins = 8;");

    const subscriptionCount = gate.getClientRequestCount("fs.file.subscribe.request");
    await gate.drop();
    gate.restore();
    await expect
      .poll(() => gate.getClientRequestCount("fs.file.subscribe.request"), { timeout: 30_000 })
      .toBeGreaterThan(subscriptionCount);
    await writeFile(sourcePath, "const afterReconnect = 9;\n", "utf8");
    await expect(editor(page)).toContainText("const afterReconnect = 9;");
  });

  test("preserves a UTF-8 BOM and uses the first line separator after saving", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-encoding-" });
    const sourcePath = path.join(workspace.repoPath, "windows.ts");
    await writeFile(
      sourcePath,
      Buffer.from("\uFEFFconst initial = true;\r\nconst mixed = true;\n", "utf8"),
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "windows.ts");

    await replaceEditorText(page, "const saved = true;\nconst normalized = true;\n");
    await editor(page).press("Control+s");

    const expected = Buffer.from(
      "\uFEFFconst saved = true;\r\nconst normalized = true;\r\n",
      "utf8",
    ).toString("hex");
    await expect.poll(async () => (await readFile(sourcePath)).toString("hex")).toBe(expected);
  });

  test("warns before closing a panel with an unsaved draft", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-draft-" });
    const sourcePath = path.join(workspace.repoPath, "draft.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();
    await openWorkspaceFile(page, "draft.ts");

    await replaceEditorText(page, "const local = 2;\n");
    await writeFile(sourcePath, "const external = 3;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-modified-file_draft.ts")).toBeVisible();

    let closePrompt = "";
    page.once("dialog", async (dialog) => {
      closePrompt = dialog.message();
      await dialog.dismiss();
    });
    await page
      .getByTestId("workspace-tab-file_draft.ts")
      .filter({ visible: true })
      .first()
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Close", exact: true }).click();
    expect(closePrompt).toContain("Closing it will discard the draft.");

    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-modified-file_draft.ts")).toBeVisible();
  });

  test("refreshes Markdown and images while preserving Preview and Source behavior", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-preview-" });
    const markdownPath = path.join(workspace.repoPath, "notes.md");
    const imagePath = path.join(workspace.repoPath, "pixel.png");
    await writeFile(markdownPath, "# First heading\n", "utf8");
    await writeFile(imagePath, RED_PIXEL);
    await workspace.navigateTo();
    await openWorkspaceFile(page, "notes.md");

    const visibleFilePane = page.getByTestId("workspace-file-pane").filter({ visible: true });
    await expect(visibleFilePane.getByText("First heading", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
    await writeFile(markdownPath, "# Updated heading\n", "utf8");
    await expect(visibleFilePane.getByText("Updated heading", { exact: true })).toBeVisible();

    await selectFileView(page, "Source");
    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await replaceEditorText(page, "# Saved from source\n");
    await expect.poll(() => readFile(markdownPath, "utf8")).toBe("# Saved from source\n");
    await selectFileView(page, "Preview");
    await expect(visibleFilePane.getByText("Saved from source", { exact: true })).toBeVisible();

    await openWorkspaceFile(page, "pixel.png");
    const image = visibleFilePane.locator("img");
    await expect(image).toBeVisible();
    const imageCanvas = page.getByTestId("image-file-preview-canvas");
    await expect(imageCanvas).toBeVisible();
    await imageCanvas.hover();
    const transformedContent = imageCanvas.locator(":scope > div").first();
    const fittedImageBox = await transformedContent.boundingBox();
    expect(fittedImageBox).not.toBeNull();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect
      .poll(async () => (await transformedContent.boundingBox())?.width ?? 0)
      .toBeGreaterThan(fittedImageBox!.width * 1.2);
    const initialSource = await image.getAttribute("src");
    await writeFile(imagePath, BLUE_PIXEL);
    await expect.poll(() => image.getAttribute("src")).not.toBe(initialSource);
  });

  test("renders a README-style Markdown file as sanitized HTML with GFM", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .context()
      .route(`${README_BADGE_ORIGIN}/**`, (route) =>
        route.request().url().endsWith("/missing.png")
          ? route.fulfill({ status: 404 })
          : route.fulfill({ contentType: "image/png", body: RED_PIXEL }),
      );
    await page
      .context()
      .route(`${README_LINK_ORIGIN}/**`, (route) =>
        route.fulfill({ contentType: "text/html", body: "<title>Docs</title>" }),
      );
    const workspace = await withWorkspace({ prefix: "file-editing-readme-preview-" });
    const screenshotPath = path.join(workspace.repoPath, "docs", "shots", "pixel.png");
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, RED_PIXEL);
    await writeFile(path.join(workspace.repoPath, "README.md"), README_FIXTURE, "utf8");
    await writeFile(
      path.join(workspace.repoPath, "docs", "CONTRIBUTING.md"),
      "# Contributing\n",
      "utf8",
    );
    await mkdir(path.join(workspace.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(workspace.repoPath, "src", "target.ts"),
      README_LINKED_TARGET,
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "README.md");

    const preview = page.getByTestId("file-markdown-preview").filter({ visible: true });
    await expect(preview.getByRole("heading", { level: 1, name: "Readme fixture" })).toBeVisible();
    for (const rawMarkup of ["<p", "<img", "<h1", "align=", "<script", "onerror"]) {
      await expect(preview).not.toContainText(rawMarkup);
    }

    await expect(preview.getByRole("heading", { level: 1, name: "Readme fixture" })).toHaveCSS(
      "text-align",
      CENTERED,
    );
    const badges = ["Docs badge", "CI badge", "License badge"].map((name) =>
      preview.getByRole("img", { name, exact: true }),
    );
    await expect(badges[0].locator("xpath=ancestor::p[1]")).toHaveCSS("text-align", CENTERED);
    const badgeTops = await Promise.all(
      badges.map(async (badge) => {
        await expect(badge).toBeVisible();
        return (await badge.boundingBox())?.y;
      }),
    );
    expect(new Set(badgeTops).size).toBe(1);
    const docsLink = preview.getByRole("link", { name: "Docs badge", exact: true });
    await expect(docsLink).toHaveAttribute("href", `${README_LINK_ORIGIN}/docs`);
    const popupPromise = page.waitForEvent("popup");
    await docsLink.click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toBe(`${README_LINK_ORIGIN}/docs`);
    await popup.close();

    // markdown 语法与 <img> 两种写法的相对路径图片都经工作区读取链路显示。
    const screenshots = ["Markdown screenshot", "Html screenshot"].map((name) =>
      preview.locator(`img[alt="${name}"]`),
    );
    for (const screenshot of screenshots) {
      await expect.poll(() => screenshot.evaluate(readNaturalWidth)).toBeGreaterThan(0);
    }
    const initialScreenshotSource = await screenshots[0].getAttribute("src");
    await writeFile(screenshotPath, BLUE_PIXEL);
    await expect.poll(() => screenshots[0].getAttribute("src")).not.toBe(initialScreenshotSource);
    await expect.poll(() => screenshots[0].evaluate(readNaturalWidth)).toBeGreaterThan(0);
    const missingScreenshot = preview.getByTestId("markdown-image-missing").filter({
      hasText: "Missing screenshot",
    });
    await expect(missingScreenshot).toBeVisible();
    await expect(missingScreenshot).toHaveAttribute("role", "img");

    await expect(preview.getByTestId("markdown-front-matter")).toContainText("Fixture title");
    const alert = preview.getByRole("note");
    await expect(alert).toHaveCount(1);
    await expect(alert.locator("p").first()).toHaveText("Note");
    await expect(alert).toContainText("Alert body text");
    await expect(preview).not.toContainText("[!NOTE]");
    const table = preview.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Name", "Status"]);
    await expect(table.getByRole("cell")).toHaveText(["Table cell", "Removed"]);
    await expect(table.locator("del")).toHaveText("Removed");
    const tasks = preview.getByRole("checkbox");
    await expect(tasks).toHaveCount(2);
    await expect(tasks.first()).toBeChecked();
    await expect(tasks.last()).not.toBeChecked();
    await expectDiagramWithLabels(page, ["Alpha", "Beta"]);

    const codeBlocks = preview.getByTestId("markdown-code-block");
    await expect(codeBlocks).toHaveCount(4);
    const languageLabels = preview.getByTestId("markdown-code-block-language");
    await expect(languageLabels).toHaveText(["bash", "ts", "json"]);
    // 每种语言取到各自的 Material 图标，而不是同一个通用文件图标。
    const languageIcons = await languageLabels.locator("svg").evaluateAll(readInnerHtml);
    expect(new Set(languageIcons).size).toBe(3);
    const bashBlock = codeBlocks.first();
    const bashCode = bashBlock.locator("pre");
    await expect(bashCode).toHaveText(README_BASH_CODE);
    const comment = bashBlock.locator('[data-syntax="comment"]');
    await expect(comment).toHaveText("# Install deps");
    const plainColor = await bashCode.evaluate((element) => getComputedStyle(element).color);
    await expect(comment).not.toHaveCSS("color", plainColor);
    await expect(bashBlock.locator('[data-syntax="string"]').first()).toHaveText('"osuna"');

    const wrapToggle = bashBlock.getByRole("button", { name: "Wrap lines", exact: true });
    await expect(wrapToggle).toHaveAttribute("aria-pressed", "false");
    expect(await bashCode.evaluate(hasHorizontalOverflow)).toBe(true);
    await wrapToggle.click();
    await expect(wrapToggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => bashCode.evaluate(hasHorizontalOverflow)).toBe(false);
    await wrapToggle.click();
    await expect.poll(() => bashCode.evaluate(hasHorizontalOverflow)).toBe(true);

    await bashBlock.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect(bashBlock.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect.poll(() => readPlainClipboard(page)).toBe(README_BASH_CODE);

    // 剪贴板 API 与 execCommand 兜底都失败时，给出失败提示而不是假装已复制。
    await page.evaluate(breakClipboardWrites);
    const tsBlock = codeBlocks.nth(1);
    await tsBlock.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect(page.getByTestId("app-toast-message")).toHaveText("Copy failed");
    await expect(tsBlock.getByRole("button", { name: "Copy code", exact: true })).toBeVisible();

    const plainBlock = codeBlocks.last();
    await expect(plainBlock.locator("pre")).toHaveText("plain fence text");
    await expect(plainBlock.locator("[data-syntax]")).toHaveCount(0);
    await expect(plainBlock.getByTestId("markdown-code-block-language")).toHaveCount(0);
    await expect(plainBlock.locator("pre")).toHaveCSS("font-family", /monospace/);

    await expect(preview.locator("script, style")).toHaveCount(0);
    // mermaid 自带渲染 iframe，只断言 fixture 里的那个被剥掉。
    await expect(preview.locator('iframe[srcdoc*="readmeFrameRan"]')).toHaveCount(0);
    const handlerImage = preview.getByRole("img", { name: "Handler image", exact: true });
    await expect(handlerImage).toBeAttached();
    await expect(handlerImage).not.toHaveAttribute("onerror");
    await expect(preview.getByText("Styled text", { exact: true })).not.toHaveAttribute("style");
    const pageUrl = page.url();
    for (const name of ["Unsafe link", "Unsafe html link"]) {
      const unsafeLink = preview.getByText(name, { exact: true });
      await expect(unsafeLink).not.toHaveAttribute("href", /javascript:/i);
      await unsafeLink.click();
    }
    expect(page.url()).toBe(pageUrl);
    expect(await readSetWindowFlags(page, README_UNSAFE_FLAGS)).toEqual([]);

    // 页内锚点在预览滚动容器内滚到对应标题，不改动应用路由。
    const setupHeading = preview.getByRole("heading", { level: 2, name: "Setup guide" });
    await expect(setupHeading).not.toBeInViewport();
    await preview.getByRole("link", { name: "Jump to setup", exact: true }).click();
    await expect(setupHeading).toBeInViewport();
    expect(page.url()).toBe(pageUrl);

    // 仓库内文件链接是带文件图标的 chip，点击在新文件标签打开，带行号时定位到该行。
    const fileLinks = preview.getByTestId("markdown-file-link");
    await expect(fileLinks).toHaveCount(2);
    const contributingLink = fileLinks.filter({ hasText: "Contributing guide" });
    await expect(contributingLink.locator("svg")).toHaveCount(1);
    await contributingLink.click();
    await expectFileTabOpen(page, "docs/CONTRIBUTING.md");
    await expect(
      page
        .getByTestId("file-markdown-preview")
        .filter({ visible: true })
        .getByRole("heading", { level: 1, name: "Contributing" }),
    ).toBeVisible();

    await page.getByTestId("workspace-tab-file_README.md").filter({ visible: true }).click();
    await fileLinks.filter({ hasText: "Target line" }).click();
    await expectFileTabOpen(page, "src/target.ts");
    await expect(page.getByLabel("Line 42, column 1")).toBeVisible();
    await expect(
      page.getByTestId("file-source-editor").locator(".cm-line", { hasText: "line42 = 42" }),
    ).toBeVisible();
  });

  test("repaints Markdown prose, quotes, tables, and code when the color scheme changes", async ({
    page,
    withWorkspace,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    // 选一个非默认、且与主题基础色（GitHub 配色）不同的语法主题，证明代码块颜色跟随设置。
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ theme: "auto", syntaxTheme: "catppuccin" }));
    }, APP_SETTINGS_KEY);
    const workspace = await withWorkspace({ prefix: "file-editing-markdown-theme-" });
    await writeFile(
      path.join(workspace.repoPath, "notes.md"),
      "Body text\n\n> Quoted text\n\n| Key | Value |\n| --- | --- |\n| Cell | Data |\n\n```bash\n# Code comment\n```\n",
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "notes.md");

    const preview = page.getByTestId("file-markdown-preview").filter({ visible: true });
    const probes = {
      body: preview.getByText("Body text", { exact: true }),
      quote: preview.getByText("Quoted text", { exact: true }),
      cell: preview.getByRole("cell", { name: "Cell", exact: true }),
      comment: preview.locator('[data-syntax="comment"]'),
    };
    // 默认 Light / Dark 主题的 foregroundProse、foregroundMuted、border，以及 Catppuccin Latte / Mocha 的注释色。
    const expectColors = async (colors: {
      body: string;
      quote: string;
      cellBorder: string;
      comment: string;
    }) => {
      await expect(probes.body).toHaveCSS("color", colors.body);
      await expect(probes.quote).toHaveCSS("color", colors.quote);
      await expect(probes.cell).toHaveCSS("border-bottom-color", colors.cellBorder);
      await expect(probes.comment).toHaveCSS("color", colors.comment);
    };
    await expectColors({
      body: "rgba(39, 39, 42, 0.86)",
      quote: "rgb(113, 113, 123)",
      cellBorder: "rgb(228, 228, 231)",
      comment: "rgb(140, 143, 161)",
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await expectColors({
      body: "rgba(245, 245, 245, 0.86)",
      quote: "rgb(129, 129, 129)",
      cellBorder: "rgb(25, 25, 25)",
      comment: "rgb(147, 153, 178)",
    });
  });

  test("renders the five GitHub alerts with localized titles and distinct colors", async ({
    page,
    withWorkspace,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ theme: "auto", language: "zh-CN" }));
    }, APP_SETTINGS_KEY);
    const workspace = await withWorkspace({ prefix: "file-editing-markdown-alerts-" });
    await writeFile(
      path.join(workspace.repoPath, "alerts.md"),
      ["NOTE", "tip", "Important", "WARNING", "caution"]
        .map((kind) => `> [!${kind}]\n> ${kind} body`)
        .concat("> [!NOTE] inline aside")
        .join("\n\n"),
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "alerts.md");

    const preview = page.getByTestId("file-markdown-preview").filter({ visible: true });
    const alerts = preview.getByRole("note");
    await expect(alerts).toHaveCount(5);
    await expect(alerts.locator("p:first-child")).toHaveText([
      "注意",
      "提示",
      "重要",
      "警告",
      "小心",
    ]);
    await expect(alerts.locator("svg")).toHaveCount(5);
    // 标记后面跟着文字时不是提示块，按普通引用保留原文；其余标记都不外露。
    await expect(preview.locator("blockquote")).toHaveText("[!NOTE] inline aside");
    expect((await preview.textContent())?.match(/\[!/g)).toHaveLength(1);

    // 默认 Light / Dark 主题下 note 的蓝色档与 statusSuccess、statusMerged、statusWarning、statusDanger。
    const readAlertColors = () => alerts.evaluateAll(readBorderLeftColors);
    await expect
      .poll(readAlertColors)
      .toEqual([
        "rgb(37, 99, 235)",
        "rgb(62, 112, 74)",
        "rgb(115, 71, 175)",
        "rgb(123, 93, 57)",
        "rgb(157, 67, 59)",
      ]);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(readAlertColors)
      .toEqual([
        "rgb(96, 165, 250)",
        "rgb(108, 177, 123)",
        "rgb(168, 144, 213)",
        "rgb(192, 150, 100)",
        "rgb(216, 132, 123)",
      ]);
  });

  test("previews and refreshes an HTML plan while preserving source access", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-html-preview-" });
    const htmlPath = path.join(workspace.repoPath, "plan.html");
    await writeFile(
      htmlPath,
      "<!doctype html><html><body><h1>Visual plan</h1></body></html>",
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "plan.html");

    const preview = htmlPreview(page);
    await expect(preview.host).toBeVisible();
    await expect(preview.host).toHaveAttribute("sandbox", /allow-scripts/);
    await expect(preview.host).not.toHaveAttribute("sandbox", /allow-same-origin/);
    await expect(preview.document.getByRole("heading", { name: "Visual plan" })).toBeVisible();

    await writeFile(
      htmlPath,
      "<!doctype html><html><body><h1>Updated plan</h1></body></html>",
      "utf8",
    );
    await expect(preview.document.getByRole("heading", { name: "Updated plan" })).toBeVisible();

    await selectFileView(page, "Source");
    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(preview.host).toHaveCount(0);
    await selectFileView(page, "Preview");
    await expect(preview.host).toBeVisible();
  });

  test("runs inline scripts without allowing fetch egress", async ({ page, withWorkspace }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-html-csp-" });
    await writeFile(
      path.join(workspace.repoPath, "probe.html"),
      `<!doctype html><html><head><title>probe</title></head><body>
<h1 id="script-result">Inline script did not run</h1>
<p id="network-result">Network request not attempted</p>
<p id="document-mode">Standards mode not detected</p>
<script>
  document.getElementById("script-result").textContent = "Inline script ran";
  if (document.compatMode === "CSS1Compat") {
    document.getElementById("document-mode").textContent = "Standards mode enabled";
  }
  var networkResult = document.getElementById("network-result");
  fetch("${BLOCKED_PREVIEW_URL}", { method: "POST", body: "repo-content" })
    .then(function () { networkResult.textContent = "Network request allowed"; })
    .catch(function () { networkResult.textContent = "Network request blocked"; });
</script>
</body></html>`,
      "utf8",
    );
    await workspace.navigateTo();

    const blockedRequests = watchRequestsTo(page, BLOCKED_PREVIEW_URL);

    await openWorkspaceFile(page, "probe.html");

    const preview = htmlPreview(page);
    await expect(
      preview.document.getByRole("heading", { name: "Inline script ran" }),
    ).toBeVisible();
    await expect(
      preview.document.getByText("Standards mode enabled", { exact: true }),
    ).toBeVisible();
    await expect(
      preview.document.getByText("Network request blocked", { exact: true }),
    ).toBeVisible();
    expect(blockedRequests).toEqual([]);
  });

  test("isolates HTML plans from the app origin and storage", async ({ page, withWorkspace }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-html-origin-" });
    await writeFile(
      path.join(workspace.repoPath, "origin.html"),
      `<!doctype html><html><body>
<p id="parent">?</p><p id="storage">?</p><p id="cookie">?</p>
<script>
  function report(id, label, probe) {
    try { probe(); document.getElementById(id).textContent = label + " reachable"; }
    catch (error) { document.getElementById(id).textContent = label + " blocked"; }
  }
  report("parent", "Parent DOM", function () { return parent.document.body; });
  report("storage", "Storage", function () { return localStorage.length; });
  report("cookie", "Cookies", function () { return document.cookie; });
</script>
</body></html>`,
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "origin.html");

    const preview = htmlPreview(page);
    await expect(preview.document.getByText("Parent DOM blocked", { exact: true })).toBeVisible();
    await expect(preview.document.getByText("Storage blocked", { exact: true })).toBeVisible();
    await expect(preview.document.getByText("Cookies blocked", { exact: true })).toBeVisible();
  });

  test("persists Vim keybindings and reports Vim mode with cursor position", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-vim-" });
    await writeFile(path.join(workspace.repoPath, "vim.ts"), "const vim = true;\n", "utf8");

    await page.goto("/settings/editor");
    const toggle = page.getByRole("switch", { name: "Vim keybindings" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Vim keybindings" })).toBeChecked();

    await workspace.navigateTo();
    await openWorkspaceFile(page, "vim.ts");
    await expect(page.getByLabel("Vim mode NORMAL")).toBeVisible();
    await expect(page.getByLabel("Line 1, column 1")).toBeVisible();
    await editor(page).click();
    await editor(page).press("i");
    await expect(page.getByLabel("Vim mode INSERT")).toBeVisible();
    await editor(page).press("Escape");
    await expect(page.getByLabel("Vim mode NORMAL")).toBeVisible();
  });
});
