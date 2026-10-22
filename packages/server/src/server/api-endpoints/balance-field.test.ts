// 用例照 magpie（https://github.com/yetone/magpie，internal/provider/balance_test.go 的 TestReadBalancePath、TestBalancePathLists，
// balance_parts_test.go 的 TestBalanceParts，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { describe, expect, test } from "vitest";
import { defaultBalanceField } from "@getpaseo/protocol/api-endpoint/balance-settings";
import { readBalanceField } from "./balance-field.js";

/** 读成一行，照 magpie joinBalanceParts：「标签 金额」以「 · 」相连；取不到值时是那句说明。 */
function lineOf(reply: unknown, field: string): string {
  const read = readBalanceField(reply, field);
  if (read.kind === "no_value") return `error: ${read.detail}`;
  return read.items
    .map((item) => (item.label === null ? item.text : `${item.label} ${item.text}`))
    .join(" · ");
}

describe("readBalanceField", () => {
  const body = {
    code: true,
    credits: { monthlyCredits: 42 },
    data: { total_available: 2500000, name: "x", list: [{ left: "7.5" }] },
  };

  test.each([
    ["data.total_available", "2500000.00"],
    ["$ data.total_available / 500000", "$5.00"],
    ["¥data.list.0.left", "¥7.50"],
    ["data.name", "x"],
    [" data.total_available/1000000 ", "2.50"],
    ["(1-credits.monthlyCredits/70)%", "40%"],
    ["$ (data.total_available - data.list.0.left * 100000) / 500000", "$3.50"],
    ["credits.monthlyCredits * 2 + 1", "85.00"],
    ["-credits.monthlyCredits", "-42.00"],
    ["credits.monthlyCredits / 70 %", "60%"],
  ])("a path, sum, sign or percent: %s reads %s", (field, want) => {
    expect(lineOf(body, field)).toBe(want);
  });

  test.each([
    "",
    "data.missing",
    "data.list.3.left",
    "data.total_available / zero",
    "data.list",
    "data.name + 1",
    "(data.total_available",
    "data.total_available / 0",
    "data.total_available 2",
    "%",
  ])("%j reads no value", (field) => {
    expect(readBalanceField(body, field).kind).toBe("no_value");
  });

  test("each kind of mistake says what is wrong, as magpie says it", () => {
    const detail = (field: string) => {
      const read = readBalanceField(body, field);
      return read.kind === "no_value" ? read.detail : null;
    };
    expect(detail("")).toBe("no balance path: where in the reply the amount is, e.g. data.balance");
    expect(detail("data.missing")).toBe('nothing at "data.missing" in the reply');
    expect(detail("data.list")).toBe('"data.list" in the reply is not an amount');
    expect(detail("data.name + 1")).toBe('"data.name" in the reply is not a number');
    expect(detail("(data.total_available")).toBe("the balance path has a ( without its )");
    expect(detail("data.total_available / 0")).toBe("the balance path divides by 0");
    expect(detail("data.total_available 2")).toBe('the balance path has "2" it can\'t read');
    expect(detail("data.total_available +")).toBe(
      "the balance path ends where a number or a path should be",
    );
    expect(detail("data.list[left")).toBe("the balance path has a [ without its ]");
    expect(detail("sum(data.list[left].x)")).toBe(
      "the balance path has [left], not a test like [status=active]",
    );
    expect(detail("data.list.*.left")).toBe(
      "the balance path has several values where one is wanted: put them in sum(), max(), min() or count()",
    );
    expect(detail("data.list.*.left / 2")).toBe(
      "the balance path has several values where one is wanted: put them in sum(), max(), min() or count()",
    );
    expect(detail("max(data.list.*.missing)")).toBe(
      "max() of the balance path has nothing to take it of",
    );
    expect(detail("1.2.3 + data.total_available")).toBe(
      'the balance path has "1.2.3", not a number',
    );
  });

  const windows = {
    credits: { monthlyCredits: 70.0 },
    windowLimits: { fiveHour: { used: 0, cap: 14 }, weekly: { used: 1.19, cap: 35 } },
  };

  test.each([
    [
      "5h: windowLimits.fiveHour.used / windowLimits.fiveHour.cap %; week: windowLimits.weekly.used/windowLimits.weekly.cap %; $credits.monthlyCredits",
      "5h 0% · week 3.4% · $70.00",
    ],
    ["credits.monthlyCredits;", "70.00"],
    [" left : $credits.monthlyCredits", "left $70.00"],
  ])("several amounts with labels: %s reads %s", (field, want) => {
    expect(lineOf(windows, field)).toBe(want);
  });

  test.each([";", "5h: windowLimits.hour.used; week: windowLimits.weekly.used / 0", "week:"])(
    "several amounts none of which can be read: %j reads no value",
    (field) => {
      expect(readBalanceField(windows, field).kind).toBe("no_value");
    },
  );

  test("each amount comes apart, its label apart and a percent's share as a ratio for a bar", () => {
    const reply = { data: { total_available: 1000000, today: 2.5, used: 45, granted: 50 } };
    const several = readBalanceField(
      reply,
      "Balance: $data.total_available / 500000; Today: $data.today; Used: data.used / data.granted %",
    );
    expect(several).toEqual({
      kind: "items",
      items: [
        { label: "Balance", text: "$2.00", value: 2, unit: "USD", ratio: null },
        { label: "Today", text: "$2.50", value: 2.5, unit: "USD", ratio: null },
        { label: "Used", text: "90%", value: 90, unit: "%", ratio: 0.9 },
      ],
    });
    expect(readBalanceField(reply, "¥data.today")).toEqual({
      kind: "items",
      items: [{ label: null, text: "¥2.50", value: 2.5, unit: "CNY", ratio: null }],
    });
    expect(readBalanceField({ name: "plan" }, "name")).toEqual({
      kind: "items",
      items: [{ label: null, text: "plan", value: null, unit: null, ratio: null }],
    });
  });

  test("an amount the reply hasn't is a dash while the others show", () => {
    expect(readBalanceField(windows, "a: credits.monthlyCredits; b: credits.missing")).toEqual({
      kind: "items",
      items: [
        { label: "a", text: "70.00", value: 70, unit: null, ratio: null },
        { label: "b", text: "—", value: null, unit: null, ratio: null },
      ],
    });
  });

  describe("a list's items", () => {
    const one = {
      data: {
        subscriptions: [
          {
            subscription: {
              status: "active",
              amount_total: 50000000,
              amount_used: 31593277,
              weekly_amount_total: 0,
              weekly_amount_used: 0,
            },
          },
        ],
        all_subscriptions: [{ subscription: { status: "expired", "...": "..." } }],
      },
    };
    const two = {
      data: {
        subscriptions: [
          {
            subscription: {
              status: "active",
              amount_total: 50000000,
              amount_used: 31593277,
              weekly_amount_total: 0,
              weekly_amount_used: 0,
            },
          },
          {
            subscription: {
              status: "active",
              amount_total: "10000000",
              amount_used: 5000000,
              weekly_amount_total: 4000000,
              weekly_amount_used: 1000000,
            },
          },
          {
            subscription: {
              status: "expired",
              amount_total: 90000000,
              amount_used: 90000000,
              weekly_amount_total: 1000000,
              weekly_amount_used: 1000000,
            },
          },
        ],
      },
    };
    const used =
      "sum(data.subscriptions[subscription.status=active].subscription.amount_used) / sum(data.subscriptions[subscription.status=active].subscription.amount_total) %";
    const week =
      "max(data.subscriptions[subscription.status=active].subscription.weekly_amount_used / data.subscriptions[subscription.status=active].subscription.weekly_amount_total) %";
    const count = "count(data.subscriptions.*.subscription[status='active'])";

    test.each([
      [one, used, "63.2%"],
      [two, used, "61%"],
      [one, "$ sum(data.subscriptions.*.subscription.amount_used) / 500000", "$63.19"],
      [two, "max(data.subscriptions.*.subscription.amount_used)", "90000000.00"],
      [two, "min(data.subscriptions.*.subscription.amount_used)", "5000000.00"],
      [two, "count(data.subscriptions[subscription.status!=active])", "1.00"],
      [one, "sum(data.all_subscriptions.*.subscription.amount_used)", "0.00"],
      [two, week, "25%"],
      [two, count, "2.00"],
      [
        two,
        "sum(data.subscriptions.*.subscription[status=active].amount_total) / 1000000",
        "60.00",
      ],
      [
        two,
        "max(data.subscriptions.*.subscription.weekly_amount_used / data.subscriptions.*.subscription.weekly_amount_total) %",
        "100%",
      ],
      [
        two,
        "sum(data.subscriptions[subscription.status=active].subscription.amount_used) * 2 / 1000000",
        "73.19",
      ],
      [[{ left: 1 }, { left: 2.5 }], "sum(*.left)", "3.50"],
      [{ a: { x: { n: 1 }, y: { n: 4 } } }, "max(a.*.n)", "4.00"],
      [one, `used: ${used}; week: ${week}`, "used 63.2% · week —"],
      [
        one,
        "first: data.subscriptions.0.subscription.amount_used; second: data.subscriptions.1.subscription.amount_used",
        "first 31593277.00 · second —",
      ],
      [
        one,
        `all: data.subscriptions.0.subscription.amount_used + data.subscriptions.1.subscription.amount_used; used: ${used}`,
        "all — · used 63.2%",
      ],
    ])("%#: %s reads %s", (reply, field, want) => {
      expect(lineOf(reply, field as string)).toBe(want);
    });

    test.each([
      "data.subscriptions.*.subscription.amount_used",
      "data.subscriptions[subscription.status=active].subscription.amount_used / 2",
      "data.subscriptions.*.subscription.amount_used %",
      "max(data.all_subscriptions.*.subscription.amount_used)",
      week,
      `week: ${week}; second: data.subscriptions.1.subscription.amount_used`,
      "sum(data.subscriptions.*.subscription.amount_used",
      "sum(data.subscriptions[status.amount_used)",
      "sum(data.subscriptions[status].amount_used)",
    ])("%j reads no value", (field) => {
      expect(readBalanceField(one, field).kind).toBe("no_value");
    });

    test("a filter compares numbers as plain decimals, and a string a number only when written in decimal", () => {
      const reply = {
        list: [
          { id: 1e21, left: 1 },
          { id: 1e-7, left: 2 },
          { id: 5, left: "0x10" },
        ],
      };
      expect(lineOf(reply, "sum(list[id=1000000000000000000000].left)")).toBe("1.00");
      expect(lineOf(reply, "sum(list[id=0.0000001].left)")).toBe("2.00");
      expect(lineOf(reply, "list.2.left")).toBe("0x10");
    });

    test("lists of different lengths put together read no value", () => {
      const read = readBalanceField(
        two,
        "sum(data.subscriptions.*.subscription.amount_used + data.subscriptions[subscription.status=active].subscription.amount_total)",
      );
      expect(read).toEqual({ kind: "no_value", detail: "the balance path puts 3 values with 2" });
    });
  });
});

describe("defaultBalanceField", () => {
  test.each([
    ["https://relay.example.com/api/usage/token", "$data.total_available / 500000"],
    ["https://relay.example.com/api/usage/token/", "$data.total_available / 500000"],
    ["https://relay.example.com/api/user/self", "$data.quota / 500000"],
    ["https://relay.example.com/api/v1/user/profile", "$data.balance"],
    ["https://relay.example.com/v1/usage", "$remaining"],
    ["https://relay.example.com/v1/dashboard/billing/credit_grants", "$total_available"],
    ["https://relay.example.com/dashboard/billing/credit_grants", "$total_available"],
  ])("a query whose reply is known: %s reads %s", (url, field) => {
    expect(defaultBalanceField(url)).toBe(field);
  });

  test("any other address has no default", () => {
    expect(defaultBalanceField("https://relay.example.com/other")).toBeNull();
    expect(defaultBalanceField("not a url")).toBeNull();
  });
});
