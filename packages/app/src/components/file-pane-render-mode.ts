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
 * 打开一个位置时渲染预览还是源码视图。带行号打开说明要落到那一行，而 Markdown 预览在哪个平台都
 * 滚不到指定行，所以一律退回带高亮的源码视图；标了 lineView: "preview" 的逻辑图节点文档也一样。
 */
export function filePreviewRenderKindForLocation(
  location: WorkspaceFileLocation,
): FilePreviewRenderKind | null {
  return location.lineStart ? null : filePreviewRenderKind(location.path);
}
