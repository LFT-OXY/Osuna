import type { ViewStyle } from "react-native";

/**
 * The header row and the data rows are separate components, so their column
 * geometry lives here rather than being written twice and drifting.
 *
 * Settings caps its reading column at 720, and the old widths (220 + 4×92 + 80
 * + 150, plus gaps and padding) came to 898: the source column and the whole
 * actions column sat outside the card, with the scroll indicator suppressed on
 * top of that, so the table looked truncated rather than scrollable. These add
 * up to 678 inside a 686 card. Flexible columns were tried first and do not
 * work here — inside a horizontal scroller the row is sized by its content, so
 * the widest badge and the edit inputs set the width and `flex-shrink` never
 * runs.
 */
export const PRICE_COLUMN_GAP = 6;

/** 101px is the "custom price" button; 116 is save plus cancel. */
const ACTIONS_WIDTH = 120;

export const priceColumns = {
  model: { width: 154, overflow: "hidden" },
  price: { width: 70 },
  // The output column is right-aligned and this one is not, so the padding is
  // what keeps "25" and "LiteLLM" from reading as one value.
  source: { width: 64, paddingLeft: 6 },
  actions: { width: ACTIONS_WIDTH },
} satisfies Record<string, ViewStyle>;
