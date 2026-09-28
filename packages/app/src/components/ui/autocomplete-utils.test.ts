import { describe, expect, it } from "vitest";

import {
  getAutocompleteFallbackIndex,
  getAutocompleteScrollOffset,
  orderAutocompleteGroups,
} from "./autocomplete-utils";

describe("orderAutocompleteGroups", () => {
  it("puts commands above skills and keeps the ranked order inside each group", () => {
    const options = [
      { id: "tdd", kind: "skill" },
      { id: "help", kind: "command" },
      { id: "review", kind: "skill" },
      { id: "compact", kind: "command" },
    ];
    expect(orderAutocompleteGroups(options).map((option) => option.id)).toEqual([
      "help",
      "compact",
      "tdd",
      "review",
    ]);
  });

  it("keeps file and directory entries in their given order", () => {
    const options = [
      { id: "src", kind: "directory" },
      { id: "a.ts", kind: "file" },
      { id: "lib", kind: "directory" },
    ];
    expect(orderAutocompleteGroups(options).map((option) => option.id)).toEqual([
      "src",
      "a.ts",
      "lib",
    ]);
  });
});

describe("getAutocompleteFallbackIndex", () => {
  it("picks the top item", () => {
    expect(getAutocompleteFallbackIndex(3)).toBe(0);
    expect(getAutocompleteFallbackIndex(0)).toBe(-1);
  });
});

describe("getAutocompleteScrollOffset", () => {
  it("scrolls up when the active item is above the viewport", () => {
    expect(
      getAutocompleteScrollOffset({
        currentOffset: 120,
        viewportHeight: 80,
        itemTop: 90,
        itemHeight: 20,
      }),
    ).toBe(90);
  });

  it("scrolls down when the active item is below the viewport", () => {
    expect(
      getAutocompleteScrollOffset({
        currentOffset: 0,
        viewportHeight: 100,
        itemTop: 150,
        itemHeight: 24,
      }),
    ).toBe(74);
  });
});
