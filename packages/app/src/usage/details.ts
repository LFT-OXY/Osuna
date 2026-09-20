import type { UsageHostInput } from "./aggregated-usage";
import type { MergedUsageProject } from "./merge";
import { totalUsageTokens } from "./totals";

/**
 * Which hosts the data details card is showing, and how to name them. Every
 * row in the card needs the same four answers, so they travel as one value.
 */
export interface UsageHostsView {
  /** The counted hosts a day's sessions are asked from. */
  hosts: readonly UsageHostInput[];
  /** Host names by id, worn by rows while more than one host is counted. */
  labels: ReadonlyMap<string, string>;
  isMultiHost: boolean;
  timezone: string;
}

/** The three tabs of the data details card, in the order they are shown. */
export const USAGE_DETAILS_TABS = ["daily", "monthly", "projects"] as const;
export type UsageDetailsTab = (typeof USAGE_DETAILS_TABS)[number];

export const USAGE_PROJECT_LIMITS = [3, 6, 10] as const;
export type UsageProjectLimit = (typeof USAGE_PROJECT_LIMITS)[number];

export interface TopUsageProjects {
  projects: MergedUsageProject[];
  /** The largest project's tokens, which every bar is drawn against. */
  maxTokens: number;
}

/**
 * The first `limit` projects of the merged report. Merging already ordered them
 * by tokens across every host, so the cut is taken after the merge — a host's
 * own top three is not the top three.
 */
export function topUsageProjects(
  projects: readonly MergedUsageProject[],
  limit: number,
): TopUsageProjects {
  const top = projects.slice(0, limit);
  return {
    projects: top,
    maxTokens: top.reduce((max, project) => Math.max(max, totalUsageTokens(project.totals)), 0),
  };
}
