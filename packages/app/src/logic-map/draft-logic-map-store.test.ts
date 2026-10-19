import { LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDraftLogicMapKey,
  readDraftLogicMapLabels,
  useDraftLogicMapStore,
} from "./draft-logic-map-store";

afterEach(() => {
  useDraftLogicMapStore.setState({ mapNameByDraftKey: {} });
});

describe("draft logic map", () => {
  it("hands a draft's map to the agent it creates as a label", () => {
    const key = buildDraftLogicMapKey({ serverId: "server-1", draftTabId: "draft-tab-1" });
    useDraftLogicMapStore.getState().setDraftMapName(key, "untitled-1a2b3c4d");

    expect(readDraftLogicMapLabels(key)).toEqual({ [LOGIC_MAP_LABEL]: "untitled-1a2b3c4d" });
  });

  it("gives no labels to a draft whose toggle is off", () => {
    const key = buildDraftLogicMapKey({ serverId: "server-1", draftTabId: "draft-tab-2" });
    useDraftLogicMapStore.getState().setDraftMapName(key, "untitled-1a2b3c4d");
    useDraftLogicMapStore.getState().setDraftMapName(key, null);

    expect(readDraftLogicMapLabels(key)).toBeUndefined();
  });

  it("keeps drafts on different hosts apart", () => {
    useDraftLogicMapStore
      .getState()
      .setDraftMapName(buildDraftLogicMapKey({ serverId: "a", draftTabId: "t" }), "untitled-1");

    expect(
      readDraftLogicMapLabels(buildDraftLogicMapKey({ serverId: "b", draftTabId: "t" })),
    ).toBeUndefined();
  });
});
