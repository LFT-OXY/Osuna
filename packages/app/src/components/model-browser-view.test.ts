import { describe, expect, it } from "vitest";
import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  followSelectedProviderView,
  resolveInitialModelBrowserView,
  resolveModelBrowserAllView,
  resolveProviderViewModelRows,
  groupProfilesByProviderModel,
  resolveModelBrowserScrolling,
  scopeModelBrowserProviders,
  selectProviderViewProfileRows,
} from "./model-browser-view";

function provider(
  id: string,
  label: string,
  rows: ProviderSelectionModelRow[] = [],
): ProviderSelectorProvider {
  return {
    id,
    label,
    modelSelection: { kind: "models", rows },
  };
}

function modelRow(
  providerId: string,
  providerLabel: string,
  modelId: string,
  modelLabel: string,
): ProviderSelectionModelRow {
  return {
    favoriteKey: `${providerId}:${modelId}`,
    provider: providerId,
    providerLabel,
    modelId,
    modelLabel,
    description: modelId,
  };
}

describe("model browser scrolling", () => {
  it("participates in native compact bottom-sheet scrolling", () => {
    expect(resolveModelBrowserScrolling({ isNative: true, isCompact: true })).toBe("sheet");
  });

  it.each([
    { platform: "native wide", isNative: true, isCompact: false },
    { platform: "compact web", isNative: false, isCompact: true },
    { platform: "wide web", isNative: false, isCompact: false },
  ])("owns scrolling on $platform surfaces", ({ isNative, isCompact }) => {
    expect(resolveModelBrowserScrolling({ isNative, isCompact })).toBe("independent");
  });
});

describe("model browser initial view", () => {
  const codex = provider("codex", "Codex");
  const pi = provider("pi", "Pi");

  it("opens a sole provider directly", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [pi],
        selectedProvider: "",
        selectedModel: "",
        hasProfiles: false,
        scope: "allProviders",
      }),
    ).toEqual({ kind: "provider", providerId: "pi", providerLabel: "Pi" });
  });

  it("opens the selected provider when there is one", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [codex, pi],
        selectedProvider: "pi",
        selectedModel: "pi-pro",
        hasProfiles: false,
        scope: "allProviders",
      }),
    ).toEqual({ kind: "provider", providerId: "pi", providerLabel: "Pi" });
  });

  it("opens the root so pinned profiles are reachable", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [codex, pi],
        selectedProvider: "pi",
        selectedModel: "pi-pro",
        hasProfiles: true,
        scope: "allProviders",
      }),
    ).toEqual({ kind: "all" });
  });

  it("opens a sole provider directly regardless of root content", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [pi],
        selectedProvider: "pi",
        selectedModel: "pi-pro",
        hasProfiles: true,
        scope: "allProviders",
      }),
    ).toEqual({ kind: "provider", providerId: "pi", providerLabel: "Pi" });
  });

  it("falls back to the root when the selected provider is gone", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [codex, pi],
        selectedProvider: "gemini",
        selectedModel: "gemini-3",
        hasProfiles: false,
        scope: "allProviders",
      }),
    ).toEqual({ kind: "all" });
  });
});

describe("groupProfilesByProviderModel", () => {
  it("groups profiles by provider and model, skipping profiles without a model", () => {
    const lookup = groupProfilesByProviderModel([
      { provider: "claude", modelId: "opus-5" },
      { provider: "claude", modelId: "opus-5" },
      { provider: "claude", modelId: "sonnet-4.6" },
      { provider: "claude", modelId: "" },
      { provider: "codex", modelId: "gpt-5.4" },
    ]);

    expect(lookup.get("claude:opus-5")).toHaveLength(2);
    expect(lookup.get("claude:sonnet-4.6")).toHaveLength(1);
    expect(lookup.get("codex:gpt-5.4")).toHaveLength(1);
    expect(lookup.has("claude:")).toBe(false);
  });

  it("trims model ids so whitespace cannot create a separate key", () => {
    const lookup = groupProfilesByProviderModel([
      { provider: "claude", modelId: "opus-5" },
      { provider: "claude", modelId: "  opus-5  " },
    ]);

    expect(lookup.get("claude:opus-5")).toHaveLength(2);
  });

  it("returns an empty map for no refs", () => {
    expect(groupProfilesByProviderModel([]).size).toBe(0);
  });
});

describe("model browser all view", () => {
  const claude = provider("claude", "Claude Code", [
    modelRow("claude", "Claude Code", "opus-5", "Opus 5"),
    modelRow("claude", "Claude Code", "sonnet-4.6", "Sonnet 4.6"),
  ]);
  const copilot = provider("copilot", "Copilot", [
    modelRow("copilot", "Copilot", "claude-opus-5", "Opus 5"),
  ]);
  const codex = provider("codex", "Codex", [modelRow("codex", "Codex", "gpt-5.4", "GPT-5.4")]);
  const providers = [claude, copilot, codex];

  it("browses providers while the query is empty", () => {
    expect(
      resolveModelBrowserAllView({ providers, normalizedQuery: "", isSearchFocused: false }),
    ).toEqual({
      kind: "browse",
    });
  });

  it("shows every searchable model as soon as empty search receives focus", () => {
    const view = resolveModelBrowserAllView({
      providers,
      normalizedQuery: "",
      isSearchFocused: true,
    });

    expect(view.kind).toBe("searchResults");
    expect(view.kind === "searchResults" ? view.rows.map((row) => row.favoriteKey) : []).toEqual([
      "claude:opus-5",
      "claude:sonnet-4.6",
      "copilot:claude-opus-5",
      "codex:gpt-5.4",
    ]);
  });

  it("ranks the same model label across every provider that offers it", () => {
    const view = resolveModelBrowserAllView({
      providers,
      normalizedQuery: "opus",
      isSearchFocused: true,
    });

    expect(view.kind).toBe("searchResults");
    expect(view.kind === "searchResults" ? view.rows.map((row) => row.favoriteKey) : []).toEqual([
      "claude:opus-5",
      "copilot:claude-opus-5",
    ]);
  });

  it("matches models by their provider label", () => {
    const view = resolveModelBrowserAllView({
      providers,
      normalizedQuery: "codex",
      isSearchFocused: true,
    });

    expect(view.kind === "searchResults" ? view.rows.map((row) => row.modelId) : []).toEqual([
      "gpt-5.4",
    ]);
  });

  it("reports no matches instead of falling back to the provider list", () => {
    expect(
      resolveModelBrowserAllView({
        providers,
        normalizedQuery: "zzzz",
        isSearchFocused: true,
      }),
    ).toEqual({ kind: "noSearchMatches" });
  });

  it("ignores providers that are still loading or errored", () => {
    const loading: ProviderSelectorProvider = {
      id: "opencode",
      label: "OpenCode",
      modelSelection: { kind: "loading" },
    };
    const failed: ProviderSelectorProvider = {
      id: "pi",
      label: "Pi",
      modelSelection: { kind: "error", message: "unavailable" },
    };

    expect(
      resolveModelBrowserAllView({
        providers: [loading, failed],
        normalizedQuery: "opus",
        isSearchFocused: true,
      }),
    ).toEqual({ kind: "noSearchMatches" });
  });
});

describe("model browser scoped to the selected provider", () => {
  const claude = provider("claude", "Claude Code", [
    modelRow("claude", "Claude Code", "opus-5", "Opus 5"),
    modelRow("claude", "Claude Code", "sonnet-4.6", "Sonnet 4.6"),
  ]);
  const copilot = provider("copilot", "Copilot", [
    modelRow("copilot", "Copilot", "claude-opus-5", "Opus 5"),
  ]);
  const providers = [claude, copilot];
  const profiles = [
    { id: "claude-profile", provider: "claude" },
    { id: "copilot-profile", provider: "copilot" },
  ];

  it("keeps only the selected provider", () => {
    expect(
      scopeModelBrowserProviders({
        providers,
        selectedProvider: "claude",
        scope: "selectedProvider",
      }),
    ).toEqual([claude]);
  });

  it("keeps every provider when browsing all providers", () => {
    expect(
      scopeModelBrowserProviders({ providers, selectedProvider: "claude", scope: "allProviders" }),
    ).toEqual(providers);
  });

  it("leaves nothing to browse when the selected provider is not listed", () => {
    expect(
      scopeModelBrowserProviders({
        providers,
        selectedProvider: "gemini",
        scope: "selectedProvider",
      }),
    ).toEqual([]);
  });

  it("opens on the selected provider with no root view, even with profiles", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: scopeModelBrowserProviders({
          providers,
          selectedProvider: "copilot",
          scope: "selectedProvider",
        }),
        selectedProvider: "copilot",
        selectedModel: "",
        hasProfiles: true,
        scope: "selectedProvider",
      }),
    ).toEqual({ kind: "provider", providerId: "copilot", providerLabel: "Copilot" });
  });

  it("stays on the selected provider's view when it is not listed yet", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: scopeModelBrowserProviders({
          providers,
          selectedProvider: "gemini",
          scope: "selectedProvider",
        }),
        selectedProvider: "gemini",
        selectedModel: "gemini-3",
        hasProfiles: true,
        scope: "selectedProvider",
      }),
    ).toEqual({ kind: "provider", providerId: "gemini", providerLabel: "gemini" });
  });

  it("drops another provider's model that the same query would match across providers", () => {
    const acrossProviders = resolveModelBrowserAllView({
      providers,
      normalizedQuery: "opus",
      isSearchFocused: true,
    });
    const scoped = resolveModelBrowserAllView({
      providers: scopeModelBrowserProviders({
        providers,
        selectedProvider: "claude",
        scope: "selectedProvider",
      }),
      normalizedQuery: "opus",
      isSearchFocused: true,
    });

    expect(
      acrossProviders.kind === "searchResults"
        ? acrossProviders.rows.map((row) => row.favoriteKey)
        : [],
    ).toEqual(["claude:opus-5", "copilot:claude-opus-5"]);
    expect(
      scoped.kind === "searchResults" ? scoped.rows.map((row) => row.favoriteKey) : [],
    ).toEqual(["claude:opus-5"]);
  });

  it("searches only the selected provider's models", () => {
    const [scoped] = scopeModelBrowserProviders({
      providers,
      selectedProvider: "claude",
      scope: "selectedProvider",
    });

    expect(resolveProviderViewModelRows(scoped, "opus").map((row) => row.favoriteKey)).toEqual([
      "claude:opus-5",
    ]);
    expect(resolveProviderViewModelRows(scoped, "").map((row) => row.favoriteKey)).toEqual([
      "claude:opus-5",
      "claude:sonnet-4.6",
    ]);
  });

  it("has no rows for a provider whose models have not arrived", () => {
    expect(
      resolveProviderViewModelRows(
        { id: "pi", label: "Pi", modelSelection: { kind: "loading" } },
        "",
      ),
    ).toEqual([]);
    expect(resolveProviderViewModelRows(null, "")).toEqual([]);
  });

  it("shows every profile, whichever provider it targets", () => {
    expect(
      selectProviderViewProfileRows({
        rows: profiles,
        providerId: "claude",
        scope: "selectedProvider",
      }),
    ).toEqual(profiles);
  });

  it("shows only the drilled-into provider's profiles when browsing all providers", () => {
    expect(
      selectProviderViewProfileRows({
        rows: profiles,
        providerId: "claude",
        scope: "allProviders",
      }),
    ).toEqual([{ id: "claude-profile", provider: "claude" }]);
  });

  const claudeView = {
    kind: "provider",
    providerId: "claude",
    providerLabel: "Claude Code",
  } as const;
  const copilotView = {
    kind: "provider",
    providerId: "copilot",
    providerLabel: "Copilot",
  } as const;

  it("moves an open provider view to the provider chosen while it was open", () => {
    expect(
      followSelectedProviderView({
        view: claudeView,
        selectedProviderView: copilotView,
        scope: "selectedProvider",
      }),
    ).toEqual(copilotView);
  });

  it("keeps the root view that holds the compact settings list", () => {
    expect(
      followSelectedProviderView({
        view: { kind: "all" },
        selectedProviderView: copilotView,
        scope: "selectedProvider",
      }),
    ).toEqual({ kind: "all" });
  });

  it("keeps a drilled-into provider when browsing all providers", () => {
    expect(
      followSelectedProviderView({
        view: claudeView,
        selectedProviderView: copilotView,
        scope: "allProviders",
      }),
    ).toEqual(claudeView);
  });
});
