import { z } from "zod";

/**
 * The public price file the snapshot and the daily refresh both read. It is the
 * only address this feature ever contacts.
 */
export const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
export const LITELLM_LICENSE_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE";
/** Recorded in `_meta.license` so a copied cache file still names its terms. */
export const LITELLM_LICENSE = "MIT (c) 2023 Berri AI — see the LICENSE file beside the snapshot";

/**
 * Dollars per token, the vendor's own unit. `null` is "this vendor does not
 * charge for that column", which costs the same as zero but is not a price the
 * user set — the distinction only matters when the column is displayed.
 */
export const PRICING_COLUMNS_SCHEMA = z.object({
  input: z.number().nullable(),
  cachedInput: z.number().nullable(),
  cacheWrite: z.number().nullable(),
  output: z.number().nullable(),
});
export type PricingColumns = z.infer<typeof PRICING_COLUMNS_SCHEMA>;

export const PRICING_TABLE_SCHEMA = z.object({
  _meta: z.object({
    source: z.string(),
    fetchedAt: z.string(),
    etag: z.string().nullable(),
    license: z.string(),
  }),
  models: z.record(z.string(), PRICING_COLUMNS_SCHEMA),
});
export type PricingTable = z.infer<typeof PRICING_TABLE_SCHEMA>;

/** The upstream field names for the four columns Osuna keeps. */
const UPSTREAM_COLUMNS = {
  input: "input_cost_per_token",
  cachedInput: "cache_read_input_token_cost",
  cacheWrite: "cache_creation_input_token_cost",
  output: "output_cost_per_token",
} as const;

/** The first entry of the upstream file documents the fields; it is not a model. */
const SPEC_KEY = "sample_spec";

export class PricingTableFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingTableFormatError";
  }
}

/**
 * Keep the four price columns and drop everything else: the upstream file is
 * 2.7 MB of context windows, service tiers and deprecation dates, of which the
 * four columns are a sixth.
 */
export function slimPricingTable(
  raw: unknown,
  meta: { source: string; fetchedAt: string; etag: string | null },
): PricingTable {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PricingTableFormatError("Price table is not a JSON object");
  }

  const models: Record<string, PricingColumns> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (key === SPEC_KEY) continue;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const columns: PricingColumns = {
      input: readColumn(record[UPSTREAM_COLUMNS.input]),
      cachedInput: readColumn(record[UPSTREAM_COLUMNS.cachedInput]),
      cacheWrite: readColumn(record[UPSTREAM_COLUMNS.cacheWrite]),
      output: readColumn(record[UPSTREAM_COLUMNS.output]),
    };
    // An embedding or image model with no token prices is not worth carrying.
    if (Object.values(columns).every((value) => value === null)) continue;
    models[key] = columns;
  }

  if (Object.keys(models).length === 0) {
    throw new PricingTableFormatError("Price table has no priced models");
  }
  return { _meta: { ...meta, license: LITELLM_LICENSE }, models };
}

function readColumn(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const PER_MILLION = 1_000_000;
// 1e-7 * 1e6 is 0.09999999999999999 in binary floating point, and that number
// would be what the price table shows the user.
const PER_MILLION_DECIMALS = 10;

export function toPerMillion(perToken: number): number {
  return Number((perToken * PER_MILLION).toFixed(PER_MILLION_DECIMALS));
}

export function fromPerMillion(perMillion: number): number {
  return perMillion / PER_MILLION;
}
