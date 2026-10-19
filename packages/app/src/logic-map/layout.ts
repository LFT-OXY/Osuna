import { graphlib, layout as runDagreLayout } from "@dagrejs/dagre";
import type {
  LogicMapEdge,
  LogicMapNode,
  LogicMapNodeKind,
  LogicMapSkeleton,
} from "@getpaseo/protocol/messages";
import { CONTROL_HEIGHT, SPACING } from "@/styles/theme";

/**
 * 卡片几何，画布按这些尺寸画，排版按这些尺寸算高度，两边必须一致。能用设计 token 的都用 token；
 * 卡片宽度、标签高度、出口圆点没有对应 token，见 docs/design.md §14 的逻辑图画布例外。
 */
export const LOGIC_MAP_CARD = {
  width: 152,
  padding: SPACING[3],
  headerHeight: SPACING[6],
  rowsTop: SPACING[2],
  rowHeight: CONTROL_HEIGHT.sm,
  rowGap: SPACING[1.5],
  tagTop: SPACING[2],
  tagHeight: 18,
  exitDotSize: 10,
} as const;

/** 只有标题一行的卡片高度（开始、步骤、结束），骨架卡片也用它。 */
export const LOGIC_MAP_CARD_MIN_HEIGHT = LOGIC_MAP_CARD.padding * 2 + LOGIC_MAP_CARD.headerHeight;

const LAYOUT_SPACING = {
  margin: SPACING[4],
  /** 列间距要放得下一条判断分支的竖线，并且线和两边的卡片都留出 clearance。 */
  nodeGap: SPACING[8],
  edgeGap: SPACING[2],
  rankGap: SPACING[12],
  /** 判断分支从出口圆点先向右走出的距离，线不贴着卡片右缘。 */
  stub: SPACING[4],
  /** 几条线进同一个目标时，横段错开的距离。 */
  laneStep: SPACING[1.5],
} as const;

/** 线与不在它两端的卡片之间至少留的距离。 */
export const LOGIC_MAP_EDGE_CLEARANCE = SPACING[3];

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
  /** 通往失败步骤的线，画成红色。 */
  failure: boolean;
  /** 起点是出口（判断行尾或卡片底边中点），终点在目标卡片顶边上。 */
  points: LogicMapPoint[];
}

export interface LogicMapLayout {
  width: number;
  height: number;
  nodes: LogicMapNodeBox[];
  edges: LogicMapEdgeRoute[];
  startNodeId: string | null;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function branchLabel(index: number, count: number): LogicMapBranchLabel {
  if (index === 0) return "if";
  return index === count - 1 ? "else" : "elseIf";
}

function cardHeight(input: { branchCount: number; hasTag: boolean }): number {
  let height = LOGIC_MAP_CARD_MIN_HEIGHT;
  if (input.branchCount > 0) {
    height +=
      LOGIC_MAP_CARD.rowsTop +
      input.branchCount * LOGIC_MAP_CARD.rowHeight +
      (input.branchCount - 1) * LOGIC_MAP_CARD.rowGap;
  }
  if (input.hasTag) {
    height += LOGIC_MAP_CARD.tagTop + LOGIC_MAP_CARD.tagHeight;
  }
  return height;
}

/** 判断卡片第 index 行的出口：卡片右缘、该行中线。 */
function branchExit(box: Box, index: number): LogicMapPoint {
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
  const decisionBranches = (node: LogicMapNode) =>
    node.kind === "decision" ? (outgoing.get(node.id) ?? []) : [];
  const isFailureEdge = (edge: LogicMapEdge) => nodeById.get(edge.to)?.failure === true;

  const graph = runLayeredLayout(layer, { decisionBranches, isFailureEdge });

  const boxes = layer.nodes.map((node): LogicMapNodeBox => {
    const placed = graph.node(node.id);
    const box = {
      x: Math.round(placed.x! - placed.width / 2),
      y: Math.round(placed.y! - placed.height / 2),
      width: placed.width,
      height: placed.height,
    };
    const branchEdges = decisionBranches(node);
    const subgraphNodeCount =
      node.kind === "subgraph" ? (layer.childCountById.get(node.id) ?? 0) : null;
    const branches = branchEdges.map((edge, index) => ({
      label: branchLabel(index, branchEdges.length),
      condition: edge.condition,
      targetId: edge.to,
      failure: isFailureEdge(edge),
      exit: branchExit(box, index),
    }));
    return {
      id: node.id,
      title: node.title,
      kind: node.kind,
      failure: node.failure === true,
      pendingLink: isPendingLink(node),
      subgraphNodeCount,
      ...box,
      branches,
    };
  });
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const entries = assignEntries(layer.edges, boxById);

  const edges = layer.edges.map((edge, index): LogicMapEdgeRoute => {
    const source = boxById.get(edge.from)!;
    const target = boxById.get(edge.to)!;
    // 同一个判断的两条分支可能指向同一个目标，按分支序号找出口，不按目标找。
    const branchIndex = outgoing.get(edge.from)?.indexOf(edge) ?? -1;
    const branch = source.branches[branchIndex];
    const entry = entries.get(edge)!;
    const goesDown = target.y > source.y + source.height;
    const label = graph.edge({ v: edge.from, w: edge.to, name: edgeId(edge, index) });
    const dagrePoints = (label?.points ?? []).slice(1, -1).map(roundPoint);
    const rawRoute =
      branch && goesDown
        ? branchRoute(branch.exit, entry)
        : bottomRoute(source, dagrePoints, entry);
    const obstacles = boxes.filter((box) => box.id !== edge.from && box.id !== edge.to);
    return {
      id: edgeId(edge, index),
      from: edge.from,
      to: edge.to,
      failure: isFailureEdge(edge),
      points: keepClearOf(rawRoute, obstacles),
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

function runLayeredLayout(
  layer: LayerInput,
  rules: {
    decisionBranches: (node: LogicMapNode) => LogicMapEdge[];
    isFailureEdge: (edge: LogicMapEdge) => boolean;
  },
) {
  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "TB",
    // 左上对齐：主路径贴着左边排成一列，失败的路往右展开。
    align: "UL",
    nodesep: LAYOUT_SPACING.nodeGap,
    edgesep: LAYOUT_SPACING.edgeGap,
    ranksep: LAYOUT_SPACING.rankGap,
    marginx: LAYOUT_SPACING.margin,
    marginy: LAYOUT_SPACING.margin,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of layer.nodes) {
    const hasTag = node.kind === "subgraph" || isPendingLink(node);
    const height = cardHeight({ branchCount: rules.decisionBranches(node).length, hasTag });
    graph.setNode(node.id, { width: LOGIC_MAP_CARD.width, height });
  }
  const decisionIds = new Set(
    layer.nodes.filter((node) => node.kind === "decision").map((node) => node.id),
  );
  for (const [index, edge] of layer.edges.entries()) {
    // 判断的分支加重：分支目标尽量紧跟在判断下面一层，不被拉到远处让出一整列。
    const weight = decisionIds.has(edge.from) ? 4 : 1;
    graph.setEdge(edge.from, edge.to, { weight }, edgeId(edge, index));
  }
  // 同一层里分支目标从左往右排：通往失败步骤的放在后面，主路径不管 Agent 写的顺序都在最左。
  const constraints: { left: string; right: string }[] = [];
  for (const node of layer.nodes) {
    const ordered = [...rules.decisionBranches(node)].sort(
      (a, b) => Number(rules.isFailureEdge(a)) - Number(rules.isFailureEdge(b)),
    );
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      constraints.push({ left: ordered[index].to, right: ordered[index + 1].to });
    }
  }
  runDagreLayout(graph, { constraints });
  return graph;
}

interface EdgeEntry {
  point: LogicMapPoint;
  /** 进目标前最后一段横线所在的高度；几条线进同一个目标时各走一层。 */
  approachY: number;
}

/**
 * 进同一个目标的线在顶边上错开入口、横段错开高度，不会叠成一条：按来源从左到右分配入口和横段，
 * 每条线各占一层。
 */
function assignEntries(
  edges: LogicMapEdge[],
  boxById: Map<string, LogicMapNodeBox>,
): Map<LogicMapEdge, EdgeEntry> {
  const byTarget = new Map<string, LogicMapEdge[]>();
  for (const edge of edges) {
    byTarget.set(edge.to, [...(byTarget.get(edge.to) ?? []), edge]);
  }
  const entries = new Map<LogicMapEdge, EdgeEntry>();
  for (const [targetId, incoming] of byTarget) {
    const target = boxById.get(targetId)!;
    const sourceX = (edge: LogicMapEdge) => {
      const source = boxById.get(edge.from)!;
      return source.x + source.width / 2;
    };
    const ordered = [...incoming].sort((a, b) => sourceX(a) - sourceX(b));
    const middle = (ordered.length - 1) / 2;
    for (const [index, edge] of ordered.entries()) {
      const x = Math.round(target.x + (target.width * (index + 1)) / (ordered.length + 1));
      entries.set(edge, {
        point: { x, y: target.y },
        approachY: Math.round(
          target.y - LAYOUT_SPACING.rankGap / 2 + (index - middle) * LAYOUT_SPACING.laneStep,
        ),
      });
    }
  }
  return entries;
}

/**
 * 判断分支的线只走横竖两个方向：先向右走出一小段，沿卡片右侧竖着下到两排之间，再横到目标上方，
 * 最后竖着进目标顶边。
 */
function branchRoute(exit: LogicMapPoint, entry: EdgeEntry): LogicMapPoint[] {
  const lane = exit.x + LAYOUT_SPACING.stub;
  return [
    exit,
    { x: lane, y: exit.y },
    { x: lane, y: entry.approachY },
    { x: entry.point.x, y: entry.approachY },
    entry.point,
  ];
}

/**
 * 普通出线从卡片底边中点出发，沿 dagre 给的折点绕开别的卡片，最后在目标上方两排之间横过去再竖着进顶边。
 * 斜着的一段拆成"竖、横、竖"，所以整条线只有横竖两个方向。
 */
function bottomRoute(
  source: LogicMapNodeBox,
  dagrePoints: LogicMapPoint[],
  entry: EdgeEntry,
): LogicMapPoint[] {
  const start = { x: source.x + source.width / 2, y: source.y + source.height };
  const waypoints = dagrePoints.filter((point) => point.y > start.y && point.y < entry.approachY);
  return orthogonalize([
    start,
    ...waypoints,
    { x: entry.point.x, y: entry.approachY },
    entry.point,
  ]);
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

/** 一段线在某个方向上被哪些卡片挡住：卡片四周各加 clearance。 */
function blockedIntervals(
  obstacles: Box[],
  axis: "x" | "y",
  span: { from: number; to: number },
): [number, number][] {
  const clearance = LOGIC_MAP_EDGE_CLEARANCE;
  const along = axis === "y" ? "x" : "y";
  const alongSize = along === "x" ? "width" : "height";
  const acrossSize = axis === "x" ? "width" : "height";
  return obstacles
    .filter(
      (box) =>
        box[along] - clearance < span.to && box[along] + box[alongSize] + clearance > span.from,
    )
    .map((box) => [box[axis] - clearance, box[axis] + box[acrossSize] + clearance]);
}

function nearestFree(value: number, blocked: [number, number][]): number {
  const hit = blocked.find(([low, high]) => value > low && value < high);
  if (!hit) return value;
  const candidates = [hit[0], hit[1]].filter(
    (candidate) => !blocked.some(([low, high]) => candidate > low && candidate < high),
  );
  if (candidates.length === 0) return value;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
}

/**
 * 把中间的横段、竖段从挡路的卡片旁边挪开（首尾两段连着出口和入口，不动）。挪一段会改变相邻两段的长度，
 * 所以多过几遍。
 */
function keepClearOf(points: LogicMapPoint[], obstacles: Box[]): LogicMapPoint[] {
  const route = points.map((point) => ({ ...point }));
  for (let pass = 0; pass < 3; pass += 1) {
    for (let index = 1; index + 2 < route.length; index += 1) {
      const a = route[index];
      const b = route[index + 1];
      const horizontal = a.y === b.y;
      const axis = horizontal ? "y" : "x";
      const along = horizontal ? "x" : "y";
      const span = { from: Math.min(a[along], b[along]), to: Math.max(a[along], b[along]) };
      const moved = nearestFree(a[axis], blockedIntervals(obstacles, axis, span));
      a[axis] = moved;
      b[axis] = moved;
    }
  }
  return route;
}

function isPendingLink(node: LogicMapNode): boolean {
  return node.doc?.kind === "own" && node.doc.pendingLink;
}

function roundPoint(point: LogicMapPoint): LogicMapPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
