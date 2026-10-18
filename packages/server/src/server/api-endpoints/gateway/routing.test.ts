// 同一个模型的写法与相近名字的例子照 magpie（MIT，THIRD_PARTY_NOTICES）的 internal/provider/group.go
// 的 sameModel 注释与 closest.go 的 Closest。

import { describe, expect, test } from "vitest";
import type { ApiEndpointState, StoredApiEndpoint } from "../store.js";
import { chooseRequestFormat, resolveGatewayRoute, sameModel } from "./routing.js";

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

  test("a bare model name that itself contains a slash is matched whole first", () => {
    expect(
      resolveGatewayRoute({
        state: state([alpha, beta]),
        agent: "codex",
        model: "moonshotai/kimi-k2",
      }),
    ).toEqual(route([beta, "moonshotai/kimi-k2"], [alpha, "kimi-k2"]));
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

  test("a Claude Code tier id goes through its tier even when an endpoint selected it (magpie claudeTierStandIn)", () => {
    const selectsSonnet = endpoint({
      id: "ep_c",
      slug: "gamma",
      models: [{ id: "claude-sonnet-4-5" }],
    });
    const mapped = { ...beta, modelMapping: { sonnet: "glm-4.6" } };
    const on = (defaultModelId: string | null) => ({
      ...state([mapped, selectsSonnet]),
      agents: {
        claude: { enabled: true, defaultModelId },
        codex: { enabled: true, defaultModelId: null },
      },
    });
    const ask = (input: { state: ApiEndpointState; model: string }) =>
      resolveGatewayRoute({ ...input, agent: "claude" });

    expect(ask({ state: on("kimi-k2"), model: "claude-sonnet-4-5" })).toEqual(
      route([mapped, "glm-4.6"]),
    );
    // 档位没有映射：换成默认模型。
    expect(ask({ state: on("kimi-k2"), model: "claude-haiku-4-5" })).toEqual(
      route([mapped, "kimi-k2"]),
    );
    // 默认模型就是这个 id：是用户自己选的，照常发给选了它的那家。
    expect(ask({ state: on("claude-sonnet-4-5"), model: "claude-sonnet-4-5" })).toEqual(
      route([selectsSonnet, "claude-sonnet-4-5"]),
    );
    // 开关关着（没有默认模型）时照常按名字找。
    expect(ask({ state: on(null), model: "claude-sonnet-4-5" })).toEqual(
      route([selectsSonnet, "claude-sonnet-4-5"]),
    );
  });

  test("a Claude tier name no endpoint maps goes to Claude Code's default model", () => {
    const withDefault = (defaultModelId: string) => ({
      ...state([alpha, beta]),
      agents: {
        claude: { enabled: true, defaultModelId },
        codex: { enabled: true, defaultModelId: null },
      },
    });
    for (const model of [
      "haiku",
      "opus",
      "claude-haiku-4-5-20251001",
      "claude-3-5-sonnet-20241022",
    ]) {
      expect(
        resolveGatewayRoute({ state: withDefault("glm-4.6"), agent: "claude", model }),
      ).toEqual(route([beta, "glm-4.6"]));
    }
    // 对不上档位、也没人在售的 Claude id 一样（照 magpie 的 claudeStandInAt）。
    expect(
      resolveGatewayRoute({
        state: withDefault("glm-4.6"),
        agent: "claude",
        model: "claude-mythos-5-1",
      }),
    ).toEqual(route([beta, "glm-4.6"]));
    // 默认模型指定了某家时照样直达那家，后面跟着同名的其他家。
    expect(
      resolveGatewayRoute({ state: withDefault("beta/kimi-k2"), agent: "claude", model: "sonnet" }),
    ).toEqual(route([beta, "kimi-k2"], [alpha, "kimi-k2"]));
  });

  test("the tier fallback is only for Claude tier names while Claude Code's switch is on", () => {
    const on = {
      ...state([alpha, beta]),
      agents: {
        claude: { enabled: true, defaultModelId: "glm-4.6" },
        codex: { enabled: true, defaultModelId: "glm-4.6" },
      },
    };
    const off = {
      ...on,
      agents: { ...on.agents, claude: { enabled: false, defaultModelId: "glm-4.6" } },
    };
    const isFound = (input: {
      state: ApiEndpointState;
      agent: "claude" | "codex";
      model: string;
    }) => resolveGatewayRoute(input).ok;
    expect(isFound({ state: off, agent: "claude", model: "haiku" })).toBe(false);
    expect(isFound({ state: on, agent: "codex", model: "claude-haiku-4-5" })).toBe(false);
    // 不是档位名的、带厂商前缀的不算（照 magpie 的 claudeFamily）。
    for (const model of ["no-such-model", "haiku-lite", "anthropic/claude-haiku-4.5"]) {
      expect(isFound({ state: on, agent: "claude", model })).toBe(false);
    }
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
      message: 'No enabled API endpoint offers the model "claude-haiku-4-5"; did you mean glm-4.6?',
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

  test("a model not offered names the three closest ids, nearest first", () => {
    const listed = endpoint({
      id: "ep_c",
      slug: "gamma",
      models: [
        { id: "glm-4.6" },
        { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
        { id: "claude-opus-4-6" },
        { id: "claude-opus-4-1" },
        { id: "gpt-5.5" },
      ],
    });
    expect(
      resolveGatewayRoute({ state: state([listed]), agent: "claude", model: "claude-opus-4-7" }),
    ).toEqual({
      ok: false,
      message:
        'No enabled API endpoint offers the model "claude-opus-4-7"; did you mean claude-opus-4-6, claude-opus-4-1, claude-sonnet-4-5?',
    });
  });

  test("a model sharing no word with any listed one names none", () => {
    expect(
      resolveGatewayRoute({ state: state([alpha]), agent: "codex", model: "gemini-3-pro" }),
    ).toEqual({ ok: false, message: 'No enabled API endpoint offers the model "gemini-3-pro"' });
  });
});

describe("a model its vendor said is retired at one endpoint", () => {
  // listed 是去掉已下线模型之后的状态（retired-models.ts）：alpha 的 kimi-k2 下线了。
  const retiredAlpha = { ...alpha, models: [] };

  test("a bare model name skips that endpoint and goes to another with the same model", () => {
    expect(
      resolveGatewayRoute({
        state: state([alpha, beta]),
        listed: state([retiredAlpha, beta]),
        agent: "claude",
        model: "kimi-k2",
      }),
    ).toEqual(route([beta, "kimi-k2"]));
  });

  test("slug/model still goes to that endpoint, and the others follow", () => {
    expect(
      resolveGatewayRoute({
        state: state([alpha, beta]),
        listed: state([retiredAlpha, beta]),
        agent: "claude",
        model: "alpha/kimi-k2",
      }),
    ).toEqual(route([alpha, "kimi-k2"], [beta, "kimi-k2"]));
  });

  test("with no other endpoint the model is not found, and the closest names left are offered", () => {
    const both = endpoint({
      id: "ep_a",
      slug: "alpha",
      models: [{ id: "kimi-k2" }, { id: "kimi-k2-thinking" }],
    });
    expect(
      resolveGatewayRoute({
        state: state([both]),
        listed: state([{ ...both, models: [{ id: "kimi-k2-thinking" }] }]),
        agent: "codex",
        model: "kimi-k2",
      }),
    ).toEqual({
      ok: false,
      message: 'No enabled API endpoint offers the model "kimi-k2"; did you mean kimi-k2-thinking?',
    });
  });
});

describe("names that differ only in how a model is written are the same model", () => {
  test.each([
    { written: "claude-opus-4.6", same: "claude-opus-4-6" },
    { written: "claude_opus_4_6", same: "claude-opus-4-6" },
    { written: "Claude-Opus-4-6", same: "claude-opus-4-6" },
    { written: "anthropic/claude-opus-4-6", same: "claude-opus-4-6" },
    { written: "accounts/fireworks/models/deepseek-v4p1", same: "deepseek-v4-1" },
    { written: "claude-opus-4-6-20260115", same: "claude-opus-4-6" },
    { written: "claude-opus-4-6@20260115", same: "claude-opus-4-6" },
    { written: "deepseek-v4-1-flash-260910", same: "deepseek-v4-1-flash" },
    // 四位数的发布号是另一个模型；冒号后的变体、-flash、-thinking 都留着。
    { written: "kimi-k2-0905", same: "kimi-k2-0905" },
    { written: "qwen3-coder-2507", same: "qwen3-coder-2507" },
    { written: "gpt-5.5:batch", same: "gpt-5-5:batch" },
    { written: "gemini-2.5-flash-thinking", same: "gemini-2-5-flash-thinking" },
  ])("$written is $same", ({ written, same }) => {
    expect(sameModel(written)).toBe(same);
  });

  const first = endpoint({ id: "ep_c", slug: "gamma", models: [{ id: "claude-opus-4.6" }] });
  const second = endpoint({
    id: "ep_d",
    slug: "delta",
    models: [{ id: "anthropic/claude-opus-4-6-20260115" }],
  });

  test("the name a CLI asks for reaches each endpoint as that endpoint lists it", () => {
    expect(
      resolveGatewayRoute({
        state: state([first, second]),
        agent: "claude",
        model: "claude-opus-4-6",
      }),
    ).toEqual(route([first, "claude-opus-4.6"], [second, "anthropic/claude-opus-4-6-20260115"]));
  });

  test("an endpoint listing the very name asked comes first, and is sent that spelling", () => {
    const both = endpoint({
      id: "ep_e",
      slug: "eps",
      models: [{ id: "claude-opus-4.6" }, { id: "claude-opus-4-6" }],
    });
    expect(
      resolveGatewayRoute({
        state: state([first, both]),
        agent: "claude",
        model: "claude-opus-4-6",
      }),
    ).toEqual(route([both, "claude-opus-4-6"], [first, "claude-opus-4.6"]));
  });

  test("slug/model asks that endpoint first, in its own spelling", () => {
    expect(
      resolveGatewayRoute({
        state: state([first, second]),
        agent: "claude",
        model: "delta/claude-opus-4.6",
      }),
    ).toEqual(route([second, "anthropic/claude-opus-4-6-20260115"], [first, "claude-opus-4.6"]));
  });

  test("a prefix that is no endpoint's slug is the vendor's and is ignored", () => {
    expect(
      resolveGatewayRoute({
        state: state([first, second]),
        agent: "codex",
        model: "anthropic/claude-opus-4-6",
      }),
    ).toEqual(route([first, "claude-opus-4.6"], [second, "anthropic/claude-opus-4-6-20260115"]));
  });

  test("~ in a requested name is read as /", () => {
    expect(
      resolveGatewayRoute({
        state: state([first, second]),
        agent: "claude",
        model: "delta~claude-opus-4-6",
      }),
    ).toEqual(route([second, "anthropic/claude-opus-4-6-20260115"], [first, "claude-opus-4.6"]));
  });

  test("a model mapped to a tier is followed by the same model however others write it", () => {
    const mapped = { ...alpha, modelMapping: { opus: "claude-opus-4.6" } };
    expect(
      resolveGatewayRoute({ state: state([mapped, second]), agent: "claude", model: "opus" }),
    ).toEqual(route([mapped, "claude-opus-4.6"], [second, "anthropic/claude-opus-4-6-20260115"]));
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
