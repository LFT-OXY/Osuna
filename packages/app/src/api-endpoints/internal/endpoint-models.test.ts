import { describe, expect, it } from "vitest";
import type { ApiEndpointModel } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  addManualModels,
  typedModelIds,
  buildModelEntries,
  familySelectAllState,
  groupModelEntries,
  keepMappingWithin,
  setFamilySelected,
  setModelSelected,
  type ModelSource,
} from "./endpoint-models";

const ids = (models: ApiEndpointModel[]) => models.map((model) => model.id);

function source(input: Partial<ModelSource> = {}): ModelSource {
  return {
    models: [],
    catalog: { fetchedAt: "2026-10-14T08:00:00.000Z", models: [] },
    manualModels: [],
    ...input,
  };
}

describe("buildModelEntries", () => {
  it("starts every fetched model off", () => {
    const entries = buildModelEntries(
      source({ catalog: { fetchedAt: "t", models: [{ id: "gpt-5" }, { id: "claude-opus-4" }] } }),
    );

    expect(entries.map((entry) => [entry.id, entry.selected])).toEqual([
      ["gpt-5", false],
      ["claude-opus-4", false],
    ]);
  });

  it("keeps selected and hand-added models, and marks selected ones the upstream no longer lists", () => {
    const entries = buildModelEntries(
      source({
        models: [{ id: "gpt-5" }, { id: "gpt-4o" }, { id: "hidden" }],
        catalog: { fetchedAt: "t", models: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] },
        manualModels: [{ id: "hidden" }, { id: "off-by-hand" }],
      }),
    );

    expect(
      entries.map((entry) => [entry.id, entry.selected, entry.manual, entry.goneUpstream]),
    ).toEqual([
      ["gpt-5", true, false, false],
      ["gpt-5-mini", false, false, false],
      ["hidden", true, true, false],
      ["off-by-hand", false, true, false],
      ["gpt-4o", true, false, true],
    ]);
  });

  it("marks nothing as gone before anything has been fetched", () => {
    const entries = buildModelEntries(source({ models: [{ id: "gpt-5" }], catalog: null }));

    expect(entries.map((entry) => [entry.id, entry.goneUpstream])).toEqual([["gpt-5", false]]);
  });
});

describe("groupModelEntries", () => {
  const entries = buildModelEntries(
    source({
      models: [{ id: "claude-opus-4" }],
      catalog: {
        fetchedAt: "t",
        models: [
          { id: "llama-3" },
          { id: "gpt-5" },
          { id: "claude-opus-4" },
          { id: "claude-haiku-4-5" },
          { id: "gpt-5-mini" },
        ],
      },
    }),
  );

  it("groups by family in the fixed order with selected and total counts", () => {
    const groups = groupModelEntries(entries, "");

    expect(
      groups.map((group) => [group.family, group.selected, group.total, ids(group.matches)]),
    ).toEqual([
      ["claude", 1, 2, ["claude-opus-4", "claude-haiku-4-5"]],
      ["gpt", 0, 2, ["gpt-5", "gpt-5-mini"]],
      ["other", 0, 1, ["llama-3"]],
    ]);
  });

  it("a search keeps only families with a match, and their counts stay the same", () => {
    const groups = groupModelEntries(entries, " MINI ");

    expect(
      groups.map((group) => [group.family, group.selected, group.total, ids(group.matches)]),
    ).toEqual([["gpt", 0, 2, ["gpt-5-mini"]]]);
  });

  it("finds nothing for a search that matches no model", () => {
    expect(groupModelEntries(entries, "nope")).toEqual([]);
  });
});

describe("selecting models", () => {
  const entries = buildModelEntries(
    source({
      models: [{ id: "claude-opus-4" }],
      catalog: {
        fetchedAt: "t",
        models: [
          { id: "claude-opus-4" },
          { id: "claude-haiku-4-5", label: "Haiku" },
          { id: "gpt-5" },
        ],
      },
    }),
  );
  const [claude] = groupModelEntries(entries, "");
  if (!claude) throw new Error("Expected the Claude group");

  it("a switch adds or removes one model", () => {
    const on = setModelSelected({
      models: [{ id: "claude-opus-4" }],
      entry: entries[1]!,
      selected: true,
    });
    expect(on).toEqual([{ id: "claude-opus-4" }, { id: "claude-haiku-4-5", label: "Haiku" }]);
    expect(setModelSelected({ models: on, entry: entries[0]!, selected: false })).toEqual([
      { id: "claude-haiku-4-5", label: "Haiku" },
    ]);
  });

  it("select all turns the family's shown models on, then select none turns them off", () => {
    expect(familySelectAllState(claude)).toBe("selectAll");

    const all = setFamilySelected({
      models: [{ id: "claude-opus-4" }, { id: "gpt-5" }],
      group: claude,
      selected: true,
    });
    expect(ids(all)).toEqual(["claude-opus-4", "gpt-5", "claude-haiku-4-5"]);

    const [allClaude] = groupModelEntries(
      buildModelEntries(source({ models: all, catalog: { fetchedAt: "t", models: [] } })),
      "",
    );
    expect(familySelectAllState(allClaude!)).toBe("selectNone");
    expect(ids(setFamilySelected({ models: all, group: allClaude!, selected: false }))).toEqual([
      "gpt-5",
    ]);
  });

  it("adding models by hand keeps them as hand-added and turns them on", () => {
    const added = addManualModels({ models: [{ id: "gpt-5" }], manualModels: [{ id: "old" }] }, [
      "secret-1",
      "gpt-5",
      "old",
    ]);

    expect(added).toEqual({
      models: [{ id: "gpt-5" }, { id: "secret-1" }, { id: "old" }],
      manualModels: [{ id: "old" }, { id: "secret-1" }, { id: "gpt-5" }],
    });
  });

  it("the add box takes several ids split at commas and line breaks, a space kept inside an id", () => {
    expect(typedModelIds(" kimi-k2, glm-5 ,\nOpus 5.5,, kimi-k2 ")).toEqual([
      "kimi-k2",
      "glm-5",
      "Opus 5.5",
    ]);
    expect(typedModelIds(" , ")).toEqual([]);
  });

  it("a mapping keeps only tiers that point at a selected model", () => {
    expect(
      keepMappingWithin({ opus: "claude-opus-4", haiku: "claude-haiku-4-5" }, [
        { id: "claude-opus-4" },
      ]),
    ).toEqual({ opus: "claude-opus-4" });
    expect(keepMappingWithin({ haiku: "claude-haiku-4-5" }, [])).toBeUndefined();
  });
});
