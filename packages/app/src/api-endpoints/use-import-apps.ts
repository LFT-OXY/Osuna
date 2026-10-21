import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ApiEndpointError,
  ApiEndpointImportPick,
  ApiEndpointImportSource,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { DaemonConnectionError, DaemonRpcError } from "@getpaseo/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

export type ImportScanState =
  | { status: "loading" }
  | { status: "error"; message: string }
  // updatedAt：这份扫描结果的时刻，变了就重新定默认选择。
  | { status: "ready"; sources: ApiEndpointImportSource[]; updatedAt: number };

export type ImportResult = { status: "imported" } | { status: "failed"; message: string };

/**
 * 导入窗口开着时扫一次别的软件的配置（含 OpenCode）；关了就丢掉结果，下次打开重扫。
 * 导入成功后刷新接口列表并提示加了哪几家（照 magpie 的「Imported {n}: …」）。
 */
export function useImportApps({ serverId, isOpen }: { serverId: string; isOpen: boolean }): {
  scan: ImportScanState;
  retryScan: () => void;
  importPicked: (picks: ApiEndpointImportPick[]) => Promise<ImportResult>;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: ["api-endpoint-import-scan", serverId],
    dataShape: "value",
    staleTimeMs: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: isOpen && Boolean(client) && isConnected,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const response = await client.apiEndpointImportScan({ includeOpenCode: true });
      if (response.error) throw new Error(importErrorText(t, response.error));
      return response.sources;
    },
  });
  const retryScan = useCallback(() => void query.refetch(), [query]);
  const importPicked = useCallback(
    async (picks: ApiEndpointImportPick[]): Promise<ImportResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      let response: Awaited<ReturnType<typeof client.apiEndpointImport>>;
      try {
        response = await client.apiEndpointImport(picks);
      } catch (error) {
        // 连接断了、RPC 失败：留在窗口里说明；别的照常抛出。
        if (!(error instanceof DaemonConnectionError || error instanceof DaemonRpcError))
          throw error;
        return { status: "failed", message: toErrorMessage(error) };
      }
      if (response.error) return { status: "failed", message: importErrorText(t, response.error) };
      await queryClient.invalidateQueries({ queryKey: ["api-endpoints", serverId] });
      const names = response.imported.map((entry) => entry.name).join(", ");
      const message =
        response.imported.length === 0
          ? t("settings.apiEndpoints.import.importedNone")
          : t("settings.apiEndpoints.import.imported", {
              count: response.imported.length,
              names,
            });
      toast.show(message, { variant: "success" });
      return { status: "imported" };
    },
    [client, queryClient, serverId, t, toast],
  );
  let scan: ImportScanState = { status: "loading" };
  if (query.data) scan = { status: "ready", sources: query.data, updatedAt: query.dataUpdatedAt };
  else if (query.error) scan = { status: "error", message: query.error.message };
  return { scan, retryScan, importPicked };
}

/** 主机说的原因按界面语言说；认不出的照主机的英文。 */
function importErrorText(t: TFunction, error: ApiEndpointError): string {
  switch (error.code) {
    case "import_gone":
      return t("settings.apiEndpoints.import.errors.gone");
    case "import_cannot_replace":
      return t("settings.apiEndpoints.import.errors.cannotReplace", {
        name: error.params?.name ?? "",
      });
    default:
      return error.message;
  }
}
