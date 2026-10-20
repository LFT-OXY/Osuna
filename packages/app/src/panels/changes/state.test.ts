import { describe, expect, it } from "vitest";
import { changesStateSchema, defaultChangesState } from "./state";

describe("Changes pane state", () => {
  it("drops preferences formerly persisted per pane without resetting local document state", () => {
    expect(
      changesStateSchema.parse({
        ...defaultChangesState,
        mode: "base",
        baseRef: "origin/main",
        layout: "split",
        wrapLines: true,
        hideWhitespace: true,
      }),
    ).toEqual(defaultChangesState);
  });
});

describe("Changes pane state persistence", () => {
  it("reads state saved before expanded files were remembered", () => {
    const saved = {
      treeVisible: true,
      collapsedFilePaths: ["a.ts"],
      collapsedFolderPaths: [],
      commitsCollapsed: true,
    };
    expect(changesStateSchema.parse(saved)).toEqual(saved);
  });

  it("keeps remembered expanded files across a save and reload", () => {
    const state = { ...defaultChangesState, expandedFilePaths: ["big.ts"] };
    expect(changesStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});
