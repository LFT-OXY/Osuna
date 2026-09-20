import type {
  UsageAgentSummary,
  UsageAgentTurn,
  UsageModelAmount,
  UsageTokenTotals,
} from "@osuna/protocol/usage/types";
import { describe, expect, it } from "vitest";
import {
  addRunningTurnElapsed,
  buildTurnUsageBreakdown,
  hasAgentUsage,
  isTurnUsagePending,
  matchTurnUsage,
  resolveSessionSpanMs,
  summarizeTurnUsage,
} from "./turn-usage";

function totals(overrides: Partial<UsageTokenTotals> = {}): UsageTokenTotals {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, ...overrides };
}

function model(name: string, amounts: Partial<UsageTokenTotals>, cost: number): UsageModelAmount {
  return { model: name, totals: totals(amounts), estimatedCost: cost, priced: cost > 0 };
}

function turn(overrides: Partial<UsageAgentTurn> = {}): UsageAgentTurn {
  return {
    cli: "claude",
    backend: null,
    sessionId: "session-1",
    turnKey: "prompt-1",
    turnId: null,
    userMessageIds: [],
    startedAt: "2026-09-19T00:00:00.000Z",
    endedAt: "2026-09-19T00:01:00.000Z",
    durationMs: 60_000,
    byModel: [],
    totals: totals(),
    estimatedCost: 0,
    priced: true,
    ...overrides,
  };
}

describe("matchTurnUsage", () => {
  const withTurnId = turn({ turnKey: "prompt-a", turnId: "osuna-turn-1", userMessageIds: ["u1"] });
  const withMessageIdOnly = turn({ turnKey: "prompt-b", turnId: null, userMessageIds: ["u2"] });

  it("matches on the Osuna turn id first", () => {
    expect(
      matchTurnUsage([withMessageIdOnly, withTurnId], {
        turnId: "osuna-turn-1",
        userMessageId: "u2",
      }),
    ).toEqual(withTurnId);
  });

  it("falls back to the first user message id when no row carries the turn id", () => {
    expect(
      matchTurnUsage([withTurnId, withMessageIdOnly], {
        turnId: "osuna-turn-missing",
        userMessageId: "u2",
      }),
    ).toEqual(withMessageIdOnly);
  });

  it("matches on the user message id when the rendered turn has no turn id", () => {
    expect(
      matchTurnUsage([withTurnId, withMessageIdOnly], { turnId: null, userMessageId: "u1" }),
    ).toEqual(withTurnId);
  });

  it("returns nothing when neither id is in the rows", () => {
    expect(
      matchTurnUsage([withTurnId, withMessageIdOnly], { turnId: "other", userMessageId: "u9" }),
    ).toBe(null);
    expect(matchTurnUsage([withTurnId], { turnId: null, userMessageId: null })).toBe(null);
  });
});

describe("isTurnUsagePending", () => {
  it("holds space while the daemon is still reading an agent it already has rows for", () => {
    expect(isTurnUsagePending({ turns: [turn()], complete: false })).toBe(true);
  });

  it("holds nothing once the daemon has read everything", () => {
    expect(isTurnUsagePending({ turns: [turn()], complete: true })).toBe(false);
  });

  it("holds nothing for an agent the scanner never reports on", () => {
    // A mock, OpenCode or Copilot agent stays incomplete forever; a skeleton
    // there would never resolve.
    expect(isTurnUsagePending({ turns: [], complete: false })).toBe(false);
  });

  it("holds nothing before the first answer arrives", () => {
    expect(isTurnUsagePending(undefined)).toBe(false);
  });
});

describe("summarizeTurnUsage", () => {
  it("reads the arrows as uncached input and output, with reasoning already inside output", () => {
    expect(
      summarizeTurnUsage(
        turn({
          totals: totals({
            input: 14_300,
            cachedInput: 9_000,
            cacheWrite: 1_200,
            output: 4_600,
            reasoning: 1_100,
          }),
          estimatedCost: 0.17,
          priced: true,
        }),
      ),
    ).toEqual({ input: 14_300, output: 4_600, estimatedCost: 0.17, priced: true });
  });
});

describe("buildTurnUsageBreakdown", () => {
  it("folds cache reads and writes into one column and skips the total for a single model", () => {
    expect(
      buildTurnUsageBreakdown(
        turn({
          byModel: [
            model(
              "claude-sonnet-4-5",
              { input: 100, cachedInput: 20, cacheWrite: 5, output: 50 },
              0.02,
            ),
          ],
          totals: totals({ input: 100, cachedInput: 20, cacheWrite: 5, output: 50 }),
          estimatedCost: 0.02,
        }),
      ),
    ).toEqual({
      rows: [
        {
          model: "claude-sonnet-4-5",
          input: 100,
          cache: 25,
          output: 50,
          reasoning: 0,
          estimatedCost: 0.02,
          priced: true,
        },
      ],
      total: null,
    });
  });

  it("adds a total row once a turn ran more than one model", () => {
    expect(
      buildTurnUsageBreakdown(
        turn({
          byModel: [
            model(
              "claude-sonnet-4-5",
              { input: 100, cachedInput: 20, cacheWrite: 5, output: 50 },
              0.02,
            ),
            model(
              "glm-4.6",
              { input: 40, cachedInput: 0, cacheWrite: 0, output: 10, reasoning: 4 },
              0,
            ),
          ],
          totals: totals({
            input: 140,
            cachedInput: 20,
            cacheWrite: 5,
            output: 60,
            reasoning: 4,
          }),
          estimatedCost: 0.02,
          priced: false,
        }),
      ),
    ).toEqual({
      rows: [
        {
          model: "claude-sonnet-4-5",
          input: 100,
          cache: 25,
          output: 50,
          reasoning: 0,
          estimatedCost: 0.02,
          priced: true,
        },
        {
          model: "glm-4.6",
          input: 40,
          cache: 0,
          output: 10,
          reasoning: 4,
          estimatedCost: 0,
          priced: false,
        },
      ],
      total: {
        input: 140,
        cache: 25,
        output: 60,
        reasoning: 4,
        estimatedCost: 0.02,
        priced: false,
      },
    });
  });
});

describe("addRunningTurnElapsed", () => {
  const startedAt = Date.parse("2026-09-19T00:00:00.000Z");

  it("returns the settled duration when no turn is running", () => {
    expect(addRunningTurnElapsed(120_000, null, startedAt + 5_000)).toBe(120_000);
  });

  it("adds the stopwatch of the running turn", () => {
    expect(addRunningTurnElapsed(120_000, startedAt, startedAt + 7_500)).toBe(127_500);
  });

  it("never subtracts when the clock reads behind the turn start", () => {
    expect(addRunningTurnElapsed(120_000, startedAt, startedAt - 3_000)).toBe(120_000);
  });
});

describe("resolveSessionSpanMs", () => {
  function summary(overrides: Partial<UsageAgentSummary> = {}): UsageAgentSummary {
    return {
      byModel: [],
      totals: totals(),
      estimatedCost: 0,
      turns: 0,
      durationMs: 0,
      firstAt: null,
      lastAt: null,
      complete: true,
      ...overrides,
    };
  }

  it("says nothing is known about an agent the scanner never reports on", () => {
    expect(hasAgentUsage(summary())).toBe(false);
    expect(hasAgentUsage(summary({ turns: 1 }))).toBe(true);
    expect(hasAgentUsage(summary({ firstAt: "2026-09-19T00:00:00.000Z" }))).toBe(true);
  });

  it("spans the first and last logged activity", () => {
    expect(
      resolveSessionSpanMs(
        summary({ firstAt: "2026-09-19T00:00:00.000Z", lastAt: "2026-09-19T01:30:00.000Z" }),
      ),
    ).toBe(5_400_000);
  });

  it("has no span until both ends are known", () => {
    expect(resolveSessionSpanMs(summary({ firstAt: "2026-09-19T00:00:00.000Z" }))).toBe(null);
    expect(resolveSessionSpanMs(summary())).toBe(null);
  });
});
