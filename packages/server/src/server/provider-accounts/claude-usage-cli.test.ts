import { describe, expect, test } from "vitest";
import { claudeResetTime, parseClaudeUsage } from "./claude-usage-cli.js";

// 2026-10-25 08:00 UTC = 16:00 Asia/Shanghai。
const NOW = Date.parse("2026-10-25T08:00:00.000Z");
const HOUR_MS = 60 * 60_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

describe("claudeResetTime", () => {
  test("a time alone is the next one from now in the zone named", () => {
    expect(claudeResetTime({ text: "7pm (Asia/Shanghai)", now: NOW, spanMs: 5 * HOUR_MS })).toBe(
      Date.parse("2026-10-25T11:00:00.000Z"),
    );
    // 已经过了今天的 3:30pm：明天的离现在超过 5 小时窗口，取今天的（窗口算已经重新开始）。
    expect(claudeResetTime({ text: "3:30pm (Asia/Shanghai)", now: NOW, spanMs: 5 * HOUR_MS })).toBe(
      Date.parse("2026-10-25T07:30:00.000Z"),
    );
  });

  test("a date without a year is in the year that keeps it within the window", () => {
    expect(claudeResetTime({ text: "Oct 30 at 2pm (UTC)", now: NOW, spanMs: WEEK_MS })).toBe(
      Date.parse("2026-10-30T14:00:00.000Z"),
    );
    expect(claudeResetTime({ text: "Oct 31, 9:05am (UTC)", now: NOW, spanMs: WEEK_MS })).toBe(
      Date.parse("2026-10-31T09:05:00.000Z"),
    );
    // 跨年：12 月 31 日读到 1 月 2 日的重置，是明年的。
    const newYearsEve = Date.parse("2026-12-31T12:00:00.000Z");
    expect(claudeResetTime({ text: "Jan 2 at 1am (UTC)", now: newYearsEve, spanMs: WEEK_MS })).toBe(
      Date.parse("2027-01-02T01:00:00.000Z"),
    );
  });

  test("a date with a year and a zone across summer time", () => {
    expect(
      claudeResetTime({ text: "Nov 2, 2026 at 3pm (America/New_York)", now: NOW, spanMs: WEEK_MS }),
    ).toBe(Date.parse("2026-11-02T20:00:00.000Z"));
    expect(
      claudeResetTime({
        text: "Oct 30, 2026 at 3pm (America/New_York)",
        now: NOW,
        spanMs: WEEK_MS,
      }),
    ).toBe(Date.parse("2026-10-30T19:00:00.000Z"));
  });

  test("text it can't read is null", () => {
    expect(claudeResetTime({ text: "soon", now: NOW, spanMs: WEEK_MS })).toBeNull();
  });
});

describe("parseClaudeUsage", () => {
  test("reads the session and weekly windows with the plan usage source's IDs", () => {
    const reading = parseClaudeUsage(
      [
        "\u001b[1mCurrent session: 13% used · resets 7pm (Asia/Shanghai)\u001b[0m",
        "Current week (all models): 41.5% used · resets Oct 30 at 2pm (UTC)",
        "Current week (Opus 4): 5% used",
      ].join("\n"),
      NOW,
    );
    expect(reading).toEqual({
      kind: "read",
      windows: [
        {
          id: "five_hour",
          label: "Session",
          shortLabel: "5h",
          usedPct: 13,
          resetsAt: "2026-10-25T11:00:00.000Z",
        },
        {
          id: "weekly",
          label: "Weekly",
          shortLabel: "wk",
          usedPct: 41.5,
          resetsAt: "2026-10-30T14:00:00.000Z",
        },
        {
          id: "weekly_model_opus_4",
          label: "Weekly · Opus 4",
          shortLabel: "wk Opus 4",
          usedPct: 5,
          resetsAt: null,
        },
      ],
    });
  });

  test("a sign-in error wins over partial readings", () => {
    const reading = parseClaudeUsage(
      "Current session: 13% used\nOAuth token has expired · Please run /login",
      NOW,
    );
    expect(reading).toEqual({
      kind: "signed_out",
      reason: "Claude Code's /usage told no allowance: OAuth token has expired · Please run /login",
    });
  });

  test("a usage-limit notice is a failed read, not a lapsed sign-in", () => {
    expect(parseClaudeUsage("You've hit your limit · resets 7pm", NOW)).toEqual({
      kind: "failed",
      reason: "Claude Code's /usage told no allowance: You've hit your limit · resets 7pm",
    });
    expect(parseClaudeUsage("", NOW)).toEqual({
      kind: "failed",
      reason: "Claude Code's /usage is temporarily unavailable",
    });
  });
});
