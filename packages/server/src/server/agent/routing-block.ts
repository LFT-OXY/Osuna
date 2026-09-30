import { findMarkdownLinks, parseAgentMentionLink } from "@getpaseo/protocol/message-links";
import type { ProviderMentionDefaults } from "@getpaseo/protocol/provider-config";

import { filterSelectableAgentModels, type ProviderSnapshotEntry } from "./agent-sdk-types.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import { formatSystemNotificationPrompt } from "./agent-prompt.js";
import { resolveThinkingOptionId, selectDefaultModel } from "./structured-generation-providers.js";

export interface RoutingBlockSettings {
  modeId?: string;
  thinkingOptionId?: string;
}

export type RoutingBlockTarget =
  | { status: "ready"; provider: string; model?: string; settings: RoutingBlockSettings }
  | { status: "unavailable"; reason: string };

export interface RoutingBlockMention {
  label: string;
  target: RoutingBlockTarget;
}

export type RoutingBlockProviderSource = Pick<
  ProviderSnapshotManager,
  "hasProvider" | "getProvider"
>;

export interface ResolveRoutingBlockInput {
  text: string;
  cwd: string;
  canCreateAgents: boolean;
  /** 发送时现读，改完配置下一条消息即生效。 */
  mentionDefaults: (providerId: string) => ProviderMentionDefaults | undefined;
  providers: RoutingBlockProviderSource;
}

const ROUTING_BLOCK_INTRO =
  "The user's message above mentions agents as links of the form [@Name](paseo://agent/...). Each mention asks you to start a new subagent for the part of the message it refers to. Start them now, before any other work:";

const ROUTING_BLOCK_RULES = [
  "Rules:",
  "- Call `create_agent` exactly once per numbered mention that can start, in the order listed. Two mentions of the same agent mean two separate subagents.",
  "- Pass `provider` and `settings` exactly as listed. Do not change the model, mode, or thinking option. Do not call `list_providers`, `list_models`, or `inspect_provider` first; the values are already resolved.",
  "- Do not do a mentioned part yourself, and do not hand it to your own subagent, task, or delegation tools, skills, or CLIs. Only `create_agent` counts.",
  "- The subagent cannot see this conversation. Write `initialPrompt` so it stands alone: the goal, the relevant files and context, constraints, and what to report back.",
  "- Keep `notifyOnFinish` at its default. You will be notified as each subagent finishes; then combine the results for the user.",
  "- If a subagent asks for permission, the user approves it in that subagent's session. Do not answer it with `respond_to_permission`.",
  "- Do any part of the message addressed to you (not to a mention) yourself, after the subagents are started.",
].join("\n");

function formatMentionLine({ label, target }: RoutingBlockMention, index: number): string {
  if (target.status === "unavailable") {
    return `${index}. ${label} -> cannot start: ${target.reason}. Tell the user.`;
  }
  const provider = target.model ? `${target.provider}/${target.model}` : target.provider;
  return `${index}. ${label} -> provider "${provider}", settings ${JSON.stringify(target.settings)}`;
}

export function formatRoutingBlock(mentions: readonly RoutingBlockMention[]): string {
  const lines = mentions.map((mention, index) => formatMentionLine(mention, index + 1));
  return formatSystemNotificationPrompt(
    [ROUTING_BLOCK_INTRO, lines.join("\n"), ROUTING_BLOCK_RULES].join("\n\n"),
  );
}

async function resolveProviderTarget(
  providerId: string,
  input: ResolveRoutingBlockInput,
): Promise<RoutingBlockTarget> {
  if (!input.providers.hasProvider(providerId)) {
    return { status: "unavailable", reason: `provider "${providerId}" is not configured` };
  }
  const entry = await input.providers.getProvider({
    provider: providerId,
    cwd: input.cwd,
    wait: true,
  });
  if (!entry.enabled) {
    return { status: "unavailable", reason: `provider "${providerId}" is disabled` };
  }
  if (entry.status === "unavailable") {
    return { status: "unavailable", reason: `provider "${providerId}" is not available` };
  }
  const defaults = input.mentionDefaults(providerId) ?? {};
  // 目录没就绪或加载出错时无从校验：配置值原样透传，未设的项交给 create_agent 按 provider 默认。
  const values = entry.status === "ready" ? resolveAgainstCatalog(entry, defaults) : defaults;
  return {
    status: "ready",
    provider: providerId,
    ...(values.model ? { model: values.model } : {}),
    settings: {
      ...(values.modeId ? { modeId: values.modeId } : {}),
      ...(values.thinkingOptionId ? { thinkingOptionId: values.thinkingOptionId } : {}),
    },
  };
}

/** 按已加载的目录校验 Mention defaults，失效项逐项回退到运行时默认。 */
function resolveAgainstCatalog(
  entry: ProviderSnapshotEntry,
  defaults: ProviderMentionDefaults,
): ProviderMentionDefaults {
  const models = filterSelectableAgentModels(entry.models);
  const configuredModel = defaults.model
    ? models.find((candidate) => candidate.id === defaults.model)
    : undefined;
  const model = configuredModel ?? selectDefaultModel(models);
  // 配置的模型已下线时连同档位一起退回默认模型的默认档位。
  const modelIsStale = defaults.model !== undefined && !configuredModel;
  return {
    model: model?.id,
    thinkingOptionId: resolveThinkingOptionId(
      model,
      modelIsStale ? undefined : defaults.thinkingOptionId,
    ),
    modeId: resolveModeId(entry, defaults.modeId),
  };
}

// 只写目录里有的模式，且总是写出一个：create_agent 缺 mode 时会继承父会话或对跨 provider 报错，
// 写了目录外的模式则直接报 Invalid mode。默认模式不在目录里时退到第一个模式，与 app 新建界面一致。
function resolveModeId(
  entry: ProviderSnapshotEntry,
  configuredModeId: string | undefined,
): string | undefined {
  const modeIds = (entry.modes ?? []).map((mode) => mode.id);
  const candidates = [configuredModeId, entry.defaultModeId ?? undefined];
  return candidates.find((id) => id !== undefined && modeIds.includes(id)) ?? modeIds[0];
}

/**
 * Routing block for the provider mentions in a client-sent user message, or null
 * when the message mentions no provider or the session cannot dispatch.
 */
export async function resolveRoutingBlock(input: ResolveRoutingBlockInput): Promise<string | null> {
  if (!input.canCreateAgents) return null;
  const mentions = findMarkdownLinks(input.text).flatMap((link) => {
    const mention = parseAgentMentionLink(link);
    return mention?.target.kind === "provider"
      ? [{ label: link.label, id: mention.target.id }]
      : [];
  });
  if (mentions.length === 0) return null;

  const providerIds = [...new Set(mentions.map((mention) => mention.id))];
  const targets = new Map(
    await Promise.all(
      providerIds.map(async (id) => [id, await resolveProviderTarget(id, input)] as const),
    ),
  );
  return formatRoutingBlock(
    mentions.flatMap(({ label, id }) => {
      const target = targets.get(id);
      return target ? [{ label, target }] : [];
    }),
  );
}
