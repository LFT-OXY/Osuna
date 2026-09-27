import { describe, expect, it } from "vitest";

import { resolveMarkdownResource } from "./resource";

const WORKSPACE_ROOT = "/Users/test/project";

function resolve(href: string, documentPath = "docs/guide/README.md") {
  return resolveMarkdownResource({ href, documentPath, workspaceRoot: WORKSPACE_ROOT });
}

describe("resolveMarkdownResource", () => {
  it("passes through http(s) and data image URIs", () => {
    expect(resolve("https://example.com/badge.svg")).toEqual({
      kind: "external",
      url: "https://example.com/badge.svg",
    });
    expect(resolve("http://example.com/badge.png")).toEqual({
      kind: "external",
      url: "http://example.com/badge.png",
    });
    expect(resolve("data:image/png;base64,abc")).toEqual({
      kind: "external",
      url: "data:image/png;base64,abc",
    });
  });

  it("resolves relative paths against the document directory", () => {
    expect(resolve("shots/output.png")).toEqual({
      kind: "workspace_file",
      path: "docs/guide/shots/output.png",
    });
    expect(resolve("./output.png")).toEqual({
      kind: "workspace_file",
      path: "docs/guide/output.png",
    });
  });

  it("walks up with ../ while staying inside the workspace", () => {
    expect(resolve("../../assets/logo.svg")).toEqual({
      kind: "workspace_file",
      path: "assets/logo.svg",
    });
  });

  it("resolves relative paths of a root-level document against the workspace root", () => {
    expect(resolve("packages/website/public/logo.svg", "README.md")).toEqual({
      kind: "workspace_file",
      path: "packages/website/public/logo.svg",
    });
  });

  it("uses the workspace-relative directory of an absolute document path", () => {
    expect(resolve("output.png", `${WORKSPACE_ROOT}/docs/README.md`)).toEqual({
      kind: "workspace_file",
      path: "docs/output.png",
    });
  });

  it("keeps absolute paths inside the workspace", () => {
    expect(resolve(`${WORKSPACE_ROOT}/docs/output.png`)).toEqual({
      kind: "workspace_file",
      path: "docs/output.png",
    });
  });

  it("treats other slash-prefixed paths as repository-root relative, like GitHub", () => {
    expect(resolve("/docs/output.png")).toEqual({
      kind: "workspace_file",
      path: "docs/output.png",
    });
  });

  it("drops the query and fragment and decodes escaped characters", () => {
    expect(resolve("my%20shot.png?raw=true#frame")).toEqual({
      kind: "workspace_file",
      path: "docs/guide/my shot.png",
    });
  });

  it("classifies paths that climb above the workspace root as outside the workspace", () => {
    expect(resolve("../../../secret.png")).toEqual({ kind: "outside_workspace" });
    expect(resolve("/../secret.png")).toEqual({ kind: "outside_workspace" });
    expect(resolve("~/secret.png")).toEqual({ kind: "outside_workspace" });
  });

  it("classifies relative paths of a document outside the workspace as outside the workspace", () => {
    expect(resolve("output.png", "/tmp/notes/README.md")).toEqual({ kind: "outside_workspace" });
    expect(resolve("output.png", "~/notes/README.md")).toEqual({ kind: "outside_workspace" });
  });

  it("handles Windows workspace roots and drive paths", () => {
    const windows = (href: string) =>
      resolveMarkdownResource({
        href,
        documentPath: "docs\\README.md",
        workspaceRoot: "C:\\Users\\test\\project",
      });
    expect(windows("shots\\output.png")).toEqual({
      kind: "workspace_file",
      path: "docs/shots/output.png",
    });
    expect(windows("c:/Users/test/project/output.png")).toEqual({
      kind: "workspace_file",
      path: "output.png",
    });
    expect(windows("D:/elsewhere/output.png")).toEqual({ kind: "outside_workspace" });
  });

  it("rejects empty sources, other schemes, and directory targets", () => {
    expect(resolve("   ")).toEqual({ kind: "unsupported" });
    expect(resolve("javascript:alert(1)")).toEqual({ kind: "unsupported" });
    expect(resolve("file:///tmp/output.png")).toEqual({ kind: "unsupported" });
    expect(resolve("data:text/html,<b>x</b>")).toEqual({ kind: "unsupported" });
    expect(resolve("//cdn.example.com/badge.png")).toEqual({ kind: "unsupported" });
    expect(resolve("../..")).toEqual({ kind: "unsupported" });
  });
});
