import { describe, expect, it } from "vitest";
import {
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
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

describe("usage.sessions.list", () => {
  const SESSION_ROW = {
    day: "2026-09-18",
    cli: "claude" as const,
    backend: null,
    sessionId: "sess-1",
    cwd: "/work/demo",
    project: { rootPath: "/work/demo", displayName: "demo", kind: "git" as const },
    models: [{ model: "claude-opus-5", totals: EMPTY_TOTALS, estimatedCost: 0, priced: true }],
    totals: EMPTY_TOTALS,
    estimatedCost: 0,
    turns: 2,
    durationMs: 5_000,
    firstAt: "2026-09-18T09:00:00.000Z",
    lastAt: "2026-09-18T09:30:00.000Z",
    handle: { providerId: "claude", providerHandleId: "sess-1" },
  };

  it("parses a request with only the required range fields", () => {
    const message = {
      type: "usage.sessions.list.request" as const,
      requestId: "req-1",
      from: null,
      to: null,
      timezone: "UTC",
    };
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });

  it("parses a request carrying filters", () => {
    const message = {
      type: "usage.sessions.list.request" as const,
      requestId: "req-2",
      from: "2026-09-18",
      to: "2026-09-18",
      timezone: "Asia/Kolkata",
      filters: { projects: ["/work/demo"] },
    };
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });

  it("parses a row whose session Osuna owns, and one it does not", () => {
    const message = {
      type: "usage.sessions.list.response" as const,
      payload: {
        requestId: "req-1",
        sessions: [
          SESSION_ROW,
          {
            ...SESSION_ROW,
            sessionId: "sess-2",
            handle: null,
            importedAgentId: "agent-1",
            importedAgentWorkspaceId: "workspace-1",
          },
        ],
        truncated: true,
      },
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

// 价格表 RPC、广播与自定义价格配置。价格写在可变 daemon 配置里，走
// set_daemon_config，不另起 RPC。
const PRICE = { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 };

describe("usage.pricing", () => {
  it("parses the list request and its response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "usage.pricing.list.request",
        requestId: "req-1",
      }),
    ).toEqual({ type: "usage.pricing.list.request", requestId: "req-1" });

    const response = {
      type: "usage.pricing.list.response" as const,
      payload: {
        requestId: "req-1",
        table: {
          fetchedAt: "2026-09-18T09:00:00.000Z",
          source: "cache" as const,
          autoUpdate: true,
        },
        models: [
          {
            model: "claude-opus-5",
            cli: "claude" as const,
            backend: null,
            priced: true,
            priceSource: "table" as const,
            matchedKey: "claude-opus-5",
            pricePerMillion: PRICE,
            lastSeenAt: "2026-09-18T09:00:00.000Z",
          },
          {
            model: "gpt-6-astra",
            cli: "pi" as const,
            backend: "openai",
            priced: false,
            priceSource: null,
            matchedKey: null,
            pricePerMillion: null,
            lastSeenAt: "2026-09-17T09:00:00.000Z",
          },
        ],
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses each refresh result", () => {
    for (const result of ["updated", "not_modified", "failed"] as const) {
      const message = {
        type: "usage.pricing.refresh.response" as const,
        payload: {
          requestId: "req-2",
          result,
          fetchedAt: "2026-09-18T09:00:00.000Z",
          error: result === "failed" ? "fetch failed" : null,
        },
      };
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  it("parses the updated broadcast, which carries nothing", () => {
    const message = { type: "usage.pricing.updated" as const };
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });

  it("subscribes to the usage broadcasts by name", () => {
    const message = {
      type: "session.events.set_subscription.request" as const,
      requestId: "req-3",
      events: ["usage.backfill.progress" as const, "usage.pricing.updated" as const],
    };
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });
});

describe("usage pricing config", () => {
  it("defaults auto-update on when the section omits it", () => {
    const config = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: true },
      usage: { pricing: { overrides: [] } },
    });
    expect(config.usage).toEqual({ pricing: { autoUpdate: true, overrides: [] } });
  });

  it("keeps auto-update untouched when a patch only edits prices", () => {
    const patch = MutableDaemonConfigPatchSchema.parse({
      usage: {
        pricing: { overrides: [{ model: "claude-opus-5", pricePerMillion: PRICE, note: "mine" }] },
      },
    });
    expect(patch.usage).toEqual({
      pricing: {
        overrides: [{ model: "claude-opus-5", pricePerMillion: PRICE, note: "mine" }],
      },
    });
  });

  it("rejects a negative price", () => {
    expect(() =>
      MutableDaemonConfigPatchSchema.parse({
        usage: {
          pricing: {
            overrides: [{ model: "claude-opus-5", pricePerMillion: { ...PRICE, input: -1 } }],
          },
        },
      }),
    ).toThrow();
  });

  it("parses a daemon config written before the section existed", () => {
    const config = MutableDaemonConfigSchema.parse({ mcp: { injectIntoAgents: true } });
    expect(config.usage).toBeUndefined();
  });
});
