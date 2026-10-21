import type { WorkspaceFileLocation } from "@/workspace/file-open";

export type FilePreviewRenderKind = "markdown" | "html";

export function isRenderedMarkdownFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function isRenderedHtmlFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm");
}

export function filePreviewRenderKind(filePath: string): FilePreviewRenderKind | null {
  if (isRenderedMarkdownFile(filePath)) return "markdown";
  if (isRenderedHtmlFile(filePath)) return "html";
  return null;
}

/**
 * 打开一个位置时渲染预览还是源码视图。带行号打开说明要落到那一行，默认退回带高亮的源码视图；
 * 只有标了 lineView: "preview" 的 Markdown（逻辑图的节点文档），在预览能滚到指定行的平台上留在预览。
 */
export function filePreviewRenderKindForLocation(input: {
  location: WorkspaceFileLocation;
  /** 这个平台的 Markdown 预览能不能滚到指定行（Web 能，原生不能）。 */
  markdownPreviewScrollsToLine: boolean;
}): FilePreviewRenderKind | null {
  const renderKind = filePreviewRenderKind(input.location.path);
  if (!input.location.lineStart) return renderKind;
  const staysInPreview =
    renderKind === "markdown" &&
    input.location.lineView === "preview" &&
    input.markdownPreviewScrollsToLine;
  return staysInPreview ? renderKind : null;
}
