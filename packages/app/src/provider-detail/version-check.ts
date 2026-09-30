import type { QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ProviderVersionCheckResult } from "@getpaseo/protocol/messages";

export type ProviderVersionCheckClient = Pick<DaemonClient, "checkProviderVersions">;

export function providerVersionCheckQueryKey(serverId: string) {
  return ["providerVersionCheck", serverId] as const;
}

/**
 * Providers 页的检查：每次打开都问 daemon（staleTime 0），daemon 在内存里缓存 npm 的结果 1 小时，
 * 所以回到页面不会重复联网。列表和详情用 enabled: false 的观察者只读结果。
 */
export function providerVersionCheckQueryInputs(input: {
  client: ProviderVersionCheckClient | null;
  serverId: string;
  enabled: boolean;
}) {
  const { client } = input;
  return {
    queryKey: providerVersionCheckQueryKey(input.serverId),
    dataShape: "value" as const,
    staleTimeMs: 0,
    enabled: input.enabled && client !== null,
    queryFn: async (): Promise<ProviderVersionCheckResult[]> => {
      if (!client) throw new Error("Host is not connected");
      const { results } = await client.checkProviderVersions();
      return results;
    },
  };
}

/**
 * 刷新时带 force 重查这几个提供方，其余提供方沿用上次的结果。走 prefetchQuery：
 * 失败只记在查询状态里、保留上次的结果，页面不报错。
 */
export async function recheckProviderVersions(input: {
  client: ProviderVersionCheckClient;
  queryClient: QueryClient;
  serverId: string;
  providers: string[];
}): Promise<void> {
  const queryKey = providerVersionCheckQueryKey(input.serverId);
  const options = {
    queryKey,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const { results } = await input.client.checkProviderVersions({
        providers: input.providers,
        force: true,
      });
      return mergeProviderVersionResults(
        input.queryClient.getQueryData<ProviderVersionCheckResult[]>(queryKey),
        results,
      );
    },
  };
  // 页面的检查还没返回时，prefetch 会并进那次不带 force 的请求；先等它结束，再发自己的。
  if (input.queryClient.isFetching({ queryKey }) > 0) {
    await input.queryClient.prefetchQuery(options);
  }
  await input.queryClient.prefetchQuery(options);
}

/**
 * 这个提供方可显示的新版本，没有时为 null。检查结果针对的已装版本要和快照里的一致：
 * CLI 在检查之后换了版本（自动更新、在终端里升级），旧结果就不再显示。
 */
export function selectNewerVersion(input: {
  provider: string;
  installedVersion: string | undefined;
  results: readonly ProviderVersionCheckResult[] | undefined;
}): string | null {
  if (!input.installedVersion) return null;
  const result = input.results?.find((candidate) => candidate.provider === input.provider);
  if (!result?.updateAvailable || !result.latestVersion) return null;
  if (result.installedVersion !== input.installedVersion) return null;
  return result.latestVersion;
}

export function mergeProviderVersionResults(
  previous: readonly ProviderVersionCheckResult[] | undefined,
  next: readonly ProviderVersionCheckResult[],
): ProviderVersionCheckResult[] {
  const byProvider = new Map(next.map((result) => [result.provider, result]));
  const merged = (previous ?? []).map((result) => byProvider.get(result.provider) ?? result);
  const known = new Set(merged.map((result) => result.provider));
  return [...merged, ...next.filter((result) => !known.has(result.provider))];
}
