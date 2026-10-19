import { z } from "zod";
import {
  LogicMapNodeKindSchema,
  type LogicMapEdge,
  type LogicMapNode,
  type LogicMapSkeleton,
} from "@getpaseo/protocol/messages";

const MAX_NODES_PER_LAYER = 20;
const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const nodeId = z.string().describe('Stable node id: lowercase letters, digits, "-" or "_".');
const parentId = z
  .string()
  .nullable()
  .describe("Id of the subgraph node this node sits inside; null or omitted for the top layer.");
const failure = z
  .boolean()
  .describe("True for a node on a failure path (drawn red). Defaults to false.");

/** update_logic_map 的一条增量操作。 */
export const LogicMapOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    id: nodeId,
    title: z.string().min(1),
    kind: LogicMapNodeKindSchema,
    parentId: parentId.optional(),
    failure: failure.optional(),
  }),
  z.object({
    op: z.literal("update_node"),
    id: nodeId,
    title: z.string().min(1).optional(),
    kind: LogicMapNodeKindSchema.optional(),
    parentId: parentId.optional(),
    failure: failure.optional(),
  }),
  z.object({
    op: z.literal("remove_node").describe("Also removes its lines and its own doc file."),
    id: nodeId,
  }),
  z.object({
    op: z.literal("add_edge"),
    from: z.string(),
    to: z.string(),
    condition: z
      .string()
      .min(1)
      .optional()
      .describe("Branch condition shown on the line. Required on lines out of a decision."),
  }),
  z.object({ op: z.literal("remove_edge"), from: z.string(), to: z.string() }),
  z.object({ op: z.literal("set_title"), title: z.string().min(1) }),
  z.object({
    op: z.literal("set_spec_framework"),
    framework: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({
        kind: z.literal("present"),
        docsPath: z.string().min(1).describe("Where the framework keeps its requirement docs."),
      }),
    ]),
  }),
  z.object({
    op: z.literal("write_node_doc"),
    id: nodeId,
    content: z.string().min(1).describe("Markdown. Replaces the node's own doc."),
  }),
  z.object({
    op: z.literal("link_node_doc"),
    id: nodeId,
    path: z.string().min(1).describe("File in this workspace, relative to the workspace root."),
    heading: z.string().min(1).describe("Text of the heading in that file the node points at."),
  }),
]);
export type LogicMapOperation = z.infer<typeof LogicMapOperationSchema>;

export interface ExternalDocLink {
  nodeId: string;
  path: string;
  heading: string;
}

export interface AppliedLogicMapOperations {
  skeleton: LogicMapSkeleton;
  problems: string[];
  /** 本组写入的自有文档：文件名 → 内容。 */
  docWrites: Map<string, string>;
  /** 写入前有、写入后不再被引用的自有文档文件名。 */
  docDeletes: string[];
  /** 本组新指向的外部文档，写入前要确认文件和标题都在。 */
  externalLinks: ExternalDocLink[];
  warnings: string[];
}

export function ownDocFileName(id: string): string {
  return `${id}.md`;
}

/** 去掉 Markdown 标题前后的 `#` 和空白，只留标题文字。 */
export function normalizeHeading(heading: string): string {
  return heading
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s+#+$/, "")
    .trim();
}

function edgeLabel(edge: Pick<LogicMapEdge, "from" | "to">): string {
  return `line ${edge.from} → ${edge.to}`;
}

interface Draft {
  title: string | null;
  specFramework: LogicMapSkeleton["specFramework"];
  nodes: Map<string, LogicMapNode>;
  edges: LogicMapEdge[];
  docWrites: Map<string, string>;
  externalLinks: Map<string, ExternalDocLink>;
}

type OperationOf<K extends LogicMapOperation["op"]> = Extract<LogicMapOperation, { op: K }>;

function addNode(draft: Draft, operation: OperationOf<"add_node">): string | null {
  if (!NODE_ID_PATTERN.test(operation.id)) {
    return `node id "${operation.id}" may only use lowercase letters, digits, "-" and "_"`;
  }
  if (draft.nodes.has(operation.id)) return `node "${operation.id}" already exists`;
  draft.nodes.set(operation.id, {
    id: operation.id,
    title: operation.title,
    kind: operation.kind,
    parentId: operation.parentId ?? null,
    failure: operation.failure ?? false,
    doc: null,
  });
  return null;
}

function updateNode(draft: Draft, operation: OperationOf<"update_node">): string | null {
  const current = draft.nodes.get(operation.id);
  if (!current) return `node "${operation.id}" does not exist`;
  draft.nodes.set(operation.id, {
    ...current,
    ...(operation.title !== undefined ? { title: operation.title } : {}),
    ...(operation.kind !== undefined ? { kind: operation.kind } : {}),
    ...(operation.parentId !== undefined ? { parentId: operation.parentId } : {}),
    ...(operation.failure !== undefined ? { failure: operation.failure } : {}),
  });
  return null;
}

function removeNode(draft: Draft, operation: OperationOf<"remove_node">): string | null {
  if (!draft.nodes.delete(operation.id)) return `node "${operation.id}" does not exist`;
  draft.edges = draft.edges.filter(
    (edge) => edge.from !== operation.id && edge.to !== operation.id,
  );
  draft.docWrites.delete(operation.id);
  draft.externalLinks.delete(operation.id);
  return null;
}

function addEdge(draft: Draft, operation: OperationOf<"add_edge">): string | null {
  if (draft.edges.some((edge) => edge.from === operation.from && edge.to === operation.to)) {
    return `${edgeLabel(operation)} already exists`;
  }
  draft.edges.push({
    from: operation.from,
    to: operation.to,
    condition: operation.condition ?? null,
  });
  return null;
}

function removeEdge(draft: Draft, operation: OperationOf<"remove_edge">): string | null {
  const remaining = draft.edges.filter(
    (edge) => edge.from !== operation.from || edge.to !== operation.to,
  );
  if (remaining.length === draft.edges.length) return `${edgeLabel(operation)} does not exist`;
  draft.edges = remaining;
  return null;
}

function writeNodeDoc(draft: Draft, operation: OperationOf<"write_node_doc">): string | null {
  const current = draft.nodes.get(operation.id);
  if (!current) return `node "${operation.id}" does not exist`;
  draft.nodes.set(operation.id, {
    ...current,
    doc: { kind: "own", file: ownDocFileName(operation.id), pendingLink: false },
  });
  draft.docWrites.set(operation.id, operation.content);
  draft.externalLinks.delete(operation.id);
  return null;
}

function linkNodeDoc(draft: Draft, operation: OperationOf<"link_node_doc">): string | null {
  const current = draft.nodes.get(operation.id);
  if (!current) return `node "${operation.id}" does not exist`;
  const heading = normalizeHeading(operation.heading);
  draft.nodes.set(operation.id, {
    ...current,
    doc: { kind: "external", path: operation.path, heading },
  });
  draft.docWrites.delete(operation.id);
  draft.externalLinks.set(operation.id, { nodeId: operation.id, path: operation.path, heading });
  return null;
}

/** 把一条操作作用到草稿上；不合格时返回问题描述，草稿不变。 */
function applyOperation(draft: Draft, operation: LogicMapOperation): string | null {
  switch (operation.op) {
    case "add_node":
      return addNode(draft, operation);
    case "update_node":
      return updateNode(draft, operation);
    case "remove_node":
      return removeNode(draft, operation);
    case "add_edge":
      return addEdge(draft, operation);
    case "remove_edge":
      return removeEdge(draft, operation);
    case "set_title":
      draft.title = operation.title;
      return null;
    case "set_spec_framework":
      draft.specFramework = operation.framework;
      return null;
    case "write_node_doc":
      return writeNodeDoc(draft, operation);
    case "link_node_doc":
      return linkNodeDoc(draft, operation);
  }
}

function validateStructure(draft: Draft): string[] {
  const problems: string[] = [];
  if (draft.title === null) {
    problems.push(
      "The map has no title yet: include a set_title operation with the feature's name.",
    );
  }
  for (const node of draft.nodes.values()) {
    if (node.parentId === null) continue;
    const parent = draft.nodes.get(node.parentId);
    if (!parent) {
      problems.push(`node "${node.id}": parent "${node.parentId}" does not exist`);
    } else if (parent.kind !== "subgraph") {
      problems.push(`node "${node.id}": parent "${node.parentId}" is not a subgraph node`);
    }
  }
  for (const edge of draft.edges) {
    const from = draft.nodes.get(edge.from);
    const to = draft.nodes.get(edge.to);
    const missing = [edge.from, edge.to].filter((id) => !draft.nodes.has(id));
    for (const id of new Set(missing)) {
      problems.push(`${edgeLabel(edge)}: node "${id}" does not exist`);
    }
    if (from && to && from.parentId !== to.parentId) {
      problems.push(`${edgeLabel(edge)}: both ends must be in the same layer`);
    }
  }
  for (const node of draft.nodes.values()) {
    if (node.kind !== "decision") continue;
    const branches = draft.edges.filter(
      (edge) => edge.from === node.id && edge.condition !== null,
    ).length;
    if (branches < 2) {
      problems.push(
        `decision "${node.id}" needs at least two outgoing lines with a condition, it has ${branches}`,
      );
    }
  }
  return problems;
}

function layerWarnings(draft: Draft): string[] {
  const layerSizes = new Map<string | null, number>();
  for (const node of draft.nodes.values()) {
    layerSizes.set(node.parentId, (layerSizes.get(node.parentId) ?? 0) + 1);
  }
  const warnings: string[] = [];
  for (const [layer, size] of layerSizes) {
    if (size <= MAX_NODES_PER_LAYER) continue;
    const where =
      layer === null
        ? "The top layer"
        : `The layer inside "${draft.nodes.get(layer)?.title ?? layer}"`;
    warnings.push(
      `${where} has ${size} nodes. Keep a layer to about 7 to 20 nodes: move some into a subgraph node.`,
    );
  }
  return warnings;
}

function ownDocFiles(nodes: Iterable<LogicMapNode>): Set<string> {
  const files = new Set<string>();
  for (const node of nodes) {
    if (node.doc?.kind === "own") files.add(node.doc.file);
  }
  return files;
}

/**
 * 在内存里把一组操作依次作用到骨架上并做结构校验；不碰磁盘。
 * 外部文档的文件与标题由调用方在写入前检查。
 */
export function applyLogicMapOperations(
  skeleton: LogicMapSkeleton,
  operations: readonly LogicMapOperation[],
): AppliedLogicMapOperations {
  const draft: Draft = {
    title: skeleton.title,
    specFramework: skeleton.specFramework,
    nodes: new Map(skeleton.nodes.map((node) => [node.id, node])),
    edges: [...skeleton.edges],
    docWrites: new Map(),
    externalLinks: new Map(),
  };
  const problems: string[] = [];
  operations.forEach((operation, index) => {
    const problem = applyOperation(draft, operation);
    if (problem) problems.push(`operations[${index}] ${operation.op}: ${problem}`);
  });
  problems.push(...validateStructure(draft));

  // 装了 spec 框架时，本组新写的自有文档是临时要点，带"还没指向正式文档"标记。
  const pendingLink = draft.specFramework?.kind === "present";
  for (const id of draft.docWrites.keys()) {
    const node = draft.nodes.get(id);
    if (node?.doc?.kind === "own") {
      draft.nodes.set(id, { ...node, doc: { ...node.doc, pendingLink } });
    }
  }

  const docWrites = new Map(
    [...draft.docWrites].map(([id, content]) => [ownDocFileName(id), content]),
  );
  const keptFiles = ownDocFiles(draft.nodes.values());
  const docDeletes = [...ownDocFiles(skeleton.nodes)].filter((file) => !keptFiles.has(file));
  return {
    skeleton: {
      title: draft.title,
      specFramework: draft.specFramework,
      nodes: [...draft.nodes.values()],
      edges: draft.edges,
    },
    problems,
    docWrites,
    docDeletes,
    externalLinks: [...draft.externalLinks.values()],
    warnings: layerWarnings(draft),
  };
}
