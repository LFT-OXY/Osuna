import { describe, expect, it } from "vitest";

import {
  getAutocompleteFallbackIndex,
  getAutocompleteGroup,
  getAutocompleteNextIndex,
  getAutocompleteScrollOffset,
  hasSelectableAutocompleteOption,
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

  it("puts agents above files and keeps the given order inside each group", () => {
    const options = [
      { id: "src", kind: "directory" },
      { id: "claude", kind: "agent" },
      { id: "a.ts", kind: "file" },
      { id: "codex", kind: "agent" },
    ];
    expect(orderAutocompleteGroups(options).map((option) => option.id)).toEqual([
      "claude",
      "codex",
      "src",
      "a.ts",
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

describe("getAutocompleteGroup", () => {
  it("groups the @ list into agents and files", () => {
    expect(getAutocompleteGroup("agent")).toBe("agents");
    expect(getAutocompleteGroup("file")).toBe("files");
    expect(getAutocompleteGroup("directory")).toBe("files");
  });
});

const enabled = { disabled: false };
const disabled = { disabled: true };

describe("getAutocompleteFallbackIndex", () => {
  it("picks the top item", () => {
    expect(getAutocompleteFallbackIndex([enabled, enabled, enabled])).toBe(0);
    expect(getAutocompleteFallbackIndex([])).toBe(-1);
  });

  it("picks the first row that can be selected", () => {
    expect(getAutocompleteFallbackIndex([disabled, disabled, enabled])).toBe(2);
    expect(getAutocompleteFallbackIndex([disabled, disabled])).toBe(-1);
  });
});

describe("getAutocompleteNextIndex", () => {
  const options = [disabled, enabled, disabled, enabled];

  it("steps over rows that cannot be selected, wrapping at both ends", () => {
    expect(getAutocompleteNextIndex({ currentIndex: 1, options, key: "ArrowDown" })).toBe(3);
    expect(getAutocompleteNextIndex({ currentIndex: 3, options, key: "ArrowDown" })).toBe(1);
    expect(getAutocompleteNextIndex({ currentIndex: 1, options, key: "ArrowUp" })).toBe(3);
    expect(getAutocompleteNextIndex({ currentIndex: -1, options, key: "ArrowDown" })).toBe(1);
    expect(getAutocompleteNextIndex({ currentIndex: -1, options, key: "ArrowUp" })).toBe(3);
  });

  it("has nowhere to go when no row can be selected", () => {
    expect(
      getAutocompleteNextIndex({ currentIndex: -1, options: [disabled], key: "ArrowDown" }),
    ).toBe(-1);
  });
});

describe("hasSelectableAutocompleteOption", () => {
  it("is false for an empty list and for a list of rows that cannot be selected", () => {
    expect(hasSelectableAutocompleteOption([])).toBe(false);
    expect(hasSelectableAutocompleteOption([disabled])).toBe(false);
    expect(hasSelectableAutocompleteOption([disabled, enabled])).toBe(true);
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

  it("keeps the active item above the bottom fade when scrolling down", () => {
    expect(
      getAutocompleteScrollOffset({
        currentOffset: 0,
        viewportHeight: 100,
        bottomInset: 16,
        itemTop: 150,
        itemHeight: 24,
      }),
    ).toBe(90);
  });

  it("treats an item under the bottom fade as out of view", () => {
    expect(
      getAutocompleteScrollOffset({
        currentOffset: 0,
        viewportHeight: 100,
        bottomInset: 16,
        itemTop: 70,
        itemHeight: 24,
      }),
    ).toBe(10);
  });
});
