import { findMarkdownHeadingLine, logicMapOwnDocPath } from "@getpaseo/protocol/logic-map-docs";
import type { LogicMapNodeDoc, LogicMapSkeleton } from "@getpaseo/protocol/messages";
import type { WorkspaceFileLocation } from "@/workspace/file-open";

/** 节点文档相对 workspace 的路径。 */
export function nodeDocPath(mapName: string, doc: LogicMapNodeDoc): string {
  return doc.kind === "own" ? logicMapOwnDocPath(mapName, doc.file) : doc.path;
}

/**
 * 点节点时打开的位置。外部文档用存下的标题在打开时换算成起始行号（daemon 校验标题时用同一套规则）；
 * 标题已被删掉、或文件没读到时打开文件开头。
 */
export function nodeDocLocation(input: {
  mapName: string;
  doc: LogicMapNodeDoc;
  /** 外部文档的当前内容；自有文档不需要，读失败时为 null。 */
  content: string | null;
}): WorkspaceFileLocation {
  const path = nodeDocPath(input.mapName, input.doc);
  if (input.doc.kind === "own" || input.content === null) return { path };
  const lineStart = findMarkdownHeadingLine(input.content, input.doc.heading);
  // 节点文档是拿来读的：停在渲染预览里滚到那一节，不像其他带行号的打开那样进源码视图。
  return lineStart === null ? { path } : { path, lineStart, lineView: "preview" };
}

/**
 * 主区域聚焦的文件标签是哪个节点的文档。几个节点指向同一份文件时，优先用户刚点开的那个，
 * 否则取图里第一个。
 */
export function focusedNodeDocId(input: {
  skeleton: LogicMapSkeleton;
  mapName: string;
  /** 聚焦的文件标签相对 workspace 的路径；聚焦的不是文件时为 null。 */
  focusedPath: string | null;
  openedNodeId: string | null;
}): string | null {
  const { focusedPath } = input;
  if (focusedPath === null) return null;
  const matching = input.skeleton.nodes.filter(
    (node) => node.doc !== null && nodeDocPath(input.mapName, node.doc) === focusedPath,
  );
  const opened = matching.find((node) => node.id === input.openedNodeId);
  return (opened ?? matching[0])?.id ?? null;
}
