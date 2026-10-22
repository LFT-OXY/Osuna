import { beforeAll, describe, expect, it } from "vitest";
import type { ApiEndpointBalanceWindow } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { i18n } from "@/i18n/i18next";
import { windowLabel } from "./balance-copy";

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
