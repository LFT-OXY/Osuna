import type { AgentProfile } from "@osuna/protocol/messages";
import {
  findMarkdownLinks,
  parseAgentMentionLink,
  type AgentMentionTarget,
} from "@osuna/protocol/message-links";
import type { ProviderMentionDefaults } from "@osuna/protocol/provider-config";

import { filterSelectableAgentModels, type ProviderSnapshotEntry } from "./agent-sdk-types.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import { formatSystemNotificationPrompt } from "./agent-prompt.js";
import { resolveThinkingOptionId, selectDefaultModel } from "./structured-generation-providers.js";

export interface RoutingBlockSettings {
  modeId?: string;
  thinkingOptionId?: string;
  features?: AgentProfile["featureValues"];
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
  /** 发送时的 Agent profile 列表；profile mention 按 id 在这里找。 */
  agentProfiles: readonly AgentProfile[];
  providers: RoutingBlockProviderSource;
}

const ROUTING_BLOCK_INTRO =
  "The user's message above mentions agents as links of the form [@Name](osuna://agent/...). Each mention asks you to start a new subagent for the part of the message it refers to. Start them now, before any other work:";

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

type UnavailableTarget = Extract<RoutingBlockTarget, { status: "unavailable" }>;

type ProviderLookup = UnavailableTarget | { status: "available"; entry: ProviderSnapshotEntry };

/** 一条 mention 要派给的 provider，profile mention 还带上 profile 自己的字段。 */
type MentionRequest =
  | UnavailableTarget
  | { status: "resolvable"; providerId: string; profile?: AgentProfile };

function toMentionRequest(
  target: AgentMentionTarget,
  profiles: readonly AgentProfile[],
): MentionRequest {
  if (target.kind === "provider") return { status: "resolvable", providerId: target.id };
  const profile = profiles.find((candidate) => candidate.id === target.id);
  if (!profile) {
    return { status: "unavailable", reason: `agent profile "${target.id}" no longer exists` };
  }
  return { status: "resolvable", providerId: profile.provider, profile };
}

async function lookupProvider(
  providerId: string,
  input: ResolveRoutingBlockInput,
): Promise<ProviderLookup> {
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
  return { status: "available", entry };
}

/** 未经目录校验时逐字段取第一个写了的层。 */
function overlayLayers(layers: readonly ProviderMentionDefaults[]): ProviderMentionDefaults {
  return {
    model: layers.find((layer) => layer.model !== undefined)?.model,
    thinkingOptionId: layers.find((layer) => layer.thinkingOptionId !== undefined)
      ?.thinkingOptionId,
    modeId: layers.find((layer) => layer.modeId !== undefined)?.modeId,
  };
}

interface ResolveTargetInput {
  providerId: string;
  entry: ProviderSnapshotEntry;
  profile: AgentProfile | undefined;
  defaults: ProviderMentionDefaults;
}

function resolveTarget({
  providerId,
  entry,
  profile,
  defaults,
}: ResolveTargetInput): RoutingBlockTarget {
  // profile 写了的字段在前，该 provider 的 Mention defaults 在后。
  const layers = profile ? [profile, defaults] : [defaults];
  // 目录没就绪或加载出错时无从校验：配置值原样透传，未设的项交给 create_agent 按 provider 默认。
  const values =
    entry.status === "ready" ? resolveAgainstCatalog(entry, layers) : overlayLayers(layers);
  const features = profile?.featureValues;
  return {
    status: "ready",
    provider: providerId,
    ...(values.model ? { model: values.model } : {}),
    settings: {
      ...(values.modeId ? { modeId: values.modeId } : {}),
      ...(values.thinkingOptionId ? { thinkingOptionId: values.thinkingOptionId } : {}),
      ...(features && Object.keys(features).length > 0 ? { features } : {}),
    },
  };
}

/**
 * 按已加载的目录逐字段校验各层配置：每个字段取第一个仍然有效的层，都失效或都没写时回退到运行时默认。
 */
function resolveAgainstCatalog(
  entry: ProviderSnapshotEntry,
  layers: readonly ProviderMentionDefaults[],
): ProviderMentionDefaults {
  const models = filterSelectableAgentModels(entry.models);
  const findModel = (id: string | undefined) =>
    id === undefined ? undefined : models.find((candidate) => candidate.id === id);
  const model =
    layers.map((layer) => findModel(layer.model)).find((found) => found !== undefined) ??
    selectDefaultModel(models);
  // 某层写的模型已下线时，该层的档位随之作废，不再套到别的模型上。
  const thinkingOptionId = layers
    .filter((layer) => layer.model === undefined || findModel(layer.model) !== undefined)
    .map((layer) => layer.thinkingOptionId)
    .find((id) => model?.thinkingOptions?.some((option) => option.id === id));
  return {
    model: model?.id,
    thinkingOptionId: resolveThinkingOptionId(model, thinkingOptionId),
    modeId: resolveModeId(
      entry,
      layers.map((layer) => layer.modeId),
    ),
  };
}

// 只写目录里有的模式，且总是写出一个：create_agent 缺 mode 时会继承父会话或对跨 provider 报错，
// 写了目录外的模式则直接报 Invalid mode。默认模式不在目录里时退到第一个模式，与 app 新建界面一致。
function resolveModeId(
  entry: ProviderSnapshotEntry,
  configuredModeIds: readonly (string | undefined)[],
): string | undefined {
  const modeIds = (entry.modes ?? []).map((mode) => mode.id);
  const candidates = [...configuredModeIds, entry.defaultModeId ?? undefined];
  return candidates.find((id) => id !== undefined && modeIds.includes(id)) ?? modeIds[0];
}

/**
 * Routing block for the agent mentions in a client-sent user message, or null
 * when the message mentions no agent or the session cannot dispatch.
 */
export async function resolveRoutingBlock(input: ResolveRoutingBlockInput): Promise<string | null> {
  if (!input.canCreateAgents) return null;
  const mentions = findMarkdownLinks(input.text).flatMap((link) => {
    const mention = parseAgentMentionLink(link);
    return mention
      ? [{ label: link.label, request: toMentionRequest(mention.target, input.agentProfiles) }]
      : [];
  });
  if (mentions.length === 0) return null;

  const providerIds = [
    ...new Set(
      mentions.flatMap(({ request }) =>
        request.status === "resolvable" ? [request.providerId] : [],
      ),
    ),
  ];
  const lookups = new Map(
    await Promise.all(
      providerIds.map(async (id) => [id, await lookupProvider(id, input)] as const),
    ),
  );
  return formatRoutingBlock(
    mentions.flatMap(({ label, request }): RoutingBlockMention[] => {
      if (request.status === "unavailable") return [{ label, target: request }];
      const lookup = lookups.get(request.providerId);
      if (!lookup) return [];
      if (lookup.status === "unavailable") return [{ label, target: lookup }];
      const target = resolveTarget({
        providerId: request.providerId,
        entry: lookup.entry,
        profile: request.profile,
        defaults: input.mentionDefaults(request.providerId) ?? {},
      });
      return [{ label, target }];
    }),
  );
}
