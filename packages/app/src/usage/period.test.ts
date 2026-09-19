import { describe, expect, it } from "vitest";
import {
  addUsageDays,
  addUsageMonths,
  canShiftUsageRangeForward,
  endOfUsageMonth,
  resolveUsageNow,
  resolveUsageRange,
  resolveUsageTrendGranularity,
  shiftUsageAnchor,
  startOfUsageWeek,
} from "./period";

const CUSTOM = { from: "2026-09-01", to: "2026-09-10" };

describe("startOfUsageWeek", () => {
  it("keeps Monday and pulls Sunday back to the Monday before it", () => {
    expect(startOfUsageWeek("2026-09-14")).toBe("2026-09-14");
    expect(startOfUsageWeek("2026-09-20")).toBe("2026-09-14");
    expect(startOfUsageWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("crosses a year boundary", () => {
    expect(startOfUsageWeek("2027-01-01")).toBe("2026-12-28");
  });
});

describe("resolveUsageRange", () => {
  it("returns one day for the day period", () => {
    expect(resolveUsageRange({ period: "day", anchor: "2026-09-19", custom: CUSTOM })).toEqual({
      from: "2026-09-19",
      to: "2026-09-19",
    });
  });

  it("returns Monday to Sunday for the week period", () => {
    expect(resolveUsageRange({ period: "week", anchor: "2026-09-19", custom: CUSTOM })).toEqual({
      from: "2026-09-14",
      to: "2026-09-20",
    });
  });

  it("returns the whole calendar month", () => {
    expect(resolveUsageRange({ period: "month", anchor: "2026-02-10", custom: CUSTOM })).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("returns both ends null for all time", () => {
    expect(resolveUsageRange({ period: "all", anchor: "2026-09-19", custom: CUSTOM })).toEqual({
      from: null,
      to: null,
    });
  });

  it("orders a reversed custom range", () => {
    expect(
      resolveUsageRange({
        period: "custom",
        anchor: "2026-09-19",
        custom: { from: "2026-09-10", to: "2026-09-01" },
      }),
    ).toEqual({ from: "2026-09-01", to: "2026-09-10" });
  });
});

describe("shiftUsageAnchor", () => {
  it("steps a day", () => {
    expect(shiftUsageAnchor({ period: "day", anchor: "2026-03-01", delta: -1 })).toBe("2026-02-28");
  });

  it("steps a week from its Monday", () => {
    expect(shiftUsageAnchor({ period: "week", anchor: "2026-09-19", delta: -1 })).toBe(
      "2026-09-07",
    );
  });

  it("steps a month and clamps the day of month", () => {
    expect(addUsageMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftUsageAnchor({ period: "month", anchor: "2026-01-31", delta: 1 })).toBe(
      "2026-02-01",
    );
  });

  it("leaves all and custom anchors alone", () => {
    expect(shiftUsageAnchor({ period: "all", anchor: "2026-09-19", delta: 1 })).toBe("2026-09-19");
    expect(shiftUsageAnchor({ period: "custom", anchor: "2026-09-19", delta: 1 })).toBe(
      "2026-09-19",
    );
  });
});

describe("canShiftUsageRangeForward", () => {
  it("is false once the shown period contains today", () => {
    expect(
      canShiftUsageRangeForward({ period: "day", anchor: "2026-09-19", today: "2026-09-19" }),
    ).toBe(false);
    expect(
      canShiftUsageRangeForward({ period: "week", anchor: "2026-09-14", today: "2026-09-19" }),
    ).toBe(false);
  });

  it("is true for a period entirely before today", () => {
    expect(
      canShiftUsageRangeForward({ period: "day", anchor: "2026-09-18", today: "2026-09-19" }),
    ).toBe(true);
  });

  it("is false for the periods with no neighbour", () => {
    expect(
      canShiftUsageRangeForward({ period: "all", anchor: "2026-01-01", today: "2026-09-19" }),
    ).toBe(false);
    expect(
      canShiftUsageRangeForward({ period: "custom", anchor: "2026-01-01", today: "2026-09-19" }),
    ).toBe(false);
  });
});

describe("resolveUsageTrendGranularity", () => {
  it("uses hours for one or two days", () => {
    expect(resolveUsageTrendGranularity({ from: "2026-09-19", to: "2026-09-19" })).toBe("hour");
    expect(resolveUsageTrendGranularity({ from: "2026-09-18", to: "2026-09-19" })).toBe("hour");
  });

  it("uses days up to 92 days", () => {
    expect(resolveUsageTrendGranularity({ from: "2026-09-17", to: "2026-09-19" })).toBe("day");
    expect(resolveUsageTrendGranularity({ from: "2026-06-20", to: "2026-09-19" })).toBe("day");
  });

  it("uses months beyond 92 days and for all time", () => {
    expect(resolveUsageTrendGranularity({ from: "2026-06-19", to: "2026-09-19" })).toBe("month");
    expect(resolveUsageTrendGranularity({ from: null, to: null })).toBe("month");
  });
});

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addUsageDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("finds the last day of a month", () => {
    expect(endOfUsageMonth("2026-12-05")).toBe("2026-12-31");
  });
});

describe("resolveUsageNow", () => {
  it("reads the day and the hour in the viewer's own zone", () => {
    const at = new Date("2026-09-19T22:30:00.000Z");

    expect(resolveUsageNow("UTC", at)).toEqual({ day: "2026-09-19", hour: "2026-09-19T22" });
    expect(resolveUsageNow("Asia/Shanghai", at)).toEqual({
      day: "2026-09-20",
      hour: "2026-09-20T06",
    });
    expect(resolveUsageNow("America/Los_Angeles", at)).toEqual({
      day: "2026-09-19",
      hour: "2026-09-19T15",
    });
  });
});
