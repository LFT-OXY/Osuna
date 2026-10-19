import { LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";
import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  buildDraftLogicMapKey,
  createDraftLogicMapStore,
  readDraftLogicMapLabels,
} from "./draft-logic-map-store";

function createMemoryStorage(): StateStorage<Promise<void>> {
  const entries: Record<string, string> = {};
  return {
    getItem: async (name) => entries[name] ?? null,
    setItem: async (name, value) => {
      entries[name] = value;
    },
    removeItem: async (name) => {
      delete entries[name];
    },
  };
}

const KEY = buildDraftLogicMapKey({ serverId: "server-1", draftTabId: "draft-tab-1" });

describe("draft logic map", () => {
  it("hands a draft's map to the agent it creates as a label", () => {
    const store = createDraftLogicMapStore(createMemoryStorage());
    store.getState().turnOnWithNewMap(KEY, "untitled-1a2b3c4d");

    expect(readDraftLogicMapLabels(store, KEY)).toEqual({
      [LOGIC_MAP_LABEL]: "untitled-1a2b3c4d",
    });
  });

  it("gives no labels once the toggle is off, but remembers the map for turning it back on", () => {
    const store = createDraftLogicMapStore(createMemoryStorage());
    store.getState().turnOnWithNewMap(KEY, "untitled-1a2b3c4d");

    store.getState().setEnabled(KEY, false);
    expect(readDraftLogicMapLabels(store, KEY)).toBeUndefined();

    store.getState().setEnabled(KEY, true);
    expect(readDraftLogicMapLabels(store, KEY)).toEqual({
      [LOGIC_MAP_LABEL]: "untitled-1a2b3c4d",
    });
  });

  it("continues an existing map and stops treating its earlier empty map as its own", () => {
    const store = createDraftLogicMapStore(createMemoryStorage());
    store.getState().turnOnWithNewMap(KEY, "untitled-1a2b3c4d");
    store.getState().setEnabled(KEY, false);

    store.getState().turnOnWithExistingMap(KEY, "login");

    expect(readDraftLogicMapLabels(store, KEY)).toEqual({ [LOGIC_MAP_LABEL]: "login" });
    // 那张空图已交给 daemon 处理（没用过就删掉），再选"新建"时要重新建。
    expect(store.getState().draftsByKey[KEY]?.createdMapName).toBeNull();
  });

  it("a draft that only ever continued a map has no map of its own to reuse", () => {
    const store = createDraftLogicMapStore(createMemoryStorage());

    store.getState().turnOnWithExistingMap(KEY, "login");

    expect(store.getState().draftsByKey[KEY]).toEqual({
      mapName: "login",
      enabled: true,
      createdMapName: null,
    });
  });

  it("keeps drafts on different hosts apart", () => {
    const store = createDraftLogicMapStore(createMemoryStorage());
    store
      .getState()
      .turnOnWithNewMap(buildDraftLogicMapKey({ serverId: "a", draftTabId: "t" }), "untitled-1");

    expect(
      readDraftLogicMapLabels(store, buildDraftLogicMapKey({ serverId: "b", draftTabId: "t" })),
    ).toBeUndefined();
  });

  it("reads the draft's toggle back after the app restarts", async () => {
    const storage = createMemoryStorage();
    const before = createDraftLogicMapStore(storage);
    before.getState().turnOnWithNewMap(KEY, "untitled-1a2b3c4d");
    before.getState().turnOnWithNewMap("server-1:draft-tab-2", "untitled-5e6f7a8b");
    before.getState().setEnabled("server-1:draft-tab-2", false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = createDraftLogicMapStore(storage);
    await after.persist.rehydrate();

    expect(readDraftLogicMapLabels(after, KEY)).toEqual({
      [LOGIC_MAP_LABEL]: "untitled-1a2b3c4d",
    });
    expect(after.getState().draftsByKey["server-1:draft-tab-2"]).toEqual({
      mapName: "untitled-5e6f7a8b",
      enabled: false,
      createdMapName: "untitled-5e6f7a8b",
    });
  });

  it("reads back a draft saved before it remembered its own map, with the switch state intact", async () => {
    const storage = createMemoryStorage();
    await storage.setItem(
      "paseo-draft-logic-maps",
      JSON.stringify({
        state: { draftsByKey: { [KEY]: { mapName: "untitled-1a2b3c4d", enabled: true } } },
        version: 1,
      }),
    );

    const store = createDraftLogicMapStore(storage);
    await store.persist.rehydrate();

    expect(readDraftLogicMapLabels(store, KEY)).toEqual({
      [LOGIC_MAP_LABEL]: "untitled-1a2b3c4d",
    });
    expect(store.getState().draftsByKey[KEY]?.createdMapName).toBeUndefined();
  });

  it("forgets the draft once its agent is created", () => {
    const store = createDraftLogicMapStore(createMemoryStorage());
    store.getState().turnOnWithNewMap(KEY, "untitled-1a2b3c4d");

    store.getState().forget(KEY);

    expect(store.getState().draftsByKey[KEY]).toBeUndefined();
  });
});
