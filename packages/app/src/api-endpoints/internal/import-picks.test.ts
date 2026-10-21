import { describe, expect, it } from "vitest";
import type {
  ApiEndpointImportItem,
  ApiEndpointImportSource,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  choosePick,
  importChoices,
  importRequests,
  initialImportPicks,
  pickedCount,
  renamePick,
  setSourcePicks,
  sourcePickState,
} from "./import-picks";

function item(overrides: Partial<ApiEndpointImportItem>): ApiEndpointImportItem {
  return {
    fingerprint: "f",
    ref: "r",
    from: null,
    name: "Relay",
    baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
    maskedKey: "sk-r…1234",
    models: [],
    templateId: null,
    status: "new",
    existingEndpointId: null,
    existingName: null,
    skip: null,
    off: null,
    ...overrides,
  };
}

function source(items: ApiEndpointImportItem[]): ApiEndpointImportSource {
  return {
    id: "cc-switch",
    name: "CC Switch",
    path: "~/.cc-switch/cc-switch.db",
    found: true,
    error: null,
    items,
  };
}

const sources = [
  source([
    item({ fingerprint: "new" }),
    item({ fingerprint: "other", status: "other_key", existingName: "Relay One" }),
    item({ fingerprint: "taken", name: "Mine", status: "name_taken", existingName: "Mine" }),
    item({ fingerprint: "off", off: "turned_off" }),
    item({
      fingerprint: "takenOther",
      name: "Shared",
      status: "name_taken",
      existingName: "Shared",
      otherKeyName: "Shared",
    }),
    item({ fingerprint: "added", status: "added" }),
    item({ fingerprint: "skip", skip: "sign_in" }),
    item({ fingerprint: "future", status: "something_new" }),
  ]),
];

describe("import picks", () => {
  it("picks new and same-vendor entries by default, a name in use that is also the same vendor too; a name in use alone or one turned off waits for the user", () => {
    const picks = initialImportPicks(sources);
    expect(Object.keys(picks)).toEqual(["new", "other", "taken", "off", "takenOther"]);
    expect(Object.entries(picks).map(([key, pick]) => [key, pick.on, pick.choice])).toEqual([
      ["new", true, "add"],
      ["other", true, "add"],
      ["taken", false, "add"],
      ["off", false, "add"],
      ["takenOther", true, "add"],
    ]);
    expect(pickedCount(picks)).toBe(3);
  });

  it("a name in use can keep both or replace; renaming drops replace and picks the entry", () => {
    const taken = sources[0]?.items[2];
    const picks = initialImportPicks(sources);
    const pick = picks.taken;
    if (!taken || !pick) throw new Error("fixture");
    expect(importChoices(taken, pick)).toEqual(["add", "replace"]);
    const replacing = choosePick(pick, "replace");
    expect(replacing).toEqual({ on: true, choice: "replace", name: "Mine" });
    const renamed = renamePick({ item: taken, pick: { ...replacing, on: false }, name: "Mine 2" });
    expect(renamed).toEqual({ on: true, choice: "add", name: "Mine 2" });
    expect(importChoices(taken, renamed)).toEqual(["add"]);
    // 改回原名：又能替换。
    expect(importChoices(taken, renamePick({ item: taken, pick: renamed, name: "Mine" }))).toEqual([
      "add",
      "replace",
    ]);
  });

  it("sends add, replace and rename for the picked entries only", () => {
    const taken = sources[0]?.items[2];
    if (!taken) throw new Error("fixture");
    let picks = initialImportPicks(sources);
    picks = { ...picks, taken: renamePick({ item: taken, pick: picks.taken!, name: "  Mine 2 " }) };
    expect(importRequests({ sources, picks })).toEqual([
      { fingerprint: "new", action: "add" },
      { fingerprint: "other", action: "add" },
      { fingerprint: "taken", action: "rename", name: "Mine 2" },
      { fingerprint: "takenOther", action: "add" },
    ]);
    picks = { ...picks, taken: choosePick({ ...picks.taken!, name: "Mine" }, "replace") };
    expect(importRequests({ sources, picks })).toContainEqual({
      fingerprint: "taken",
      action: "replace",
    });
  });

  it("select all turns every pickable entry of a source on or off", () => {
    const only = sources[0]!;
    const all = setSourcePicks({ source: only, picks: initialImportPicks(sources), on: true });
    expect(sourcePickState({ source: only, picks: all })).toEqual({ pickable: 5, on: 5 });
    const none = setSourcePicks({ source: only, picks: all, on: false });
    expect(sourcePickState({ source: only, picks: none })).toEqual({ pickable: 5, on: 0 });
  });
});
