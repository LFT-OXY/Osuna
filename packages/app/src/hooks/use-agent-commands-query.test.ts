import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQueryOptions } from "@/data/query";
import {
  type AgentCommandsClient,
  type DraftCommandConfig,
  agentCommandsQueryInputs,
  fetchAgentCommands,
  selectAgentCommandsState,
} from "./use-agent-commands-query";

type ListCommands = AgentCommandsClient["listCommands"];
type ListCommandsResult = Awaited<ReturnType<ListCommands>>;

interface ListCommandsCall {
  agentId: string;
  draftConfig: DraftCommandConfig | undefined;
}

interface FakeAgentCommandsClient extends AgentCommandsClient {
  calls: ListCommandsCall[];
  /** Resolves the oldest pending request. */
  resolveNext: (response: ListCommandsResult) => void;
}

function createClient(): FakeAgentCommandsClient {
  const calls: ListCommandsCall[] = [];
  const pending: Array<(response: ListCommandsResult) => void> = [];
  return {
    calls,
    listCommands: (options) => {
      calls.push({ agentId: options.agentId, draftConfig: options.draftConfig });
      return new Promise<ListCommandsResult>((resolve) => pending.push(resolve));
    },
    resolveNext: (response) => {
      const resolve = pending.shift();
      if (!resolve) throw new Error("no pending listCommands request");
      resolve(response);
    },
  };
}

function commandsPayload(
  commands: ListCommandsResult["commands"],
  extra: { partial?: boolean } = {},
): ListCommandsResult {
  return {
    requestId: "req_commands",
    agentId: "",
    error: null,
    commands,
    ...extra,
  };
}

const compact = { name: "compact", description: "Compact context", argumentHint: "" };
const review = { name: "review", description: "Review changes", argumentHint: "" };

function readyWith(commands: (typeof compact)[]) {
  return { status: "ready", commands, partial: false };
}

interface ObservedFlags {
  isMenuOpen: boolean;
  prefetch: boolean;
}

// 与 composer 挂载时一样：同一个 QueryClient 上的预取观察者和菜单观察者。
function observeAgentCommands(client: FakeAgentCommandsClient, initial: ObservedFlags) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  const options = (flags: ObservedFlags) => {
    const inputs = agentCommandsQueryInputs({
      serverId: "server-1",
      agentId: "agent-1",
      client,
      canFetch: true,
      ...flags,
      clientUnavailableMessage: "client unavailable",
    });
    return {
      prefetch: fetchQueryOptions(inputs.prefetch),
      menu: fetchQueryOptions(inputs.menu),
    };
  };
  const initialOptions = options(initial);
  const prefetch = new QueryObserver(queryClient, initialOptions.prefetch);
  const menu = new QueryObserver(queryClient, initialOptions.menu);
  const unsubscribes = [prefetch.subscribe(() => {}), menu.subscribe(() => {})];
  return {
    setFlags(flags: ObservedFlags) {
      const next = options(flags);
      prefetch.setOptions(next.prefetch);
      menu.setOptions(next.menu);
    },
    state() {
      const result = menu.getCurrentResult();
      return selectAgentCommandsState({ canFetch: true, data: result.data, error: result.error });
    },
    isFetching() {
      return menu.getCurrentResult().fetchStatus !== "idle";
    },
    dispose() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      queryClient.clear();
    },
  };
}

describe("fetchAgentCommands", () => {
  it("loads commands for a draft composer without an agent id", async () => {
    const client = createClient();
    const draftConfig: DraftCommandConfig = { provider: "opencode", cwd: "/repo", modeId: "build" };

    const pending = fetchAgentCommands({ client, agentId: "", draftConfig });
    client.resolveNext(commandsPayload([compact]));

    expect(await pending).toEqual({ commands: [compact], partial: false });
    expect(client.calls).toEqual([{ agentId: "", draftConfig }]);
  });

  it("passes the agent id when fetching commands for a running agent", async () => {
    const client = createClient();

    const pending = fetchAgentCommands({ client, agentId: "agent-1" });
    client.resolveNext(commandsPayload([]));
    await pending;

    expect(client.calls).toEqual([{ agentId: "agent-1", draftConfig: undefined }]);
  });

  it("reports a partial list only when the daemon says so", async () => {
    const client = createClient();

    const pending = fetchAgentCommands({ client, agentId: "agent-1" });
    client.resolveNext(commandsPayload([compact], { partial: true }));

    expect(await pending).toEqual({ commands: [compact], partial: true });
  });
});

describe("agent commands queries", () => {
  let observed: ReturnType<typeof observeAgentCommands> | null = null;
  afterEach(() => {
    observed?.dispose();
    observed = null;
  });

  it("is loading while the menu is open and nothing has arrived yet", async () => {
    const client = createClient();
    observed = observeAgentCommands(client, { isMenuOpen: true, prefetch: false });

    expect(client.calls).toEqual([{ agentId: "agent-1", draftConfig: undefined }]);
    expect(observed.state()).toEqual({ status: "loading" });

    client.resolveNext(commandsPayload([compact], { partial: true }));
    await vi.waitFor(() =>
      expect(observed?.state()).toEqual({ status: "ready", commands: [compact], partial: true }),
    );
  });

  it("re-requests on every menu open and keeps the previous list while refetching", async () => {
    const client = createClient();
    observed = observeAgentCommands(client, { isMenuOpen: true, prefetch: false });
    client.resolveNext(commandsPayload([compact]));
    await vi.waitFor(() => expect(observed?.state()).toEqual(readyWith([compact])));

    observed.setFlags({ isMenuOpen: false, prefetch: false });
    observed.setFlags({ isMenuOpen: true, prefetch: false });

    expect(client.calls).toEqual([
      { agentId: "agent-1", draftConfig: undefined },
      { agentId: "agent-1", draftConfig: undefined },
    ]);
    expect(observed.state()).toEqual(readyWith([compact]));

    client.resolveNext(commandsPayload([compact, review]));
    await vi.waitFor(() => expect(observed?.state()).toEqual(readyWith([compact, review])));
  });

  it("prefetches while the input is focused so the menu opens with data", async () => {
    const client = createClient();
    observed = observeAgentCommands(client, { isMenuOpen: false, prefetch: true });

    expect(client.calls).toEqual([{ agentId: "agent-1", draftConfig: undefined }]);
    client.resolveNext(commandsPayload([compact]));
    await vi.waitFor(() => expect(observed?.state()).toEqual(readyWith([compact])));

    observed.setFlags({ isMenuOpen: true, prefetch: true });

    expect(observed.state()).toEqual(readyWith([compact]));
  });

  it("does not request while the input is unfocused and the menu is closed", () => {
    const client = createClient();
    observed = observeAgentCommands(client, { isMenuOpen: false, prefetch: false });

    expect(client.calls).toEqual([]);
    expect(observed.isFetching()).toBe(false);
  });
});

describe("selectAgentCommandsState", () => {
  it("keeps the previous list when a background refresh fails", () => {
    expect(
      selectAgentCommandsState({
        canFetch: true,
        data: { commands: [compact], partial: false },
        error: new Error("socket closed"),
      }),
    ).toEqual(readyWith([compact]));
  });

  it("reports the failure when there was never a list", () => {
    const error = new Error("socket closed");

    expect(selectAgentCommandsState({ canFetch: true, data: undefined, error })).toEqual({
      status: "error",
      error,
    });
  });

  it("is unavailable when it cannot fetch and has nothing cached", () => {
    expect(selectAgentCommandsState({ canFetch: false, data: undefined, error: null })).toEqual({
      status: "unavailable",
    });
  });
});
