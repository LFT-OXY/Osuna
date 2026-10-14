import { describe, expect, test } from "vitest";
import type { ApiEndpointState, StoredApiEndpoint } from "../store.js";
import { resolveGatewayRoute } from "./routing.js";

function endpoint(
  input: Pick<StoredApiEndpoint, "id" | "slug"> & Partial<StoredApiEndpoint>,
): StoredApiEndpoint {
  return {
    name: input.slug.toUpperCase(),
    baseUrls: [{ format: "anthropic_messages", url: `https://${input.slug}.example` }],
    models: [],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...input,
  };
}

function state(endpoints: StoredApiEndpoint[]): ApiEndpointState {
  return {
    endpoints,
    agents: {
      claude: { enabled: true, defaultModelId: null },
      codex: { enabled: true, defaultModelId: null },
    },
  };
}

const alpha = endpoint({ id: "ep_a", slug: "alpha", models: [{ id: "kimi-k2" }] });
const beta = endpoint({
  id: "ep_b",
  slug: "beta",
  models: [{ id: "kimi-k2" }, { id: "glm-4.6" }, { id: "moonshotai/kimi-k2" }],
});

describe("routing a requested model name to an endpoint", () => {
  test("slug/model goes straight to that endpoint and sends the bare model name", () => {
    expect(
      resolveGatewayRoute({ state: state([alpha, beta]), agent: "claude", model: "beta/kimi-k2" }),
    ).toEqual({ ok: true, endpoint: beta, upstreamModel: "kimi-k2" });
  });

  test("a bare model name goes to the earliest enabled endpoint that selected it", () => {
    const closedAlpha = { ...alpha, enabled: false };
    expect(
      resolveGatewayRoute({ state: state([alpha, beta]), agent: "codex", model: "kimi-k2" }),
    ).toEqual({ ok: true, endpoint: alpha, upstreamModel: "kimi-k2" });
    expect(
      resolveGatewayRoute({ state: state([closedAlpha, beta]), agent: "codex", model: "kimi-k2" }),
    ).toEqual({ ok: true, endpoint: beta, upstreamModel: "kimi-k2" });
  });

  test("a bare model name that itself contains a slash is matched whole", () => {
    expect(
      resolveGatewayRoute({
        state: state([alpha, beta]),
        agent: "codex",
        model: "moonshotai/kimi-k2",
      }),
    ).toEqual({ ok: true, endpoint: beta, upstreamModel: "moonshotai/kimi-k2" });
  });

  test("a Claude tier name is translated by the first endpoint that maps that tier", () => {
    const mapped = { ...beta, modelMapping: { haiku: "glm-4.6" } };
    expect(
      resolveGatewayRoute({
        state: state([alpha, mapped]),
        agent: "claude",
        model: "claude-haiku-4-5-20251001",
      }),
    ).toEqual({ ok: true, endpoint: mapped, upstreamModel: "glm-4.6" });
  });

  test("a selected Claude model is sent as is even when a tier mapping exists elsewhere", () => {
    const selectsSonnet = endpoint({
      id: "ep_c",
      slug: "gamma",
      models: [{ id: "claude-sonnet-4-5" }],
    });
    const mapped = { ...beta, modelMapping: { sonnet: "glm-4.6" } };
    expect(
      resolveGatewayRoute({
        state: state([mapped, selectsSonnet]),
        agent: "claude",
        model: "claude-sonnet-4-5",
      }),
    ).toEqual({ ok: true, endpoint: selectsSonnet, upstreamModel: "claude-sonnet-4-5" });
  });

  test("Codex requests never go through the Claude tier mapping", () => {
    const mapped = { ...beta, modelMapping: { haiku: "glm-4.6" } };
    expect(
      resolveGatewayRoute({
        state: state([mapped]),
        agent: "codex",
        model: "claude-haiku-4-5",
      }),
    ).toEqual({
      ok: false,
      message: 'No enabled API endpoint offers the model "claude-haiku-4-5"',
    });
  });

  test("a closed or deleted slug is unavailable and the same model goes to another endpoint", () => {
    const closedBeta = { ...beta, enabled: false };
    expect(
      resolveGatewayRoute({
        state: state([alpha, closedBeta]),
        agent: "claude",
        model: "beta/kimi-k2",
      }),
    ).toEqual({ ok: true, endpoint: alpha, upstreamModel: "kimi-k2" });
    expect(
      resolveGatewayRoute({ state: state([alpha]), agent: "claude", model: "gone/kimi-k2" }),
    ).toEqual({ ok: true, endpoint: alpha, upstreamModel: "kimi-k2" });
  });

  test("a model no enabled endpoint offers is an error", () => {
    expect(
      resolveGatewayRoute({
        state: state([alpha, { ...beta, enabled: false }]),
        agent: "claude",
        model: "beta/glm-4.6",
      }),
    ).toEqual({ ok: false, message: 'No enabled API endpoint offers the model "beta/glm-4.6"' });
  });
});
