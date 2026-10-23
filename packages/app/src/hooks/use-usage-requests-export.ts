import type { UsageRequestFilters } from "@getpaseo/protocol/usage/types";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { UsageHostInput } from "@/usage-stats/aggregated-usage";
import { resolveUsageNow, type UsageRange } from "@/usage-stats/period";
import { fetchUsageRequestsCsv, usageRequestsCsvFileName } from "@/usage-stats/requests-export";
import { toErrorMessage } from "@/utils/error-messages";
import { saveTextFile } from "@/utils/save-text-file";

export interface UseUsageRequestsExportInput {
  hosts: readonly UsageHostInput[];
  range: UsageRange;
  timezone: string;
  filters: UsageRequestFilters;
}

export type UsageRequestsExportState =
  | { status: "idle" }
  | { status: "exporting" }
  | { status: "failed"; message: string };

export interface UsageRequestsExport {
  state: UsageRequestsExportState;
  /** Exports again with the filters on screen now; also the Retry. */
  start: () => void;
  dismiss: () => void;
}

/**
 * The Requests tab's Export CSV: every request the filters keep, saved through
 * the platform (save dialog, download, or share sheet). A failure stays until
 * the user retries or dismisses it; success says nothing.
 */
export function useUsageRequestsExport(input: UseUsageRequestsExportInput): UsageRequestsExport {
  const { hosts, range, timezone, filters } = input;
  const mutation = useMutation({
    mutationFn: async () => {
      const csv = await fetchUsageRequestsCsv({
        hosts,
        runtime: getHostRuntimeStore(),
        range,
        timezone,
        filters,
      });
      await saveTextFile({
        fileName: usageRequestsCsvFileName(range, resolveUsageNow(timezone).day),
        contents: csv,
        mimeType: "text/csv",
        uti: "public.comma-separated-values-text",
        filterName: "CSV",
        extension: "csv",
      });
    },
  });
  const { mutate, reset, isPending, error } = mutation;
  const start = useCallback(() => mutate(), [mutate]);
  return useMemo(() => {
    let state: UsageRequestsExportState = { status: "idle" };
    if (isPending) state = { status: "exporting" };
    else if (error) state = { status: "failed", message: toErrorMessage(error) };
    return { state, start, dismiss: reset };
  }, [isPending, error, start, reset]);
}
