import { describe, expect, it } from "vitest";
import type { ApiEndpointVendorStatus } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { endpointVendorNotices, subscriptionVendorOf, vendorNoticeOf } from "./vendor-status";

function status(overrides: Partial<ApiEndpointVendorStatus>): ApiEndpointVendorStatus {
  return {
    vendor: "anthropic",
    name: "Anthropic",
    page: "https://status.claude.com",
    isLinkOnly: false,
    level: "ok",
    parts: [],
    incidents: [],
    readAt: "2026-10-21T08:00:00.000Z",
    error: null,
    ...overrides,
  };
}

describe("vendorNoticeOf", () => {
  it("says nothing while the page reports the API well, or when it could not be read", () => {
    expect(vendorNoticeOf(status({ level: "ok" }))).toBeNull();
    expect(vendorNoticeOf(status({ level: null }))).toBeNull();
    expect(vendorNoticeOf(status({ level: "something_new" }))).toBeNull();
  });

  it("only links a vendor whose page is not read", () => {
    expect(
      vendorNoticeOf(
        status({
          vendor: "deepseek",
          name: "DeepSeek",
          page: "https://status.deepseek.com",
          isLinkOnly: true,
          level: null,
          readAt: null,
        }),
      ),
    ).toEqual({ vendorName: "DeepSeek", link: "https://status.deepseek.com", problem: null });
  });

  it("names the affected parts and open incidents, and links the incident's own page first", () => {
    expect(
      vendorNoticeOf(
        status({
          level: "partial",
          parts: [{ name: "Claude API (api.anthropic.com)", status: "partial_outage" }],
          incidents: [
            { name: "Elevated errors", impact: "major", url: null },
            { name: "Slow responses", impact: "minor", url: "https://stspg.io/x" },
          ],
        }),
      ),
    ).toEqual({
      vendorName: "Anthropic",
      link: "https://stspg.io/x",
      problem: {
        tone: "danger",
        details: [
          { kind: "part", name: "Claude API (api.anthropic.com)", status: "partial_outage" },
          { kind: "incident", name: "Elevated errors" },
          { kind: "incident", name: "Slow responses" },
        ],
      },
    });
  });

  it("takes its tone from the level: degraded is a warning, an outage is danger, maintenance is quiet", () => {
    const toneOf = (level: string) => vendorNoticeOf(status({ level }))?.problem?.tone;
    expect(toneOf("degraded")).toBe("warning");
    expect(toneOf("partial")).toBe("danger");
    expect(toneOf("major")).toBe("danger");
    expect(toneOf("maintenance")).toBe("muted");
  });
});

describe("endpointVendorNotices", () => {
  it("gives each endpoint its vendor's notice, and none to an endpoint on a vendor that is well", () => {
    const notices = endpointVendorNotices({
      vendors: [
        status({ level: "degraded" }),
        status({ vendor: "openai", name: "OpenAI", level: "ok" }),
      ],
      endpointVendors: { ep_a: "anthropic", ep_o: "openai", ep_x: "nobody" },
    });
    expect([...notices.keys()]).toEqual(["ep_a"]);
    expect(notices.get("ep_a")?.problem?.tone).toBe("warning");
  });

  it("has no notices without an answer", () => {
    expect(endpointVendorNotices(null).size).toBe(0);
  });
});

describe("subscriptionVendorOf", () => {
  it("matches Claude Code's and Codex's subscriptions to their vendors, and nothing else", () => {
    expect(subscriptionVendorOf("claude")).toBe("anthropic");
    expect(subscriptionVendorOf("codex")).toBe("openai");
    expect(subscriptionVendorOf("opencode")).toBeNull();
    expect(subscriptionVendorOf("constructor")).toBeNull();
  });
});
