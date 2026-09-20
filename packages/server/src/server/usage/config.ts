import type { UsagePricingOverride } from "@osuna/protocol/usage/types";
import type { UsageLogRoots } from "./log-roots.js";
import type { UsagePricingTimers } from "./pricing/service.js";
import type { PricingTable } from "./pricing/table.js";

/**
 * The daemon's usage section. Every value has an environment-derived default
 * resolved at startup; the section exists so tests can point the scanner at
 * fixture logs and drive its clock.
 */
export interface UsageConfig {
  /** Where each CLI keeps its session logs. Defaults to the real per-CLI paths. */
  roots?: UsageLogRoots;
  /** Overrides the constant and `PASEO_USAGE_SCAN_INTERVAL_MS`. */
  scanIntervalMs?: number;
  /** Clock for bucket-to-local-day resolution, backfill stamps and idle settling. */
  now?: () => number;
  /**
   * Price table wiring, so the usage section stays the single injection point
   * for this feature. `autoUpdate` and `overrides` are the startup values that
   * seed the mutable daemon config; the live ones are read from that config.
   */
  pricing?: {
    autoUpdate?: boolean;
    overrides?: UsagePricingOverride[];
    fetch?: typeof globalThis.fetch;
    /** Drives the refresh schedule in tests without waiting a day. */
    timers?: UsagePricingTimers;
    /**
     * Stands in for the built-in snapshot. A suite that is not about pricing
     * passes an empty table so its numbers do not move when the snapshot is
     * refreshed for a release.
     */
    snapshot?: PricingTable;
  };
}

/** The price settings as the usage service reads them, live, every time. */
export interface UsagePricingSettings {
  autoUpdate: boolean;
  overrides: readonly UsagePricingOverride[];
}

/**
 * The daemon config owns these two while the daemon runs. The section is
 * optional on the wire, so a config from a daemon that predates it resolves to
 * the same defaults a fresh one writes.
 */
export function resolveUsagePricingSettings(
  pricing: { autoUpdate?: boolean; overrides?: readonly UsagePricingOverride[] } | undefined,
): UsagePricingSettings {
  return { autoUpdate: pricing?.autoUpdate ?? true, overrides: pricing?.overrides ?? [] };
}
