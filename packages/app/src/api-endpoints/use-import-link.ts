import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ApiEndpointIconImage,
  ApiEndpointImportLinkPreview,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { DaemonConnectionError, DaemonRpcError } from "@getpaseo/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import { importLinkRefusalOf } from "./internal/import-link";
import { importLinkErrorText, type ImportLinkRefusalCopy } from "./import-link-copy";
import { importDiscoveryQueryKey } from "./use-import-discovery";

export type ImportLinkPreviewState =
  | { status: "loading" }
  // 问不到主机（断了、RPC 失败）：可以重试。
  | { status: "error"; message: string }
  // 主机拒收了这条链接：说为什么（画的时候按界面语言说），只能关掉。
  | ({ status: "refused" } & ImportLinkRefusalCopy)
  | { status: "ready"; preview: ApiEndpointImportLinkPreview };

export type ImportLinkAddResult =
  | { status: "added"; endpointId: string }
  | { status: "failed"; message: string };

/** 确认框里改过的名称与 key。 */
export interface ImportLinkAddInput {
  name: string;
  key: string;
}

export interface UseImportLinkResult {
  preview: ImportLinkPreviewState;
  // 链接 icon= 的图片：主机取到了才有，没取到、还在取为 null（确认框先用默认图标）。
  iconImage: ApiEndpointIconImage | null;
  retry: () => void;
  add: (input: ImportLinkAddInput) => Promise<ImportLinkAddResult>;
}

/**
 * 导入链接的确认框（ADR 0013）：开着时请主机读一遍链接（主机解析、拒收，不存）；点了添加时把链接与改过的名称、key 交给主机，
 * 主机再拒收一遍。加好后刷新接口列表、提示「{name} 已添加」。链接里有 key：结果只在这个窗口开着时留在内存里。
 */
export function useImportLink({
  serverId,
  link,
}: {
  serverId: string;
  link: string;
}): UseImportLinkResult {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: ["api-endpoint-import-link", serverId, link],
    dataShape: "value",
    staleTimeMs: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(client) && isConnected,
    retry: false,
    queryFn: async (): Promise<ImportLinkPreviewState> => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const response = await client.apiEndpointImportLinkPreview(link);
      if (response.error) {
        const reason = importLinkRefusalOf(response.error);
        if (reason === null) throw new Error(importLinkErrorText(t, response.error));
        return { status: "refused", reason, params: response.error.params ?? {} };
      }
      if (response.preview === null) throw new Error(t("settings.apiEndpoints.importLink.failed"));
      return { status: "ready", preview: response.preview };
    },
  });
  const retry = useCallback(() => void query.refetch(), [query]);
  // 图片另外要（照 magpie 确认框打开后再取图标）：确认框不等它。
  const isIconPending = query.data?.status === "ready" && query.data.preview.iconPending === true;
  const iconQuery = useFetchQuery({
    queryKey: ["api-endpoint-import-link-icon", serverId, link],
    dataShape: "value",
    staleTimeMs: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(client) && isConnected && isIconPending,
    retry: false,
    queryFn: async (): Promise<ApiEndpointIconImage | null> => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const response = await client.apiEndpointImportLinkIcon(link);
      return response.iconImage;
    },
  });
  const add = useCallback(
    async (input: ImportLinkAddInput): Promise<ImportLinkAddResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      let response: Awaited<ReturnType<typeof client.apiEndpointImportLink>>;
      try {
        response = await client.apiEndpointImportLink({ link, name: input.name, key: input.key });
      } catch (error) {
        // 连接断了、RPC 失败：留在确认框里说明；别的照常抛出。
        if (!(error instanceof DaemonConnectionError || error instanceof DaemonRpcError))
          throw error;
        return { status: "failed", message: toErrorMessage(error) };
      }
      if (response.error || response.endpoint === null) {
        let message = t("settings.apiEndpoints.importLink.failed");
        if (response.error) message = importLinkErrorText(t, response.error);
        return { status: "failed", message };
      }
      const added = response.endpoint;
      await queryClient.invalidateQueries({ queryKey: ["api-endpoints", serverId] });
      void queryClient.invalidateQueries({ queryKey: importDiscoveryQueryKey(serverId) });
      toast.show(t("settings.apiEndpoints.importLink.added", { name: added.name }), {
        variant: "success",
      });
      return { status: "added", endpointId: added.endpointId };
    },
    [client, link, queryClient, serverId, t, toast],
  );
  let preview: ImportLinkPreviewState = { status: "loading" };
  if (query.data) preview = query.data;
  else if (query.error) preview = { status: "error", message: query.error.message };
  return { preview, iconImage: iconQuery.data ?? null, retry, add };
}
