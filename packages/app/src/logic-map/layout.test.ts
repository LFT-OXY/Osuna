import { describe, expect, it } from "vitest";
import type { LogicMapSkeleton } from "@getpaseo/protocol/messages";
import {
  buildEmptyLogicMap,
  buildLoginLogicMap,
  buildNestedLogicMap,
} from "@/test/logic-map-fixtures";
import {
  LOGIC_MAP_EDGE_CLEARANCE,
  layoutLogicMapLayer,
  logicMapLayerTrail,
  type LogicMapNodeBox,
} from "./layout";

function overlaps(a: LogicMapNodeBox, b: LogicMapNodeBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function findNode(nodes: readonly LogicMapNodeBox[], id: string): LogicMapNodeBox {
  const found = nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`node ${id} missing`);
  return found;
}

describe("logic map layer layout", () => {
  it("lays out only the requested layer, top to bottom from the start node", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);

    expect(layout.nodes.map((box) => box.id)).toEqual([
      "submit",
      "account",
      "locked-notice",
      "password",
      "reset-count",
      "second-factor",
      "session",
      "home",
      "count-failure",
      "limit",
      "wrong-password",
      "lock",
      "stay",
    ]);
    expect(layout.startNodeId).toBe("submit");
    const start = findNode(layout.nodes, "submit");
    for (const box of layout.nodes) {
      expect(box.y).toBeGreaterThanOrEqual(start.y);
    }
    expect(findNode(layout.nodes, "home").y).toBeGreaterThan(findNode(layout.nodes, "session").y);
  });

  it("keeps every card apart and inside the canvas", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);

    for (const [index, box] of layout.nodes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
      for (const other of layout.nodes.slice(index + 1)) {
        expect(overlaps(box, other), `${box.id} overlaps ${other.id}`).toBe(false);
      }
    }
  });

  it("lists a decision's branches in the skeleton's edge order with if / else if / else labels", () => {
    const skeleton: LogicMapSkeleton = {
      title: "Checkout",
      specFramework: null,
      nodes: [
        { id: "pay", kind: "decision", title: "Payment", parentId: null, doc: null },
        { id: "card", kind: "step", title: "Charge card", parentId: null, doc: null },
        { id: "wallet", kind: "step", title: "Charge wallet", parentId: null, doc: null },
        {
          id: "declined",
          kind: "step",
          title: "Show declined",
          parentId: null,
          failure: true,
          doc: null,
        },
      ],
      edges: [
        { from: "pay", to: "wallet", condition: "Wallet" },
        { from: "pay", to: "declined", condition: "Declined" },
        { from: "pay", to: "card", condition: "Card" },
      ],
    };

    const branches = findNode(layoutLogicMapLayer(skeleton, null).nodes, "pay").branches;

    expect(
      branches.map(({ label, condition, targetId, failure }) => ({
        label,
        condition,
        targetId,
        failure,
      })),
    ).toEqual([
      { label: "if", condition: "Wallet", targetId: "wallet", failure: false },
      { label: "elseIf", condition: "Declined", targetId: "declined", failure: true },
      { label: "else", condition: "Card", targetId: "card", failure: false },
    ]);
  });

  it("keeps the main path (every decision's first branch) in one column on the left", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);
    const mainPath = ["submit", "account", "password", "reset-count", "second-factor", "session"];

    expect(new Set(mainPath.map((id) => findNode(layout.nodes, id).x))).toEqual(
      new Set([Math.min(...layout.nodes.map((box) => box.x))]),
    );
    expect(findNode(layout.nodes, "lock").x).toBeGreaterThan(
      findNode(layout.nodes, "wrong-password").x,
    );
  });

  it("lays out a decision whose branch targets end up on different rows", () => {
    const skeleton: LogicMapSkeleton = {
      title: "Retry",
      specFramework: null,
      nodes: [
        { id: "try", kind: "decision", title: "Try", parentId: null, doc: null },
        { id: "wait", kind: "step", title: "Wait", parentId: null, doc: null },
        { id: "done", kind: "end", title: "Done", parentId: null, doc: null },
      ],
      edges: [
        { from: "try", to: "wait", condition: "Busy" },
        { from: "try", to: "done", condition: "Free" },
        { from: "wait", to: "done", condition: null },
      ],
    };

    const layout = layoutLogicMapLayer(skeleton, null);

    expect(findNode(layout.nodes, "done").y).toBeGreaterThan(findNode(layout.nodes, "wait").y);
    expect(layout.edges).toHaveLength(3);
  });

  it("produces the same layout for the same skeleton", () => {
    expect(layoutLogicMapLayer(buildLoginLogicMap(), null)).toEqual(
      layoutLogicMapLayer(buildLoginLogicMap(), null),
    );
  });

  it("leaves each branch from its own row's exit and ends on top of that branch's target", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);
    const limit = findNode(layout.nodes, "limit");

    expect(limit.branches.map((branch) => branch.targetId)).toEqual(["wrong-password", "lock"]);
    const [first, second] = limit.branches;
    expect(first.exit.x).toBe(limit.x + limit.width);
    expect(second.exit.x).toBe(limit.x + limit.width);
    expect(second.exit.y).toBeGreaterThan(first.exit.y);
    for (const branch of limit.branches) {
      const route = layout.edges.find(
        (candidate) => candidate.from === "limit" && candidate.to === branch.targetId,
      );
      const target = findNode(layout.nodes, branch.targetId);
      expect(route?.points[0]).toEqual(branch.exit);
      expect(route?.points.at(-1)).toEqual({ x: target.x + target.width / 2, y: target.y });
    }
  });

  it("routes every line with only horizontal and vertical segments", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);

    expect(layout.edges).toHaveLength(14);
    for (const route of layout.edges) {
      for (const [index, point] of route.points.slice(1).entries()) {
        const previous = route.points[index];
        expect(point.x === previous.x || point.y === previous.y, route.id).toBe(true);
      }
    }
  });

  it("marks only the lines leading into failure steps, and counts a subgraph node's direct children", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);
    const failureEdges = layout.edges
      .filter((route) => route.failure)
      .map((route) => `${route.from}->${route.to}`);

    // 离开失败步骤、回到主流程或结束的线（count-failure->limit、lock->stay……）是普通颜色。
    expect(failureEdges).toEqual([
      "account->locked-notice",
      "password->count-failure",
      "limit->wrong-password",
      "limit->lock",
    ]);
    expect(findNode(layout.nodes, "second-factor").subgraphNodeCount).toBe(4);
    expect(findNode(layout.nodes, "submit").subgraphNodeCount).toBeNull();
    expect(findNode(layout.nodes, "session").pendingLink).toBe(true);
    expect(findNode(layout.nodes, "home").pendingLink).toBe(false);
  });

  it("lays out the inside of a subgraph node as its own layer", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), "second-factor");

    expect(layout.nodes.map((box) => box.id)).toEqual(["sms", "sms-check", "sms-ok", "sms-fail"]);
    expect(layout.edges.map((route) => `${route.from}->${route.to}`)).toEqual([
      "sms->sms-check",
      "sms-check->sms-ok",
      "sms-check->sms-fail",
    ]);
  });

  it("lays out each layer of nested subgraphs with only that layer's own nodes and lines", () => {
    const map = buildNestedLogicMap();
    const layerContents = (layerId: string | null) => {
      const layout = layoutLogicMapLayer(map, layerId);
      return {
        nodes: layout.nodes.map((box) => box.id),
        edges: layout.edges.map((route) => `${route.from}->${route.to}`),
        counts: layout.nodes
          .filter((box) => box.subgraphNodeCount !== null)
          .map((box) => `${box.id}:${box.subgraphNodeCount}`),
      };
    };

    // 跨层的 open->enter-password 哪一层都不画。
    expect(layerContents(null)).toEqual({
      nodes: ["open", "password-login", "signed-in"],
      edges: ["open->password-login", "password-login->signed-in"],
      counts: ["password-login:4"],
    });
    expect(layerContents("password-login")).toEqual({
      nodes: ["enter-password", "check-password", "reset", "password-ok"],
      edges: [
        "enter-password->check-password",
        "check-password->password-ok",
        "check-password->reset",
      ],
      counts: ["reset:2"],
    });
    expect(layerContents("reset")).toEqual({
      nodes: ["send-mail", "mail-sent"],
      edges: ["send-mail->mail-sent"],
      counts: [],
    });
  });

  it("names the path from the top layer down to a subgraph layer", () => {
    const map = buildNestedLogicMap();

    expect(logicMapLayerTrail(map, null)).toEqual([]);
    expect(logicMapLayerTrail(map, "password-login")).toEqual([
      { id: "password-login", title: "密码登录" },
    ]);
    expect(logicMapLayerTrail(map, "reset")).toEqual([
      { id: "password-login", title: "密码登录" },
      { id: "reset", title: "找回密码" },
    ]);
  });

  it("has no path to a layer that is gone or is not a subgraph node", () => {
    const map = buildNestedLogicMap();
    const withoutReset = {
      ...map,
      nodes: map.nodes.filter((node) => node.id !== "reset" && node.parentId !== "reset"),
    };

    expect(logicMapLayerTrail(withoutReset, "reset")).toBeNull();
    expect(logicMapLayerTrail(map, "check-password")).toBeNull();
    expect(logicMapLayerTrail(map, "missing")).toBeNull();
  });

  it("gives an empty map an empty canvas with no start node", () => {
    const layout = layoutLogicMapLayer(buildEmptyLogicMap(), null);

    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.startNodeId).toBeNull();
  });

  it("keeps the main path on the left when the agent writes the failure branch first", () => {
    const map = buildLoginLogicMap();
    const failureFirst = (from: string) => {
      const branches = map.edges.filter((edge) => edge.from === from);
      return branches.toReversed();
    };
    const edges = [
      ...map.edges.filter((edge) => !["account", "password"].includes(edge.from)),
      ...failureFirst("account"),
      ...failureFirst("password"),
    ];
    const layout = layoutLogicMapLayer({ ...map, edges }, null);
    const column = findNode(layout.nodes, "submit").x;

    for (const id of ["account", "password", "reset-count", "second-factor", "session", "home"]) {
      expect(findNode(layout.nodes, id).x, id).toBe(column);
    }
    expect(findNode(layout.nodes, "locked-notice").x).toBeGreaterThan(column);
    expect(findNode(layout.nodes, "count-failure").x).toBeGreaterThan(column);
    // 行仍按 Agent 写的顺序：第一行是失败的那条。
    expect(findNode(layout.nodes, "account").branches.map((branch) => branch.targetId)).toEqual([
      "locked-notice",
      "password",
    ]);
  });

  it("leaves from each row's own exit when two branches point at the same step", () => {
    const skeleton: LogicMapSkeleton = {
      title: "Retry",
      specFramework: null,
      nodes: [
        { id: "check", kind: "decision", title: "Check", parentId: null, doc: null },
        { id: "notice", kind: "step", title: "Notice", parentId: null, failure: true, doc: null },
      ],
      edges: [
        { from: "check", to: "notice", condition: "Timeout" },
        { from: "check", to: "notice", condition: "Refused" },
      ],
    };

    const layout = layoutLogicMapLayer(skeleton, null);
    const [first, second] = findNode(layout.nodes, "check").branches;

    expect(layout.edges.map((route) => route.points[0])).toEqual([first.exit, second.exit]);
    expect(first.exit.y).not.toBe(second.exit.y);
  });

  it("keeps every line clear of the cards it does not connect", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);

    for (const route of layout.edges) {
      for (const card of layout.nodes) {
        if (card.id === route.from || card.id === route.to) continue;
        for (const [index, end] of route.points.slice(1).entries()) {
          const start = route.points[index];
          const gapX = Math.max(
            card.x - Math.max(start.x, end.x),
            Math.min(start.x, end.x) - (card.x + card.width),
            0,
          );
          const gapY = Math.max(
            card.y - Math.max(start.y, end.y),
            Math.min(start.y, end.y) - (card.y + card.height),
            0,
          );
          expect(Math.max(gapX, gapY), `${route.id} near ${card.id}`).toBeGreaterThanOrEqual(
            LOGIC_MAP_EDGE_CLEARANCE,
          );
        }
      }
    }
  });

  it("gives every line into the same step its own entry and its own last horizontal", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);
    const intoStay = layout.edges.filter((route) => route.to === "stay");

    expect(intoStay).toHaveLength(3);
    expect(new Set(intoStay.map((route) => route.points.at(-1)?.x)).size).toBe(3);
    expect(new Set(intoStay.map((route) => route.points.at(-2)?.y)).size).toBe(3);
  });

  it("never lets two branches of one decision share a stretch of line", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);
    const segments = (points: { x: number; y: number }[]): Segment[] =>
      points.slice(1).map((end, index) => ({
        x1: points[index].x,
        y1: points[index].y,
        x2: end.x,
        y2: end.y,
      }));
    const shareStretch = (a: Segment, b: Segment) => {
      if (a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1) {
        const top = Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2));
        const bottom = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2));
        return bottom > top;
      }
      if (a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1) {
        const left = Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
        const right = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2));
        return right > left;
      }
      return false;
    };

    for (const decision of ["account", "password", "limit"]) {
      const [first, second] = layout.edges.filter((route) => route.from === decision);
      for (const a of segments(first.points)) {
        for (const b of segments(second.points)) {
          expect(shareStretch(a, b), `${first.id} / ${second.id}`).toBe(false);
        }
      }
    }
  });
});
