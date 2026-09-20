import type { UsagePricingModel, UsagePricingOverride } from "@osuna/protocol/usage/types";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { describeTimeAgo } from "@/usage/relative-time";
import { renderUsageText } from "@/usage/text";
import {
  EMPTY_PRICE_DRAFT,
  PRICE_COLUMNS,
  buildPriceDraft,
  dedupePricingModels,
  extractFailureReason,
  describeModelCount,
  describePriceSource,
  describePriceTableSubtitle,
  formatPriceCell,
  parsePriceDraft,
  parsePriceInput,
  upsertPricingOverride,
} from "./pricing";

const NOW = Date.parse("2026-06-19T12:00:00.000Z");

function model(overrides: Partial<UsagePricingModel>): UsagePricingModel {
  return {
    model: "claude-opus-5",
    cli: "claude",
    backend: null,
    priced: true,
    priceSource: "table",
    matchedKey: "claude-opus-5",
    pricePerMillion: { input: 15, cachedInput: 1.5, cacheWrite: 18.75, output: 75 },
    lastSeenAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

describe("price cells", () => {
  it("shows the number without toFixed padding", () => {
    expect(formatPriceCell(3)).toBe("3");
    expect(formatPriceCell(0.25)).toBe("0.25");
    expect(formatPriceCell(1.25)).toBe("1.25");
    expect(formatPriceCell(18.75)).toBe("18.75");
    expect(formatPriceCell(0)).toBe("0");
    expect(formatPriceCell(0.0000001)).toBe("<0.000001");
    expect(formatPriceCell(Number.NaN)).toBe("—");
  });

  it("reads a typed price, and refuses what is not one", () => {
    expect(parsePriceInput("3")).toBe(3);
    expect(parsePriceInput(" 1.25 ")).toBe(1.25);
    expect(parsePriceInput("0")).toBe(0);
    expect(parsePriceInput("")).toBe(null);
    expect(parsePriceInput("   ")).toBe(null);
    expect(parsePriceInput("abc")).toBe(null);
    expect(parsePriceInput("-1")).toBe(null);
  });

  it("seeds the editor from the price the row already resolves to", () => {
    expect(buildPriceDraft({ input: 15, cachedInput: 1.5, cacheWrite: 18.75, output: 75 })).toEqual(
      {
        input: "15",
        cachedInput: "1.5",
        cacheWrite: "18.75",
        output: "75",
      },
    );
    expect(buildPriceDraft(null)).toEqual(EMPTY_PRICE_DRAFT);
  });

  it("takes a draft only when all four columns are numbers", () => {
    expect(parsePriceDraft({ input: "1", cachedInput: "2", cacheWrite: "3", output: "4" })).toEqual(
      { input: 1, cachedInput: 2, cacheWrite: 3, output: 4 },
    );
    expect(parsePriceDraft({ input: "1", cachedInput: "", cacheWrite: "3", output: "4" })).toBe(
      null,
    );
    expect(parsePriceDraft({ input: "1", cachedInput: "2", cacheWrite: "3", output: "-4" })).toBe(
      null,
    );
    expect(parsePriceDraft({ input: "0", cachedInput: "0", cacheWrite: "0", output: "0" })).toEqual(
      { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
    );
  });
});

describe("the override list written back to the daemon", () => {
  const existing: UsagePricingOverride[] = [
    { model: "gpt-5.5", pricePerMillion: { input: 1, cachedInput: 1, cacheWrite: 1, output: 1 } },
  ];
  const price = { input: 2, cachedInput: 3, cacheWrite: 4, output: 5 };

  it("appends a model that has no override yet", () => {
    expect(upsertPricingOverride(existing, "claude-opus-5", price)).toEqual([
      existing[0],
      { model: "claude-opus-5", pricePerMillion: price },
    ]);
  });

  it("replaces the price of a model already overridden, ignoring case and space", () => {
    expect(upsertPricingOverride(existing, " GPT-5.5 ", price)).toEqual([
      { model: "gpt-5.5", pricePerMillion: price },
    ]);
  });

  it("keeps a note that was set outside the app", () => {
    const noted: UsagePricingOverride[] = [{ ...existing[0]!, note: "negotiated rate" }];
    expect(upsertPricingOverride(noted, "gpt-5.5", price)).toEqual([
      { model: "gpt-5.5", pricePerMillion: price, note: "negotiated rate" },
    ]);
  });

  it("leaves the list alone apart from the one model", () => {
    expect(upsertPricingOverride([], "gpt-5.5", price)).toEqual([
      { model: "gpt-5.5", pricePerMillion: price },
    ]);
  });
});

describe("one row per model", () => {
  it("drops the repeats a model picks up from a second CLI", () => {
    // 覆盖价按模型名匹配，所以 (模型, CLI, 后端) 的三条其实编辑的是同一条价格。
    const rows = [
      model({ model: "claude-opus-5", cli: "claude", backend: null }),
      model({ model: "claude-opus-5", cli: "pi", backend: "anthropic" }),
      model({ model: "gpt-5.5", cli: "codex", backend: null }),
      model({ model: "CLAUDE-OPUS-5", cli: "omp", backend: "anthropic" }),
    ];

    expect(dedupePricingModels(rows).map((row) => `${row.model}:${row.cli}`)).toEqual([
      "claude-opus-5:claude",
      "gpt-5.5:codex",
    ]);
  });

  it("keeps the order the daemon sorted them in", () => {
    // 无价格的排在前面，其余按最近使用；保留先出现的那条就保住了这个顺序。
    const rows = [
      model({ model: "gpt-6-astra", priced: false, priceSource: null, pricePerMillion: null }),
      model({ model: "gpt-5.5" }),
      model({ model: "gpt-6-astra", cli: "pi", backend: "openai-codex" }),
    ];

    expect(dedupePricingModels(rows).map((row) => row.model)).toEqual(["gpt-6-astra", "gpt-5.5"]);
    expect(dedupePricingModels(rows)[0]?.priced).toBe(false);
  });

  it("leaves a list that has no repeats alone", () => {
    const rows = [model({ model: "a" }), model({ model: "b" })];
    expect(dedupePricingModels(rows)).toEqual(rows);
  });
});

describe("the reason a write was refused", () => {
  it("drops the debug tail DaemonRpcError concatenates into its message", () => {
    expect(
      extractFailureReason(
        new Error(
          "Request failed: config is read-only requestType=set_daemon_config_request code=handler_error",
        ),
      ),
    ).toBe("Request failed: config is read-only");
    expect(extractFailureReason(new Error("Session is not authorized code=access_denied"))).toBe(
      "Session is not authorized",
    );
  });

  it("passes a plain message through", () => {
    expect(extractFailureReason(new Error("socket closed"))).toBe("socket closed");
  });

  it("has nothing to say about a value that is not an error", () => {
    expect(extractFailureReason("socket closed")).toBe("");
    expect(extractFailureReason(undefined)).toBe("");
  });
});

describe("price table descriptions", () => {
  it("names where a row's price came from", () => {
    expect(describePriceSource(model({ priceSource: "table" }))).toEqual({
      key: "settings.host.priceTable.source.table",
    });
    expect(describePriceSource(model({ priceSource: "override" }))).toEqual({
      key: "settings.host.priceTable.source.override",
    });
    expect(
      describePriceSource(
        model({ priced: false, priceSource: null, matchedKey: null, pricePerMillion: null }),
      ),
    ).toEqual({ key: "settings.host.priceTable.source.none" });
  });

  it("counts models with two keys rather than a plural suffix", () => {
    expect(describeModelCount(1)).toEqual({ key: "settings.host.priceTable.modelCountOne" });
    expect(describeModelCount(7)).toEqual({
      key: "settings.host.priceTable.modelCountMany",
      params: { count: 7 },
    });
  });

  it("renders the subtitle the card shows", () => {
    const subtitle = describePriceTableSubtitle({
      fetchedAgo: describeTimeAgo("2026-06-19T09:00:00.000Z", NOW),
      modelCount: 7,
    });
    expect(renderUsageText(i18n.t, subtitle)).toBe(
      "$ per million tokens · LiteLLM snapshot, updated 3h ago, 7 models",
    );
    // 协议保证 `fetchedAt` 非空，所以描述不出来时不替 daemon 断言「刚刚更新」。
    expect(
      renderUsageText(i18n.t, describePriceTableSubtitle({ fetchedAgo: null, modelCount: 1 })),
    ).toBe("$ per million tokens · LiteLLM snapshot, updated —, 1 model");
  });

  it("has a key for every runtime-assembled name", () => {
    for (const key of [
      "settings.host.priceTable.source.table",
      "settings.host.priceTable.source.override",
      "settings.host.priceTable.source.none",
      "settings.host.priceTable.modelCountOne",
      "settings.host.priceTable.modelCountMany",
      ...PRICE_COLUMNS.map((column) => column.labelKey),
      "usage.common.time.justNow",
      "usage.common.time.minutesAgo",
      "usage.common.time.hoursAgo",
      "usage.common.time.daysAgo",
    ]) {
      expect(i18n.exists(key), key).toBe(true);
    }
  });

  it("keeps the four price columns in the order the table header prints them", () => {
    // 表头与单元格都从这一份读，所以这里锁住的是「第几列对应哪个字段」。
    expect(PRICE_COLUMNS).toEqual([
      { field: "input", labelKey: "settings.host.priceTable.columns.input" },
      { field: "cachedInput", labelKey: "settings.host.priceTable.columns.cacheRead" },
      { field: "cacheWrite", labelKey: "settings.host.priceTable.columns.cacheWrite" },
      { field: "output", labelKey: "settings.host.priceTable.columns.output" },
    ]);
  });
});
