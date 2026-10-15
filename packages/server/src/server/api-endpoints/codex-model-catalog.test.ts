import { describe, expect, it } from "vitest";
import { buildCodexModelCatalog } from "./codex-model-catalog.js";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";

function endpoint(input: {
  slug: string;
  enabled?: boolean;
  models: Array<{ id: string; label?: string }>;
}): StoredApiEndpoint {
  return {
    id: `ep_${input.slug}`,
    slug: input.slug,
    name: input.slug.toUpperCase(),
    baseUrls: [{ format: "openai_responses", url: `https://${input.slug}.example/v1` }],
    models: input.models,
    enabled: input.enabled ?? true,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  };
}

const STATE: ApiEndpointState = {
  endpoints: [
    endpoint({ slug: "relay-a", models: [{ id: "kimi-k2" }, { id: "gpt-5.5", label: "GPT 5.5" }] }),
    endpoint({ slug: "off", enabled: false, models: [{ id: "hidden-1" }] }),
    endpoint({ slug: "relay-b", models: [{ id: "kimi-k2", label: "Kimi" }, { id: "glm-4.6" }] }),
  ],
  agents: {
    claude: { enabled: false, defaultModelId: null },
    codex: { enabled: true, defaultModelId: "kimi-k2" },
  },
};

interface CatalogEntry {
  slug: string;
  display_name: string;
  visibility: string;
  [field: string]: unknown;
}

function entries(
  state: ApiEndpointState,
  options: { reasoningEffort?: string | null } = {},
): CatalogEntry[] {
  const catalog = buildCodexModelCatalog(state, options.reasoningEffort ?? null);
  return (JSON.parse(catalog) as { models: CatalogEntry[] }).models;
}

describe("buildCodexModelCatalog", () => {
  it("lists each bare model name once in the picker and every endpoint's own name hidden", () => {
    expect(
      entries(STATE).map(({ slug, display_name, visibility }) => [slug, display_name, visibility]),
    ).toEqual([
      ["kimi-k2", "kimi-k2", "list"],
      ["gpt-5.5", "GPT 5.5", "list"],
      ["glm-4.6", "glm-4.6", "list"],
      ["relay-a/kimi-k2", "kimi-k2", "hide"],
      ["relay-a/gpt-5.5", "GPT 5.5", "hide"],
      ["relay-b/kimi-k2", "Kimi", "hide"],
      ["relay-b/glm-4.6", "glm-4.6", "hide"],
    ]);
  });

  it("writes every field Codex needs to load the file, with its own base instructions", () => {
    const [first] = entries(STATE);

    expect(first).toMatchObject({
      shell_type: "unified_exec",
      supported_in_api: true,
      priority: 1,
      support_verbosity: false,
      truncation_policy: { mode: "bytes", limit: 10_000 },
      experimental_supported_tools: [],
      supports_parallel_tool_calls: true,
    });
    expect(first?.base_instructions).toEqual(
      expect.stringContaining("You are a coding agent running in the Codex CLI"),
    );
  });

  it("does not list a hidden name twice when a model id already looks like one", () => {
    const state: ApiEndpointState = {
      ...STATE,
      endpoints: [
        endpoint({ slug: "relay-a", models: [{ id: "kimi-k2" }] }),
        endpoint({ slug: "relay-b", models: [{ id: "relay-a/kimi-k2" }] }),
      ],
    };

    expect(entries(state).map((entry) => entry.slug)).toEqual([
      "kimi-k2",
      "relay-a/kimi-k2",
      "relay-b/relay-a/kimi-k2",
    ]);
  });

  it("offers four reasoning levels and reasoning summaries on every entry, listed or hidden", () => {
    for (const entry of entries(STATE)) {
      expect(entry.supported_reasoning_levels).toEqual([
        { effort: "low", description: "Fast responses with lighter reasoning" },
        { effort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
        { effort: "high", description: "Greater reasoning depth for complex problems" },
        { effort: "xhigh", description: "Extra high reasoning depth for complex problems" },
      ]);
      expect(entry.supports_reasoning_summaries).toBe(true);
    }
  });

  it.each([
    { configured: null, level: "medium" },
    { configured: "none", level: "low" },
    { configured: "minimal", level: "low" },
    { configured: "low", level: "low" },
    { configured: "high", level: "high" },
    { configured: "xhigh", level: "xhigh" },
    { configured: "max", level: "xhigh" },
    { configured: "turbo", level: "medium" },
  ])(
    "defaults every entry to the level nearest model_reasoning_effort $configured: $level",
    ({ configured, level }) => {
      const levels = entries(STATE, { reasoningEffort: configured }).map(
        (entry) => entry.default_reasoning_level,
      );
      expect(new Set(levels)).toEqual(new Set([level]));
    },
  );
});
