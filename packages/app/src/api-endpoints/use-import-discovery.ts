// 发现提示照 magpie（https://github.com/yetone/magpie，7597c132）internal/gui/assets/app.js 的
// discoverLocalProviders、renderProviderDiscovery。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiEndpointImportCandidate } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { DaemonConnectionError, DaemonRpcError } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

export function importDiscoveryQueryKey(serverId: string) {
  return ["api-endpoint-import-discovery", serverId] as const;
}

export type IgnoreState =
  | { status: "idle" }
  | { status: "ignoring" }
  | { status: "failed"; message: string };

export interface ImportDiscovery {
  // 没被忽略、导入窗口会默认选上的那几条；还没问到或问不到时是空的（提示可有可无，不挡手动添加）。
  candidates: readonly ApiEndpointImportCandidate[];
  ignoreState: IgnoreState;
  ignore: () => Promise<void>;
}

const NO_CANDIDATES: readonly ApiEndpointImportCandidate[] = [];

/**
 * 「第三方接口」页每次打开问一次（daemon 一分钟内只真读一次别的软件的文件）；导入之后 use-import-apps 让它重问。
 * 「忽略」把这几条记在主机上，同一批不再提示；失败时留着提示并说原因，再点一次即重试。
 */
export function useImportDiscovery(input: { serverId: string; enabled: boolean }): ImportDiscovery {
  const { serverId } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const [ignoreState, setIgnoreState] = useState<IgnoreState>({ status: "idle" });
  const queryKey = importDiscoveryQueryKey(serverId);
  const query = useFetchQuery({
    queryKey,
    dataShape: "value",
    staleTimeMs: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: input.enabled && Boolean(client) && isConnected,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const response = await client.apiEndpointImportDiscovery();
      if (response.error) throw new Error(response.error.message);
      return response.candidates;
    },
  });
  const candidates = query.data ?? NO_CANDIDATES;
  const ignore = useCallback(async () => {
    if (!client) {
      setIgnoreState({ status: "failed", message: t("workspace.terminal.hostDisconnected") });
      return;
    }
    setIgnoreState({ status: "ignoring" });
    let message: string | null = null;
    try {
      const response = await client.apiEndpointImportIgnore(
        candidates.map((candidate) => candidate.fingerprint),
      );
      if (response.error) message = response.error.message;
    } catch (error) {
      if (!(error instanceof DaemonConnectionError || error instanceof DaemonRpcError)) throw error;
      message = toErrorMessage(error);
    }
    if (message !== null) {
      setIgnoreState({ status: "failed", message });
      return;
    }
    queryClient.setQueryData<readonly ApiEndpointImportCandidate[]>(
      importDiscoveryQueryKey(serverId),
      NO_CANDIDATES,
    );
    setIgnoreState({ status: "idle" });
  }, [candidates, client, queryClient, serverId, t]);
  return { candidates, ignoreState, ignore };
}
