import { beforeAll, describe, expect, it } from "vitest";
import type { ApiEndpointBalanceWindow } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { i18n } from "@/i18n/i18next";
import { resetsLine, windowLabel } from "./balance-copy";

function labelOf(id: string, label = id): string {
  const window: ApiEndpointBalanceWindow = { id, label };
  return windowLabel({ t: i18n.t.bind(i18n), window });
}

describe("windowLabel", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names a window by its id: lengths with their count, the month, MCP and a bucket", () => {
    expect(labelOf("5h")).toBe("5 hours");
    expect(labelOf("1d")).toBe("1 day");
    expect(labelOf("7d")).toBe("7 days");
    expect(labelOf("30min")).toBe("30 minutes");
    expect(labelOf("month")).toBe("Month");
    expect(labelOf("allowance")).toBe("Plan usage");
    expect(labelOf("mcp_month")).toBe("MCP · Month");
    expect(labelOf("session")).toBe("Session limit");
    expect(labelOf("credits")).toBe("Credits");
    expect(labelOf("video:24h")).toBe("Video · 24 hours");
    expect(labelOf("image:7d#2")).toBe("Image · 7 days");
  });

  it("writes a bucket it has no words for, or an id it doesn't know, as the daemon named it", () => {
    expect(labelOf("speech:5h", "Speech · 5 hours")).toBe("Speech · 5 hours");
    expect(labelOf("weird", "Something new")).toBe("Something new");
  });

  it("has every key it builds, in Chinese too", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(labelOf("1h")).toBe("1 小时");
    expect(labelOf("video:7d")).toBe("视频 · 7 天");
    await i18n.changeLanguage("en");
  });
});

describe("resetsLine", () => {
  it("counts a team's resets by window, leaving out a window with none, in English and Chinese", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    const byWindow = { count: 3, until: null, byWindow: true, fiveHour: 2, weekly: 1 };
    expect(resetsLine({ t, resets: byWindow })).toBe("2 five-hour resets · 1 weekly reset left");
    expect(resetsLine({ t, resets: { ...byWindow, count: 1, fiveHour: 0, weekly: 1 } })).toBe(
      "1 weekly reset left",
    );
    expect(resetsLine({ t, resets: { count: 1, until: null } })).toBe("1 reset left");
    await i18n.changeLanguage("zh-CN");
    expect(resetsLine({ t: i18n.t.bind(i18n), resets: byWindow })).toBe(
      "还有 2 次 5 小时重置 · 1 次周重置",
    );
    await i18n.changeLanguage("en");
  });
});
