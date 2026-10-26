import { expect, test } from "vitest";
import { UsageSourceRegistry } from "./index.js";

function source(input: {
  id: string;
  discover?: () => Promise<Array<{ key: string; label?: string; input: unknown }>>;
  fetch?: (value: unknown) => Promise<unknown>;
}) {
  return {
    id: input.id,
    label: input.id,
    discover: input.discover ?? (async () => []),
    fetch: input.fetch ?? (async () => ({ status: "available", windows: [] })),
  };
}

test("discovery preserves account IDs and updates input after token rotation", async () => {
  const registry = new UsageSourceRegistry();
  let token = "old";
  registry.register(
    source({
      id: "codex",
      discover: async () => [{ key: "work", input: { token } }],
      fetch: async (input) => ({
        status: "available",
        windows: [{ id: "token", label: (input as { token: string }).token }],
      }),
    }),
  );
  const first = await registry.listReports();
  expect(first.map((entry) => entry.id)).toEqual(["codex:work"]);
  expect(first[0]?.report.windows[0]?.label).toBe("old");
  token = "new";
  const refreshed = await registry.listReports({ forceRefresh: true });
  expect(refreshed.map((entry) => entry.id)).toEqual(["codex:work"]);
  expect(refreshed[0]?.report.windows[0]?.label).toBe("new");
});

test("a report's resets reach the client as the source gave them", async () => {
  const registry = new UsageSourceRegistry();
  const resets = {
    count: 2,
    until: "2026-10-25T14:30:00.000Z",
    each: [{ until: "2026-10-25T14:30:00.000Z" }, { until: null }],
  };
  registry.register(
    source({
      id: "codex",
      discover: async () => [{ key: "work", input: {} }],
      fetch: async () => ({ status: "available", windows: [], resets }),
    }),
  );
  const [entry] = await registry.listReports();
  expect(entry?.report).toEqual({ status: "available", windows: [], resets });
});

test("coalesces per account, caches errors, and refreshes only requested IDs", async () => {
  let now = 0;
  const counts = new Map<string, number>();
  const registry = new UsageSourceRegistry({ now: () => now });
  registry.register(
    source({
      id: "source",
      discover: async () => ["a", "b"].map((account) => ({ key: account, input: { account } })),
      fetch: async (input) => {
        const account = (input as { account: string }).account;
        counts.set(account, (counts.get(account) ?? 0) + 1);
        if (account === "b") throw new Error("failed");
        return { status: "available", windows: [] };
      },
    }),
  );
  const first = await registry.listReports();
  expect(first.map((entry) => entry.id)).toEqual(["source:a", "source:b"]);
  expect(first[1]?.report.status).toBe("error");
  expect(await registry.listReports()).toEqual(first);
  expect(counts.get("a")).toBe(1);
  expect(counts.get("b")).toBe(1);
  now = 1000;
  const refreshed = await registry.listReports({
    reportIds: ["source:a", "missing:id"],
    forceRefresh: true,
  });
  expect(refreshed.map((entry) => entry.id)).toEqual(["source:a"]);
  expect(refreshed[0]?.fetchedAt).not.toBe(first[0]?.fetchedAt);
  expect(counts.get("a")).toBe(2);
  expect(counts.get("b")).toBe(1);
  now = 301_001;
  await registry.listReports({ reportIds: ["source:a"] });
  expect(counts.get("a")).toBe(3);
});

test("legacy listing uses oldest fetchedAt", async () => {
  let now = 1000;
  const registry = new UsageSourceRegistry({ now: () => now });
  registry.register(
    source({
      id: "source",
      discover: async () => ["a", "b"].map((account) => ({ key: account, input: { account } })),
    }),
  );
  await registry.listReports();
  now = 2000;
  await registry.listReports({ reportIds: ["source:b"], forceRefresh: true });
  expect((await registry.listLegacyUsage()).fetchedAt).toBe(new Date(1000).toISOString());
});

test("concurrent requests for the same ID share one vendor fetch", async () => {
  let finish!: (report: unknown) => void;
  const response = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  let fetches = 0;
  const registry = new UsageSourceRegistry();
  registry.register(
    source({
      id: "coalesced",
      discover: async () => [{ key: "one", input: {} }],
      fetch: async () => {
        fetches++;
        return response;
      },
    }),
  );
  const first = registry.listReports();
  const second = registry.listReports();
  finish({ status: "available", windows: [] });
  const [one, two] = await Promise.all([first, second]);
  expect(one[0]).toBe(two[0]);
  expect(fetches).toBe(1);
});

test("rediscovery removes an old account from targeted refreshes", async () => {
  let now = 0;
  const registry = new UsageSourceRegistry({ now: () => now, ttlMs: 100 });
  let account = "old";
  registry.register(source({ id: "source", discover: async () => [{ key: account, input: {} }] }));
  await registry.listReports();
  await registry.listReports({ reportIds: ["source:old"] });
  now = 101;
  account = "new";
  await registry.listReports();
  await registry.listReports({ reportIds: ["source:new"] });
  expect(await registry.listReports({ reportIds: ["source:old"] })).toEqual([]);
});

test("discovery failures log once while other sources still report", async () => {
  const warnings: unknown[][] = [];
  const registry = new UsageSourceRegistry({
    logger: {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
    },
  });
  const err = new Error("subprocess stopped");
  registry.register(
    source({
      id: "kimi",
      discover: async () => {
        throw err;
      },
    }),
  );
  registry.register(source({ id: "healthy", discover: async () => [{ key: "one", input: {} }] }));
  const updates: string[] = [];
  const reports = await registry.listReports({ onReport: (report) => updates.push(report.id) });
  expect(reports.map((report) => report.id)).toEqual(["healthy:one"]);
  expect(updates).toEqual(["healthy:one"]);
  expect(warnings).toEqual([[{ sourceId: "kimi", err }, "Usage source discovery failed"]]);
});

test("a failed fetch is logged as well as reported", async () => {
  const warnings: unknown[][] = [];
  const registry = new UsageSourceRegistry({
    logger: {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
    },
  });
  const err = new Error("Rate limited by Claude. Try again in 38m.");
  registry.register(
    source({
      id: "claude",
      discover: async () => [{ key: "work", input: {} }],
      fetch: async () => {
        throw err;
      },
    }),
  );
  const [report] = await registry.listReports();
  expect(report?.report).toEqual({ status: "error", error: err.message });
  expect(warnings).toEqual([[{ sourceId: "claude", err }, "Usage fetch failed"]]);
});

test("legacy listing distinguishes labeled accounts and preserves unlabeled names", async () => {
  const registry = new UsageSourceRegistry({ now: () => 1000 });
  registry.register(
    source({
      id: "claude",
      discover: async () =>
        ["work", "personal", "default"].map((key) => ({
          key,
          label: key === "default" ? undefined : key,
          input: {},
        })),
    }),
  );
  expect(
    (await registry.listLegacyUsage()).providers.map((provider) => provider.displayName),
  ).toEqual(["claude (work)", "claude (personal)", "claude"]);
});

test("duplicate logins prefer discovery order across unavailable, error and thrown fetches", async () => {
  for (const failure of ["unavailable", "error", "throw"]) {
    const registry = new UsageSourceRegistry();
    const calls: number[] = [];
    registry.register(
      source({
        id: "codex",
        discover: async () => [0, 1, 2].map((input) => ({ key: "same", input })),
        fetch: async (input) => {
          calls.push(Number(input));
          if (input === 0) {
            if (failure === "throw") throw new Error("revoked");
            return failure === "unavailable"
              ? { status: failure, problem: { kind: "rejected", status: 401 } }
              : { status: failure, error: "revoked" };
          }
          return {
            status: "available",
            windows: [{ id: "session", label: "Session", usedPct: 42 }],
          };
        },
      }),
    );
    const reports = await registry.listReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.report.status).toBe("available");
    expect(calls).toEqual([0, 1, 2]);
  }
});

test("targeted refresh re-reads the login without discovering again", async () => {
  let discoveries = 0;
  let value = "old";
  const registry = new UsageSourceRegistry();
  registry.register(
    source({
      id: "source",
      discover: async () => {
        discoveries++;
        return [{ key: "original", input: {} }];
      },
      fetch: async () => ({ status: "available", windows: [{ id: "session", label: value }] }),
    }),
  );
  await registry.listReports();
  value = "new";
  const reports = await registry.listReports({
    reportIds: ["source:original"],
    forceRefresh: true,
  });
  expect(reports[0]?.report).toEqual({
    status: "available",
    windows: [{ id: "session", label: "new" }],
  });
  expect(discoveries).toBe(1);
});

test("a thrown fetch is an error card", async () => {
  const registry = new UsageSourceRegistry();
  registry.register(
    source({
      id: "source",
      discover: async () => [{ key: "one", input: {} }],
      fetch: async () => {
        throw new Error("Store deleted");
      },
    }),
  );
  expect((await registry.listReports())[0]?.report).toEqual({
    status: "error",
    error: "Store deleted",
  });
});

test("an unavailable login falls back to the next available login", async () => {
  const calls: unknown[] = [];
  const registry = new UsageSourceRegistry();
  registry.register(
    source({
      id: "source",
      discover: async () => [1, 2].map((input) => ({ key: "same", input })),
      fetch: async (input) => {
        calls.push(input);
        return input === 1
          ? {
              status: "unavailable",
              problem: { kind: "expired", expiresAt: "1970-01-01T00:00:00.000Z" },
            }
          : { status: "available", windows: [] };
      },
    }),
  );
  expect(
    (await registry.listReports()).map((entry) => ({ id: entry.id, report: entry.report })),
  ).toEqual([{ id: "source:same", report: { status: "available", windows: [] } }]);
  expect(calls).toEqual([1, 2]);
});

test("failed fallbacks preserve the final problem", async () => {
  const registry = new UsageSourceRegistry();
  registry.register(
    source({
      id: "source",
      discover: async () => [1, 2].map((input) => ({ key: "same", input })),
      fetch: async (input) => ({
        status: "unavailable",
        problem: { kind: "rejected", status: input === 1 ? 401 : 403 },
      }),
    }),
  );
  expect((await registry.listReports())[0]?.report).toEqual({
    status: "unavailable",
    problem: { kind: "rejected", status: 403 },
  });
});

test("session discovery reuses accounts, separates launches, and retains live agent reports globally", async () => {
  const sessions = new Map([
    ["one", { provider: "claude", env: { HOME: "/one" }, sessionKey: "launch-1" }],
    ["two", { provider: "claude", env: { HOME: "/two" }, sessionKey: "launch-2" }],
  ]);
  const existing = new Set(["one", "two", "closed"]);
  const discoveries: string[] = [];
  let fetches = 0;
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: (id) => existing.has(id),
      usageSession: (id) => sessions.get(id) ?? null,
    },
  });
  registry.register({
    id: "claude",
    label: "Claude",
    discover: async (scope) => {
      discoveries.push(scope.kind === "global" ? "global" : scope.env.HOME);
      if (scope.kind === "global") return [{ key: "default", input: "default" }];
      return [{ key: scope.env.HOME === "/new" ? "new" : "same", input: scope.env.HOME }];
    },
    fetch: async () => {
      fetches++;
      return { status: "available", windows: [] };
    },
  });
  expect(await registry.listReports({ agentId: "closed" })).toEqual([]);
  expect((await registry.listReports({ agentId: "one" })).map((r) => r.id)).toEqual([
    "claude:same",
  ]);
  await registry.listReports({ agentId: "one" });
  await registry.listReports({ agentId: "two" });
  expect(discoveries).toEqual(["/one", "/two"]);
  expect(fetches).toBe(2);
  expect((await registry.listReports()).map((r) => r.id)).toEqual([
    "claude:default",
    "claude:same",
  ]);
  sessions.set("one", { provider: "claude", env: { HOME: "/new" }, sessionKey: "launch-3" });
  expect((await registry.listReports({ agentId: "one" })).map((r) => r.id)).toEqual(["claude:new"]);
  existing.delete("two");
  sessions.delete("two");
  expect((await registry.listReports()).map((r) => r.id)).toEqual(["claude:default", "claude:new"]);
  await expect(registry.listReports({ agentId: "missing" })).rejects.toThrow("Unknown agent");
  await expect(registry.listReports({ agentId: "one", reportIds: [] })).rejects.toThrow("agentId");
});

test("an agent started before the CLI switched accounts keeps showing the account it started on", async () => {
  // CLI 的登录：先是 one，Agent 启动后换成了 two（多号自动轮换）。
  let cliAccount = "one";
  let switchedAt: number | null = null;
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: () => true,
      usageSession: () => ({ provider: "codex", env: {}, sessionKey: "launch", launchedAt: 1_000 }),
    },
  });
  registry.useSavedAccounts({
    accountAt: ({ at }) =>
      switchedAt !== null && switchedAt > at && cliAccount !== "one"
        ? { key: "one", label: "one@example.com" }
        : null,
    usageInput: async ({ key }) => ({ token: `saved-${key}` }),
  });
  registry.register(
    source({
      id: "codex",
      discover: async () => [
        { key: cliAccount, label: `${cliAccount}@example.com`, input: { token: "cli" } },
      ],
      fetch: async (input) => ({
        status: "available",
        windows: [
          {
            id: "who",
            label: (input as { token: string }).token === "cli" ? cliAccount : "saved",
          },
        ],
      }),
    }),
  );
  const before = await registry.listReports({ agentId: "agent" });
  expect(before.map((entry) => [entry.id, entry.account.label])).toEqual([
    ["codex:one", "one@example.com"],
  ]);

  cliAccount = "two";
  switchedAt = 2_000;
  const after = await registry.listReports({ agentId: "agent", forceRefresh: true });
  expect(after.map((entry) => [entry.id, entry.account.label])).toEqual([
    ["codex:one", "one@example.com"],
  ]);
  // 读的是 one 自己存着的登录，不是 CLI 现在的 two。
  expect(after[0]?.report.status === "available" && after[0].report.windows[0]?.label).toBe(
    "saved",
  );

  // 换回 one 之后，又照 CLI 的登录读。
  cliAccount = "one";
  const back = await registry.listReports({ agentId: "agent", forceRefresh: true });
  expect(back.map((entry) => entry.id)).toEqual(["codex:one"]);
  expect(back[0]?.report.status === "available" && back[0].report.windows[0]?.label).toBe("one");
});

test("reports arrive independently and a hung fetch settles as an error before completion", async () => {
  const registry = new UsageSourceRegistry({ deadlineMs: 25 });
  let finishSlow!: (value: unknown) => void;
  const slow = new Promise<unknown>((resolve) => {
    finishSlow = resolve;
  });
  const reports: string[] = [];
  let firstReport!: () => void;
  const first = new Promise<void>((resolve) => {
    firstReport = resolve;
  });
  for (const id of ["slow", "fast", "also-fast"]) {
    registry.register(
      source({
        id,
        discover: async () => [{ key: "account", input: {} }],
        fetch: async () => (id === "slow" ? slow : { status: "available", windows: [] }),
      }),
    );
  }
  let complete = false;
  const request = registry
    .listReports({
      onReport: (entry) => {
        reports.push(entry.id);
        firstReport();
      },
    })
    .then((entries) => {
      complete = true;
      return entries;
    });
  await first;
  expect(reports).toEqual(["fast:account", "also-fast:account"]);
  expect(complete).toBe(false);
  const entries = await request;
  expect(reports).toEqual(["fast:account", "also-fast:account", "slow:account"]);
  expect(entries[0]?.report).toEqual({ status: "error", error: "Usage fetch timed out" });
  finishSlow({ status: "available", windows: [] });
  expect((await registry.listReports({ reportIds: ["slow:account"] }))[0]?.report).toEqual(
    entries[0]?.report,
  );
});

test("#6155: agent reports use only their session login despite host and sibling discoveries", async () => {
  const sessions = new Map([
    ["codex-agent", { provider: "codex", env: {}, sessionKey: "codex-launch" }],
    ["opencode-agent", { provider: "opencode", env: {}, sessionKey: "opencode-launch" }],
  ]);
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: (id) => sessions.has(id),
      usageSession: (id) => sessions.get(id) ?? null,
    },
  });
  const codexError = { status: "error", error: "Codex usage API returned 500" };
  const expired = {
    status: "unavailable",
    problem: { kind: "expired", expiresAt: "2026-07-07T00:00:00.000Z", refreshedBy: "opencode" },
  };
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async (scope) =>
      (scope.kind === "global" ? ["codex", "opencode"] : [scope.provider]).map((harness) => ({
        key: "same",
        harness,
        input: { harness },
      })),
    fetch: async (input) =>
      (input as { harness: string }).harness === "codex" ? codexError : expired,
  });
  await registry.listReports();
  await registry.listReports({ agentId: "opencode-agent" });
  expect((await registry.listReports({ agentId: "codex-agent" }))[0]?.report).toEqual(codexError);
});

test("all failed host logins retain each source-supplied harness and remedy", async () => {
  const registry = new UsageSourceRegistry();
  const failures = [
    { status: "error", error: "Codex usage API returned 500" },
    {
      status: "unavailable",
      problem: { kind: "expired", expiresAt: "2026-07-07T00:00:00.000Z", refreshedBy: "opencode" },
    },
    { status: "unavailable", problem: { kind: "rejected", status: 401, refreshedBy: "pi" } },
    { status: "unavailable", problem: { kind: "rejected", status: 403, refreshedBy: "omp" } },
  ];
  const harnesses = ["Codex", "OpenCode", "Pi", "OMP"];
  registry.register(
    source({
      id: "codex",
      discover: async () => harnesses.map((harness, input) => ({ key: "same", harness, input })),
      fetch: async (input) => failures[Number(input)],
    }),
  );
  const [entry] = await registry.listReports();
  expect(entry?.loginErrors).toEqual(
    harnesses.map((harness, index) => ({ harness, report: failures[index] })),
  );
});

test("a working agent login never uses another harness's failure or host fallback cache", async () => {
  const sessions = new Map([
    ["working", { provider: "codex", env: {}, sessionKey: "one" }],
    ["broken", { provider: "opencode", env: {}, sessionKey: "two" }],
  ]);
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: (id) => sessions.has(id),
      usageSession: (id) => sessions.get(id) ?? null,
    },
  });
  const available = {
    status: "available",
    windows: [{ id: "weekly", label: "Weekly", usedPct: 31 }],
  };
  const error = { status: "error", error: "OpenCode login rejected. Run opencode to refresh it." };
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async (scope) =>
      (scope.kind === "global" ? ["opencode", "codex"] : [scope.provider]).map((harness) => ({
        key: "same",
        harness,
        input: harness,
      })),
    fetch: async (input) => (input === "codex" ? available : error),
  });
  const [host] = await registry.listReports();
  expect(host?.report).toEqual(available);
  expect(host?.loginErrors).toBeUndefined();
  expect((await registry.listReports({ agentId: "working" }))[0]?.report).toEqual(available);
  expect((await registry.listReports({ agentId: "broken" }))[0]?.report).toEqual(error);
  expect(
    (await registry.listReports({ agentId: "broken", forceRefresh: true }))[0]?.report,
  ).toEqual(error);
  expect(
    (await registry.listReports({ reportIds: ["codex:same"], forceRefresh: true }))[0]?.report,
  ).toEqual(available);
});

test("concurrent host and agent requests never share a different login's pending fetch", async () => {
  let finish!: (report: unknown) => void;
  const slow = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: () => true,
      usageSession: () => ({ provider: "codex", env: {}, sessionKey: "launch" }),
    },
  });
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async (scope) => [{ key: "same", harness: "Codex", input: scope.kind }],
    fetch: async (input) =>
      input === "global" ? slow : { status: "error", error: "Session login failed" },
  });
  const host = registry.listReports();
  const [agent] = await registry.listReports({ agentId: "agent" });
  expect(agent?.report).toEqual({ status: "error", error: "Session login failed" });
  finish({ status: "available", windows: [] });
  expect((await host)[0]?.report.status).toBe("available");
});

test("duplicate logins across scopes appear only once in the host's errors", async () => {
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: () => true,
      usageSession: () => ({ provider: "codex", env: {}, sessionKey: "launch" }),
    },
  });
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async (scope) => [
      {
        key: "same",
        harness: "Codex",
        input:
          scope.kind === "global"
            ? { path: "/auth", kind: "file" }
            : { kind: "file", path: "/auth" },
      },
    ],
    fetch: async () => ({ status: "error", error: "Login failed" }),
  });
  await registry.listReports({ agentId: "agent" });
  expect((await registry.listReports())[0]?.loginErrors).toEqual([
    { harness: "Codex", report: { status: "error", error: "Login failed" } },
  ]);
});

test("a hung login records its own timeout and still tries the next login", async () => {
  const registry = new UsageSourceRegistry({ deadlineMs: 25 });
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async () => [
      { key: "same", harness: "Codex", input: 0 },
      { key: "same", harness: "OpenCode", input: 1 },
    ],
    fetch: async (input) =>
      input === 0 ? new Promise(() => {}) : { status: "error", error: "Login rejected" },
  });
  expect((await registry.listReports())[0]?.loginErrors).toEqual([
    { harness: "Codex", report: { status: "error", error: "Usage fetch timed out" } },
    { harness: "OpenCode", report: { status: "error", error: "Login rejected" } },
  ]);
});

test("using a reset goes through the login the card shows, then reads the account past the cache", async () => {
  const registry = new UsageSourceRegistry({ now: () => 0 });
  let windowsUsed = 80;
  const fetched: string[] = [];
  const consumed: unknown[] = [];
  registry.register({
    ...source({
      id: "codex",
      discover: async () => [
        { key: "work", input: { login: "expired" } },
        { key: "work", input: { login: "live" } },
      ],
      fetch: async (input) => {
        const login = (input as { login: string }).login;
        fetched.push(login);
        if (login === "expired")
          return { status: "unavailable", problem: { kind: "rejected", status: 401 } };
        return {
          status: "available",
          windows: [{ id: "five_hour", label: "5-hour", usedPct: windowsUsed }],
        };
      },
    }),
    consumeReset: async (input: unknown) => {
      consumed.push(input);
      windowsUsed = 0;
      return { code: "reset", windows: 2 };
    },
  });
  const [listed] = await registry.listReports();
  expect(listed?.consumesResets).toBe(true);
  fetched.length = 0;

  const { outcome, entry } = await registry.consumeReset("codex:work");
  expect(consumed).toEqual([{ login: "live" }]);
  expect(outcome).toEqual({ code: "reset", windows: 2, message: "2 windows started again" });
  expect(fetched).toEqual(["expired", "live"]);
  expect(entry.report).toMatchObject({ status: "available", windows: [{ usedPct: 0 }] });
  // 之后的普通读取拿到的是用掉之后的读数
  const [cached] = await registry.listReports({ reportIds: ["codex:work"] });
  expect(cached?.report).toMatchObject({ windows: [{ usedPct: 0 }] });
});

test("each reset outcome gets its words, and an unknown one is passed on as said", async () => {
  for (const [code, windows, message] of [
    ["reset", 1, "1 window started again"],
    ["nothing_to_reset", 0, "nothing to reset — no window has been used, and the reset is kept"],
    ["no_credit", 0, "no reset left on the account"],
    ["already_redeemed", 0, "that reset was already used"],
    ["already_used", 0, "that reset was already used"],
    ["cooldown", 0, "cooldown"],
  ] as const) {
    const registry = new UsageSourceRegistry();
    registry.register({
      ...source({ id: "codex", discover: async () => [{ key: "work", input: {} }] }),
      consumeReset: async () => ({ code, windows }),
    });
    await registry.listReports();
    expect((await registry.consumeReset("codex:work")).outcome).toEqual({ code, windows, message });
  }
});

test("a source that can't use resets says so and its reports don't offer it", async () => {
  const registry = new UsageSourceRegistry();
  registry.register(source({ id: "claude", discover: async () => [{ key: "me", input: {} }] }));
  const [entry] = await registry.listReports();
  expect(entry).not.toHaveProperty("consumesResets");
  await expect(registry.consumeReset("claude:me")).rejects.toThrow("claude can't use resets");
  await expect(registry.consumeReset("claude:nobody")).rejects.toThrow(
    "Unknown usage report: claude:nobody",
  );
});

test("a failed reset leaves the cached reading alone", async () => {
  const registry = new UsageSourceRegistry({ now: () => 0 });
  let fetches = 0;
  registry.register({
    ...source({
      id: "codex",
      discover: async () => [{ key: "work", input: {} }],
      fetch: async () => {
        fetches += 1;
        return { status: "available", windows: [] };
      },
    }),
    consumeReset: async () => {
      throw new Error("Couldn't read which reset runs out first, so none was used");
    },
  });
  await registry.listReports();
  await expect(registry.consumeReset("codex:work")).rejects.toThrow("so none was used");
  await registry.listReports({ reportIds: ["codex:work"] });
  expect(fetches).toBe(1);
});

test("with CLI sign-ins off no source is asked, and a read in flight when they go off is dropped", async () => {
  let allowed = true;
  const calls: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const registry = new UsageSourceRegistry({ cliSignIns: { allowed: () => allowed } });
  registry.register({
    ...source({
      id: "codex",
      discover: async () => {
        calls.push("discover");
        return [{ key: "work", input: {} }];
      },
      fetch: async () => {
        calls.push("fetch");
        await held;
        return { status: "available", windows: [] };
      },
    }),
    consumeReset: async () => {
      calls.push("consumeReset");
      return { code: "reset", windows: 1 };
    },
  });
  const inFlight = registry.listReports();
  await expect.poll(() => calls).toEqual(["discover", "fetch"]);
  allowed = false;
  registry.forget();
  release();
  expect(await inFlight).toEqual([]);
  expect(await registry.listReports()).toEqual([]);
  expect(await registry.listReports({ reportIds: ["codex:work"] })).toEqual([]);
  expect((await registry.listLegacyUsage()).providers).toEqual([]);
  await expect(registry.consumeReset("codex:work")).rejects.toMatchObject({
    name: "CliSignInsOffError",
    operation: "usage_reset",
    reportId: "codex:work",
    userMessage: "Read CLI sign-ins is off, so a reset can't be used",
  });
  expect(calls).toEqual(["discover", "fetch"]);
  allowed = true;
  expect((await registry.listReports()).map((entry) => entry.id)).toEqual(["codex:work"]);
  expect(calls).toEqual(["discover", "fetch", "discover", "fetch"]);
});

test("retains the last successful poll across failures, cache expiry, and recovery", async () => {
  let now = 0;
  let report: unknown = {
    status: "available",
    windows: [{ id: "week", label: "Weekly", usedPct: 42 }],
  };
  const registry = new UsageSourceRegistry({ now: () => now });
  registry.register(
    source({
      id: "quota",
      discover: async () => [{ key: "account", input: {} }],
      fetch: async () => report,
    }),
  );
  registry.register(source({ id: "other", discover: async () => [{ key: "account", input: {} }] }));
  const [success] = await registry.listReports();
  now = 360_000;
  // An unrelated write evicts the expired fetch result, but must not discard its snapshot.
  await registry.listReports({ reportIds: ["other:account"], forceRefresh: true });
  report = { status: "error", error: "Rate limited" };
  const [failure] = await registry.listReports({ reportIds: ["quota:account"] });
  expect(failure).toMatchObject({
    fetchedAt: new Date(now).toISOString(),
    report,
    lastSuccessful: { fetchedAt: success!.fetchedAt, report: success!.report },
  });
  now += 360_000;
  const [repeated] = await registry.listReports({ reportIds: ["quota:account"] });
  expect(repeated?.lastSuccessful).toEqual(failure?.lastSuccessful);
  report = { status: "unavailable", problem: { kind: "no_quota", detail: "No quota" } };
  const [unavailable] = await registry.listReports({
    reportIds: ["quota:account"],
    forceRefresh: true,
  });
  expect(unavailable?.lastSuccessful).toEqual(failure?.lastSuccessful);
  now += 1000;
  report = { status: "available", windows: [{ id: "week", label: "Weekly", usedPct: 43 }] };
  const [recovered] = await registry.listReports({
    reportIds: ["quota:account"],
    forceRefresh: true,
  });
  expect(recovered?.report).toEqual(report);
  expect(recovered?.lastSuccessful).toBeUndefined();
  expect(recovered?.fetchedAt).toBe(new Date(now).toISOString());
});

test("successful history is isolated by login set and pruned when identities retire", async () => {
  let login = "old";
  let present = true;
  let available = true;
  const registry = new UsageSourceRegistry();
  const fixture = source({
    id: "source",
    discover: async () => (present ? [{ key: "same", input: login }] : []),
    fetch: async () =>
      available ? { status: "available", windows: [] } : { status: "error", error: "failed" },
  });
  registry.register(fixture);
  await registry.listReports();
  available = false;
  login = "new";
  expect((await registry.listReports({ forceRefresh: true }))[0]?.lastSuccessful).toBeUndefined();
  login = "old";
  expect((await registry.listReports({ forceRefresh: true }))[0]?.lastSuccessful).toBeUndefined();
  available = true;
  await registry.listReports({ forceRefresh: true });
  present = false;
  expect(await registry.listReports()).toEqual([]);
  present = true;
  available = false;
  expect((await registry.listReports())[0]?.lastSuccessful).toBeUndefined();
  available = true;
  await registry.listReports({ forceRefresh: true });
  registry.unregister("source");
  registry.register(fixture);
  available = false;
  expect((await registry.listReports())[0]?.lastSuccessful).toBeUndefined();
});

test("host fallback history never supplies an agent's failed login, and removed agents lose history", async () => {
  const sessions = new Map([["agent", { provider: "codex", env: {}, sessionKey: "one" }]]);
  let available = true;
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: (id) => sessions.has(id),
      usageSession: (id) => sessions.get(id) ?? null,
    },
  });
  registry.register({
    id: "source",
    label: "Source",
    discover: async (scope) =>
      (scope.kind === "global" ? ["host", "agent"] : ["agent"]).map((input) => ({
        key: "same",
        input,
      })),
    fetch: async () =>
      available ? { status: "available", windows: [] } : { status: "error", error: "failed" },
  });
  await registry.listReports();
  available = false;
  expect((await registry.listReports({ agentId: "agent" }))[0]?.lastSuccessful).toBeUndefined();
  available = true;
  const [success] = await registry.listReports({ agentId: "agent", forceRefresh: true });
  available = false;
  expect(
    (await registry.listReports({ agentId: "agent", forceRefresh: true }))[0]?.lastSuccessful
      ?.report,
  ).toEqual(success?.report);
  sessions.delete("agent");
  await registry.listReports();
  sessions.set("agent", { provider: "codex", env: {}, sessionKey: "two" });
  expect((await registry.listReports({ agentId: "agent" }))[0]?.lastSuccessful).toBeUndefined();
});

test("a timed out poll retains successful values and late completion cannot replace the failure", async () => {
  let now = 1000;
  let finish!: (value: unknown) => void;
  let slow = false;
  const registry = new UsageSourceRegistry({ now: () => now, deadlineMs: 10 });
  registry.register(
    source({
      id: "source",
      discover: async () => [{ key: "same", input: {} }],
      fetch: async () =>
        slow
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : { status: "available", windows: [] },
    }),
  );
  const [success] = await registry.listReports();
  now = 2000;
  slow = true;
  const [failure] = await registry.listReports({ forceRefresh: true });
  expect(failure?.report).toEqual({ status: "error", error: "Usage fetch timed out" });
  expect(failure?.lastSuccessful).toEqual({
    fetchedAt: success?.fetchedAt,
    report: success?.report,
  });
  finish({ status: "available", windows: [{ id: "late", label: "Late" }] });
  expect((await registry.listReports())[0]).toEqual(failure);
});

test("attempt ordering keeps its timestamp while retained freshness records successful completion", async () => {
  let now = 1000;
  let available = true;
  const registry = new UsageSourceRegistry({ now: () => now });
  registry.register(
    source({
      id: "source",
      discover: async () => [{ key: "same", input: {} }],
      fetch: async () => {
        if (available) now = 2000;
        return available
          ? { status: "available", windows: [] }
          : { status: "error", error: "failed" };
      },
    }),
  );
  const [success] = await registry.listReports();
  expect(success?.fetchedAt).toBe(new Date(1000).toISOString());
  expect(success?.successfulAt).toBe(new Date(2000).toISOString());
  available = false;
  now = 3000;
  const [failure] = await registry.listReports({ forceRefresh: true });
  expect(failure?.fetchedAt).toBe(new Date(3000).toISOString());
  expect(failure?.lastSuccessful?.fetchedAt).toBe(success?.successfulAt);
});

test("failed discovery preserves history until discovery confirms account removal", async () => {
  let discoveryFails = false;
  let present = true;
  let available = true;
  const registry = new UsageSourceRegistry({ now: () => 1000, logger: { warn: () => {} } });
  registry.register(
    source({
      id: "source",
      discover: async () => {
        if (discoveryFails) throw new Error("Login store temporarily unavailable");
        return present ? [{ key: "account", input: {} }] : [];
      },
      fetch: async () =>
        available
          ? { status: "available", windows: [{ id: "weekly", label: "Weekly", usedPct: 42 }] }
          : { status: "error", error: "Rate limited" },
    }),
  );
  const [success] = await registry.listReports();
  available = false;
  discoveryFails = true;
  const [duringDiscoveryFailure] = await registry.listReports({ forceRefresh: true });
  expect(duringDiscoveryFailure?.lastSuccessful).toEqual({
    fetchedAt: success?.successfulAt,
    report: success?.report,
  });
  discoveryFails = false;
  const [afterDiscoveryRecovery] = await registry.listReports({ forceRefresh: true });
  expect(afterDiscoveryRecovery?.lastSuccessful).toEqual(duringDiscoveryFailure?.lastSuccessful);
  expect(afterDiscoveryRecovery?.report).toEqual({ status: "error", error: "Rate limited" });
  present = false;
  expect(await registry.listReports()).toEqual([]);
  present = true;
  expect((await registry.listReports())[0]?.lastSuccessful).toBeUndefined();
});

test("turning Read CLI sign-ins off forgets successful readings, and a read in flight leaves none behind", async () => {
  let available = true;
  let hold = false;
  let release = () => {};
  const calls: string[] = [];
  const registry = new UsageSourceRegistry();
  registry.register(
    source({
      id: "codex",
      discover: async () => [{ key: "work", input: {} }],
      fetch: async () => {
        calls.push("fetch");
        if (hold)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return available
          ? { status: "available", windows: [] }
          : { status: "error", error: "failed" };
      },
    }),
  );
  await registry.listReports();
  registry.forget();
  available = false;
  expect((await registry.listReports())[0]?.lastSuccessful).toBeUndefined();

  // 关掉之前开始、关掉之后才成功的读取，不留下读数。
  available = true;
  hold = true;
  calls.length = 0;
  const inFlight = registry.listReports({ forceRefresh: true });
  await expect.poll(() => calls).toEqual(["fetch"]);
  registry.forget();
  release();
  expect(await inFlight).toEqual([]);
  hold = false;
  available = false;
  expect((await registry.listReports())[0]?.lastSuccessful).toBeUndefined();
});

test("an agent's launch account keeps its own last successful reading after the CLI switched accounts", async () => {
  let cliAccount = "one";
  let switchedAt: number | null = null;
  let savedLoginWorks = true;
  const registry = new UsageSourceRegistry({
    agents: {
      hasAgent: () => true,
      usageSession: () => ({ provider: "codex", env: {}, sessionKey: "launch", launchedAt: 1_000 }),
    },
  });
  registry.useSavedAccounts({
    accountAt: ({ at }) =>
      switchedAt !== null && switchedAt > at && cliAccount !== "one"
        ? { key: "one", label: "one@example.com" }
        : null,
    usageInput: async ({ key }) => ({ token: `saved-${key}` }),
  });
  registry.register(
    source({
      id: "codex",
      discover: async () => [
        { key: cliAccount, label: `${cliAccount}@example.com`, input: { token: "cli" } },
      ],
      fetch: async (input) => {
        const token = (input as { token: string }).token;
        if (token !== "cli" && !savedLoginWorks) return { status: "error", error: "saved failed" };
        return {
          status: "available",
          windows: [{ id: "who", label: token === "cli" ? cliAccount : token }],
        };
      },
    }),
  );
  await registry.listReports({ agentId: "agent" });
  cliAccount = "two";
  switchedAt = 2_000;
  const [pinned] = await registry.listReports({ agentId: "agent", forceRefresh: true });
  expect(pinned?.report).toMatchObject({ windows: [{ label: "saved-one" }] });

  // 存着的登录读失败时，卡片留着的是这个号自己上次读成功的值，不是 CLI 现在的号。
  savedLoginWorks = false;
  const [failed] = await registry.listReports({ agentId: "agent", forceRefresh: true });
  expect(failed?.id).toBe("codex:one");
  expect(failed?.report).toEqual({ status: "error", error: "saved failed" });
  expect(failed?.lastSuccessful?.report).toEqual(pinned?.report);
});
