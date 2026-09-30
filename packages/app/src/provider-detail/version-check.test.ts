import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderVersionCheckResult } from "@getpaseo/protocol/messages";
import { fetchQueryOptions } from "@/data/query";
import {
  type ProviderVersionCheckClient,
  mergeProviderVersionResults,
  providerVersionCheckQueryInputs,
  recheckProviderVersions,
  selectNewerVersion,
} from "./version-check";

type CheckOptions = Parameters<ProviderVersionCheckClient["checkProviderVersions"]>[0];

interface FakeVersionCheckClient extends ProviderVersionCheckClient {
  calls: CheckOptions[];
  /** 下一次请求的结果；为 Error 时请求失败，为 Promise 时由测试决定何时返回。 */
  answers: Array<ProviderVersionCheckResult[] | Error | Promise<ProviderVersionCheckResult[]>>;
}

function createClient(): FakeVersionCheckClient {
  const calls: CheckOptions[] = [];
  const answers: FakeVersionCheckClient["answers"] = [];
  return {
    calls,
    answers,
    checkProviderVersions: async (options) => {
      calls.push(options);
      const answer = answers.shift();
      if (!answer) throw new Error("no answer queued");
      if (answer instanceof Error) throw answer;
      return { requestId: "check", results: await answer };
    },
  };
}

const claude: ProviderVersionCheckResult = {
  provider: "claude",
  installedVersion: "2.1.280",
  latestVersion: "2.1.285",
  updateAvailable: true,
};
const codex: ProviderVersionCheckResult = { provider: "codex", updateAvailable: false };

describe("provider version check query", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const unsubscribes: Array<() => void> = [];

  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    queryClient.clear();
  });

  // 挂一个观察者，相当于挂载一次用到它的组件。
  function observe(client: FakeVersionCheckClient | null, enabled: boolean) {
    const observer = new QueryObserver(
      queryClient,
      fetchQueryOptions(providerVersionCheckQueryInputs({ client, serverId: "server-1", enabled })),
    );
    unsubscribes.push(observer.subscribe(() => {}));
    return observer;
  }

  async function settled(observer: ReturnType<typeof observe>) {
    await expect.poll(() => observer.getCurrentResult().fetchStatus).toBe("idle");
    return observer.getCurrentResult().data;
  }

  it("checks without force when the Providers page opens", async () => {
    const client = createClient();
    client.answers.push([claude, codex]);

    const page = observe(client, true);

    expect(await settled(page)).toEqual([claude, codex]);
    expect(client.calls).toEqual([undefined]);
  });

  it("asks again on every open and lets the daemon answer from its cache", async () => {
    const client = createClient();
    client.answers.push([claude, codex], [claude, codex]);
    await settled(observe(client, true));
    unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());

    const reopened = observe(client, true);

    // 回到页面先显示上次的结果，同时再问一次 daemon；不带 force。
    expect(reopened.getCurrentResult().data).toEqual([claude, codex]);
    await settled(reopened);
    expect(client.calls).toEqual([undefined, undefined]);
  });

  it("lets the list and the detail read the page's results without checking", async () => {
    const client = createClient();
    client.answers.push([claude, codex]);

    const reader = observe(client, false);
    expect(reader.getCurrentResult().fetchStatus).toBe("idle");
    expect(client.calls).toEqual([]);

    await settled(observe(client, true));
    expect(reader.getCurrentResult().data).toEqual([claude, codex]);
  });

  it("sends nothing without a client that can check", () => {
    // 连着旧 daemon（没有 providerVersions）或主机断开时，hook 传进来的 client 是 null。
    const page = observe(null, true);

    expect(page.getCurrentResult().fetchStatus).toBe("idle");
    expect(page.getCurrentResult().data).toBeUndefined();
  });

  it("forces a recheck of one provider and keeps the others", async () => {
    const client = createClient();
    const rechecked = { ...claude, latestVersion: "2.1.290" };
    client.answers.push([claude, codex], [rechecked]);
    const page = observe(client, true);
    await settled(page);

    await recheckProviderVersions({
      client,
      queryClient,
      serverId: "server-1",
      providers: ["claude"],
    });

    expect(client.calls.at(-1)).toEqual({ providers: ["claude"], force: true });
    expect(page.getCurrentResult().data).toEqual([rechecked, codex]);
  });

  it("still forces the recheck when the page's check has not answered yet", async () => {
    const client = createClient();
    let answerPageCheck: (results: ProviderVersionCheckResult[]) => void = () => {};
    const rechecked = { ...claude, latestVersion: "2.1.290" };
    client.answers.push(
      new Promise((resolve) => {
        answerPageCheck = resolve;
      }),
      [rechecked],
    );
    const page = observe(client, true);

    const recheck = recheckProviderVersions({
      client,
      queryClient,
      serverId: "server-1",
      providers: ["claude"],
    });
    answerPageCheck([claude, codex]);
    await recheck;

    expect(client.calls).toEqual([undefined, { providers: ["claude"], force: true }]);
    expect(page.getCurrentResult().data).toEqual([rechecked, codex]);
  });

  it("keeps the last results when a recheck fails", async () => {
    const client = createClient();
    client.answers.push([claude, codex], new Error("timeout"));
    const page = observe(client, true);
    await settled(page);

    await recheckProviderVersions({
      client,
      queryClient,
      serverId: "server-1",
      providers: ["claude"],
    });

    expect(client.calls.at(-1)).toEqual({ providers: ["claude"], force: true });
    expect(page.getCurrentResult().data).toEqual([claude, codex]);
  });
});

describe("selectNewerVersion", () => {
  it("shows the update checked against the installed version", () => {
    expect(
      selectNewerVersion({ provider: "claude", installedVersion: "2.1.280", results: [claude] }),
    ).toBe("2.1.285");
  });

  it("shows nothing when the CLI is current or the lookup failed", () => {
    const results: ProviderVersionCheckResult[] = [
      { ...claude, latestVersion: "2.1.280", updateAvailable: false },
      {
        provider: "copilot",
        installedVersion: "1.0.89",
        updateAvailable: false,
        error: "registry unreachable",
      },
    ];
    expect(
      selectNewerVersion({ provider: "claude", installedVersion: "2.1.280", results }),
    ).toBeNull();
    expect(
      selectNewerVersion({ provider: "copilot", installedVersion: "1.0.89", results }),
    ).toBeNull();
  });

  it("drops a result checked against a version that is no longer installed", () => {
    // 检查之后 CLI 自己更新到了 2.1.285，快照已经是新版本，旧结果不再算数。
    expect(
      selectNewerVersion({ provider: "claude", installedVersion: "2.1.285", results: [claude] }),
    ).toBeNull();
  });

  it("shows nothing before the check answers or without an installed version", () => {
    expect(
      selectNewerVersion({ provider: "claude", installedVersion: "2.1.280", results: undefined }),
    ).toBeNull();
    expect(
      selectNewerVersion({ provider: "claude", installedVersion: undefined, results: [claude] }),
    ).toBeNull();
  });
});

describe("mergeProviderVersionResults", () => {
  it("replaces the rechecked providers and keeps the rest", () => {
    const rechecked = { ...claude, latestVersion: "2.1.290" };

    expect(mergeProviderVersionResults([claude, codex], [rechecked])).toEqual([rechecked, codex]);
    expect(mergeProviderVersionResults(undefined, [rechecked])).toEqual([rechecked]);
  });
});
