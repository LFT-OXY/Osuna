import { describe, expect, it } from "vitest";
import type { UsageRequestRow } from "@getpaseo/protocol/usage/types";
import {
  formatRequestMs,
  INITIAL_USAGE_REQUESTS_FILTERS,
  mergeUsageRequestPages,
  toUsageRequestFilters,
  usageRequestsFiltersFor,
  usageRequestStatus,
  type UsageRequestsPage,
} from "./requests";

function row(id: string, at: string, overrides: Partial<UsageRequestRow> = {}): UsageRequestRow {
  return {
    id,
    at,
    cli: "claude",
    model: "kimi-k2",
    through: "gateway",
    endpointId: "ep_a",
    endpointName: "Relay A",
    endpointDeleted: false,
    totals: { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, reasoning: 0 },
    estimatedCost: 0,
    priced: false,
    durationMs: 900,
    ttftMs: 200,
    outputSpeed: 50,
    status: "ok",
    error: null,
    attempts: [],
    replyId: id,
    sessionId: "s",
    project: null,
    ...overrides,
  };
}

function attempt(endpointId: string, result: "answered" | "failed", failure: string | null) {
  return {
    endpointId,
    endpointName: endpointId,
    model: "m",
    startedAt: "2026-10-23T00:00:00.000Z",
    durationMs: 1,
    result,
    failure,
    reason: null,
    cooldownUntil: null,
    reasked: false,
  };
}

const EMPTY_FACETS = { clis: [], endpoints: [], models: [] };

describe("mergeUsageRequestPages", () => {
  it("interleaves the hosts newest first, cuts the page, and adds the totals", () => {
    const pages: UsageRequestsPage[] = [
      {
        serverId: "h1",
        requests: [row("a3", "2026-10-23T03:00:00Z"), row("a1", "2026-10-23T01:00:00Z")],
        total: 7,
        facets: EMPTY_FACETS,
      },
      {
        serverId: "h2",
        requests: [row("b2", "2026-10-23T02:00:00Z"), row("b0", "2026-10-23T00:00:00Z")],
        total: 5,
        facets: EMPTY_FACETS,
      },
    ];
    const merged = mergeUsageRequestPages(pages, { offset: 1, limit: 2 });
    expect(merged.rows.map((one) => one.key)).toEqual(["h2:b2", "h1:a1"]);
    expect(merged.total).toBe(12);
  });

  it("offers an endpoint name once across hosts, with every host's id, and Official first", () => {
    const merged = mergeUsageRequestPages(
      [
        {
          serverId: "h1",
          requests: [],
          total: 0,
          facets: {
            clis: ["codex"],
            endpoints: [
              { endpointId: "ep_z", name: "Zeta", deleted: false },
              { endpointId: "ep_1", name: "Relay", deleted: true },
            ],
            models: ["m2"],
          },
        },
        {
          serverId: "h2",
          requests: [],
          total: 0,
          facets: {
            clis: ["claude", "codex"],
            endpoints: [
              { endpointId: "ep_2", name: "Relay", deleted: false },
              { endpointId: null, name: null, deleted: false },
            ],
            models: ["m1", "m2"],
          },
        },
      ],
      { offset: 0, limit: 100 },
    );
    expect(merged.clis).toEqual(["claude", "codex"]);
    expect(merged.models).toEqual(["m1", "m2"]);
    expect(merged.endpoints).toEqual([
      { key: "official", name: null, deleted: false, endpointIds: [null] },
      { key: "name:Relay", name: "Relay", deleted: false, endpointIds: ["ep_1", "ep_2"] },
      { key: "name:Zeta", name: "Zeta", deleted: false, endpointIds: ["ep_z"] },
    ]);
  });
});

describe("toUsageRequestFilters", () => {
  it("sends only what is chosen, the endpoint as every id of its name, and the search trimmed", () => {
    expect(toUsageRequestFilters(INITIAL_USAGE_REQUESTS_FILTERS)).toEqual({});
    expect(
      toUsageRequestFilters({
        status: "failed",
        through: "gateway",
        cli: "codex",
        endpoint: {
          key: "name:Relay",
          endpointIds: ["ep_1", "ep_2"],
          name: "Relay",
          deleted: false,
        },
        model: "gpt-5.5",
        search: "  quota ",
      }),
    ).toEqual({
      status: "failed",
      through: "gateway",
      clis: ["codex"],
      endpoints: ["ep_1", "ep_2"],
      models: ["gpt-5.5"],
      search: "quota",
    });
  });
});

describe("usageRequestsFiltersFor", () => {
  it("chooses the endpoint's name in the menu but asks only for its own id, every other filter at all", () => {
    const filters = usageRequestsFiltersFor({ endpointId: "ep_1", endpointName: "Relay" });
    expect(filters.endpoint?.key).toBe("name:Relay");
    expect(toUsageRequestFilters(filters)).toEqual({ endpoints: ["ep_1"] });
  });
});

describe("usageRequestStatus", () => {
  it("is failed with the last try's class, switched by the tries before the answer, or ok", () => {
    expect(
      usageRequestStatus(
        row("f", "t", {
          status: "cancelled",
          attempts: [attempt("ep_b", "failed", "other"), attempt("ep_d", "failed", "canceled")],
        }),
      ),
    ).toEqual({ kind: "failed", failure: "canceled" });
    expect(usageRequestStatus(row("f", "t", { status: "failed" }))).toEqual({
      kind: "failed",
      failure: null,
    });
    expect(
      usageRequestStatus(
        row("s", "t", {
          attempts: [
            attempt("ep_b", "failed", "quota"),
            attempt("ep_c", "failed", "rate"),
            attempt("ep_d", "answered", null),
          ],
        }),
      ),
    ).toEqual({ kind: "switched", count: 2 });
    expect(
      usageRequestStatus(row("o", "t", { attempts: [attempt("ep_a", "answered", null)] })),
    ).toEqual({ kind: "ok" });
  });
});

describe("formatRequestMs", () => {
  it("writes ms under a second, one decimal under ten seconds and whole seconds above", () => {
    expect(formatRequestMs(850)).toBe("850 ms");
    expect(formatRequestMs(999.6)).toBe("1.0 s");
    expect(formatRequestMs(1234)).toBe("1.2 s");
    expect(formatRequestMs(12_345)).toBe("12 s");
    expect(formatRequestMs(null)).toBe("—");
  });
});
