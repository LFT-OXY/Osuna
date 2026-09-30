import { describe, expect, it } from "vitest";
import { EMPTY_PRICE_DRAFT } from "./pricing";
import {
  INITIAL_PRICE_ROWS,
  priceRowsReducer,
  resolveRowWriteState,
  type PriceRowsAction,
  type PriceRowsState,
} from "./price-rows";

const PRICE = { input: 15, cachedInput: 1.5, cacheWrite: 18.75, output: 75 };

function run(...actions: PriceRowsAction[]): PriceRowsState {
  return actions.reduce(priceRowsReducer, INITIAL_PRICE_ROWS);
}

describe("editing a row of the price table", () => {
  it("opens the editor seeded with the price the row already has", () => {
    const state = run({ type: "editOpened", model: "gpt-5.5", price: PRICE });
    expect(state.drafts["gpt-5.5"]).toEqual({
      input: "15",
      cachedInput: "1.5",
      cacheWrite: "18.75",
      output: "75",
    });
  });

  it("keeps what was typed, starting an unpriced row from four empty cells", () => {
    const state = run({ type: "fieldChanged", model: "glm-5", field: "output", value: "2" });
    expect(state.drafts["glm-5"]).toEqual({ ...EMPTY_PRICE_DRAFT, output: "2" });
  });

  it("drops the draft on cancel and reseeds the inputs", () => {
    const state = run(
      { type: "editOpened", model: "gpt-5.5", price: PRICE },
      { type: "cancelled", model: "gpt-5.5" },
    );
    expect(state.drafts).toEqual({});
    expect(state.draftToken).toBe(INITIAL_PRICE_ROWS.draftToken + 1);
  });

  it("clears the row's error when the editor opens again", () => {
    const state = run(
      { type: "writeFailed", model: "gpt-5.5", message: "Could not remove this custom price." },
      { type: "editOpened", model: "gpt-5.5", price: PRICE },
    );
    expect(state.error).toBeNull();
  });
});

describe("writing the override list back", () => {
  it("flags the cells of a draft that does not parse, without starting a write", () => {
    const state = run({ type: "draftRejected", model: "glm-5", message: "Enter a number" });
    expect(state.error).toEqual({ model: "glm-5", message: "Enter a number", invalid: true });
    expect(state.writingModel).toBeNull();
  });

  it("marks the row being written and clears an earlier error", () => {
    const state = run(
      { type: "draftRejected", model: "glm-5", message: "Enter a number" },
      { type: "writeStarted", model: "glm-5" },
    );
    expect(state.writingModel).toBe("glm-5");
    expect(state.error).toBeNull();
  });

  it("closes the editor once a save lands", () => {
    const state = run(
      { type: "fieldChanged", model: "glm-5", field: "input", value: "1" },
      { type: "writeStarted", model: "glm-5" },
      { type: "saved", model: "glm-5" },
    );
    expect(state.writingModel).toBeNull();
    expect(state.drafts).toEqual({});
    expect(state.draftToken).toBe(INITIAL_PRICE_ROWS.draftToken + 1);
  });

  it("leaves other rows' drafts alone when a removal lands", () => {
    const state = run(
      { type: "fieldChanged", model: "glm-5", field: "input", value: "1" },
      { type: "writeStarted", model: "gpt-5.5" },
      { type: "removed", model: "gpt-5.5" },
    );
    expect(state.writingModel).toBeNull();
    expect(state.drafts["glm-5"]?.input).toBe("1");
    expect(state.draftToken).toBe(INITIAL_PRICE_ROWS.draftToken);
  });

  it("keeps the draft and names the failure on the row when a write is refused", () => {
    const state = run(
      { type: "fieldChanged", model: "glm-5", field: "input", value: "1" },
      { type: "writeStarted", model: "glm-5" },
      { type: "writeFailed", model: "glm-5", message: "Could not save this price." },
    );
    expect(state.writingModel).toBeNull();
    expect(state.drafts["glm-5"]?.input).toBe("1");
    // daemon 拒绝时四格都填对了，不标格子。
    expect(state.error).toEqual({
      model: "glm-5",
      message: "Could not save this price.",
      invalid: false,
    });
  });
});

describe("one write at a time", () => {
  it("lets every row write while nothing is in flight", () => {
    expect(resolveRowWriteState(null, "glm-5")).toBe("idle");
  });

  it("shows the row being written as writing and locks the others", () => {
    expect(resolveRowWriteState("glm-5", "glm-5")).toBe("writing");
    expect(resolveRowWriteState("glm-5", "gpt-5.5")).toBe("locked");
  });
});
