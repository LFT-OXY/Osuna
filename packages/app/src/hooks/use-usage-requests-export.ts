import type { UsageRequestFilters } from "@getpaseo/protocol/usage/types";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { UsageHostInput } from "@/usage-stats/aggregated-usage";
import { resolveUsageNow, type UsageRange } from "@/usage-stats/period";
import {
  fetchUsageRequestsCsv,
  usageRequestsCsvFileName,
  type UsageRequestsExportSkip,
} from "@/usage-stats/requests-export";
import { toErrorMessage } from "@/utils/error-messages";
import { saveTextFile } from "@/utils/save-text-file";

export interface UseUsageRequestsExportInput {
  hosts: readonly UsageHostInput[];
  range: UsageRange;
  timezone: string;
  filters: UsageRequestFilters;
}

/** Why nothing was saved: no host answered, or saving the file failed. */
export type UsageRequestsExportFailure =
  | { kind: "hosts"; skipped: UsageRequestsExportSkip[] }
  | { kind: "save"; message: string };

export type UsageRequestsExportState =
  | { status: "idle" }
  | { status: "exporting" }
  | { status: "failed"; failure: UsageRequestsExportFailure }
  /** Saved, without the rows of the hosts listed. */
  | { status: "partial"; skipped: UsageRequestsExportSkip[] };

/** No host answered the export; carries each host and why. */
class UsageRequestsNoHostError extends Error {
  constructor(readonly skipped: UsageRequestsExportSkip[]) {
    super("No host could export requests");
    this.name = "UsageRequestsNoHostError";
  }
}

export interface UsageRequestsExport {
  state: UsageRequestsExportState;
  /** Exports again with the filters on screen now; also the Retry. */
  start: () => void;
  dismiss: () => void;
}

/**
 * The Requests tab's Export CSV: every request the filters keep on the hosts
 * that answer, saved through the platform (save dialog, download, or share
 * sheet). A failure, or the hosts a saved file leaves out, stays until the user
 * dismisses it or exports again; a whole export says nothing.
 */
export function useUsageRequestsExport(input: UseUsageRequestsExportInput): UsageRequestsExport {
  const { hosts, range, timezone, filters } = input;
  const mutation = useMutation({
    mutationFn: async (): Promise<UsageRequestsExportSkip[]> => {
      const result = await fetchUsageRequestsCsv({
        hosts,
        runtime: getHostRuntimeStore(),
        range,
        timezone,
        filters,
      });
      if (result.status === "none") throw new UsageRequestsNoHostError(result.skipped);
      await saveTextFile({
        fileName: usageRequestsCsvFileName(range, resolveUsageNow(timezone).day),
        contents: result.csv,
        mimeType: "text/csv",
        uti: "public.comma-separated-values-text",
        filterName: "CSV",
        extension: "csv",
      });
      return result.skipped;
    },
  });
  const { mutate, reset, isPending, error, data } = mutation;
  const start = useCallback(() => mutate(), [mutate]);
  return useMemo(() => {
    let state: UsageRequestsExportState = { status: "idle" };
    if (isPending) state = { status: "exporting" };
    else if (error instanceof UsageRequestsNoHostError) {
      state = { status: "failed", failure: { kind: "hosts", skipped: error.skipped } };
    } else if (error) {
      state = { status: "failed", failure: { kind: "save", message: toErrorMessage(error) } };
    } else if (data && data.length > 0) state = { status: "partial", skipped: data };
    return { state, start, dismiss: reset };
  }, [isPending, error, data, start, reset]);
}
