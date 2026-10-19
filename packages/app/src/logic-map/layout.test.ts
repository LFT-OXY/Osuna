import { describe, expect, it } from "vitest";
import type { LogicMapSkeleton } from "@getpaseo/protocol/messages";
import { buildEmptyLogicMap, buildLoginLogicMap } from "@/test/logic-map-fixtures";
import { layoutLogicMapLayer, type LogicMapNodeBox } from "./layout";

function overlaps(a: LogicMapNodeBox, b: LogicMapNodeBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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

  it("marks the paths into and out of failure steps, and counts a subgraph node's direct children", () => {
    const layout = layoutLogicMapLayer(buildLoginLogicMap(), null);
    const failureEdges = layout.edges
      .filter((route) => route.failure)
      .map((route) => `${route.from}->${route.to}`);

    expect(failureEdges).toEqual([
      "account->locked-notice",
      "password->count-failure",
      "count-failure->limit",
      "limit->wrong-password",
      "limit->lock",
      "wrong-password->stay",
      "lock->stay",
      "locked-notice->stay",
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

  it("gives an empty map an empty canvas with no start node", () => {
    const layout = layoutLogicMapLayer(buildEmptyLogicMap(), null);

    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.startNodeId).toBeNull();
  });
});
