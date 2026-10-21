// 范围与时刻的用例取自 magpie（https://github.com/yetone/magpie，internal/provider/concurrency.go 的 SetQuotaRest、SetRestCap、
// ParseResetAt、NextResetAt）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, it } from "vitest";
import { cooldownSettingsProblem, nextResetAt, parseResetAt } from "./cooldown-settings.js";

describe("cooldown settings in range (magpie SetQuotaRest, SetRestCap)", () => {
  it("takes whole minutes from 0 to eight days", () => {
    expect(cooldownSettingsProblem({})).toBeNull();
    expect(cooldownSettingsProblem({ quotaRestMinutes: 0, restCapMinutes: 11_520 })).toBeNull();
  });

  it("names the first field out of range: negative, past eight days, or not whole", () => {
    expect(cooldownSettingsProblem({ quotaRestMinutes: -1 })).toEqual({
      field: "quotaRestMinutes",
    });
    expect(cooldownSettingsProblem({ restCapMinutes: 11_521 })).toEqual({
      field: "restCapMinutes",
    });
    expect(cooldownSettingsProblem({ quotaRestMinutes: 1.5, restCapMinutes: -1 })).toEqual({
      field: "quotaRestMinutes",
    });
  });

  it("names a time of day it can't read", () => {
    expect(cooldownSettingsProblem({ quotaResetAt: "08:00" })).toBeNull();
    expect(cooldownSettingsProblem({ quotaResetAt: "8am" })).toEqual({ field: "quotaResetAt" });
  });
});

describe("a time of day the allowance comes back (magpie ParseResetAt)", () => {
  it("reads the host's clock, UTC and a fixed offset", () => {
    expect(parseResetAt("08:00")).toEqual({
      kind: "ok",
      at: { hour: 8, minute: 0, offsetMinutes: null },
    });
    expect(parseResetAt(" 8:30 ")).toEqual({
      kind: "ok",
      at: { hour: 8, minute: 30, offsetMinutes: null },
    });
    expect(parseResetAt("00:00+08:00")).toEqual({
      kind: "ok",
      at: { hour: 0, minute: 0, offsetMinutes: 480 },
    });
    expect(parseResetAt("23:59-05:30")).toEqual({
      kind: "ok",
      at: { hour: 23, minute: 59, offsetMinutes: -330 },
    });
    expect(parseResetAt("16:00Z")).toEqual({
      kind: "ok",
      at: { hour: 16, minute: 0, offsetMinutes: 0 },
    });
    expect(parseResetAt("16:00z")).toMatchObject({ kind: "ok" });
    expect(parseResetAt("")).toEqual({ kind: "none" });
    expect(parseResetAt("   ")).toEqual({ kind: "none" });
  });

  it("refuses what isn't HH:MM with two-digit minutes, a real hour and minute, and a -07:00 zone", () => {
    for (const bad of [
      "8",
      "8:0",
      "08:000",
      "24:00",
      "12:60",
      ":30",
      "08:00+8",
      "08:00+08",
      "08:00+0800",
      "08:00UTC",
      "08:00Zx",
      "-08:00",
      "8am",
    ]) {
      expect(parseResetAt(bad), bad).toEqual({ kind: "invalid" });
    }
  });
});

describe("the next time it comes round (magpie NextResetAt)", () => {
  const now = Date.parse("2026-10-21T06:30:00Z");

  it("today's when it is still ahead, tomorrow's when it is now or past", () => {
    expect(nextResetAt({ text: "08:00Z", now })).toBe(Date.parse("2026-10-21T08:00:00Z"));
    expect(nextResetAt({ text: "06:30Z", now })).toBe(Date.parse("2026-10-22T06:30:00Z"));
    expect(nextResetAt({ text: "05:00Z", now })).toBe(Date.parse("2026-10-22T05:00:00Z"));
  });

  it("on the vendor's clock: its day, not UTC's", () => {
    // 06:30 UTC 是北京时间 14:30：北京的 00:00 是明天的，即 UTC 今天 16:00。
    expect(nextResetAt({ text: "00:00+08:00", now })).toBe(Date.parse("2026-10-21T16:00:00Z"));
    // 06:30 UTC 是纽约（-05:00）01:30：当地 23:00 还在今天，即 UTC 明天 04:00。
    expect(nextResetAt({ text: "23:00-05:00", now })).toBe(Date.parse("2026-10-22T04:00:00Z"));
    // 当地 01:00 已过：明天的，UTC 后天 06:00。
    expect(nextResetAt({ text: "01:00-05:00", now })).toBe(Date.parse("2026-10-22T06:00:00Z"));
  });

  it("with no zone, on this computer's clock", () => {
    const local = new Date(2026, 9, 21, 9, 15).getTime();
    expect(nextResetAt({ text: "10:00", now: local })).toBe(new Date(2026, 9, 21, 10, 0).getTime());
    expect(nextResetAt({ text: "09:15", now: local })).toBe(new Date(2026, 9, 22, 9, 15).getTime());
  });

  it("none when unset or unreadable", () => {
    expect(nextResetAt({ text: "", now })).toBeNull();
    expect(nextResetAt({ text: "25:00", now })).toBeNull();
  });
});
