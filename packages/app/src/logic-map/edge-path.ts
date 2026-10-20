import type { LogicMapPoint } from "./layout";

const CORNER_RADIUS = 10;
/** 箭头长 7、宽 8；线停在箭头底边，不从尖上穿出去。 */
const ARROW_LENGTH = 7;
const ARROW_HALF_WIDTH = 4;

function samePoint(a: LogicMapPoint, b: LogicMapPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function isCollinear(a: LogicMapPoint, b: LogicMapPoint, c: LogicMapPoint): boolean {
  return (b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x);
}

function simplify(points: readonly LogicMapPoint[]): LogicMapPoint[] {
  const deduped = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1]),
  );
  return deduped.filter(
    (point, index) =>
      index === 0 ||
      index === deduped.length - 1 ||
      !isCollinear(deduped[index - 1], point, deduped[index + 1]),
  );
}

function towards(from: LogicMapPoint, to: LogicMapPoint, distance: number): LogicMapPoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return from;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
}

/**
 * 折线的 SVG 路径：拐角处用二次曲线倒圆角，终点留出箭头的长度。最后一段总是竖直向下进入目标卡片顶边。
 */
export function roundedEdgePath(points: readonly LogicMapPoint[]): string {
  const simplified = simplify(points);
  if (simplified.length < 2) return "";
  const last = simplified[simplified.length - 1];
  const beforeLast = simplified[simplified.length - 2];
  const trimmed = [...simplified.slice(0, -1), towards(last, beforeLast, ARROW_LENGTH)];
  const commands = [`M ${trimmed[0].x} ${trimmed[0].y}`];
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const previous = trimmed[index - 1];
    const corner = trimmed[index];
    const next = trimmed[index + 1];
    const radius = Math.min(
      CORNER_RADIUS,
      Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    const enter = towards(corner, previous, radius);
    const exit = towards(corner, next, radius);
    commands.push(`L ${enter.x} ${enter.y}`, `Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`);
  }
  const end = trimmed[trimmed.length - 1];
  commands.push(`L ${end.x} ${end.y}`);
  return commands.join(" ");
}

/** 终点处向下的实心箭头。 */
export function arrowHeadPath(end: LogicMapPoint): string {
  const baseY = end.y - ARROW_LENGTH;
  return `M ${end.x - ARROW_HALF_WIDTH} ${baseY} L ${end.x + ARROW_HALF_WIDTH} ${baseY} L ${end.x} ${end.y} Z`;
}
