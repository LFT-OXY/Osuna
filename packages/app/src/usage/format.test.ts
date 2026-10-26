import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { formatAmount, formatDisplayPct, formatResetLabel, formatRunsOutLabel } from "./format";

describe("formatAmount", () => {
  it("groups thousands in the app's language", () => {
    expect(formatAmount(12345, "credits", "en")).toBe("12,345");
    expect(formatAmount(12345, "requests", "en")).toBe("12,345");
    expect(formatAmount(12345, "credits", "fr").replace(/\s/g, " ")).toBe("12 345");
  });

  it("formats dollars as the language writes currency", () => {
    expect(formatAmount(1234.5, "usd", "en")).toBe("$1,234.50");
    expect(formatAmount(1234.5, "usd", "fr").replace(/\s/g, " ")).toBe("1 234,50 $US");
  });
});

describe("formatDisplayPct", () => {
  it("writes the share used bare and names the share left", () => {
    expect(formatDisplayPct(31, "used")).toBe("31%");
    expect(formatDisplayPct(69, "remaining")).toBe("69% left");
  });

  it("names the share left in the app's language", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      expect(formatDisplayPct(31, "used")).toBe("31%");
      expect(formatDisplayPct(69, "remaining")).toBe("剩余 69%");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("window timing labels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says when a window resets", () => {
    expect(formatResetLabel("2026-10-01T14:30:00Z")).toBe("resets 2h");
    expect(formatResetLabel("2026-10-04T12:00:00Z")).toBe("resets 3d");
    expect(formatResetLabel("2026-10-01T11:00:00Z")).toBe("resetting now");
    expect(formatResetLabel(null)).toBeNull();
  });

  it("says when a window runs out, and nothing once that time has passed", () => {
    expect(formatRunsOutLabel("2026-10-01T12:45:00Z")).toBe("runs out 45m");
    expect(formatRunsOutLabel("2026-10-01T11:00:00Z")).toBeNull();
    expect(formatRunsOutLabel(null)).toBeNull();
  });

  it("reads in the app's language", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      expect(formatResetLabel("2026-10-01T14:30:00Z")).toBe("2h 后重置");
      expect(formatResetLabel("2026-10-01T11:00:00Z")).toBe("正在重置");
      expect(formatRunsOutLabel("2026-10-01T12:45:00Z")).toBe("45m 后用完");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

it("retained reset times that have passed do not claim the quota is resetting", () => {
  const past = "2000-01-01T00:00:00.000Z";
  expect(formatResetLabel(past, true)).toBe("Reset time passed");
  expect(formatResetLabel(past)).toBe("resetting now");
  expect(formatResetLabel(null, true)).toBeNull();
});
