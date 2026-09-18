import type { UsageLogRoots } from "./log-roots.js";

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
   * for this feature.
   */
  pricing?: {
    autoUpdate?: boolean;
    fetch?: typeof globalThis.fetch;
  };
}
