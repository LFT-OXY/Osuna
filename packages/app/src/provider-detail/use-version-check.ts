import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProviderVersionCheckResult } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { providerVersionCheckQueryInputs, recheckProviderVersions } from "./version-check";

// 内置提供方有没有新版本。只有 Providers 页用 checkOnMount 发起检查；列表、详情和刷新按钮只读结果或强制重查。
export function useProviderVersionCheck(
  serverId: string,
  options: { checkOnMount: boolean },
): {
  results: ProviderVersionCheckResult[] | undefined;
  recheck: (providers: string[]) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(providerVersions): added in v0.14.0, remove gate after 2027-04-01.
  const supportsProviderVersions = useHostFeature(serverId, "providerVersions");
  const checkClient = isConnected && supportsProviderVersions ? client : null;

  const query = useFetchQuery(
    providerVersionCheckQueryInputs({
      client: checkClient,
      serverId,
      enabled: options.checkOnMount,
    }),
  );

  const recheck = useCallback(
    async (providers: string[]) => {
      if (!checkClient) return;
      await recheckProviderVersions({ client: checkClient, queryClient, serverId, providers });
    },
    [checkClient, queryClient, serverId],
  );

  return { results: checkClient ? query.data : undefined, recheck };
}
