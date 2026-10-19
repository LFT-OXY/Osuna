import { SPACING } from "@/styles/theme";

/** Shared geometry for menu rows and controls that align with them. */
export const MENU_ITEM_HEIGHT = { xs: 40, md: 30 } as const;

/** A menu row is a chip inset from the surface edge by this much… */
export const MENU_ROW_INSET = SPACING[1];
/** …with this much padding of its own before the label. */
export const MENU_ROW_PADDING = SPACING[2];

/**
 * The rail a bottom sheet's title and content sit on, the same 24 as `AdaptiveModalSheet`'s
 * `SHEET_HORIZONTAL_PADDING_SCALE`. Menu rows in a sheet pad their list by this minus the row's
 * own inset so the label lands on it.
 */
export const SHEET_CONTENT_INSET = SPACING[6];
