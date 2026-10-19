import { graphlib, layout as runDagreLayout } from "@dagrejs/dagre";
import type {
  LogicMapEdge,
  LogicMapNode,
  LogicMapNodeKind,
  LogicMapSkeleton,
} from "@getpaseo/protocol/messages";

/** 卡片几何，画布按这些尺寸画，排版按这些尺寸算高度，两边必须一致。 */
export const LOGIC_MAP_CARD = {
  width: 152,
  padding: 12,
  radius: 12,
  headerHeight: 24,
  rowsTop: 8,
  rowHeight: 24,
  rowGap: 6,
  tagTop: 8,
  tagHeight: 18,
} as const;

const LAYOUT_SPACING = {
  margin: 16,
  nodeGap: 16,
  edgeGap: 8,
  rankGap: 40,
  /** 判断分支从出口圆点先向右走出的距离，线不贴着卡片右缘。 */
  stub: 12,
} as const;

export interface LogicMapPoint {
  x: number;
  y: number;
}

export type LogicMapBranchLabel = "if" | "elseIf" | "else";

/** 判断卡片里的一行：一条带条件的出线，出口在卡片右缘、这一行的中线上。 */
export interface LogicMapBranch {
  label: LogicMapBranchLabel;
  condition: string | null;
  targetId: string;
  failure: boolean;
  exit: LogicMapPoint;
}

export interface LogicMapNodeBox {
  id: string;
  title: string;
  kind: LogicMapNodeKind;
  failure: boolean;
  /** 装了 spec 框架时还停留在临时要点、没指向正式文档。 */
  pendingLink: boolean;
  /** 子图节点里直接包含的节点数；其他种类为 null。 */
  subgraphNodeCount: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  branches: LogicMapBranch[];
}

export interface LogicMapEdgeRoute {
  id: string;
  from: string;
  to: string;
  /** 通往或离开失败步骤的线，画成红色。 */
  failure: boolean;
  /** 起点是出口（判断行尾或卡片底边中点），终点是目标卡片顶边中点。 */
  points: LogicMapPoint[];
}

export interface LogicMapLayout {
  width: number;
  height: number;
  nodes: LogicMapNodeBox[];
  edges: LogicMapEdgeRoute[];
  startNodeId: string | null;
}

function branchLabel(index: number, count: number): LogicMapBranchLabel {
  if (index === 0) return "if";
  return index === count - 1 ? "else" : "elseIf";
}

function cardHeight(node: LogicMapNode, branchCount: number, hasTag: boolean): number {
  let height = LOGIC_MAP_CARD.padding * 2 + LOGIC_MAP_CARD.headerHeight;
  if (node.kind === "decision" && branchCount > 0) {
    height +=
      LOGIC_MAP_CARD.rowsTop +
      branchCount * LOGIC_MAP_CARD.rowHeight +
      (branchCount - 1) * LOGIC_MAP_CARD.rowGap;
  }
  if (hasTag) {
    height += LOGIC_MAP_CARD.tagTop + LOGIC_MAP_CARD.tagHeight;
  }
  return height;
}

/** 判断卡片第 index 行的出口：卡片右缘、该行中线。 */
function branchExit(box: { x: number; y: number; width: number }, index: number): LogicMapPoint {
  return {
    x: box.x + box.width,
    y:
      box.y +
      LOGIC_MAP_CARD.padding +
      LOGIC_MAP_CARD.headerHeight +
      LOGIC_MAP_CARD.rowsTop +
      index * (LOGIC_MAP_CARD.rowHeight + LOGIC_MAP_CARD.rowGap) +
      LOGIC_MAP_CARD.rowHeight / 2,
  };
}

function edgeId(edge: LogicMapEdge, index: number): string {
  return `${edge.from}->${edge.to}#${index}`;
}

interface LayerInput {
  nodes: LogicMapNode[];
  edges: LogicMapEdge[];
  childCountById: Map<string, number>;
}

function collectLayer(skeleton: LogicMapSkeleton, layerId: string | null): LayerInput {
  const nodes = skeleton.nodes.filter((node) => node.parentId === layerId);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = skeleton.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const childCountById = new Map<string, number>();
  for (const node of skeleton.nodes) {
    if (node.parentId && ids.has(node.parentId)) {
      childCountById.set(node.parentId, (childCountById.get(node.parentId) ?? 0) + 1);
    }
  }
  return { nodes, edges, childCountById };
}

/**
 * 把骨架里的一层排成从上往下的图：输入骨架和层（顶层为 null，否则是子图节点 id），输出卡片坐标、
 * 判断各分支的出口和每条线的折点。同样的骨架总是得到同样的结果。
 */
export function layoutLogicMapLayer(
  skeleton: LogicMapSkeleton,
  layerId: string | null,
): LogicMapLayout {
  const layer = collectLayer(skeleton, layerId);
  const nodeById = new Map(layer.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, LogicMapEdge[]>();
  for (const edge of layer.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "TB",
    // 左上对齐：主路径（每个判断的第一条分支）贴着左边排成一列，失败的路往右展开。
    align: "UL",
    nodesep: LAYOUT_SPACING.nodeGap,
    edgesep: LAYOUT_SPACING.edgeGap,
    ranksep: LAYOUT_SPACING.rankGap,
    marginx: LAYOUT_SPACING.margin,
    marginy: LAYOUT_SPACING.margin,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of layer.nodes) {
    const branchCount = node.kind === "decision" ? (outgoing.get(node.id)?.length ?? 0) : 0;
    const hasTag = node.kind === "subgraph" || isPendingLink(node);
    graph.setNode(node.id, {
      width: LOGIC_MAP_CARD.width,
      height: cardHeight(node, branchCount, hasTag),
    });
  }
  const branchOrder: { left: string; right: string }[] = [];
  for (const [index, edge] of layer.edges.entries()) {
    // 判断的分支加重：分支目标尽量紧跟在判断下面一层，不被拉到远处让出一整列。
    const fromDecision = nodeById.get(edge.from)?.kind === "decision";
    graph.setEdge(edge.from, edge.to, { weight: fromDecision ? 4 : 1 }, edgeId(edge, index));
  }
  for (const node of layer.nodes) {
    if (node.kind !== "decision") continue;
    const targets = (outgoing.get(node.id) ?? []).map((edge) => edge.to);
    for (let index = 0; index + 1 < targets.length; index += 1) {
      branchOrder.push({ left: targets[index], right: targets[index + 1] });
    }
  }
  // 同一层里分支目标按分支顺序从左往右排，和判断卡片里行的顺序一致。
  runDagreLayout(graph, { constraints: branchOrder });

  const boxes = layer.nodes.map((node) => {
    const placed = graph.node(node.id);
    const x = Math.round(placed.x! - placed.width / 2);
    const y = Math.round(placed.y! - placed.height / 2);
    const box = { x, y, width: placed.width, height: placed.height };
    const nodeEdges = node.kind === "decision" ? (outgoing.get(node.id) ?? []) : [];
    const nodeBox: LogicMapNodeBox = {
      id: node.id,
      title: node.title,
      kind: node.kind,
      failure: node.failure === true,
      pendingLink: isPendingLink(node),
      subgraphNodeCount: node.kind === "subgraph" ? (layer.childCountById.get(node.id) ?? 0) : null,
      ...box,
      branches: nodeEdges.map((edge, index) => ({
        label: branchLabel(index, nodeEdges.length),
        condition: edge.condition,
        targetId: edge.to,
        failure: isFailureEdge(edge, nodeById),
        exit: branchExit(box, index),
      })),
    };
    return nodeBox;
  });
  const boxById = new Map(boxes.map((box) => [box.id, box]));

  const edges = layer.edges.map((edge, index): LogicMapEdgeRoute => {
    const source = boxById.get(edge.from)!;
    const target = boxById.get(edge.to)!;
    const branch = source.branches.find((candidate) => candidate.targetId === edge.to);
    const end = { x: target.x + target.width / 2, y: target.y };
    const label = graph.edge({ v: edge.from, w: edge.to, name: edgeId(edge, index) });
    const dagrePoints = (label?.points ?? []).slice(1, -1).map(roundPoint);
    return {
      id: edgeId(edge, index),
      from: edge.from,
      to: edge.to,
      failure: isFailureEdge(edge, nodeById),
      points:
        branch && target.y > source.y + source.height
          ? branchRoute(branch.exit, end)
          : bottomRoute(source, dagrePoints, end),
    };
  });

  const size = graph.graph();
  return {
    width: Math.ceil(size.width ?? LAYOUT_SPACING.margin * 2),
    height: Math.ceil(size.height ?? LAYOUT_SPACING.margin * 2),
    nodes: boxes,
    edges,
    startNodeId: layer.nodes.find((node) => node.kind === "start")?.id ?? null,
  };
}

/**
 * 判断分支的线只走横竖两个方向：目标在出口右边时先横着出去再竖着下来；在左边或正下方时先沿卡片右侧
 * 竖着下到两排之间，再横到目标上方，最后竖着进目标顶边。
 */
function branchRoute(exit: LogicMapPoint, end: LogicMapPoint): LogicMapPoint[] {
  const lane = exit.x + LAYOUT_SPACING.stub;
  if (end.x >= lane) {
    return [exit, { x: end.x, y: exit.y }, end];
  }
  const approachY = end.y - LAYOUT_SPACING.rankGap / 2;
  return [exit, { x: lane, y: exit.y }, { x: lane, y: approachY }, { x: end.x, y: approachY }, end];
}

/**
 * 普通出线从卡片底边中点出发，沿 dagre 给的折点绕开别的卡片，最后在目标上方两排之间横过去再竖着进顶边。
 * 斜着的一段拆成"竖、横、竖"，所以整条线只有横竖两个方向。
 */
function bottomRoute(
  source: LogicMapNodeBox,
  dagrePoints: LogicMapPoint[],
  end: LogicMapPoint,
): LogicMapPoint[] {
  const start = { x: source.x + source.width / 2, y: source.y + source.height };
  const approachY = end.y - LAYOUT_SPACING.rankGap / 2;
  const waypoints = dagrePoints.filter((point) => point.y > start.y && point.y < approachY);
  return orthogonalize([start, ...waypoints, { x: end.x, y: approachY }, end]);
}

function orthogonalize(points: LogicMapPoint[]): LogicMapPoint[] {
  const result = [points[0]];
  for (const point of points.slice(1)) {
    const previous = result[result.length - 1];
    if (previous.x !== point.x && previous.y !== point.y) {
      const middleY = Math.round((previous.y + point.y) / 2);
      result.push({ x: previous.x, y: middleY }, { x: point.x, y: middleY });
    }
    result.push(point);
  }
  return result;
}

function isPendingLink(node: LogicMapNode): boolean {
  return node.doc?.kind === "own" && node.doc.pendingLink;
}

function isFailureEdge(edge: LogicMapEdge, nodeById: Map<string, LogicMapNode>): boolean {
  return nodeById.get(edge.from)?.failure === true || nodeById.get(edge.to)?.failure === true;
}

function roundPoint(point: LogicMapPoint): LogicMapPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
