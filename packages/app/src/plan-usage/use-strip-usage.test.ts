import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQueryOptions } from "@/data/query";
import type { UsageReportEntry } from "@/usage/types";
import {
  STRIP_USAGE_REFRESH_MS,
  resolveStripReports,
  stripAgentReportsQueryInput,
  stripHostReportsQueryInput,
  stripNeedsHostReports,
  type StripUsageSource,
} from "./use-strip-usage";

type Resolve = (reports: UsageReportEntry[]) => void;

interface FakeSource extends StripUsageSource {
  hostCalls: number;
  agentCalls: string[];
  /** 让最早一个挂起的请求返回。 */
  resolveNextHost: Resolve;
  resolveNextAgent: Resolve;
}

function createSource(): FakeSource {
  const pendingHost: Resolve[] = [];
  const pendingAgent: Resolve[] = [];
  const take = (pending: Resolve[]): Resolve => {
    const resolve = pending.shift();
    if (!resolve) throw new Error("no pending request");
    return resolve;
  };
  const source: FakeSource = {
    hostCalls: 0,
    agentCalls: [],
    listHostReports: () => {
      source.hostCalls += 1;
      return new Promise<UsageReportEntry[]>((resolve) => pendingHost.push(resolve));
    },
    listAgentReports: (agentId) => {
      source.agentCalls.push(agentId);
      return new Promise<UsageReportEntry[]>((resolve) => pendingAgent.push(resolve));
    },
    resolveNextHost: (reports) => take(pendingHost)(reports),
    resolveNextAgent: (reports) => take(pendingAgent)(reports),
  };
  return source;
}

function report(id: string): UsageReportEntry {
  return {
    id,
    sourceId: "claude",
    sourceLabel: "Claude",
    account: {},
    fetchedAt: "2026-10-01T10:00:00.000Z",
    report: { status: "available", windows: [] },
  };
}

interface StripFlags {
  agentId: string | null;
  enabled: boolean;
}

describe("the plan usage the composer strip asks for", () => {
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

  // 组件里的接法：先看 Agent 那条查询答了什么，再决定要不要取主机的列表。
  function mountStrip(source: FakeSource, flags: StripFlags) {
    const serverId = "server-1";
    const agentOptions = (next: StripFlags) =>
      fetchQueryOptions(stripAgentReportsQueryInput({ serverId, source, ...next }));
    const hostOptions = (next: StripFlags, needsHostReports: boolean) =>
      fetchQueryOptions(
        stripHostReportsQueryInput({
          serverId,
          source,
          enabled: next.enabled && needsHostReports,
        }),
      );
    let current = flags;
    const agent = new QueryObserver(queryClient, agentOptions(flags));
    const host = new QueryObserver(queryClient, hostOptions(flags, flags.agentId === null));
    const sync = () => {
      const result = agent.getCurrentResult();
      const needsHostReports = stripNeedsHostReports({
        agentId: current.agentId,
        agentReports: result.data,
        agentFailed: result.isError,
      });
      agent.setOptions(agentOptions(current));
      host.setOptions(hostOptions(current, needsHostReports));
    };
    unsubscribes.push(
      agent.subscribe(sync),
      host.subscribe(() => {}),
    );
    return {
      agent,
      host,
      setFlags: (next: StripFlags) => {
        current = next;
        sync();
      },
    };
  }

  // Node 里没有 window，TanStack 按服务端处理（`isServer`），refetchInterval 不会起定时器；
  // 所以刷新周期读观察者实际拿到的选项，取数时机用请求次数和 fetchStatus 断言。
  it("asks once for the agent's account when the strip mounts and polls every five minutes", () => {
    const source = createSource();
    const strip = mountStrip(source, { agentId: "agent-1", enabled: true });

    expect(source.agentCalls).toEqual(["agent-1"]);
    expect(strip.agent.options.refetchInterval).toBe(5 * 60 * 1000);
    expect(source.hostCalls).toBe(0);
    expect(strip.host.options.refetchInterval).toBe(false);
  });

  it("leaves the host's list alone while the daemon reports an account for the agent", async () => {
    const source = createSource();
    const strip = mountStrip(source, { agentId: "agent-1", enabled: true });
    source.resolveNextAgent([report("claude:work")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(strip.agent.getCurrentResult().data).toEqual([report("claude:work")]);
    expect(strip.host.getCurrentResult().fetchStatus).toBe("idle");
    expect(source.hostCalls).toBe(0);
  });

  it("reads the host's list once the daemon reports no account for the agent", async () => {
    const source = createSource();
    const strip = mountStrip(source, { agentId: "agent-1", enabled: true });
    source.resolveNextAgent([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(source.hostCalls).toBe(1);
    expect(strip.host.options.refetchInterval).toBe(5 * 60 * 1000);
  });

  it("reads only the host's list for a draft, which has no agent to ask about", () => {
    const source = createSource();
    const strip = mountStrip(source, { agentId: null, enabled: true });

    expect(source.agentCalls).toEqual([]);
    expect(strip.agent.getCurrentResult().fetchStatus).toBe("idle");
    expect(source.hostCalls).toBe(1);
    expect(strip.host.options.refetchInterval).toBe(5 * 60 * 1000);
  });

  it("neither fetches nor polls while the strip cannot show it", () => {
    const source = createSource();
    const draft = mountStrip(source, { agentId: null, enabled: false });
    const agent = mountStrip(source, { agentId: "agent-1", enabled: false });

    expect(source.hostCalls).toBe(0);
    expect(source.agentCalls).toEqual([]);
    expect(draft.host.getCurrentResult().fetchStatus).toBe("idle");
    expect(draft.host.options.refetchInterval).toBe(false);
    expect(agent.agent.getCurrentResult().fetchStatus).toBe("idle");
    expect(agent.agent.options.refetchInterval).toBe(false);
  });

  it("refetches when the strip comes back after the data went stale", async () => {
    const source = createSource();
    const strip = mountStrip(source, { agentId: "agent-1", enabled: true });
    source.resolveNextAgent([report("claude:work")]);
    await vi.advanceTimersByTimeAsync(0);

    strip.setFlags({ agentId: "agent-1", enabled: false });
    strip.setFlags({ agentId: "agent-1", enabled: true });
    expect(source.agentCalls).toHaveLength(1);

    strip.setFlags({ agentId: "agent-1", enabled: false });
    vi.setSystemTime(Date.now() + STRIP_USAGE_REFRESH_MS + 1);
    strip.setFlags({ agentId: "agent-1", enabled: true });
    expect(source.agentCalls).toHaveLength(2);
  });
});

describe("whether the strip needs the host's list", () => {
  it("does for a draft", () => {
    expect(
      stripNeedsHostReports({ agentId: null, agentReports: undefined, agentFailed: false }),
    ).toBe(true);
  });

  it("does not while the daemon has yet to answer about the agent", () => {
    expect(
      stripNeedsHostReports({ agentId: "agent-1", agentReports: undefined, agentFailed: false }),
    ).toBe(false);
  });

  it("does when the daemon names no account, or could not be asked", () => {
    expect(
      stripNeedsHostReports({ agentId: "agent-1", agentReports: [], agentFailed: false }),
    ).toBe(true);
    expect(
      stripNeedsHostReports({ agentId: "agent-1", agentReports: undefined, agentFailed: true }),
    ).toBe(true);
  });

  it("does not while an earlier answer still names the agent's account", () => {
    expect(
      stripNeedsHostReports({
        agentId: "agent-1",
        agentReports: [report("claude:work")],
        agentFailed: true,
      }),
    ).toBe(false);
  });
});

describe("the reports the strip is given to choose from", () => {
  const cachedHost = [report("claude:personal")];
  const base = {
    canReport: true,
    agentId: "agent-1",
    agentReports: undefined,
    agentFailed: false,
    hostReports: cachedHost,
  };

  it("holds back the host's cached list while the daemon has yet to answer about the agent", () => {
    // 侧栏一打开应用就取了主机的列表；先拿它显示，会在 Agent 的账号到达前闪一下别的账号。
    expect(resolveStripReports(base)).toEqual({ agentReports: null, hostReports: null });
  });

  it("gives only the agent's account once the daemon names it", () => {
    const agentReports = [report("claude:work")];
    expect(resolveStripReports({ ...base, agentReports })).toEqual({
      agentReports,
      hostReports: null,
    });
  });

  it("gives the host's list when the daemon names no account, or could not be asked", () => {
    expect(resolveStripReports({ ...base, agentReports: [] })).toEqual({
      agentReports: [],
      hostReports: cachedHost,
    });
    expect(resolveStripReports({ ...base, agentFailed: true })).toEqual({
      agentReports: null,
      hostReports: cachedHost,
    });
  });

  it("gives a draft the host's list", () => {
    expect(resolveStripReports({ ...base, agentId: null })).toEqual({
      agentReports: null,
      hostReports: cachedHost,
    });
    expect(resolveStripReports({ ...base, agentId: null, hostReports: undefined })).toEqual({
      agentReports: null,
      hostReports: null,
    });
  });

  it("gives nothing for a host that is offline or cannot report, whatever is still cached", () => {
    const agentReports = [report("claude:work")];
    expect(resolveStripReports({ ...base, canReport: false, agentReports })).toEqual({
      agentReports: null,
      hostReports: null,
    });
  });
});
