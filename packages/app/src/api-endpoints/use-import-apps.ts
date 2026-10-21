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

// failedFingerprint：出错的那一条（窗口在它下面说原因）；整个请求失败时为 null。
export type ImportResult =
  | { status: "imported" }
  | { status: "failed"; message: string; failedFingerprint: string | null };

/**
 * 导入窗口挂着时扫一次别的软件的配置（含 OpenCode）；关了就丢掉结果，下次打开重扫。
 * 加好了几家就刷新接口列表并提示是哪几家（照 magpie 的「Imported {n}: …」）；daemon 一条一条地加，
 * 中途有一条不成时前面的留着，重扫一遍让它们显示为已添加，窗口留着说哪一条为什么没成。
 */
export function useImportApps({ serverId }: { serverId: string }): {
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
    enabled: Boolean(client) && isConnected,
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
      if (!client) {
        const message = t("workspace.terminal.hostDisconnected");
        return { status: "failed", message, failedFingerprint: null };
      }
      let response: Awaited<ReturnType<typeof client.apiEndpointImport>>;
      try {
        response = await client.apiEndpointImport(picks);
      } catch (error) {
        // 连接断了、RPC 失败：留在窗口里说明；别的照常抛出。
        if (!(error instanceof DaemonConnectionError || error instanceof DaemonRpcError))
          throw error;
        return { status: "failed", message: toErrorMessage(error), failedFingerprint: null };
      }
      const hasImported = response.imported.length > 0;
      if (hasImported) {
        await queryClient.invalidateQueries({ queryKey: ["api-endpoints", serverId] });
        const names = response.imported.map((entry) => entry.name).join(", ");
        const count = response.imported.length;
        toast.show(t("settings.apiEndpoints.import.imported", { count, names }), {
          variant: "success",
        });
      }
      if (response.error) {
        // 加好了几家（让它们显示为已添加），或扫描结果过时了：重扫一遍。
        const isStale = response.error.code === "import_gone";
        if (hasImported || isStale) void query.refetch();
        const failed = response.failed ?? null;
        const reason = importErrorText(t, response.error);
        let message = reason;
        if (failed !== null) {
          message = t("settings.apiEndpoints.import.failedItem", { name: failed.name, reason });
        }
        return { status: "failed", message, failedFingerprint: failed?.fingerprint ?? null };
      }
      if (!hasImported) {
        toast.show(t("settings.apiEndpoints.import.importedNone"), { variant: "success" });
      }
      return { status: "imported" };
    },
    [client, query, queryClient, serverId, t, toast],
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
    case "import_failed":
      return t("settings.apiEndpoints.import.errors.failed", {
        reason: error.params?.reason ?? "",
      });
    case "import_cannot_replace":
      return t("settings.apiEndpoints.import.errors.cannotReplace", {
        name: error.params?.name ?? "",
      });
    default:
      return error.message;
  }
}
