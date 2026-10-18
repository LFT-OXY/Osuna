import { describe, expect, it } from "vitest";
import {
  buildCodexModelCatalog,
  codexDefaultLevel,
  codexEndpointEntries,
  codexModelEntry,
  codexReasoningLevels,
} from "./codex-model-catalog.js";
import type { ModelFacts } from "./model-facts.js";
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
  options: {
    reasoningEffort?: string | null;
    facts?: (endpoint: StoredApiEndpoint, modelId: string) => ModelFacts;
  } = {},
): CatalogEntry[] {
  const catalog = buildCodexModelCatalog(
    state,
    options.reasoningEffort ?? null,
    options.facts ?? (() => ({})),
  );
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

  it("writes what each endpoint knows of its model; a bare name takes the first endpoint that serves it", () => {
    const known: Record<string, ModelFacts> = {
      "relay-a/kimi-k2": { context: 262_144, efforts: ["low", "high"], images: false },
      "relay-b/kimi-k2": { context: 131_072, images: true },
    };
    const byEntry = Object.fromEntries(
      entries(STATE, { facts: (ep, modelId) => known[`${ep.slug}/${modelId}`] ?? {} }).map(
        (entry) => [entry.slug, entry],
      ),
    );

    expect(byEntry["kimi-k2"]).toMatchObject({
      context_window: 262_144,
      input_modalities: ["text"],
      supported_reasoning_levels: [
        { effort: "low", description: "Fast responses with lighter reasoning" },
        { effort: "high", description: "Greater reasoning depth for complex problems" },
      ],
    });
    expect(byEntry["relay-b/kimi-k2"]).toMatchObject({
      context_window: 131_072,
      input_modalities: ["text", "image"],
    });
    // 档位没查到的那家照旧四档。
    expect(byEntry["relay-b/kimi-k2"]?.supported_reasoning_levels).toHaveLength(4);
  });
});

describe("codexModelEntry", () => {
  function entry(facts: ModelFacts, reasoningEffort: string | null = null) {
    return codexModelEntry({
      slug: "relay/m",
      displayName: "M",
      visibility: "hide",
      priority: 3,
      facts,
      reasoningEffort,
    });
  }

  it("writes the known window, levels, default and image input", () => {
    expect(
      entry(
        { context: 1_000_000, output: 64_000, efforts: ["low", "high", "max"], images: true },
        "xhigh",
      ),
    ).toMatchObject({
      slug: "relay/m",
      display_name: "M",
      visibility: "hide",
      priority: 3,
      context_window: 1_000_000,
      input_modalities: ["text", "image"],
      supported_reasoning_levels: [
        { effort: "low", description: "Fast responses with lighter reasoning" },
        { effort: "high", description: "Greater reasoning depth for complex problems" },
        { effort: "max", description: "" },
      ],
      default_reasoning_level: "max",
      supports_reasoning_summaries: true,
    });
  });

  it("a known window is the whole window: no larger maximum is claimed", () => {
    expect(entry({ context: 1_000_000 })).not.toHaveProperty("max_context_window");
  });

  it("says text only for a model known not to see images", () => {
    expect(entry({ images: false }).input_modalities).toEqual(["text"]);
  });

  it("keeps today's entry for a model nothing is known of", () => {
    const unknown = entry({}, "high");
    expect(unknown).toMatchObject({
      context_window: 272_000,
      max_context_window: 272_000,
      default_reasoning_level: "high",
      supports_reasoning_summaries: true,
    });
    expect(unknown.supported_reasoning_levels.map((level) => level.effort)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(unknown).not.toHaveProperty("input_modalities");
  });

  it("offers no levels for a model known to have none", () => {
    expect(entry({ efforts: [] })).toMatchObject({
      supported_reasoning_levels: [],
      default_reasoning_level: null,
      supports_reasoning_summaries: false,
    });
  });
});

describe("codexReasoningLevels", () => {
  it("passes the listed names on in order, since Codex takes any non-empty level", () => {
    expect(codexReasoningLevels(["none", "low", "xhigh", "max", "ultra", "thinking-hard"])).toEqual(
      ["none", "low", "xhigh", "max", "ultra", "thinking-hard"],
    );
  });

  it("drops an empty name, which would make Codex reject the whole file, and repeats", () => {
    expect(codexReasoningLevels([" high ", "", "  ", "high", "low"])).toEqual(["high", "low"]);
  });
});

describe("codexDefaultLevel", () => {
  it.each([
    { levels: ["low", "high", "max"], chosen: null, level: "high" },
    { levels: ["low", "high", "max"], chosen: "high", level: "high" },
    { levels: ["low", "high", "max"], chosen: "medium", level: "high" },
    { levels: ["low", "high", "max"], chosen: "none", level: "low" },
    { levels: ["low", "high", "max"], chosen: "ultra", level: "max" },
    { levels: ["low", "high", "max"], chosen: "turbo", level: "high" },
    { levels: ["none", "low"], chosen: "none", level: "none" },
    { levels: ["minimal", "low"], chosen: null, level: "minimal" },
    { levels: ["low", "medium", "high"], chosen: null, level: "medium" },
    { levels: ["thinking-hard"], chosen: "high", level: "thinking-hard" },
  ])("levels $levels started at $chosen default to $level", ({ levels, chosen, level }) => {
    expect(codexDefaultLevel(levels, chosen)).toBe(level);
  });
});

describe("codexEndpointEntries", () => {
  it("lists every on endpoint's picked models as <slug>/<model>, in the chat model picker's order, with what is known of them", () => {
    const listed = codexEndpointEntries({
      state: STATE,
      reasoningEffort: "high",
      factsFor: (owner, modelId) =>
        owner.slug === "relay-b" && modelId === "glm-4.6"
          ? { context: 200_000, efforts: ["low", "high"], images: false }
          : {},
    });
    expect(
      listed.map((entry) => [entry.slug, entry.display_name, entry.visibility, entry.priority]),
    ).toEqual([
      ["relay-a/kimi-k2", "kimi-k2", "list", 1],
      ["relay-a/gpt-5.5", "GPT 5.5", "list", 2],
      ["relay-b/kimi-k2", "Kimi", "list", 3],
      ["relay-b/glm-4.6", "glm-4.6", "list", 4],
    ]);
    const glm = listed[3]!;
    expect(glm.context_window).toBe(200_000);
    expect(glm.supported_reasoning_levels.map((level) => level.effort)).toEqual(["low", "high"]);
    expect(glm.default_reasoning_level).toBe("high");
    expect(glm.input_modalities).toEqual(["text"]);
  });
});
