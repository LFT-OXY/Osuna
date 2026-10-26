import { describe, expect, it } from "vitest";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import { i18n } from "@/i18n/i18next";
import {
  buildProviderQualifiedDescription,
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  buildSelectedTriggerLabel,
  filterAndRankModelRows,
  groupProviderMenuEntries,
  matchesModelSearch,
  resolveEffectiveComposerModeId,
  resolveSelectedModelLabel,
  resolveSnapshotModelLabel,
  resolveSubmissionReadiness,
  selectableEntryModels,
} from "./provider-selection";

describe("combined model selector data", () => {
  const codexModel: AgentModelDefinition = {
    provider: "codex",
    id: "gpt-5.4",
    label: "GPT-5.4",
  };

  function snapshotEntry(
    overrides: Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">,
  ): ProviderSnapshotEntry {
    return {
      ...overrides,
      provider: overrides.provider,
      status: overrides.status ?? "ready",
      enabled: overrides.enabled ?? true,
      label: overrides.label ?? overrides.provider,
      description: overrides.description ?? `${overrides.provider} provider`,
      defaultModeId: overrides.defaultModeId ?? "default",
      modes: overrides.modes ?? [],
      models: overrides.models ?? [codexModel],
    };
  }

  it("builds selector providers from ready enabled snapshot entries", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({
          provider: "codex",
          label: "Codex",
          models: [codexModel],
        }),
      ]),
    ).toEqual([
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "codex:gpt-5.4",
              provider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "GPT-5.4",
              description: "gpt-5.4",
              isDefault: undefined,
            },
          ],
        },
      },
    ]);
  });

  it("hides compatibility-only model entries from new clients", () => {
    const compatibilityModel: AgentModelDefinition = {
      ...codexModel,
      id: "gpt-5.4-legacy",
      label: "GPT-5.4 legacy",
      isSelectable: false,
    };

    const [provider] = buildSelectableProviderSelectorProviders([
      snapshotEntry({ provider: "codex", models: [codexModel, compatibilityModel] }),
    ]);

    expect(provider?.modelSelection).toMatchObject({
      kind: "models",
      rows: [{ modelId: "gpt-5.4" }],
    });
  });

  it("synthesizes a default model row for ready enabled providers without explicit models", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({
          provider: "codewhale",
          label: "CodeWhale",
          models: [],
        }),
      ]),
    ).toEqual([
      {
        id: "codewhale",
        label: "CodeWhale",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "codewhale:",
              provider: "codewhale",
              providerLabel: "CodeWhale",
              modelId: "",
              modelLabel: "Default",
              description: undefined,
              isDefault: true,
            },
          ],
        },
      },
    ]);
  });

  it("excludes disabled providers from selector data", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({
          provider: "codewhale",
          label: "CodeWhale",
          enabled: false,
          models: [],
        }),
      ]),
    ).toEqual([]);
  });

  it("surfaces non-ready providers with their state-specific selection", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({ provider: "loading-provider", status: "loading", models: [] }),
        snapshotEntry({
          provider: "error-provider",
          status: "error",
          error: "boom",
          models: [],
        }),
        snapshotEntry({
          provider: "unavailable-provider",
          status: "unavailable",
          models: [],
        }),
      ]),
    ).toEqual([
      {
        id: "loading-provider",
        label: "loading-provider",
        modelSelection: { kind: "loading" },
      },
      {
        id: "error-provider",
        label: "error-provider",
        modelSelection: { kind: "error", message: "boom" },
      },
      {
        id: "unavailable-provider",
        label: "unavailable-provider",
        modelSelection: { kind: "error", message: "Unavailable" },
      },
    ]);
  });

  it("builds selector providers from an already-curated provider list", () => {
    const providerDefinitions: AgentProviderDefinition[] = [
      {
        id: "codex",
        label: "Codex",
        description: "Codex provider",
        defaultModeId: "auto",
        modes: [],
      },
    ];

    expect(
      buildProviderSelectorProviders({
        providerDefinitions,
        modelsByProvider: new Map([["codex", [codexModel]]]),
      }),
    ).toEqual([
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models",
          rows: [
            expect.objectContaining({
              provider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "GPT-5.4",
            }),
          ],
        },
      },
    ]);
  });

  it("matches across label, provider, and description with multi-token fuzzy search", () => {
    const row = {
      favoriteKey: "opencode:opencode-zen/kimi-k2.5",
      provider: "opencode",
      providerLabel: "OpenCode",
      modelId: "opencode-zen/kimi-k2.5",
      modelLabel: "Kimi K2.5",
      description: "OpenCode Zen - kimi",
    };

    expect(matchesModelSearch(row, "kimi zen")).toBe(true);
    expect(matchesModelSearch(row, "zen kimi")).toBe(true);
    expect(matchesModelSearch(row, "k2.5 zen")).toBe(true);
    expect(matchesModelSearch(row, "kimi gemini")).toBe(false);
  });

  it("ranks model search results by fuzzy match quality", () => {
    const rows = [
      {
        favoriteKey: "openai:gpt-4.1",
        provider: "openai",
        providerLabel: "OpenAI",
        modelId: "gpt-4.1",
        modelLabel: "GPT-4.1",
      },
      {
        favoriteKey: "openai:gpt-5.4",
        provider: "openai",
        providerLabel: "OpenAI",
        modelId: "gpt-5.4",
        modelLabel: "GPT-5.4",
      },
      {
        favoriteKey: "google:gemini",
        provider: "google",
        providerLabel: "Google",
        modelId: "gemini",
        modelLabel: "Gemini",
      },
    ];

    expect(filterAndRankModelRows(rows, "gpt54").map((row) => row.modelId)).toEqual(["gpt-5.4"]);
  });

  it("keeps the selected trigger label model-only", () => {
    expect(buildSelectedTriggerLabel("GPT-5.4")).toBe("GPT-5.4");
  });

  it("names the provider first when a model row is shown outside its provider", () => {
    const row = {
      favoriteKey: "copilot:claude-opus-5",
      provider: "copilot",
      providerLabel: "Copilot",
      modelId: "claude-opus-5",
      modelLabel: "Opus 5",
      description: "claude-opus-5",
    };

    expect(buildProviderQualifiedDescription(row)).toBe("Copilot · claude-opus-5");
    expect(buildProviderQualifiedDescription({ ...row, description: undefined })).toBe("Copilot");
  });

  it("resolves selected labels from explicit provider model-selection state", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "codex",
        label: "Codex",
        models: [codexModel],
      }),
      snapshotEntry({
        provider: "codewhale",
        label: "CodeWhale",
        models: [],
      }),
    ]);

    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "codex",
        selectedModel: "gpt-5.4",
        isLoading: false,
      }),
    ).toBe("GPT-5.4");
    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "codewhale",
        selectedModel: "",
        isLoading: false,
      }),
    ).toBe("Default");
  });

  it("distinguishes a loading selection from a resolved empty selection", () => {
    expect(
      resolveSelectedModelLabel({
        providers: [],
        selectedProvider: "",
        selectedModel: "",
        isLoading: true,
      }),
    ).toBe("Loading...");
    expect(
      resolveSelectedModelLabel({
        providers: [],
        selectedProvider: "",
        selectedModel: "",
        isLoading: false,
      }),
    ).toBe("Select model");
  });

  it("keeps a stored selected model visible when current snapshot rows no longer offer it", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "codex",
        label: "Codex",
        models: [{ provider: "codex", id: "gpt-5.4", label: "GPT-5.4", isDefault: true }],
      }),
    ]);

    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "codex",
        selectedModel: "gpt-5.3",
        isLoading: false,
      }),
    ).toBe("gpt-5.3");
  });

  it("keeps provider snapshot errors visible in the selected trigger label", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "opencode",
        label: "OpenCode",
        status: "error",
        error: "OpenCode app.agents timed out after 10s",
        models: [],
      }),
    ]);

    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "opencode",
        selectedModel: "",
        isLoading: false,
      }),
    ).toBe("Error");
  });

  it("returns observable submission readiness reasons", () => {
    expect(
      resolveSubmissionReadiness({
        text: "hello",
        allowsEmptyAutoSubmit: false,
        providerCount: 1,
        selection: {
          provider: "codex",
          modelId: "",
          availableModels: [codexModel],
          isModelLoading: false,
        },
        autoSubmitConfig: null,
        workspaceDirectory: "/repo",
        hasClient: true,
      }),
    ).toEqual({
      ok: false,
      reason: "No model is available for the selected provider",
    });

    expect(
      resolveSubmissionReadiness({
        text: "hello",
        allowsEmptyAutoSubmit: false,
        providerCount: 1,
        selection: {
          provider: "codewhale",
          modelId: "",
          availableModels: [],
          isModelLoading: false,
        },
        autoSubmitConfig: null,
        workspaceDirectory: "/repo",
        hasClient: true,
      }),
    ).toEqual({ ok: true });
  });

  it("uses the active app language for utility labels", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      const providers = buildSelectableProviderSelectorProviders([
        snapshotEntry({
          provider: "deepseek-tui",
          label: "DeepSeek TUI",
          models: [],
        }),
        snapshotEntry({
          provider: "unavailable-provider",
          status: "unavailable",
          models: [],
        }),
      ]);

      expect(getAllModelLabels(providers)).toContain("默认");
      expect(providers[1]?.modelSelection).toEqual({
        kind: "error",
        message: "不可用",
      });
      expect(
        resolveSubmissionReadiness({
          text: "",
          allowsEmptyAutoSubmit: false,
          providerCount: 1,
          selection: {
            provider: "codex",
            modelId: "gpt-5.4",
            availableModels: [codexModel],
            isModelLoading: false,
          },
          autoSubmitConfig: null,
          workspaceDirectory: "/repo",
          hasClient: true,
        }),
      ).toEqual({ ok: false, reason: "初始提示词必填" });
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("provider menu groups", () => {
  function entry(
    provider: string,
    overrides: Pick<ProviderSnapshotEntry, "status"> & Partial<ProviderSnapshotEntry>,
  ): ProviderSnapshotEntry {
    return {
      provider,
      enabled: true,
      label: provider.toUpperCase(),
      description: `${provider} provider`,
      defaultModeId: "default",
      modes: [],
      models: [],
      ...overrides,
    };
  }

  it("lays out ready and loading providers flat and folds error and unavailable ones into more", () => {
    expect(
      groupProviderMenuEntries([
        entry("claude", { status: "ready" }),
        entry("gemini", { status: "unavailable" }),
        entry("codex", { status: "loading" }),
        entry("kimi", { status: "error" }),
        entry("pi", { status: "ready" }),
      ]),
    ).toEqual({
      flat: [
        { id: "claude", label: "CLAUDE" },
        { id: "codex", label: "CODEX" },
        { id: "pi", label: "PI" },
      ],
      more: [
        { id: "gemini", label: "GEMINI" },
        { id: "kimi", label: "KIMI" },
      ],
    });
  });

  it("leaves disabled providers out of both groups", () => {
    expect(
      groupProviderMenuEntries([
        entry("claude", { status: "ready", enabled: false }),
        entry("gemini", { status: "unavailable", enabled: false }),
        entry("codex", { status: "ready" }),
      ]),
    ).toEqual({ flat: [{ id: "codex", label: "CODEX" }], more: [] });
  });

  it("falls back to the provider id when the snapshot has no label", () => {
    expect(
      groupProviderMenuEntries([{ ...entry("custom-acp", { status: "ready" }), label: undefined }]),
    ).toEqual({ flat: [{ id: "custom-acp", label: "custom-acp" }], more: [] });
  });

  it("returns empty groups before the snapshot arrives", () => {
    expect(groupProviderMenuEntries(undefined)).toEqual({ flat: [], more: [] });
  });
});

function getAllModelLabels(providers: ReturnType<typeof buildSelectableProviderSelectorProviders>) {
  return providers.flatMap((provider) =>
    provider.modelSelection.kind === "models"
      ? provider.modelSelection.rows.map((row) => row.modelLabel)
      : [],
  );
}

describe("models grouped by API endpoint", () => {
  // 总开关开着时快照同时带光秃秃的 models（老客户端看）与按接口分组的 apiEndpointModelGroups。
  const entry: ProviderSnapshotEntry = {
    provider: "claude",
    status: "ready",
    enabled: true,
    label: "Claude Code",
    models: [
      { provider: "claude", id: "shared", label: "shared", isDefault: true },
      { provider: "claude", id: "kimi-k2", label: "kimi-k2" },
    ],
    isModelListAuthoritative: true,
    apiEndpointModelGroups: [
      {
        name: "Relay A",
        models: [
          { provider: "claude", id: "relay-a/shared", label: "shared", isDefault: true },
          { provider: "claude", id: "relay-a/kimi-k2", label: "kimi-k2" },
        ],
      },
      {
        name: "Relay B",
        models: [{ provider: "claude", id: "relay-b/shared", label: "shared" }],
      },
    ],
  };

  it("the selectable models are the grouped ones, one per endpoint for a shared name", () => {
    expect(selectableEntryModels(entry)?.map((model) => model.id)).toEqual([
      "relay-a/shared",
      "relay-a/kimi-k2",
      "relay-b/shared",
    ]);
    const official = { ...entry, apiEndpointModelGroups: undefined };
    expect(selectableEntryModels(official)?.map((model) => model.id)).toEqual([
      "shared",
      "kimi-k2",
    ]);
  });

  it("Pi chats pick from its endpoint groups, ids written the way Pi names Osuna's models", () => {
    const pi: ProviderSnapshotEntry = {
      ...entry,
      provider: "pi",
      label: "Pi",
      models: [{ provider: "pi", id: "osuna/glm-5", label: "glm-5" }],
      apiEndpointModelGroups: [
        {
          name: "Relay",
          models: [{ provider: "pi", id: "osuna/relay/glm-5", label: "glm-5", isDefault: true }],
        },
      ],
    };
    expect(selectableEntryModels(pi)?.map((model) => model.id)).toEqual(["osuna/relay/glm-5"]);
    const [provider] = buildSelectableProviderSelectorProviders([pi]);
    const rows = provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
    expect(rows.map((row) => [row.modelId, row.modelLabel])).toEqual([
      ["osuna/relay/glm-5", "glm-5"],
    ]);
  });

  it("OMP chats pick from its endpoint groups too, ids written the way OMP names Osuna's models", () => {
    const omp: ProviderSnapshotEntry = {
      ...entry,
      provider: "omp",
      label: "Oh My Pi",
      models: [{ provider: "omp", id: "e2e/omp-model", label: "omp-model" }],
      apiEndpointModelGroups: [
        {
          name: "Relay",
          models: [{ provider: "omp", id: "osuna/relay/glm-5", label: "glm-5", isDefault: true }],
        },
      ],
    };
    expect(selectableEntryModels(omp)?.map((model) => model.id)).toEqual(["osuna/relay/glm-5"]);
  });

  it("rows carry their endpoint group and never show the slashed id", () => {
    const [provider] = buildSelectableProviderSelectorProviders([entry]);
    const rows = provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
    expect(
      rows.map((row) => [row.modelId, row.modelLabel, row.description, row.apiEndpointGroup]),
    ).toEqual([
      ["relay-a/shared", "shared", undefined, { name: "Relay A", index: 0, nameShown: "heading" }],
      [
        "relay-a/kimi-k2",
        "kimi-k2",
        undefined,
        { name: "Relay A", index: 0, nameShown: "heading" },
      ],
      ["relay-b/shared", "shared", undefined, { name: "Relay B", index: 1, nameShown: "heading" }],
    ]);
  });

  function rowsWith(display: string) {
    const [provider] = buildSelectableProviderSelectorProviders([
      { ...entry, apiEndpointNameDisplay: display },
    ]);
    const rows = provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
    return rows.map((row) => [row.modelId, row.description, row.apiEndpointGroup?.nameShown]);
  }

  it("only when names clash: the endpoint's name follows the two models of one name, the rest go without it", () => {
    expect(rowsWith("clash")).toEqual([
      ["relay-a/shared", "Relay A", "inline"],
      ["relay-a/kimi-k2", undefined, "none"],
      ["relay-b/shared", "Relay B", "inline"],
    ]);
  });

  it("never: no row names its endpoint; an unknown setting reads as always", () => {
    expect(rowsWith("never")).toEqual([
      ["relay-a/shared", undefined, "none"],
      ["relay-a/kimi-k2", undefined, "none"],
      ["relay-b/shared", undefined, "none"],
    ]);
    expect(rowsWith("sometimes").map(([, , shown]) => shown)).toEqual([
      "heading",
      "heading",
      "heading",
    ]);
  });

  it("cross-provider results name the endpoint only where the setting shows it", () => {
    const [provider] = buildSelectableProviderSelectorProviders([
      { ...entry, apiEndpointNameDisplay: "clash" },
    ]);
    const rows = provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
    expect(rows.map(buildProviderQualifiedDescription)).toEqual([
      "Claude Code · Relay A",
      "Claude Code",
      "Claude Code · Relay B",
    ]);
  });

  it("the selected label is the bare model name", () => {
    const providers = buildSelectableProviderSelectorProviders([entry]);
    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "claude",
        selectedModel: "relay-b/shared",
        isLoading: false,
      }),
    ).toBe("shared");
  });

  it("cross-provider results name the endpoint instead of the id", () => {
    const [provider] = buildSelectableProviderSelectorProviders([entry]);
    const rows = provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
    expect(buildProviderQualifiedDescription(rows[2])).toBe("Claude Code · Relay B");
  });

  it("a session's endpoint model id reads as the bare name elsewhere in the app", () => {
    expect(resolveSnapshotModelLabel([entry], "claude", "relay-b/shared")).toBe("shared");
    expect(resolveSnapshotModelLabel([entry], "claude", "unknown")).toBe("unknown");
    expect(resolveSnapshotModelLabel(undefined, "claude", "relay-b/shared")).toBe("relay-b/shared");
  });

  it("searching an endpoint name finds its models", () => {
    const [provider] = buildSelectableProviderSelectorProviders([entry]);
    const rows = provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
    expect(filterAndRankModelRows(rows, "relay b").map((row) => row.modelId)).toEqual([
      "relay-b/shared",
    ]);
  });
});

describe("resolveEffectiveComposerModeId", () => {
  const selection = {
    provider: "pi",
    modelId: "",
    thinkingOptionId: "",
    availableModels: [],
  };

  it("drops a remembered mode when the provider offers no modes", () => {
    expect(
      resolveEffectiveComposerModeId({ ...selection, modeId: "build", modeOptions: [] }, false),
    ).toBe("");
  });

  it("submits the mode the picker shows when the remembered mode is not offered", () => {
    expect(
      resolveEffectiveComposerModeId(
        {
          ...selection,
          modeId: "plan",
          modeOptions: [
            { id: "build", label: "Build" },
            { id: "ask", label: "Ask" },
          ],
        },
        false,
      ),
    ).toBe("build");
  });

  it("keeps a selected mode the provider offers", () => {
    expect(
      resolveEffectiveComposerModeId(
        {
          ...selection,
          modeId: "ask",
          modeOptions: [
            { id: "build", label: "Build" },
            { id: "ask", label: "Ask" },
          ],
        },
        false,
      ),
    ).toBe("ask");
  });

  it("keeps the selected mode while the provider's modes are still loading", () => {
    expect(
      resolveEffectiveComposerModeId({ ...selection, modeId: "build", modeOptions: [] }, true),
    ).toBe("build");
  });
});
