import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { isAgentMentionTarget, type AgentMentionTarget } from "@getpaseo/protocol/message-links";
import type { AgentProfile } from "@/agent-profiles";
import type {
  AutocompleteGroupNotice,
  AutocompleteGroupNotices,
  AutocompleteOption,
} from "@/components/ui/autocomplete";
import { getProviderIcon } from "@/components/provider-icons";
import { openHostSettingsSection } from "@/navigation/settings-navigation";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { useProvidersSnapshot } from "./use-providers-snapshot";
import {
  useAgentCommandsQuery,
  type AgentSlashCommand,
  type DraftCommandConfig,
} from "./use-agent-commands-query";
import { orderAutocompleteGroups } from "@/components/ui/autocomplete-utils";
import { useAutocomplete } from "./use-autocomplete";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { CLIENT_SLASH_COMMANDS, type ClientSlashCommand } from "@/client-slash-commands";
import type { PluginClientSlashCommand } from "@/plugins/client-slash-commands";
import { mergeSlashCommandSources } from "@/plugins/client-slash-commands/model";
import {
  applySlashCommandReplacement,
  filterAndRankCommandAutocompleteEntries,
  filterInlineSkillCommandEntries,
  findActiveSlashCommand,
  type SlashCommandRange,
} from "@/utils/agent-command-autocomplete";
import { findActiveFileMention, type FileMentionRange } from "@/utils/file-mention-autocomplete";
import type { FileEntryKind, InlineBlock, SkillBlock } from "@/inline-blocks";
import type { ComposerInputSnapshot } from "@/composer/input/text-input.types";

/** `@` 列表选中的文件、目录或智能体，换掉当前的 `@query`。 */
export interface MentionPick {
  range: FileMentionRange;
  block: InlineBlock;
}

interface UseAgentAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  /** 光标前最后一个行内块结束处的偏移；`@`、`/` 识别不往回越过它。 */
  blockBoundary: number;
  setUserInput: (nextValue: string) => void;
  serverId: string;
  agentId: string;
  draftConfig?: DraftCommandConfig;
  /** Composer input 聚焦且可显示菜单时为真，用于预取指令列表。 */
  prefetchCommands: boolean;
  onAutocompleteApplied?: () => void;
  /** 选中 skill 时交给 Composer 变成开头的 Skill block；不传则按命令插入文字。 */
  onPickSkill?: (input: SkillPick) => void;
  /** 选中文件、目录或智能体：把当前 `@query` 换成 File mention 或 Agent mention。 */
  onPickMention: (pick: MentionPick) => void;
  onClientSlashCommand?: (command: ClientSlashCommand) => void;
  canExecuteClientSlashCommand?: boolean;
  pluginClientSlashCommands?: readonly PluginClientSlashCommand[];
  /** daemon 配置里的 Agent profile，`@` 列表排在 provider 后面；配置未到时为 null。 */
  agentProfiles: readonly AgentProfile[] | null;
}

interface AgentAutocompleteKeyPressEvent {
  key: string;
  preventDefault: () => void;
  input: ComposerInputSnapshot;
}

export type AgentAutocompleteOption =
  | (AutocompleteOption & { type: "client_command"; command: ClientSlashCommand })
  | (AutocompleteOption & {
      type: "plugin_command";
      command: PluginClientSlashCommand;
    })
  | (AutocompleteOption & { type: "provider_command" })
  | (AutocompleteOption & {
      type: "workspace_entry";
      entryPath: string;
      entryKind: FileEntryKind;
      mention: FileMentionRange;
    })
  | (AutocompleteOption & { type: "agent_mention"; target: AgentMentionTarget });

interface AgentAutocompleteResult {
  isVisible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  onHighlight: (index: number) => void;
  isLoading: boolean;
  errorMessage?: string;
  loadingText: string;
  emptyText: string;
  footerText?: string;
  groupNotices?: AutocompleteGroupNotices;
  onSelectOption: (option: AutocompleteOption, input?: ComposerInputSnapshot) => void;
  onKeyPress: (event: AgentAutocompleteKeyPressEvent) => boolean;
}

interface AgentAutocompleteSnapshot {
  text: string;
  slashCommand: SlashCommandRange | null;
  fileMention: FileMentionRange | null;
}

function resolveAgentAutocompleteSnapshot(input: {
  input?: ComposerInputSnapshot;
  userInput: string;
  cursorIndex: number;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
}): AgentAutocompleteSnapshot {
  if (!input.input) {
    return {
      text: input.userInput,
      slashCommand: input.activeSlashCommand,
      fileMention: input.activeFileMention,
    };
  }

  const { text, blockBoundary } = input.input;
  const cursorIndex = input.input.selection.start;
  return {
    text,
    slashCommand: findActiveSlashCommand({ text, cursorIndex, blockBoundary }),
    fileMention: findActiveFileMention({ text, cursorIndex, blockBoundary }),
  };
}

interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

type AvailableCommand =
  | { source: "client"; command: ClientSlashCommand }
  | { source: "plugin"; command: PluginClientSlashCommand }
  | { source: "provider"; command: AgentSlashCommand };

function normalizeDraftCommandConfig(
  draftConfig?: DraftCommandConfig,
): DraftCommandConfig | undefined {
  if (!draftConfig) {
    return undefined;
  }

  const cwd = draftConfig.cwd.trim();
  if (!cwd) {
    return undefined;
  }

  const modeId = draftConfig.modeId?.trim() ?? "";
  const model = draftConfig.model?.trim() ?? "";
  const thinkingOptionId = draftConfig.thinkingOptionId?.trim() ?? "";
  const featureValues = draftConfig.featureValues;
  return {
    provider: draftConfig.provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(featureValues && Object.keys(featureValues).length > 0 ? { featureValues } : {}),
  };
}

function mapDirectorySuggestionsToEntries(payload: {
  entries?: Array<{ path: string; kind: string }>;
  directories?: string[];
}): DirectorySuggestionEntry[] {
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries.flatMap((entry) => {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        (entry.kind !== "file" && entry.kind !== "directory")
      ) {
        return [];
      }
      return [{ path: entry.path, kind: entry.kind }];
    });
  }

  return (payload.directories ?? []).map((path) => ({
    path,
    kind: "directory" as const,
  }));
}

function mapCommandToOption(entry: AvailableCommand, t: TFunction): AgentAutocompleteOption {
  const command = entry.command;
  const base = {
    id: command.name,
    label: `/${command.name}`,
    detail: command.argumentHint || undefined,
    description:
      entry.source === "client" ? t(entry.command.descriptionKey) : entry.command.description,
    // 客户端内置与插件命令都归"命令"组，只有 daemon 标成 skill 的才进"技能"组。
    kind:
      entry.source === "provider" && entry.command.kind === "skill"
        ? ("skill" as const)
        : ("command" as const),
  };
  if (entry.source === "client") {
    return {
      ...base,
      type: "client_command",
      command: entry.command,
    };
  }
  if (entry.source === "plugin") {
    return { ...base, type: "plugin_command", command: entry.command };
  }
  return {
    ...base,
    type: "provider_command",
  };
}

type AutocompleteMode = "command" | "file" | null;

export interface SkillPick {
  command: SlashCommandRange | null;
  block: SkillBlock;
  /** 该 agent 的 skill 名；原生端据此认出开头已有的 `/skill`。 */
  skillNames: ReadonlySet<string>;
}

/** 只有 daemon 标成 skill 的 provider 条目变 Skill block，命令一律保持文字。 */
export function resolvePickedSkillBlock(selected: AgentAutocompleteOption): SkillBlock | null {
  if (selected.type !== "provider_command" || selected.kind !== "skill") return null;
  return selected.description
    ? { kind: "skill", name: selected.id, description: selected.description }
    : { kind: "skill", name: selected.id };
}

/**
 * `@` 列表智能体分组的状态。老 Host 没有 `agentMentions`；当前会话不能派发时带 daemon 的原因码。
 * 快照没带 `canCreateAgents`（未加载的存档智能体、本地缓存）时按可用处理：发送会恢复会话，由 daemon 判定。
 */
export type AgentMentionAvailability =
  | { kind: "available" }
  | { kind: "host_outdated" }
  | { kind: "unavailable"; reason: string | undefined };

export interface AgentMentionAvailabilityInput {
  supportsAgentMentions: boolean;
  canCreateAgents: boolean | undefined;
  unavailableReason: string | undefined;
}

export function resolveAgentMentionAvailability(
  input: AgentMentionAvailabilityInput,
): AgentMentionAvailability {
  if (!input.supportsAgentMentions) return { kind: "host_outdated" };
  if (input.canCreateAgents === false) {
    return { kind: "unavailable", reason: input.unavailableReason };
  }
  return { kind: "available" };
}

// wire 上原因码是开放的字符串（新 daemon 可能加码），这里只列 app 认得、只有一句说明的几个。
type PlainUnavailableReason = "mcp_disabled" | "create_agent_not_allowed" | "tools_not_delivered";

const UNAVAILABLE_REASON_MESSAGE_KEYS = {
  mcp_disabled: "agentAutocomplete.agentMentions.mcpDisabled",
  create_agent_not_allowed: "agentAutocomplete.agentMentions.createAgentNotAllowed",
  tools_not_delivered: "agentAutocomplete.agentMentions.toolsNotDelivered",
} as const satisfies Record<PlainUnavailableReason, string>;

function isPlainUnavailableReason(reason: string | undefined): reason is PlainUnavailableReason {
  return reason !== undefined && Object.hasOwn(UNAVAILABLE_REASON_MESSAGE_KEYS, reason);
}

export interface AgentMentionNoticeInput {
  availability: AgentMentionAvailability;
  t: TFunction;
  onOpenAgentsSettings: () => void;
}

/** 智能体组顶的原因说明；认不出的原因码用通用文案。 */
export function resolveAgentMentionNotice(
  input: AgentMentionNoticeInput,
): AutocompleteGroupNotice | undefined {
  const { availability, t } = input;
  if (availability.kind === "available") return undefined;
  if (availability.kind === "host_outdated") {
    return { message: t("agentAutocomplete.agentMentions.hostOutdated") };
  }
  if (availability.reason === "tools_not_injected") {
    return {
      message: t("agentAutocomplete.agentMentions.toolsNotInjected"),
      detail: t("agentAutocomplete.agentMentions.toolsNotInjectedDetail"),
      action: {
        label: t("agentAutocomplete.agentMentions.openAgentsSettings"),
        onPress: input.onOpenAgentsSettings,
      },
    };
  }
  const messageKey = isPlainUnavailableReason(availability.reason)
    ? UNAVAILABLE_REASON_MESSAGE_KEYS[availability.reason]
    : "agentAutocomplete.agentMentions.unknownReason";
  return { message: t(messageKey) };
}

export interface AgentMentionOptionsInput {
  entries: readonly ProviderSnapshotEntry[] | undefined;
  /** daemon 配置里的 Agent profile；配置还没到时为空。 */
  profiles: readonly AgentProfile[];
  query: string;
  disabled: boolean;
  serverId: string;
}

/**
 * Providers 设置里已启用的 provider，保持设置里的顺序，按显示名或 id 过滤；
 * 其后是 provider 已启用的 Agent profile，按 profile 名过滤，副文字写所属 provider。
 */
export function buildAgentMentionOptions(
  input: AgentMentionOptionsInput,
): AgentAutocompleteOption[] {
  // provider id 满足 PROVIDER_ID_PATTERN，本身就是小写。
  const query = input.query.toLowerCase();
  const providerLabels = new Map(
    (input.entries ?? [])
      .filter((entry) => entry.enabled !== false)
      .map((entry) => [entry.provider, entry.label ?? entry.provider]),
  );
  const providerOptions = [...providerLabels].flatMap(
    ([provider, label]): AgentAutocompleteOption[] => {
      const matchesQuery = label.toLowerCase().includes(query) || provider.includes(query);
      if (!matchesQuery) return [];
      return [
        {
          type: "agent_mention",
          id: `agent:provider:${provider}`,
          label,
          kind: "agent",
          Icon: getProviderIcon(provider, input.serverId),
          disabled: input.disabled,
          target: { kind: "provider", id: provider },
        },
      ];
    },
  );
  const profileOptions = input.profiles.flatMap((profile): AgentAutocompleteOption[] => {
    const providerLabel = providerLabels.get(profile.provider);
    if (providerLabel === undefined) return [];
    // 手改配置可能写出含 `/` 或为空的 id，写不成链接，选中后只剩文字、不会派发。
    const target: AgentMentionTarget = { kind: "profile", id: profile.id };
    if (!isAgentMentionTarget(target)) return [];
    if (!profile.name.toLowerCase().includes(query)) return [];
    return [
      {
        type: "agent_mention",
        id: `agent:profile:${profile.id}`,
        label: profile.name,
        description: providerLabel,
        kind: "agent",
        Icon: getProviderIcon(profile.provider, input.serverId),
        profileGlyph: { icon: profile.icon, color: profile.color },
        disabled: input.disabled,
        target,
      },
    ];
  });
  return [...providerOptions, ...profileOptions];
}

/** `@` 列表选中的行变成 File mention 或 Agent mention；置灰行与命令不产生块。 */
export function resolvePickedMentionBlock(selected: AgentAutocompleteOption): InlineBlock | null {
  if (selected.disabled) return null;
  if (selected.type === "agent_mention") {
    return { kind: "agent", target: selected.target, name: selected.label };
  }
  if (selected.type === "workspace_entry") {
    return { kind: "file", path: selected.entryPath, entryKind: selected.entryKind };
  }
  return null;
}

/**
 * `@` 列表的智能体分组：行与组顶说明。只在已有会话的输入框里出现，派发由当前会话的 daemon 判定决定；
 * 还没收到 server_info 时（断线不等于老 Host）不显示。
 */
interface AgentMentionGroupInput {
  serverId: string;
  agentId: string;
  cwd: string;
  query: string;
  enabled: boolean;
  agentProfiles: readonly AgentProfile[] | null;
}

interface AgentMentionGroup {
  options: AgentAutocompleteOption[];
  groupNotices?: AutocompleteGroupNotices;
}

function useAgentMentionGroup(input: AgentMentionGroupInput): AgentMentionGroup {
  const { t } = useTranslation();
  const { serverId, agentId } = input;
  const agentState = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[serverId]?.agents?.get(agentId);
      return {
        hasAgent: Boolean(agent),
        canCreateAgents: agent?.canCreateAgents,
        unavailableReason: agent?.createAgentsUnavailableReason,
      };
    }),
  );
  const supportsAgentMentions = useHostFeatureAvailability(serverId, "agentMentions");
  const visible = input.enabled && agentState.hasAgent && supportsAgentMentions !== null;
  const { entries } = useProvidersSnapshot(serverId, { cwd: input.cwd, enabled: visible });

  const availability = useMemo(
    () =>
      resolveAgentMentionAvailability({
        supportsAgentMentions: supportsAgentMentions === true,
        canCreateAgents: agentState.canCreateAgents,
        unavailableReason: agentState.unavailableReason,
      }),
    [agentState.canCreateAgents, agentState.unavailableReason, supportsAgentMentions],
  );
  const options = useMemo(
    () =>
      visible
        ? buildAgentMentionOptions({
            entries,
            profiles: input.agentProfiles ?? EMPTY_PROFILES,
            query: input.query,
            disabled: availability.kind !== "available",
            serverId,
          })
        : [],
    [availability.kind, entries, input.agentProfiles, input.query, serverId, visible],
  );
  const groupNotices = useMemo<AutocompleteGroupNotices | undefined>(() => {
    if (options.length === 0) return undefined;
    const notice = resolveAgentMentionNotice({
      availability,
      t,
      onOpenAgentsSettings: () => openHostSettingsSection(serverId, "agents"),
    });
    return notice ? { agents: notice } : undefined;
  }, [availability, options.length, serverId, t]);

  return { options, groupNotices };
}

const EMPTY_COMMANDS: AgentSlashCommand[] = [];
const EMPTY_PROFILES: AgentProfile[] = [];

interface BuildAutocompleteOptionsInput {
  isVisible: boolean;
  mode: AutocompleteMode;
  commands: AgentSlashCommand[];
  isCommandsLoading: boolean;
  pluginCommands: readonly PluginClientSlashCommand[];
  isDraftContext: boolean;
  commandFilterQuery: string;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  /** `@` 列表里排在文件上面的智能体行；没有智能体分组时为空。 */
  agentMentionOptions: readonly AgentAutocompleteOption[];
  fileSuggestions: DirectorySuggestionEntry[];
  t: TFunction;
}

export function buildCommandAutocompleteOptions(input: BuildAutocompleteOptionsInput) {
  if (!input.isVisible) {
    return [];
  }

  if (input.mode === "command") {
    // 列表未到之前不给选项，免得键盘在"加载中"行下面选中看不见的内置命令。
    if (input.isCommandsLoading) {
      return [];
    }
    const providerCommands = input.commands.map((command) => ({
      source: "provider" as const,
      command,
    }));
    const rootCommands: AvailableCommand[] = mergeSlashCommandSources({
      builtIn: CLIENT_SLASH_COMMANDS,
      plugins: input.pluginCommands,
      provider: input.commands,
      onPluginCollision(command, winner) {
        console.warn(
          `[Plugins] Client slash command /${command.name} from ${command.pluginId} ignored; ${winner} command wins`,
        );
      },
    })
      .filter((entry) => !input.isDraftContext || entry.source !== "built-in")
      .map((entry): AvailableCommand => {
        if (entry.source === "built-in") return { source: "client", command: entry.command };
        return entry;
      });
    const availableCommands: AvailableCommand[] =
      input.activeSlashCommand?.position === "inline"
        ? filterInlineSkillCommandEntries(providerCommands)
        : rootCommands;
    const matches = filterAndRankCommandAutocompleteEntries(
      availableCommands,
      input.commandFilterQuery,
    );
    return orderAutocompleteGroups(matches.map((entry) => mapCommandToOption(entry, input.t)));
  }

  const activeFileMention = input.activeFileMention;
  if (input.mode === "file" && activeFileMention) {
    const fileOptions = input.fileSuggestions.map((entry) => ({
      type: "workspace_entry" as const,
      id: `${entry.kind}:${entry.path}`,
      label: entry.path,
      kind: entry.kind,
      entryPath: entry.path,
      entryKind: entry.kind,
      mention: activeFileMention,
    }));
    return [...input.agentMentionOptions, ...fileOptions];
  }

  return [];
}

function resolveAutocompleteMode(args: {
  showFileAutocomplete: boolean;
  showCommandAutocomplete: boolean;
}): AutocompleteMode {
  if (args.showFileAutocomplete) {
    return "file";
  }
  if (args.showCommandAutocomplete) {
    return "command";
  }
  return null;
}

export function resolveAutocompleteIsVisible(args: {
  mode: AutocompleteMode;
  canLoadCommands: boolean;
  /** 能请求指令或手里已有列表；断线且从没拿到过时不显示面板。 */
  commandsAvailable: boolean;
  serverId: string;
  autocompleteCwd: string;
}): boolean {
  if (args.mode === "command") {
    return args.canLoadCommands && args.commandsAvailable;
  }
  if (args.mode === "file") {
    return Boolean(args.serverId) && args.autocompleteCwd.length > 0;
  }
  return false;
}

function resolveCanLoadCommands(args: {
  serverId: string;
  agentId: string;
  isDraftContext: boolean;
}): boolean {
  if (!args.serverId) {
    return false;
  }
  return Boolean(args.agentId) || args.isDraftContext;
}

export function resolveAutocompleteIsLoading(args: {
  mode: AutocompleteMode;
  isCommandsLoading: boolean;
  fileSuggestionsIsPending: boolean;
  fileSuggestionsIsLoading: boolean;
  optionsLength: number;
}): boolean {
  if (args.mode === "command") {
    return args.isCommandsLoading;
  }
  if (args.mode === "file") {
    return (
      args.fileSuggestionsIsPending || (args.fileSuggestionsIsLoading && args.optionsLength === 0)
    );
  }
  return false;
}

function resolveAutocompleteErrorMessage(args: {
  mode: AutocompleteMode;
  commandError: Error | null;
  fileSuggestionsError: unknown;
  t: TFunction;
}): string | undefined {
  if (args.mode === "command") {
    return args.commandError
      ? args.commandError.message || args.t("agentAutocomplete.failedToLoad")
      : undefined;
  }
  if (args.mode === "file") {
    return args.fileSuggestionsError instanceof Error
      ? args.fileSuggestionsError.message
      : undefined;
  }
  return undefined;
}

interface AutocompleteTexts {
  loadingText: string;
  emptyText: string;
  footerText?: string;
}

interface AutocompleteTextsInput {
  mode: AutocompleteMode;
  isCommandListPartial: boolean;
  t: TFunction;
}

export function resolveAutocompleteTexts(args: AutocompleteTextsInput): AutocompleteTexts {
  if (args.mode === "file") {
    return {
      loadingText: args.t("agentAutocomplete.searchingWorkspace"),
      emptyText: args.t("agentAutocomplete.noFiles"),
    };
  }
  return {
    loadingText: args.t("agentAutocomplete.loadingCommands"),
    emptyText: args.t("agentAutocomplete.noCommands"),
    footerText:
      args.mode === "command" && args.isCommandListPartial
        ? args.t("agentAutocomplete.partialCommands")
        : undefined,
  };
}

export function useAgentAutocomplete(input: UseAgentAutocompleteInput): AgentAutocompleteResult {
  const { t } = useTranslation();
  const {
    userInput,
    cursorIndex,
    blockBoundary,
    setUserInput,
    serverId,
    agentId,
    draftConfig,
    prefetchCommands,
    onAutocompleteApplied,
    onPickSkill,
    onPickMention,
    onClientSlashCommand,
    canExecuteClientSlashCommand,
    pluginClientSlashCommands = [],
    agentProfiles,
  } = input;

  const activeSlashCommand = useMemo(
    () =>
      findActiveSlashCommand({
        text: userInput,
        cursorIndex,
        blockBoundary,
      }),
    [blockBoundary, cursorIndex, userInput],
  );
  const showCommandAutocomplete = activeSlashCommand !== null;
  const commandFilterQuery = activeSlashCommand?.query ?? "";

  const activeFileMention = useMemo(
    () =>
      findActiveFileMention({
        text: userInput,
        cursorIndex,
        blockBoundary,
      }),
    [blockBoundary, cursorIndex, userInput],
  );
  const showFileAutocomplete = activeFileMention !== null;
  const fileFilterQuery = activeFileMention?.query ?? "";
  const [debouncedFileFilterQuery, setDebouncedFileFilterQuery] = useState(fileFilterQuery);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileFilterQuery(fileFilterQuery), 180);
    return () => clearTimeout(timer);
  }, [fileFilterQuery]);

  const normalizedDraftConfig = useMemo(
    () => normalizeDraftCommandConfig(draftConfig),
    [draftConfig],
  );

  const isDraftContext = normalizedDraftConfig !== undefined;
  const queryDraftConfig = normalizedDraftConfig;
  const canLoadCommands = resolveCanLoadCommands({ serverId, agentId, isDraftContext });

  const agentCwd = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? "",
  );
  const autocompleteCwd = useMemo(() => {
    if (isDraftContext) {
      return queryDraftConfig?.cwd ?? "";
    }
    return agentCwd.trim();
  }, [agentCwd, isDraftContext, queryDraftConfig]);

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const mode = resolveAutocompleteMode({ showFileAutocomplete, showCommandAutocomplete });
  const commandsState = useAgentCommandsQuery({
    serverId,
    agentId,
    isMenuOpen: mode === "command" && canLoadCommands,
    prefetch: prefetchCommands && canLoadCommands,
    draftConfig: queryDraftConfig,
  });
  const commands = commandsState.status === "ready" ? commandsState.commands : EMPTY_COMMANDS;
  const isCommandListPartial = commandsState.status === "ready" && commandsState.partial;
  const commandsAvailable = commandsState.status !== "unavailable";
  const isCommandsLoading = commandsState.status === "loading";
  const commandError = commandsState.status === "error" ? commandsState.error : null;

  const isVisible = resolveAutocompleteIsVisible({
    mode,
    canLoadCommands,
    commandsAvailable,
    serverId,
    autocompleteCwd,
  });

  const fileSuggestionsQuery = useQuery({
    queryKey: [
      "directorySuggestions",
      serverId,
      autocompleteCwd,
      debouncedFileFilterQuery,
      true,
      true,
    ],
    queryFn: async (): Promise<DirectorySuggestionEntry[]> => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const response = await client.getDirectorySuggestions({
        cwd: autocompleteCwd,
        query: debouncedFileFilterQuery,
        limit: 50,
        includeFiles: true,
        includeDirectories: true,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return mapDirectorySuggestionsToEntries(response);
    },
    enabled:
      mode === "file" &&
      Boolean(serverId) &&
      autocompleteCwd.length > 0 &&
      Boolean(client) &&
      isConnected,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const { options: agentMentionOptions, groupNotices } = useAgentMentionGroup({
    serverId,
    agentId,
    cwd: agentCwd,
    query: fileFilterQuery,
    enabled: !isDraftContext && mode === "file",
    agentProfiles,
  });

  const options = useMemo<AgentAutocompleteOption[]>(
    () =>
      buildCommandAutocompleteOptions({
        activeFileMention,
        agentMentionOptions,
        commandFilterQuery,
        commands,
        isCommandsLoading,
        pluginCommands: pluginClientSlashCommands,
        activeSlashCommand,
        fileSuggestions: fileSuggestionsQuery.data ?? [],
        isDraftContext,
        isVisible,
        mode,
        t,
      }),
    [
      activeFileMention,
      activeSlashCommand,
      agentMentionOptions,
      commandFilterQuery,
      commands,
      isCommandsLoading,
      pluginClientSlashCommands,
      fileSuggestionsQuery.data,
      isDraftContext,
      isVisible,
      mode,
      t,
    ],
  );

  const onSelectOption = useCallback(
    (option: AutocompleteOption, snapshot?: ComposerInputSnapshot) => {
      const selected = option as AgentAutocompleteOption;
      const current = resolveAgentAutocompleteSnapshot({
        input: snapshot,
        userInput,
        cursorIndex,
        activeSlashCommand,
        activeFileMention,
      });
      const selectedIsCommand =
        selected.type === "client_command" ||
        selected.type === "plugin_command" ||
        selected.type === "provider_command";
      if (snapshot && selectedIsCommand && !current.slashCommand) return;
      if (
        selected.type === "client_command" &&
        selected.command.execution === "immediate" &&
        canExecuteClientSlashCommand &&
        onClientSlashCommand
      ) {
        onClientSlashCommand(selected.command);
        return;
      }

      const skillBlock = resolvePickedSkillBlock(selected);
      if (skillBlock && onPickSkill) {
        onPickSkill({
          command: current.slashCommand,
          block: skillBlock,
          skillNames: new Set(
            commands.filter((command) => command.kind === "skill").map((command) => command.name),
          ),
        });
        onAutocompleteApplied?.();
        return;
      }

      if (selectedIsCommand) {
        if (!current.slashCommand) {
          setUserInput(`/${selected.id} `);
          onAutocompleteApplied?.();
          return;
        }

        const nextInput = applySlashCommandReplacement({
          text: current.text,
          command: current.slashCommand,
          commandName: selected.id,
        });
        setUserInput(nextInput);
        onAutocompleteApplied?.();
        return;
      }

      const mentionBlock = resolvePickedMentionBlock(selected);
      if (!current.fileMention || !mentionBlock) return;
      onPickMention({ range: current.fileMention, block: mentionBlock });
      onAutocompleteApplied?.();
    },
    [
      canExecuteClientSlashCommand,
      onAutocompleteApplied,
      onPickSkill,
      onPickMention,
      onClientSlashCommand,
      setUserInput,
      userInput,
      cursorIndex,
      activeFileMention,
      activeSlashCommand,
      commands,
    ],
  );

  const selectOptionFromKeyPress = useCallback(
    (option: AutocompleteOption, event?: AgentAutocompleteKeyPressEvent) =>
      onSelectOption(option, event?.input),
    [onSelectOption],
  );

  const { selectedIndex, onHighlight, onKeyPress } = useAutocomplete({
    isVisible,
    options,
    query: mode === "command" ? commandFilterQuery : fileFilterQuery,
    onSelectOption: selectOptionFromKeyPress,
    onEscape:
      mode === "command" && activeSlashCommand?.position === "start"
        ? () => setUserInput("")
        : undefined,
  });

  const isLoading = resolveAutocompleteIsLoading({
    mode,
    isCommandsLoading,
    fileSuggestionsIsPending: fileSuggestionsQuery.isPending,
    fileSuggestionsIsLoading: fileSuggestionsQuery.isLoading,
    optionsLength: options.length,
  });
  const errorMessage = resolveAutocompleteErrorMessage({
    mode,
    commandError,
    fileSuggestionsError: fileSuggestionsQuery.error,
    t,
  });

  const { loadingText, emptyText, footerText } = resolveAutocompleteTexts({
    mode,
    isCommandListPartial,
    t,
  });

  return {
    isVisible,
    options,
    selectedIndex,
    onHighlight,
    isLoading,
    errorMessage,
    loadingText,
    emptyText,
    footerText,
    groupNotices,
    onSelectOption,
    onKeyPress,
  };
}
