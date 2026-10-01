import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQueryOptions } from "@/data/query";
import type { ProviderUsageListPayload } from "./types";
import {
  PROVIDER_USAGE_STALE_TIME_MS,
  providerUsageQueryInput,
  type ProviderUsageClient,
} from "./use-provider-usage";

interface FakeProviderUsageClient extends ProviderUsageClient {
  calls: number;
  /** 让最早一个挂起的请求返回。 */
  resolveNext: (payload: ProviderUsageListPayload) => void;
}

function createClient(): FakeProviderUsageClient {
  const pending: Array<(payload: ProviderUsageListPayload) => void> = [];
  const client: FakeProviderUsageClient = {
    calls: 0,
    listProviderUsage: () => {
      client.calls += 1;
      return new Promise<ProviderUsageListPayload>((resolve) => pending.push(resolve));
    },
    resolveNext: (payload) => {
      const resolve = pending.shift();
      if (!resolve) throw new Error("no pending listProviderUsage request");
      resolve(payload);
    },
  };
  return client;
}

function usagePayload(fetchedAt: string): ProviderUsageListPayload {
  return { requestId: "req", fetchedAt, providers: [] };
}

interface ObserverFlags {
  enabled: boolean;
  autoRefresh: boolean;
}

describe("the shared plan usage query", () => {
  let queryClient: QueryClient;
  const unsubscribes: Array<() => void> = [];

  // 与 app 的 query client 相同的默认值：数据不按时间过期，聚焦和重连都不重取。
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          refetchOnMount: false,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
        },
      },
    });
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    queryClient.clear();
    vi.useRealTimers();
  });

  function observe(client: FakeProviderUsageClient, flags: ObserverFlags) {
    const options = (next: ObserverFlags) =>
      fetchQueryOptions(providerUsageQueryInput({ serverId: "server-1", client, ...next }));
    const observer = new QueryObserver(queryClient, options(flags));
    unsubscribes.push(observer.subscribe(() => {}));
    return {
      observer,
      setFlags: (next: ObserverFlags) => observer.setOptions(options(next)),
    };
  }

  // Node 里没有 window，TanStack 按服务端处理（`isServer`），refetchInterval 不会起定时器；
  // 所以刷新周期读观察者实际拿到的选项，取数时机用请求次数和 fetchStatus 断言。
  it("fetches once when the strip mounts and polls every five minutes", () => {
    const client = createClient();
    const strip = observe(client, { enabled: true, autoRefresh: true });

    expect(client.calls).toBe(1);
    expect(strip.observer.options.refetchInterval).toBe(5 * 60 * 1000);
  });

  it("neither fetches nor polls while the strip cannot show it", () => {
    const client = createClient();
    const strip = observe(client, { enabled: false, autoRefresh: true });

    expect(strip.observer.getCurrentResult().fetchStatus).toBe("idle");
    expect(client.calls).toBe(0);
    expect(strip.observer.options.refetchInterval).toBe(false);
  });

  it("refetches when the strip comes back after the data went stale", async () => {
    const client = createClient();
    const strip = observe(client, { enabled: true, autoRefresh: true });
    client.resolveNext(usagePayload("2026-10-01T10:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(0);

    strip.setFlags({ enabled: false, autoRefresh: true });
    strip.setFlags({ enabled: true, autoRefresh: true });
    expect(client.calls).toBe(1);

    strip.setFlags({ enabled: false, autoRefresh: true });
    vi.setSystemTime(Date.now() + PROVIDER_USAGE_STALE_TIME_MS + 1);
    strip.setFlags({ enabled: true, autoRefresh: true });
    expect(client.calls).toBe(2);
  });

  it("leaves the context popover's observer without polling", () => {
    const client = createClient();
    const popover = observe(client, { enabled: true, autoRefresh: false });

    expect(client.calls).toBe(1);
    expect(popover.observer.options.refetchInterval).toBe(false);
  });

  it("hands what the strip fetched to the popover without a second copy", async () => {
    const client = createClient();
    observe(client, { enabled: true, autoRefresh: true });
    const answer = usagePayload("2026-10-01T10:00:00.000Z");
    client.resolveNext(answer);
    await vi.advanceTimersByTimeAsync(0);

    const popover = observe(client, { enabled: false, autoRefresh: false });
    expect(popover.observer.getCurrentResult().data).toEqual(answer);
    expect(client.calls).toBe(1);
  });
});
