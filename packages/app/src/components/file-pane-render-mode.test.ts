import { describe, expect, it } from "vitest";
import {
  filePreviewRenderKind,
  filePreviewRenderKindForLocation,
  isRenderedMarkdownFile,
} from "@/components/file-pane-render-mode";

describe("isRenderedMarkdownFile", () => {
  it("detects .md files", () => {
    expect(isRenderedMarkdownFile("README.md")).toBe(true);
    expect(isRenderedMarkdownFile("docs/guide.MD")).toBe(true);
  });

  it("detects .markdown files", () => {
    expect(isRenderedMarkdownFile("notes.markdown")).toBe(true);
    expect(isRenderedMarkdownFile("docs/CHANGELOG.MARKDOWN")).toBe(true);
  });

  it("does not treat .mdx files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("page.mdx")).toBe(false);
  });

  it("does not treat other text files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("src/index.ts")).toBe(false);
    expect(isRenderedMarkdownFile("README.md.txt")).toBe(false);
    expect(isRenderedMarkdownFile("plan.html")).toBe(false);
  });
});

describe("filePreviewRenderKind", () => {
  it("maps each renderable extension to its kind", () => {
    expect(filePreviewRenderKind("README.md")).toBe("markdown");
    expect(filePreviewRenderKind("notes.markdown")).toBe("markdown");
    expect(filePreviewRenderKind("plan.html")).toBe("html");
    expect(filePreviewRenderKind("docs/PLAN.HTML")).toBe("html");
    expect(filePreviewRenderKind("plan.htm")).toBe("html");
  });

  it("returns null for files without a rendered preview", () => {
    expect(filePreviewRenderKind("src/index.ts")).toBe(null);
    expect(filePreviewRenderKind("page.mdx")).toBe(null);
    expect(filePreviewRenderKind("index.html.erb")).toBe(null);
  });
});

describe("filePreviewRenderKindForLocation", () => {
  const scrolls = { markdownPreviewScrollsToLine: true };

  it("renders a file opened without a line", () => {
    expect(filePreviewRenderKindForLocation({ location: { path: "spec.md" }, ...scrolls })).toBe(
      "markdown",
    );
  });

  it("shows a plain line target in the source view", () => {
    expect(
      filePreviewRenderKindForLocation({
        location: { path: "spec.md", lineStart: 42 },
        ...scrolls,
      }),
    ).toBeNull();
  });

  it("renders a Markdown line target marked for the preview, such as a node doc", () => {
    expect(
      filePreviewRenderKindForLocation({
        location: { path: "spec.md", lineStart: 42, lineView: "preview" },
        ...scrolls,
      }),
    ).toBe("markdown");
  });

  it("falls back to source where the preview cannot scroll to a line", () => {
    const location = { path: "spec.md", lineStart: 42, lineView: "preview" } as const;
    expect(
      filePreviewRenderKindForLocation({ location, markdownPreviewScrollsToLine: false }),
    ).toBeNull();
    expect(
      filePreviewRenderKindForLocation({
        location: { path: "plan.html", lineStart: 2, lineView: "preview" },
        ...scrolls,
      }),
    ).toBeNull();
  });
});
