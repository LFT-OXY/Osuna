import type { TFunction } from "i18next";
import { classifyCheck, type CheckPresentation } from "@/git/check-presentation";
import type { PrPaneCheck } from "./data";

/**
 * The order the checks section reads in: what the user can act on, then what they are
 * waiting on, then what needs no attention. Skipped trails everything because it is the
 * only status that says nothing about whether the run is going well.
 */
export const PRESENTATION_ORDER = [
  "actionRequired",
  "warning",
  "failure",
  "pending",
  "manual",
  "success",
  "ignored",
] as const satisfies readonly CheckPresentation[];

/** The worst thing happening in the run, which is what the headline and the ring report. */
export type ChecksOutcome = "actionRequired" | "failure" | "pending" | "success" | "none";

export interface ChecksCountPart {
  status: CheckPresentation;
  count: number;
}

export interface ChecksGroup {
  status: CheckPresentation;
  count: number;
  checks: readonly PrPaneCheck[];
}

export interface ChecksSummary {
  outcome: ChecksOutcome;
  /** One count per non-empty status, in `PRESENTATION_ORDER`. */
  parts: readonly ChecksCountPart[];
  total: number;
  /** Non-empty groups only, in `PRESENTATION_ORDER`. */
  groups: readonly ChecksGroup[];
}

/**
 * Reduces a change request's checks to everything the checks section renders, so the
 * header, the ring, and the grouped list all read from one derivation instead of each
 * filtering the array again with its own idea of what counts.
 */
export function summarizeChecks(checks: readonly PrPaneCheck[]): ChecksSummary {
  const groups: ChecksGroup[] = [];
  const parts: ChecksCountPart[] = [];

  for (const status of PRESENTATION_ORDER) {
    const matching = checks.filter((check) => classifyCheck(check) === status);
    if (matching.length === 0) {
      continue;
    }
    groups.push({ status, count: matching.length, checks: matching });
    parts.push({ status, count: matching.length });
  }

  return {
    outcome: selectOutcome(checks),
    parts,
    total: checks.length,
    groups,
  };
}

const CHECKS_KEY = "workspace.git.pr.checks";

/** The line naming the run's outcome, keyed by `ChecksOutcome`. */
export function formatChecksHeadline(t: TFunction, outcome: ChecksOutcome): string {
  return t(`${CHECKS_KEY}.headline.${outcome}`);
}

/**
 * The count line, e.g. "2 failing, 4 in progress, 1 successful checks". The noun follows
 * the total, so "check" only for a run of one. Empty with no checks.
 */
export function formatChecksCount(
  t: TFunction,
  parts: readonly ChecksCountPart[],
  total: number,
): string {
  if (parts.length === 0) {
    return "";
  }
  const phrases = parts.map((part) =>
    t(`${CHECKS_KEY}.count.${part.status}`, { count: part.count }),
  );
  return t(total === 1 ? `${CHECKS_KEY}.countLine.one` : `${CHECKS_KEY}.countLine.many`, {
    parts: phrases.join(t(`${CHECKS_KEY}.countSeparator`)),
  });
}

/** e.g. "2 failing checks" */
export function formatChecksGroupLabel(t: TFunction, group: ChecksGroup): string {
  return formatChecksCount(t, [group], group.count);
}

/**
 * A failure outranks anything still running: a run that is half done with one failure
 * already needs the user, and reporting it as in progress buries that.
 */
function selectOutcome(checks: readonly PrPaneCheck[]): ChecksOutcome {
  if (checks.length === 0) {
    return "none";
  }
  if (checks.some((check) => classifyCheck(check) === "actionRequired")) {
    return "actionRequired";
  }
  if (
    checks.some((check) => {
      const presentation = classifyCheck(check);
      return presentation === "failure" || presentation === "warning";
    })
  ) {
    return "failure";
  }
  if (checks.some((check) => check.status === "pending")) {
    return "pending";
  }
  return "success";
}
