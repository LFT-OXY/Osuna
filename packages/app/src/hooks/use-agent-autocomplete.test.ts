import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AgentProfile } from "@/agent-profiles";
import { i18n } from "@/i18n/i18next";
import {
  buildAgentMentionOptions,
  buildCommandAutocompleteOptions,
  resolveAgentMentionAvailability,
  resolveAgentMentionNotice,
  resolvePickedMentionBlock,
  resolveAutocompleteIsLoading,
  resolveAutocompleteIsVisible,
  resolveAutocompleteTexts,
  resolvePickedSkillBlock,
} from "./use-agent-autocomplete";

const t = i18n.t;

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

interface TestCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: string;
}

const review: TestCommand = { name: "review", description: "Review changes", argumentHint: "" };

function commandOptions(input: {
  commands: TestCommand[];
  isCommandsLoading: boolean;
  isDraftContext?: boolean;
}) {
  return buildCommandAutocompleteOptions({
    isVisible: true,
    mode: "command",
    commands: input.commands,
    isCommandsLoading: input.isCommandsLoading,
    pluginCommands: [],
    isDraftContext: input.isDraftContext ?? true,
    commandFilterQuery: "",
    activeSlashCommand: { start: 0, end: 1, query: "", position: "start" },
    activeFileMention: null,
    agentMentionOptions: [],
    fileSuggestions: [],
    t,
  });
}

describe("command menu visibility", () => {
  it("shows the menu before any command has arrived", () => {
    expect(
      resolveAutocompleteIsVisible({
        mode: "command",
        canLoadCommands: true,
        commandsAvailable: true,
        serverId: "server-1",
        autocompleteCwd: "/repo",
      }),
    ).toBe(true);
  });

  it("hides the menu when commands can neither be fetched nor read from cache", () => {
    expect(
      resolveAutocompleteIsVisible({
        mode: "command",
        canLoadCommands: true,
        commandsAvailable: false,
        serverId: "server-1",
        autocompleteCwd: "/repo",
      }),
    ).toBe(false);
  });
});

describe("command menu options", () => {
  it("offers nothing to select while the loading row is showing", () => {
    expect(commandOptions({ commands: [review], isCommandsLoading: true })).toEqual([]);
  });

  it("maps provider commands to selectable options once the list has arrived", () => {
    expect(commandOptions({ commands: [review], isCommandsLoading: false })).toEqual([
      {
        type: "provider_command",
        id: "review",
        label: "/review",
        detail: undefined,
        description: "Review changes",
        kind: "command",
      },
    ]);
  });

  it("lists skills below every command, built-in commands included", () => {
    const options = commandOptions({
      commands: [
        { name: "tdd", description: "Test first", argumentHint: "", kind: "skill" },
        { name: "compact", description: "Compact context", argumentHint: "", kind: "command" },
      ],
      isCommandsLoading: false,
      isDraftContext: false,
    });
    expect(options.map((option) => [option.label, option.kind])).toEqual([
      ["/exit", "command"],
      ["/clear", "command"],
      ["/compact", "command"],
      ["/tdd", "skill"],
    ]);
  });
});

describe("resolvePickedSkillBlock", () => {
  const options = commandOptions({
    commands: [
      { name: "tdd", description: "Test first", argumentHint: "", kind: "skill" },
      { name: "compact", description: "Compact context", argumentHint: "", kind: "command" },
    ],
    isCommandsLoading: false,
    isDraftContext: false,
  });
  const optionNamed = (label: string) => {
    const option = options.find((candidate) => candidate.label === label);
    if (!option) throw new Error(`missing option ${label}`);
    return option;
  };

  it("turns a picked skill into a Skill block carrying its description", () => {
    expect(resolvePickedSkillBlock(optionNamed("/tdd"))).toEqual({
      kind: "skill",
      name: "tdd",
      description: "Test first",
    });
  });

  it("makes no block for provider and built-in commands, which stay text", () => {
    expect(resolvePickedSkillBlock(optionNamed("/compact"))).toBeNull();
    expect(resolvePickedSkillBlock(optionNamed("/clear"))).toBeNull();
  });
});

describe("resolveAutocompleteIsLoading", () => {
  it("shows the loading row whenever the command list has not arrived", () => {
    expect(
      resolveAutocompleteIsLoading({
        mode: "command",
        isCommandsLoading: true,
        fileSuggestionsIsPending: false,
        fileSuggestionsIsLoading: false,
        optionsLength: 0,
      }),
    ).toBe(true);
  });
});

describe("resolveAutocompleteTexts", () => {
  it("adds the send-a-message hint when the command list is partial", () => {
    expect(resolveAutocompleteTexts({ mode: "command", isCommandListPartial: true, t })).toEqual({
      loadingText: "Loading commands...",
      emptyText: "No commands found",
      footerText: "Send a message to load all commands",
    });
  });

  it("shows no hint when the list is complete or the daemon predates the field", () => {
    expect(resolveAutocompleteTexts({ mode: "command", isCommandListPartial: false, t })).toEqual({
      loadingText: "Loading commands...",
      emptyText: "No commands found",
      footerText: undefined,
    });
  });

  it("never shows the hint in the file list", () => {
    expect(resolveAutocompleteTexts({ mode: "file", isCommandListPartial: true, t })).toEqual({
      loadingText: "Searching workspace...",
      emptyText: "No files or directories found",
    });
  });
});

function providerEntry(
  provider: string,
  label: string,
  overrides: Partial<ProviderSnapshotEntry> = {},
): ProviderSnapshotEntry {
  return { provider, label, status: "ready", enabled: true, ...overrides };
}

const PROVIDERS = [
  providerEntry("codex", "Codex"),
  providerEntry("claude", "Claude"),
  providerEntry("pi", "Pi", { enabled: false }),
  providerEntry("my-agent", "Reviewer Bot"),
];

const PROFILES: AgentProfile[] = [
  { id: "p-review", name: "Careful reviewer", provider: "claude", icon: "eye", color: "blue" },
  { id: "p-pi", name: "Pi helper", provider: "pi" },
  { id: "p-gone", name: "Orphan", provider: "grok" },
  // id 写不成 Agent mention 链接（含 `/` 或为空）：选中后只会剩文字，不列出。
  { id: "team/review", name: "Slash reviewer", provider: "claude" },
  { id: "", name: "Blank reviewer", provider: "claude" },
  { id: "p-fast", name: "Fast coder", provider: "codex" },
];

function agentRows(input: { query: string; disabled?: boolean }) {
  return buildAgentMentionOptions({
    entries: PROVIDERS,
    profiles: PROFILES,
    query: input.query,
    disabled: input.disabled ?? false,
    serverId: "server-1",
  }).map((option) => ({
    label: option.label,
    description: option.description,
    disabled: option.disabled,
  }));
}

describe("@ list agent group", () => {
  it("lists enabled providers in the Providers settings order, then their profiles", () => {
    expect(agentRows({ query: "" }).map((row) => [row.label, row.description])).toEqual([
      ["Codex", undefined],
      ["Claude", undefined],
      ["Reviewer Bot", undefined],
      ["Careful reviewer", "Claude"],
      ["Fast coder", "Codex"],
    ]);
  });

  it("filters providers by display name or id and profiles by name, ignoring case", () => {
    expect(agentRows({ query: "CLA" }).map((row) => row.label)).toEqual(["Claude"]);
    expect(agentRows({ query: "my-a" }).map((row) => row.label)).toEqual(["Reviewer Bot"]);
    expect(agentRows({ query: "review" }).map((row) => row.label)).toEqual([
      "Reviewer Bot",
      "Careful reviewer",
    ]);
    expect(agentRows({ query: "pi" })).toEqual([]);
  });

  it("marks every row unavailable when the group is grayed out", () => {
    expect(agentRows({ query: "", disabled: true }).every((row) => row.disabled)).toBe(true);
  });

  it("puts the agent rows above the files", () => {
    const mention = { start: 0, end: 2, query: "c" };
    const options = buildCommandAutocompleteOptions({
      isVisible: true,
      mode: "file",
      commands: [],
      isCommandsLoading: false,
      pluginCommands: [],
      isDraftContext: false,
      commandFilterQuery: "",
      activeSlashCommand: null,
      activeFileMention: mention,
      agentMentionOptions: buildAgentMentionOptions({
        entries: PROVIDERS,
        profiles: [],
        query: "c",
        disabled: false,
        serverId: "server-1",
      }),
      fileSuggestions: [{ path: "src/cli.ts", kind: "file" }],
      t,
    });
    expect(options.map((option) => [option.kind, option.label])).toEqual([
      ["agent", "Codex"],
      ["agent", "Claude"],
      ["file", "src/cli.ts"],
    ]);
  });
});

describe("@ list agent group availability", () => {
  it("asks for a host update when the host predates agent mentions", () => {
    expect(
      resolveAgentMentionAvailability({
        supportsAgentMentions: false,
        canCreateAgents: undefined,
        unavailableReason: undefined,
      }),
    ).toEqual({ kind: "host_outdated" });
  });

  it("grays the group out with the daemon's reason when the session cannot dispatch", () => {
    expect(
      resolveAgentMentionAvailability({
        supportsAgentMentions: true,
        canCreateAgents: false,
        unavailableReason: "tools_not_injected",
      }),
    ).toEqual({ kind: "unavailable", reason: "tools_not_injected" });
  });

  it("keeps the group available when the snapshot has no verdict yet", () => {
    expect(
      resolveAgentMentionAvailability({
        supportsAgentMentions: true,
        canCreateAgents: undefined,
        unavailableReason: undefined,
      }),
    ).toEqual({ kind: "available" });
  });
});

describe("@ list agent group notice", () => {
  function notice(availability: Parameters<typeof resolveAgentMentionNotice>[0]["availability"]) {
    return resolveAgentMentionNotice({ availability, t, onOpenAgentsSettings: vi.fn() });
  }

  it("shows nothing when agents can be mentioned", () => {
    expect(notice({ kind: "available" })).toBeUndefined();
  });

  it("links to the Agents settings when Osuna tools are not injected", () => {
    const onOpenAgentsSettings = vi.fn();
    const result = resolveAgentMentionNotice({
      availability: { kind: "unavailable", reason: "tools_not_injected" },
      t,
      onOpenAgentsSettings,
    });
    expect(result?.message).toBe("Osuna tools are off for this agent");
    expect(result?.detail).toBe(
      "Turn them on in Settings → Host → Agents, then reload this agent.",
    );
    result?.action?.onPress();
    expect(onOpenAgentsSettings).toHaveBeenCalledTimes(1);
  });

  it("names each other reason, and falls back to a generic message for an unknown one", () => {
    const messages = [
      "mcp_disabled",
      "create_agent_not_allowed",
      "tools_not_delivered",
      "some_future_reason",
      undefined,
    ].map((reason) => notice({ kind: "unavailable", reason }));
    expect(messages.map((entry) => [entry?.message, entry?.action])).toEqual([
      ["MCP is turned off on this host", undefined],
      ["This provider's Osuna tools policy doesn't allow create_agent", undefined],
      ["This agent can't call Osuna tools", undefined],
      ["This agent can't start subagents", undefined],
      ["This agent can't start subagents", undefined],
    ]);
  });

  it("asks for a host update on an old host", () => {
    expect(notice({ kind: "host_outdated" })?.message).toBe("Update the host to mention agents");
  });
});

describe("resolvePickedMentionBlock", () => {
  const [claude, reviewer] = buildAgentMentionOptions({
    entries: [providerEntry("claude", "Claude")],
    profiles: [PROFILES[0]!],
    query: "",
    disabled: false,
    serverId: "server-1",
  });

  it("turns a picked provider into an Agent mention named after its display name", () => {
    expect(resolvePickedMentionBlock(claude!)).toEqual({
      kind: "agent",
      target: { kind: "provider", id: "claude" },
      name: "Claude",
    });
  });

  it("turns a picked profile into an Agent mention of that profile named after it", () => {
    expect(resolvePickedMentionBlock(reviewer!)).toEqual({
      kind: "agent",
      target: { kind: "profile", id: "p-review" },
      name: "Careful reviewer",
    });
  });

  it("makes no block for a grayed-out agent", () => {
    expect(resolvePickedMentionBlock({ ...claude!, disabled: true })).toBeNull();
  });
});
