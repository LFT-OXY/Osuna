import type {
  UsageAgentSummary,
  UsageAgentTurn,
  UsageModelAmount,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { renderUsageText } from "./text";
import {
  addRunningTurnElapsed,
  buildTurnUsagePanel,
  describeUnpricedWarning,
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

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

describe("matchTurnUsage", () => {
  const withTurnId = turn({ turnKey: "prompt-a", turnId: "paseo-turn-1", userMessageIds: ["u1"] });
  const withMessageIdOnly = turn({ turnKey: "prompt-b", turnId: null, userMessageIds: ["u2"] });

  it("matches on the Paseo turn id first", () => {
    expect(
      matchTurnUsage([withMessageIdOnly, withTurnId], {
        turnId: "paseo-turn-1",
        userMessageId: "u2",
      }),
    ).toEqual(withTurnId);
  });

  it("falls back to the first user message id when no row carries the turn id", () => {
    expect(
      matchTurnUsage([withTurnId, withMessageIdOnly], {
        turnId: "paseo-turn-missing",
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

describe("buildTurnUsagePanel", () => {
  const sonnet = model(
    "claude-sonnet-4-5",
    { input: 100, cachedInput: 20, cacheWrite: 5, output: 50, reasoning: 12 },
    0.02,
  );
  const glm = model("glm-4.6", { input: 40, output: 10, reasoning: 4 }, 0);
  const sonnetRow = {
    model: "claude-sonnet-4-5",
    input: 100,
    cache: 25,
    output: 50,
    reasoning: 12,
    estimatedCost: 0.02,
    priced: true,
  };
  const glmRow = {
    model: "glm-4.6",
    input: 40,
    cache: 0,
    output: 10,
    reasoning: 4,
    estimatedCost: 0,
    priced: false,
  };

  it("names the one model and takes the totals from the turn, reasoning kept inside output", () => {
    expect(
      buildTurnUsagePanel(
        turn({
          byModel: [sonnet],
          totals: totals({ input: 100, cachedInput: 20, cacheWrite: 5, output: 50, reasoning: 12 }),
          estimatedCost: 0.02,
          priced: true,
        }),
      ),
    ).toEqual({
      totals: {
        input: 100,
        cache: 25,
        output: 50,
        reasoning: 12,
        estimatedCost: 0.02,
        priced: true,
      },
      models: { kind: "single", model: sonnetRow },
      unpricedModels: [],
    });
  });

  it("lists every model of a turn that ran more than one, and the ones without price data", () => {
    expect(
      buildTurnUsagePanel(
        turn({
          byModel: [sonnet, glm],
          totals: totals({ input: 140, cachedInput: 20, cacheWrite: 5, output: 60, reasoning: 16 }),
          estimatedCost: 0.02,
          priced: false,
        }),
      ),
    ).toEqual({
      totals: {
        input: 140,
        cache: 25,
        output: 60,
        reasoning: 16,
        estimatedCost: 0.02,
        priced: false,
      },
      models: { kind: "multi", models: [sonnetRow, glmRow] },
      unpricedModels: ["glm-4.6"],
    });
  });

  it("costs nothing when no model of the turn has price data", () => {
    expect(
      buildTurnUsagePanel(
        turn({
          byModel: [glm],
          totals: totals({ input: 40, output: 10, reasoning: 4 }),
          estimatedCost: 0,
          priced: false,
        }),
      ),
    ).toEqual({
      totals: { input: 40, cache: 0, output: 10, reasoning: 4, estimatedCost: 0, priced: false },
      models: { kind: "single", model: glmRow },
      unpricedModels: ["glm-4.6"],
    });
  });

  it("names no model for a turn the daemon broke down by none", () => {
    expect(buildTurnUsagePanel(turn()).models).toEqual({ kind: "none" });
  });
});

describe("describeUnpricedWarning", () => {
  it("names the models counted at $0 with two keys rather than a plural suffix", () => {
    expect(renderUsageText(i18n.t, describeUnpricedWarning(["glm-4.6"], ", "))).toBe(
      "glm-4.6 has no price data and counts as $0. Set a custom price in Settings › Price table.",
    );
    expect(
      renderUsageText(i18n.t, describeUnpricedWarning(["glm-4.6", "orcarouter/qwen3"], ", ")),
    ).toBe(
      "glm-4.6, orcarouter/qwen3 have no price data and count as $0. Set custom prices in Settings › Price table.",
    );
  });

  it("has a key for every runtime-assembled name", () => {
    for (const key of [
      "message.turnUsage.unpricedWarningOne",
      "message.turnUsage.unpricedWarningMany",
    ]) {
      expect(i18n.exists(key), key).toBe(true);
    }
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
