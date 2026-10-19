import { describe, expect, it } from "vitest";
import type { LogicMapNode, LogicMapSkeleton } from "@getpaseo/protocol/messages";
import { focusedNodeDocId, nodeDocLocation } from "./node-doc";

const SPEC = ["# 登录", "", "## 密码登录", "", "正文", "", "## 密码登录", ""].join("\n");

function node(id: string, doc: LogicMapNode["doc"]): LogicMapNode {
  return { id, title: id, kind: "step", parentId: null, doc };
}

describe("nodeDocLocation", () => {
  it("opens an own doc from the map folder without a line", () => {
    expect(
      nodeDocLocation({
        mapName: "login",
        doc: { kind: "own", file: "check.md", pendingLink: false },
        content: null,
      }),
    ).toEqual({ path: "docs/logic-maps/login/check.md" });
  });

  it("starts an external doc at its heading's line, in the rendered preview", () => {
    expect(
      nodeDocLocation({
        mapName: "login",
        doc: { kind: "external", path: ".atw/spec/login.md", heading: "密码登录" },
        content: SPEC,
      }),
    ).toEqual({ path: ".atw/spec/login.md", lineStart: 3, lineView: "preview" });
  });

  it("takes the first of duplicated headings", () => {
    expect(
      nodeDocLocation({
        mapName: "login",
        doc: { kind: "external", path: "spec.md", heading: "## 密码登录" },
        content: SPEC,
      }).lineStart,
    ).toBe(3);
  });

  it("opens the top of the file when the heading is gone or the file could not be read", () => {
    const doc = { kind: "external", path: "spec.md", heading: "验证码登录" } as const;
    expect(nodeDocLocation({ mapName: "login", doc, content: SPEC })).toEqual({ path: "spec.md" });
    expect(nodeDocLocation({ mapName: "login", doc, content: null })).toEqual({ path: "spec.md" });
  });
});

describe("focusedNodeDocId", () => {
  const skeleton: LogicMapSkeleton = {
    title: "登录",
    specFramework: null,
    nodes: [
      node("start", null),
      node("password", { kind: "external", path: "spec.md", heading: "密码登录" }),
      node("lock", { kind: "external", path: "spec.md", heading: "锁定" }),
      node("notify", { kind: "own", file: "notify.md", pendingLink: true }),
    ],
    edges: [],
  };

  it("finds the node whose own doc is the focused file", () => {
    expect(
      focusedNodeDocId({
        skeleton,
        mapName: "login",
        focusedPath: "docs/logic-maps/login/notify.md",
        openedNodeId: null,
      }),
    ).toBe("notify");
  });

  it("prefers the node the user opened when several nodes share the file", () => {
    expect(
      focusedNodeDocId({
        skeleton,
        mapName: "login",
        focusedPath: "spec.md",
        openedNodeId: "lock",
      }),
    ).toBe("lock");
    expect(
      focusedNodeDocId({ skeleton, mapName: "login", focusedPath: "spec.md", openedNodeId: null }),
    ).toBe("password");
  });

  it("ignores the opened node once another file is focused", () => {
    expect(
      focusedNodeDocId({
        skeleton,
        mapName: "login",
        focusedPath: "docs/logic-maps/login/notify.md",
        openedNodeId: "lock",
      }),
    ).toBe("notify");
  });

  it("is null when the focused tab is not a node doc", () => {
    expect(
      focusedNodeDocId({
        skeleton,
        mapName: "login",
        focusedPath: "README.md",
        openedNodeId: null,
      }),
    ).toBeNull();
    expect(
      focusedNodeDocId({ skeleton, mapName: "login", focusedPath: null, openedNodeId: "lock" }),
    ).toBeNull();
    expect(
      focusedNodeDocId({
        skeleton,
        mapName: "other",
        focusedPath: "docs/logic-maps/login/notify.md",
        openedNodeId: null,
      }),
    ).toBeNull();
  });
});
