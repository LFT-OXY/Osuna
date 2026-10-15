import { describe, expect, test } from "vitest";
import type { ApiEndpointState, StoredApiEndpoint } from "../store.js";
import { chooseRequestFormat, resolveGatewayRoute } from "./routing.js";

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

/** 期望的候选：第一家是用户选的，后面是有同名模型、开着的其他接口。 */
function route(...candidates: [StoredApiEndpoint, string][]) {
  return {
    ok: true,
    candidates: candidates.map(([target, upstreamModel]) => ({ endpoint: target, upstreamModel })),
  };
}

describe("routing a requested model name to an endpoint", () => {
  test("slug/model goes straight to that endpoint and sends the bare model name", () => {
    expect(
      resolveGatewayRoute({ state: state([alpha, beta]), agent: "claude", model: "beta/kimi-k2" }),
    ).toEqual(route([beta, "kimi-k2"], [alpha, "kimi-k2"]));
  });

  test("a bare model name goes to the earliest enabled endpoint that selected it", () => {
    const closedAlpha = { ...alpha, enabled: false };
    expect(
      resolveGatewayRoute({ state: state([alpha, beta]), agent: "codex", model: "kimi-k2" }),
    ).toEqual(route([alpha, "kimi-k2"], [beta, "kimi-k2"]));
    expect(
      resolveGatewayRoute({ state: state([closedAlpha, beta]), agent: "codex", model: "kimi-k2" }),
    ).toEqual(route([beta, "kimi-k2"]));
  });

  test("a bare model name that itself contains a slash is matched whole", () => {
    expect(
      resolveGatewayRoute({
        state: state([alpha, beta]),
        agent: "codex",
        model: "moonshotai/kimi-k2",
      }),
    ).toEqual(route([beta, "moonshotai/kimi-k2"]));
  });

  test("a Claude tier name is translated by the first endpoint that maps that tier", () => {
    const mapped = { ...beta, modelMapping: { haiku: "glm-4.6" } };
    expect(
      resolveGatewayRoute({
        state: state([alpha, mapped]),
        agent: "claude",
        model: "claude-haiku-4-5-20251001",
      }),
    ).toEqual(route([mapped, "glm-4.6"]));
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
    ).toEqual(route([selectsSonnet, "claude-sonnet-4-5"]));
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
    ).toEqual(route([alpha, "kimi-k2"]));
    expect(
      resolveGatewayRoute({ state: state([alpha]), agent: "claude", model: "gone/kimi-k2" }),
    ).toEqual(route([alpha, "kimi-k2"]));
  });

  test("the same model at the other enabled endpoints follows, in creation order", () => {
    const gamma = endpoint({ id: "ep_c", slug: "gamma", models: [{ id: "kimi-k2" }] });
    const closedGamma = { ...gamma, id: "ep_d", slug: "delta", enabled: false };
    expect(
      resolveGatewayRoute({
        state: state([alpha, closedGamma, beta, gamma]),
        agent: "claude",
        model: "gamma/kimi-k2",
      }),
    ).toEqual(route([gamma, "kimi-k2"], [alpha, "kimi-k2"], [beta, "kimi-k2"]));
    const mapped = { ...alpha, modelMapping: { haiku: "glm-4.6" } };
    expect(
      resolveGatewayRoute({ state: state([mapped, beta]), agent: "claude", model: "haiku" }),
    ).toEqual(route([mapped, "glm-4.6"], [beta, "glm-4.6"]));
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

describe("which request format an endpoint is asked in", () => {
  test("an endpoint with the agent's own format address is passed through", () => {
    expect(
      chooseRequestFormat({
        agentFormat: "openai_responses",
        model: "gpt-5.5",
        formats: ["openai_chat", "openai_responses", "anthropic_messages"],
      }),
    ).toBe("openai_responses");
  });

  test("a Claude model goes to the Anthropic address even when the agent's own format is there", () => {
    expect(
      chooseRequestFormat({
        agentFormat: "openai_responses",
        model: "relay-a/claude-sonnet-4-5",
        formats: ["openai_responses", "anthropic_messages"],
      }),
    ).toBe("anthropic_messages");
  });

  test("without the agent's own format it is translated to Chat first", () => {
    expect(
      chooseRequestFormat({
        agentFormat: "anthropic_messages",
        model: "kimi-k2",
        formats: ["openai_responses", "openai_chat"],
      }),
    ).toBe("openai_chat");
  });

  test("then Responses, then Anthropic", () => {
    expect(
      chooseRequestFormat({
        agentFormat: "anthropic_messages",
        model: "kimi-k2",
        formats: ["openai_responses"],
      }),
    ).toBe("openai_responses");
    expect(
      chooseRequestFormat({
        agentFormat: "openai_responses",
        model: "kimi-k2",
        formats: ["anthropic_messages"],
      }),
    ).toBe("anthropic_messages");
  });

  test("an endpoint with no address at all is asked in none", () => {
    expect(
      chooseRequestFormat({ agentFormat: "anthropic_messages", model: "kimi-k2", formats: [] }),
    ).toBeNull();
  });
});
