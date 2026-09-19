import type { PricingColumns, PricingTable } from "./table.js";
import { fromPerMillion } from "./table.js";

export type PricingSource = "override" | "table";

/** Dollars per token for the four billed columns; reasoning is never priced. */
export interface PricingRates {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export interface PricingMatch {
  priced: boolean;
  priceSource: PricingSource | null;
  /** The table key the price came from, or the override's model string. */
  matchedKey: string | null;
  rates: PricingRates;
}

export interface PricingOverrideEntry {
  model: string;
  pricePerMillion: PricingRates;
}

const UNPRICED_MATCH: PricingMatch = {
  priced: false,
  priceSource: null,
  matchedKey: null,
  rates: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
};

/**
 * When a bare model id exists behind several gateways the tie-break is a fixed
 * vendor order: the direct vendor first, then the gateways people actually
 * route through. Anything unlisted falls back to the lexicographically smallest
 * key, so the answer does not depend on object key order.
 */
const PROVIDER_PREFERENCE = [
  "anthropic",
  "openai",
  "gemini",
  "deepseek",
  "zai",
  "moonshot",
  "xai",
  "mistral",
  "groq",
  "openrouter",
];

const DATE_SUFFIX = /-\d{8}$/;
const CLAUDE_ID = /^(?:claude-)?(sonnet|opus|haiku)-(\d+(?:[.-]\d+)*)(.*)$/;

/**
 * Lookup structures over one table. Both are rebuilt when the table changes,
 * which happens at most once a day.
 */
export interface PricingIndex {
  /** Lowercase key to the key as the table spells it; 489 keys are mixed case. */
  byLowercase: ReadonlyMap<string, string>;
  /** Prefixed keys grouped by their last path segment. */
  bySuffix: ReadonlyMap<string, string[]>;
}

export function buildPricingIndex(table: PricingTable): PricingIndex {
  const byLowercase = new Map<string, string>();
  const bySuffix = new Map<string, string[]>();
  for (const key of Object.keys(table.models)) {
    const lower = key.toLowerCase();
    if (!byLowercase.has(lower)) byLowercase.set(lower, key);
    const slash = key.lastIndexOf("/");
    if (slash < 0) continue;
    const suffix = lower.slice(slash + 1);
    const bucket = bySuffix.get(suffix);
    if (bucket) bucket.push(key);
    else bySuffix.set(suffix, [key]);
  }
  return { byLowercase, bySuffix };
}

/**
 * The lookup order, first hit wins: user overrides, the id as written, the
 * Claude spelling the table uses, the undated id, then the same steps on the id
 * with its gateway prefix removed, and finally the preferred gateway key.
 */
export function matchModelPrice(
  model: string,
  table: PricingTable,
  overrides: ReadonlyMap<string, PricingOverrideEntry>,
  index: PricingIndex,
): PricingMatch {
  const trimmed = model.trim();
  const override = overrides.get(trimmed.toLowerCase());
  if (override) {
    return {
      priced: true,
      priceSource: "override",
      matchedKey: override.model,
      rates: {
        input: fromPerMillion(override.pricePerMillion.input),
        cachedInput: fromPerMillion(override.pricePerMillion.cachedInput),
        cacheWrite: fromPerMillion(override.pricePerMillion.cacheWrite),
        output: fromPerMillion(override.pricePerMillion.output),
      },
    };
  }

  const direct = lookUp(trimmed, table, index);
  if (direct) return direct;

  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return UNPRICED_MATCH;
  const bare = trimmed.slice(slash + 1);

  const stripped = lookUp(bare, table, index);
  if (stripped) return stripped;

  const candidates = index.bySuffix.get(bare.toLowerCase());
  if (!candidates || candidates.length === 0) return UNPRICED_MATCH;
  return fromKey(preferredKey(candidates), table) ?? UNPRICED_MATCH;
}

/** The id itself, then its Claude and undated spellings, each case-insensitively. */
function lookUp(id: string, table: PricingTable, index: PricingIndex): PricingMatch | null {
  for (const candidate of spellings(id)) {
    const match =
      fromKey(candidate, table) ?? fromKey(index.byLowercase.get(candidate.toLowerCase()), table);
    if (match) return match;
  }
  return null;
}

function fromKey(key: string | undefined, table: PricingTable): PricingMatch | null {
  if (key === undefined) return null;
  const columns = table.models[key];
  return columns ? fromTable(key, columns) : null;
}

function spellings(id: string): string[] {
  const seen = new Set<string>([id]);
  const claude = normalizeClaudeId(id.toLowerCase());
  if (claude) seen.add(claude);
  for (const base of Array.from(seen)) {
    if (DATE_SUFFIX.test(base)) seen.add(base.replace(DATE_SUFFIX, ""));
  }
  return Array.from(seen);
}

/**
 * The table spells Claude versions with dashes on bare keys (`claude-sonnet-4-5`)
 * and dots behind gateways (`openrouter/anthropic/claude-sonnet-4.5`), and Pi
 * backends drop the vendor prefix entirely (`sonnet-4-5`).
 */
function normalizeClaudeId(id: string): string | null {
  const match = CLAUDE_ID.exec(id);
  if (!match) return null;
  const [, family, version, rest] = match;
  const normalized = `claude-${family}-${version.replaceAll(".", "-")}${rest}`;
  return normalized === id ? null : normalized;
}

function preferredKey(candidates: readonly string[]): string {
  for (const provider of PROVIDER_PREFERENCE) {
    const hit = candidates.find((key) => key.slice(0, key.indexOf("/")) === provider);
    if (hit) return hit;
  }
  return candidates.reduce((best, key) => (key < best ? key : best));
}

function fromTable(key: string, columns: PricingColumns): PricingMatch {
  return {
    priced: true,
    priceSource: "table",
    matchedKey: key,
    rates: {
      input: columns.input ?? 0,
      cachedInput: columns.cachedInput ?? 0,
      cacheWrite: columns.cacheWrite ?? 0,
      output: columns.output ?? 0,
    },
  };
}
