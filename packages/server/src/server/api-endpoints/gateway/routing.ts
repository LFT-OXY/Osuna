// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/provider.go 的 MessagesFirst、internal/gateway/gateway.go 的 usable、
// internal/provider/group.go 的 sameModel、internal/provider/closest.go 的 Closest、internal/gateway/unknown_model.go，
// internal/gateway/gateway.go 的 claudeFamily 与 claudeTierStandIn、internal/agent/claude.go 的 claudeStandInAt，Gemini 排最后照 provider.go 的 Speaks）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModelTier,
  type ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { ONE_MILLION_MARK } from "../claude-model-hints.js";
import type { ApiEndpointProvider, ApiEndpointState, StoredApiEndpoint } from "../store.js";
import { isBedrockClaude } from "../templates.js";

/*
 * Claude Code 的开关开着时，Claude Code 内置的档位 id（claude-haiku-4-5-20251001 这类，照 magpie 的 claudeFamily）
 * 不论哪家选了它，都先换成这个档位的映射：第一家映射了该档位的接口；没有一家映射时换成 Claude Code 的默认模型。
 * 默认模型本身就是这个 id 时照下面的顺序找（照 magpie 的 claudeTierStandIn / claudeStandInAt）。
 *
 * 其余的名字按顺序试（名字里的 `~` 先当 `/`）：
 * 1. `slug/模型名`：该家开着且选了这个模型就直达；
 * 2. 整个名字是某家已选的模型（模型名本身可能带斜杠，如 `moonshotai/kimi-k2`）；
 * 3. 标识那家已删除 / 已关闭 / 没选这个模型：视同不可用，斜杠后的光秃秃模型名换同名的家；
 * 4. 只差写法的同一个模型（sameModel）：斜杠前不是任何一家的标识时就是厂商前缀，一并忽略；
 * 5. Claude 档位名（含 opus / sonnet / haiku / fable）：第一家映射了该档位的接口，换成映射到的模型；
 * 6. Claude Code 的开关开着时，档位名（opus 等）与 claude- 开头的 id（对不上档位的，如 claude-mythos-5-1）
 *    都没找到，改按 Claude Code 的默认模型找，不回 404。
 * 都按接口顺序（数组顺序）找，只看开着的接口；一家要发的名字取它自己列出的写法，写法完全相同的优先。
 * 用户选的那家排第一，后面跟着其他开着、选了同一个模型的接口（接口顺序），供失败时自动切换。
 * 厂商说已下线的模型（retired-models.ts）只有第 1 步照发，其余各步、后面跟着的接口与相近名字都按 listed 找。
 */

export interface GatewayCandidate {
  endpoint: StoredApiEndpoint;
  upstreamModel: string;
}

export type GatewayRoute =
  | { ok: true; candidates: GatewayCandidate[] }
  | { ok: false; message: string };

/** `claude-haiku-4-5-20251001`、`haiku` 这类名字里的档位；档位词须独立成段。 */
function claudeTierOf(model: string): ApiEndpointModelTier | null {
  const lower = model.toLowerCase();
  return (
    API_ENDPOINT_MODEL_TIERS.find((tier) =>
      new RegExp(`(?:^|[^a-z])${tier}(?:[^a-z]|$)`).test(lower),
    ) ?? null
  );
}

// Claude Code 内置的档位 id（照 magpie 的 claudeFamily）：不论版本，按家族认；带厂商前缀的 `a/claude-…` 不算。
const CLAUDE_FAMILY_ID = /^claude-(?:[0-9][0-9.-]*-)?(?:opus|sonnet|haiku|fable)(?:[-.@:]|$)/;
const CLAUDE_TIER_NAMES: ReadonlySet<string> = new Set(API_ENDPOINT_MODEL_TIERS);
// 没人在售的 Claude id（照 magpie 的 claudeStandInAt：对不上档位的换成主模型）；带厂商前缀的不算。
const CLAUDE_ID = /^claude-/;

/** 比较用的名字：小写，去掉 Claude Code 的 [1m]。 */
function comparableName(model: string): string {
  const lower = model.toLowerCase();
  if (!lower.endsWith(ONE_MILLION_MARK)) return lower;
  return lower.slice(0, -ONE_MILLION_MARK.length);
}

export interface GatewayRouteInput {
  state: ApiEndpointState;
  // 去掉一周内下线的模型之后的状态；缺省即 state（没有下线的模型）。
  listed?: ApiEndpointState;
  agent: ApiEndpointProvider;
  model: string;
}

export function resolveGatewayRoute(input: GatewayRouteInput): GatewayRoute {
  const listed = input.listed ?? input.state;
  const model = input.model.replaceAll("~", "/");
  const routeInput = { state: input.state, listed, agent: input.agent, model };
  const chosen =
    claudeTierStandIn(routeInput) ?? chooseEndpoint(routeInput) ?? tierFallback(routeInput);
  if (!chosen) {
    return { ok: false, message: unknownModel(listed, input.model) };
  }
  const others = listed.endpoints.flatMap((endpoint) => {
    if (!endpoint.enabled || endpoint.id === chosen.endpoint.id) return [];
    const upstreamModel = listedAs(endpoint, chosen.upstreamModel);
    return upstreamModel === null ? [] : [{ endpoint, upstreamModel }];
  });
  return { ok: true, candidates: [chosen, ...others] };
}

/**
 * 只差写法的模型名归成同一个（magpie 的 sameModel）：小写，去掉最后一个斜杠前的厂商前缀，
 * 下划线改连字符，数字之间的点和 Fireworks 的 p 改连字符，去掉末尾的快照日期
 * （YYYYMMDD、Vertex 的 @YYYYMMDD、火山方舟的 YYMMDD）。冒号后的变体、-flash、-thinking、
 * 四位数的发布号（qwen 的 -2507、kimi-k2-0905）是另一个模型，留着。
 */
export function sameModel(id: string): string {
  let key = id.trim().toLowerCase().replaceAll("_", "-");
  key = key.slice(key.lastIndexOf("/") + 1);
  const chars = [...key];
  for (let i = 1; i + 1 < chars.length; i++) {
    const between = isDigit(chars[i - 1]) && isDigit(chars[i + 1]);
    if (between && (chars[i] === "." || chars[i] === "p")) chars[i] = "-";
  }
  key = chars.join("");
  const cut = Math.max(key.lastIndexOf("-"), key.lastIndexOf("@"));
  if (cut <= 0 || !isSnapshotDate(key.slice(cut + 1))) return key;
  return key.slice(0, cut);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/** 厂商给快照标的日期：2000 年起的 YYYYMMDD，或 2023–2039 年、月日都合法的 YYMMDD。 */
function isSnapshotDate(text: string): boolean {
  if (!/^\d+$/.test(text)) return false;
  if (text.length === 8) return text.startsWith("20");
  if (text.length !== 6) return false;
  const yy = Number(text.slice(0, 2));
  const mm = Number(text.slice(2, 4));
  const dd = Number(text.slice(4, 6));
  const arkYear = yy >= 23 && yy <= 39;
  const realDay = mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  return arkYear && realDay;
}

/** 这家怎么写这个模型：写法完全相同的优先，否则第一个只差写法的；没选为 null。 */
export function listedAs(
  endpoint: Pick<StoredApiEndpoint, "models">,
  model: string,
): string | null {
  if (endpoint.models.some((entry) => entry.id === model)) return model;
  const key = sameModel(model);
  return endpoint.models.find((entry) => sameModel(entry.id) === key)?.id ?? null;
}

function chooseEndpoint(input: Required<GatewayRouteInput>): GatewayCandidate | null {
  const { model } = input;
  const enabled = input.listed.endpoints.filter((endpoint) => endpoint.enabled);

  const slash = model.indexOf("/");
  const bare = slash === -1 ? null : model.slice(slash + 1);
  if (bare !== null) {
    const slug = model.slice(0, slash);
    // 指定了这家：已下线的也照发，厂商怎么答交给 CLI。
    const named = input.state.endpoints.find(
      (endpoint) => endpoint.enabled && endpoint.slug === slug,
    );
    if (named) {
      const upstreamModel = listedAs(named, bare);
      if (upstreamModel !== null) return { endpoint: named, upstreamModel };
    }
  }
  for (const name of bare === null ? [model] : [model, bare]) {
    const endpoint = enabled.find((entry) => entry.models.some((listed) => listed.id === name));
    if (endpoint) return { endpoint, upstreamModel: name };
  }
  for (const endpoint of enabled) {
    const upstreamModel = listedAs(endpoint, model);
    if (upstreamModel !== null) return { endpoint, upstreamModel };
  }
  const tier = input.agent === "claude" ? claudeTierOf(bare ?? model) : null;
  return tier ? tierMapping({ listed: input.listed, tier }) : null;
}

/** 第一家开着、映射了这个档位的接口和映射到的模型。 */
function tierMapping(input: {
  listed: ApiEndpointState;
  tier: ApiEndpointModelTier;
}): GatewayCandidate | null {
  for (const endpoint of input.listed.endpoints) {
    if (!endpoint.enabled) continue;
    const mapped = endpoint.modelMapping?.[input.tier];
    if (mapped) return { endpoint, upstreamModel: mapped };
  }
  return null;
}

/** Claude Code 的开关开着、调用方是 Claude Code 时它的默认模型；否则为 null。 */
function claudeDefaultModel(input: Required<GatewayRouteInput>): string | null {
  const claude = input.state.agents.claude;
  const isClaudeCodeOn = input.agent === "claude" && claude.enabled;
  return isClaudeCodeOn ? claude.defaultModelId : null;
}

/** 内置的档位 id 换成档位的映射，没有映射换成默认模型；默认模型就是它、或不适用时为 null。 */
function claudeTierStandIn(input: Required<GatewayRouteInput>): GatewayCandidate | null {
  const defaultModel = claudeDefaultModel(input);
  const name = comparableName(input.model);
  const isStandInAsked = defaultModel !== null && CLAUDE_FAMILY_ID.test(name);
  if (!isStandInAsked) return null;
  const isOwnPick = comparableName(defaultModel) === name;
  if (isOwnPick) return null;
  const tier = API_ENDPOINT_MODEL_TIERS.find((entry) => name.includes(entry));
  const mapped = tier ? tierMapping({ listed: input.listed, tier }) : null;
  return mapped ?? chooseEndpoint({ ...input, model: defaultModel });
}

/** 第 6 步：没人在售、没配映射的档位名（opus 等）与 Claude id（claude-mythos-5-1 这类）改按 Claude Code 的默认模型找。 */
function tierFallback(input: Required<GatewayRouteInput>): GatewayCandidate | null {
  const defaultModel = claudeDefaultModel(input);
  const name = comparableName(input.model);
  const isClaudeName = CLAUDE_TIER_NAMES.has(name) || CLAUDE_ID.test(name);
  const isFallbackAsked = defaultModel !== null && isClaudeName;
  if (!isFallbackAsked) return null;
  return chooseEndpoint({ ...input, model: defaultModel });
}

/** 找不到模型时的说法：附上最接近的三个 id（magpie 的 unknownModel）。 */
function unknownModel(state: ApiEndpointState, asked: string): string {
  const message = `No enabled API endpoint offers the model "${asked}"`;
  const near = closestModels({ state, asked, n: 3 });
  return near.length > 0 ? `${message}; did you mean ${near.join(", ")}?` : message;
}

/** 名字里连续的字母、连续的数字，小写：`glm-4.6` 是 glm、4、6。 */
function nameWords(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+|\p{N}+/gu) ?? [];
}

/**
 * 开着的接口里离 asked 最近的至多 n 个模型 id，近的在前（magpie 的 Closest）：
 * 显示名里有这个词得 4 分、id 里有得 3 分、只在接口标识或名称里有得 1 分；
 * 只靠接口名对上的不算；连起来的整个名字出现在显示名或 id 里再加 4 分。
 */
function closestModels(input: { state: ApiEndpointState; asked: string; n: number }): string[] {
  const words = nameWords(input.asked);
  if (words.length === 0) return [];
  const hits: { id: string; score: number }[] = [];
  for (const endpoint of input.state.endpoints) {
    if (!endpoint.enabled) continue;
    const endpointWords = [...nameWords(endpoint.slug), ...nameWords(endpoint.name)];
    const from = new Set(endpointWords);
    for (const entry of endpoint.models) {
      const score = closeness({ words, label: entry.label ?? "", id: entry.id, from });
      if (score !== null) hits.push({ id: entry.id, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const ids = new Set(hits.map((hit) => hit.id));
  return [...ids].slice(0, input.n);
}

/** 一个模型离要的名字多近；没有一个词对上它自己的显示名或 id 为 null。 */
function closeness(input: {
  words: string[];
  label: string;
  id: string;
  from: ReadonlySet<string>;
}): number | null {
  const names = nameWords(input.label);
  const model = nameWords(input.id);
  const nameSet = new Set(names);
  const modelSet = new Set(model);
  let score = 0;
  let own = 0;
  for (const word of input.words) {
    if (nameSet.has(word)) {
      score += 4;
      own++;
    } else if (modelSet.has(word)) {
      score += 3;
      own++;
    } else if (input.from.has(word)) {
      score++;
    }
  }
  if (own === 0) return null;
  const whole = input.words.join("");
  if (names.join("").includes(whole) || model.join("").includes(whole)) score += 4;
  return score;
}

// 没有 Agent 自己格式的地址时，按这个顺序取第一个能用的格式翻译过去；Gemini 排最后（magpie Speaks）。
const TRANSLATION_ORDER: ApiEndpointRequestFormat[] = [
  "openai_chat",
  "openai_responses",
  "anthropic_messages",
  "gemini",
];

/** 斜杠后的名字以 claude 开头，或是 Bedrock 的 Claude id（magpie 的 claudeModel）。 */
export function isClaudeModel(model: string): boolean {
  const bare = model.slice(model.lastIndexOf("/") + 1).toLowerCase();
  return bare.startsWith("claude") || isBedrockClaude(bare);
}

/**
 * 这次向这家接口用哪种格式请求（照 magpie 的 usable + MessagesFirst）：
 * Claude 模型且有 Anthropic 地址一律走 Anthropic，保住缓存标记与思考；
 * 否则有 Agent 自己格式的地址就直通；再否则按 Chat → Responses → Anthropic → Gemini 取第一个翻译过去。
 * `formatOrder` 是这家这个模型翻译时先试的格式（translationOrderAt，如 Bedrock 与 Azure 上的 GPT 先 Responses，照 magpie ResponsesFirst），
 * 翻译时按它取；null 即按上面的顺序。
 */
export function chooseRequestFormat(input: {
  agentFormat: ApiEndpointRequestFormat;
  model: string;
  formats: readonly ApiEndpointRequestFormat[];
  formatOrder: readonly ApiEndpointRequestFormat[] | null;
}): ApiEndpointRequestFormat | null {
  const { formats } = input;
  if (isClaudeModel(input.model) && formats.includes("anthropic_messages")) {
    return "anthropic_messages";
  }
  if (formats.includes(input.agentFormat)) return input.agentFormat;
  const order = input.formatOrder ?? TRANSLATION_ORDER;
  return order.find((format) => formats.includes(format)) ?? null;
}
