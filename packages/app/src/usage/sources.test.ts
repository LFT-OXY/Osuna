import { describe, expect, it } from "vitest";
import {
  usageBackendLabel,
  usageModelColor,
  usageSourceColor,
  usageSourceLabel,
  usageSourceRefFromKey,
  usageTrendGroupColor,
} from "./sources";
import { usageSourceKey } from "./totals";

describe("usageSourceRefFromKey", () => {
  it("round-trips every shape `usageSourceKey` produces", () => {
    const refs = [
      { cli: "claude", backend: null },
      { cli: "codex", backend: null },
      { cli: "pi", backend: "anthropic" },
      // A backend the user named themselves can hold the separator's own letters.
      { cli: "omp", backend: "3oxy-openai" },
    ] as const;

    expect(refs.map((ref) => usageSourceRefFromKey(usageSourceKey(ref)))).toEqual([
      { cli: "claude", backend: null },
      { cli: "codex", backend: null },
      { cli: "pi", backend: "anthropic" },
      { cli: "omp", backend: "3oxy-openai" },
    ]);
  });

  it("keeps the whole tail as the backend when it contains a colon", () => {
    expect(usageSourceRefFromKey("pi:openai:codex")).toEqual({
      cli: "pi",
      backend: "openai:codex",
    });
  });

  it("returns null for a key no CLI owns, which is how a model id is told apart", () => {
    expect(usageSourceRefFromKey("claude-opus-5")).toBeNull();
    expect(usageSourceRefFromKey("gpt-5.5")).toBeNull();
    expect(usageSourceRefFromKey("")).toBeNull();
  });
});

describe("usageSourceLabel", () => {
  it("names the CLI, and the backend when there is one", () => {
    expect([
      usageSourceLabel({ cli: "claude", backend: null }),
      usageSourceLabel({ cli: "pi", backend: "anthropic" }),
      usageSourceLabel({ cli: "omp", backend: "3oxy-openai" }),
    ]).toEqual(["Claude Code", "Pi · Anthropic", "OMP · 3oxy-openai"]);
  });
});

describe("usageBackendLabel", () => {
  it("spells a known vendor its own way and capitalises anything else", () => {
    expect([
      usageBackendLabel("openai"),
      usageBackendLabel("xai"),
      usageBackendLabel("homelab"),
    ]).toEqual(["OpenAI", "xAI", "Homelab"]);
  });
});

describe("usageTrendGroupColor", () => {
  it("colours a source group by its source and a model group by its name", () => {
    const sourceRef = { cli: "pi", backend: "anthropic" } as const;

    expect(usageTrendGroupColor(usageSourceKey(sourceRef), "source")).toBe(
      usageSourceColor(sourceRef),
    );
    expect(usageTrendGroupColor("claude-opus-5", "model")).toBe(usageModelColor("claude-opus-5"));
  });

  it("falls back to the model palette for a source key no CLI owns", () => {
    expect(usageTrendGroupColor("unknown", "source")).toBe(usageModelColor("unknown"));
  });

  it("gives one model the same colour every time", () => {
    expect(usageModelColor("gpt-5.5")).toBe(usageModelColor("gpt-5.5"));
    expect(usageModelColor("gpt-5.5")).not.toBe(usageModelColor("gpt-6-astra"));
  });
});
