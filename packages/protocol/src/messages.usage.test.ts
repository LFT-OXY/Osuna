import { describe, expect, it } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";
import type { UsageReport } from "./usage/types";

// 用量报表 RPC 与回填进度广播。老客户端不认识 features.usage 与两条新消息，
// 解析必须照常通过。
const EMPTY_TOTALS = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 };

const EMPTY_REPORT: UsageReport = {
  summary: {
    totals: EMPTY_TOTALS,
    estimatedCost: 0,
    sessionCount: 0,
    last7Days: { totals: EMPTY_TOTALS, estimatedCost: 0 },
    last30Days: { totals: EMPTY_TOTALS, estimatedCost: 0 },
  },
  sources: [],
  models: [],
  trend: { granularity: "day", stackBy: "source", points: [] },
  days: [],
  months: [],
  heatmapDays: [],
  projects: [],
  backfill: { state: "idle", filesTotal: 0, filesDone: 0, startedAt: null },
  error: null,
};

describe("usage.report.get", () => {
  it("parses a request with only the required range fields", () => {
    const message = {
      type: "usage.report.get.request" as const,
      requestId: "req-1",
      from: null,
      to: null,
      timezone: "UTC",
    };
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });

  it("parses a request carrying filters and a trend selection", () => {
    const message = {
      type: "usage.report.get.request" as const,
      requestId: "req-2",
      from: "2026-09-01",
      to: "2026-09-18",
      timezone: "Asia/Kolkata",
      filters: {
        sources: [{ cli: "pi" as const, backend: "anthropic" }],
        models: ["claude-opus-5"],
        projects: ["/work/demo"],
      },
      trend: { granularity: "hour" as const, stackBy: "model" as const },
    };
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });

  it("rejects a request without a timezone", () => {
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "usage.report.get.request",
        requestId: "req-3",
        from: null,
        to: null,
      }),
    ).toThrow();
  });

  it("parses the response payload", () => {
    const message = {
      type: "usage.report.get.response" as const,
      payload: { requestId: "req-1", ...EMPTY_REPORT },
    };
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });
});

describe("usage.backfill.progress", () => {
  it("parses a progress broadcast", () => {
    const message = {
      type: "usage.backfill.progress" as const,
      payload: {
        state: "running" as const,
        filesTotal: 12,
        filesDone: 3,
        startedAt: "2026-09-18T09:00:00.000Z",
      },
    };
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });
});

describe("server_info usage feature", () => {
  it("parses server_info without the flag (old daemon)", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv-1",
      features: { sessionHistory: true },
    });
    expect(parsed.features?.usage).toBeUndefined();
  });

  it("parses the flag when advertised", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv-1",
      features: { usage: true },
    });
    expect(parsed.features?.usage).toBe(true);
  });
});
