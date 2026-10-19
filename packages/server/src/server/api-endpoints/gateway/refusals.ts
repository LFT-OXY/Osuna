// 拒绝判定移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic.go 的 alwaysThinks、refusesThinkingOff、thinkingOffRefused，gateway.go 的 mandatoryReasoning、effortLevelsNamed、noneQuoted、wrongEndpoint、markUnfit 与 attempt、forwardTranslated 里画图工具的重问，internal/catalog/authheader.go 的 BothAuthRefused、OneAuthOrder，internal/provider/authheader.go 的 RetryOneAuth）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord, parseJson } from "../upstream-http.js";
import { templateKeyHeaders } from "../templates.js";
import { FAILURE_WORDS, wordsOf } from "./failure.js";
import { refusedDowngrades, type DowngradedShape } from "./refused-downgrades.js";
import { refusedFields, refusesContent, type DroppedField } from "./refused-fields.js";
import type { FailedAttempt, UpstreamOpening } from "./upstream-call.js";

/*
 * 上游不收的写法（拒收）：OpenAI 格式的 effort none、Anthropic 格式的关思考、这个格式的地址不提供这个模型、
 * 两个认证头不能同时带、请求里的某个字段（refused-fields.ts）、结构化输出与预填（refused-downgrades.ts）。中转站在开口前、换家判断之前，换一种写法在同一家重问，并记住这家的这个模型不收，
 * 以后直接换写法发。记录只在内存里，daemon 重启清零（和冷却一样）。
 */

/**
 * none：不收 effort none；thinkingOff：不让关思考；toolsEffort：Chat 上带工具时不收推理力度（要 none）；
 * `format:<格式>`：这个格式的地址不提供这个模型；
 * bothKeyHeaders：x-api-key 与 Authorization 不能同时带（只带 x-api-key）；xApiKeyAlone：只带 x-api-key 也不收（只带 Bearer）；
 * 其余是不收、要去掉的字段（DroppedField）与要降级的写法（DowngradedShape）。
 */
export type RefusedShape =
  | "none"
  | "thinkingOff"
  | "toolsEffort"
  | `format:${ApiEndpointRequestFormat}`
  | "bothKeyHeaders"
  | "xApiKeyAlone"
  | DroppedField
  | DowngradedShape;

const REFUSAL_WORDS = {
  // 列出它收的档位，如 Command Code 的 `expected one of "low"|"medium"|…`。
  effortLevelsNamed: /\blow\b\W+(?:medium|high)\b/i,
  // 带引号的 none：列档位的错误都带引号（JSON 里双引号前有反斜杠），句子里的 None 不算。
  noneQuoted: /['"]none\\?['"]/i,
  // 总在思考的模型不让关：智谱 GLM-5.3 的 1210、中文版、百炼、MiniMax、火山方舟。
  alwaysThinks:
    /always engages in thinking|thinking (?:can ?not|can't) be (?:disabled|turned off)|enable_thinking[^"]{0,60}restricted to true|始终(?:支持|开启|启用)?思考|思考[^"]{0,20}(?:不可|无法|不能)关闭|requires adaptive thinking\W+thinking\.type\W+disabled\W+\(including reasoning\.effort=none\) is not allowed|thinking\.type `disabled` is not supported by this model/i,
  // OpenRouter 要求必须推理。
  mandatoryReasoning: /reasoning is mandatory for this endpoint and cannot be disabled/i,
  // Chat 上带工具时不收推理力度，要求设成 none（Bedrock 的 GPT，magpie #176 的 toolsWithoutEffort）。
  toolsWithoutEffort: /tools with reasoning_effort are not supported.*reasoning_effort to .?none/is,
  // 任何档位都不收 disabled 的 Claude（Opus 5.5）。
  thinkingOffRefused: /thinking\.type\.disabled\W+is not supported/i,
} as const;

const W = REFUSAL_WORDS;

/** 列出了档位、又点名 none：上游不收 effort none（中转站把 disabled 读成 none 拒掉也是这样说的）。 */
function refusesNone(text: string): boolean {
  return W.effortLevelsNamed.test(text) && W.noneQuoted.test(text);
}

function refusesThinkingOff(text: string): boolean {
  return (
    W.alwaysThinks.test(wordsOf(text)) ||
    W.mandatoryReasoning.test(text) ||
    W.thinkingOffRefused.test(text) ||
    refusesNone(text)
  );
}

/** 这次发出去的请求（`body`）被 400 拒，是不是因为不思考的写法；不是为 null。 */
export function refusedShape(input: {
  format: ApiEndpointRequestFormat;
  body: unknown;
  status: number;
  text: string;
}): RefusedShape | null {
  const { body, text } = input;
  if (input.status !== 400 || !isRecord(body)) return null;
  if (input.format === "anthropic_messages") {
    const type = isRecord(body.thinking) ? body.thinking.type : undefined;
    const off = type === "disabled" || type === "between_tools";
    return off && refusesThinkingOff(text) ? "thinkingOff" : null;
  }
  const effort = openAIEffortOf(input.format, body);
  if (effort === "none") return refusesNone(text) ? "none" : null;
  const chat = input.format === "openai_chat";
  return chat && W.toolsWithoutEffort.test(text) ? "toolsEffort" : null;
}

function openAIEffortOf(format: ApiEndpointRequestFormat, body: Record<string, unknown>): unknown {
  if (format === "openai_chat") return body.reasoning_effort;
  return isRecord(body.reasoning) ? body.reasoning.effort : undefined;
}

/**
 * 发出去的 `body` 被拒，是因为不思考的写法、它带着的字段或要降级的写法：记进 `refusals`，返回 true，调用方在同一家换写法重问。
 * 同一模型并发的请求可能都按旧写法发出，所以已经记过的也照样重问。
 */
export function noteRefusal(input: {
  refusals: ShapeRefusals;
  format: ApiEndpointRequestFormat;
  body: unknown;
  failed: { status: number; text: string };
}): boolean {
  const { failed } = input;
  const read = { ...input, status: failed.status, text: failed.text };
  const shapes: RefusedShape[] = [...refusedFields(read), ...refusedDowngrades(read)];
  const shape = refusedShape(read);
  if (shape !== null) shapes.push(shape);
  for (const refused of shapes) input.refusals.add(refused);
  return shapes.length > 0;
}

/** 按记住的写法重问之后：最后一次的结果，与最后一次发出的请求体。 */
export interface RefittedAsk {
  outcome: UpstreamOpening;
  sent: string;
}

/**
 * 被拒是因为认得出的写法（noteRefusal）：记下后按新写法在同一家重问；新写法又因为另一种写法被拒时接着记、接着问。
 * 每次重问的请求体都和上一次不同，所以问的次数有限；认不出、或改不出新请求体时交出这次的失败，按原来的规则处理。
 */
export async function askRefitted(input: {
  refusals: ShapeRefusals;
  format: ApiEndpointRequestFormat;
  sent: string;
  outcome: UpstreamOpening;
  // 按现在记住的写法重新做的请求体。
  refit: () => string;
  ask: (body: string) => Promise<UpstreamOpening>;
}): Promise<RefittedAsk> {
  let { outcome, sent } = input;
  // 拒答不是写法的问题：用 403 说的也记成了 400，不能当作拒收去改写重问。
  while (outcome.kind === "failed" && outcome.cause !== "refused") {
    const noted = noteRefusal({
      refusals: input.refusals,
      format: input.format,
      body: parseJson(sent),
      failed: outcome,
    });
    if (!noted) break;
    const next = input.refit();
    if (next === sent) break;
    sent = next;
    outcome = await input.ask(sent);
  }
  return { outcome, sent };
}

/** 认得出的拒收之外，同一家的 400 / 422 不说原因：不是「这个格式的地址没有这个模型」，也不是拒答。 */
function refusesBare(failed: FailedAttempt): boolean {
  const refusedAnswer = failed.cause === "refused";
  return refusesContent(failed.status) && !refusesFormat(failed) && !refusedAnswer;
}

/**
 * 不说原因的 400 / 422 可能是因为某个字段：这次的请求带着它时，去掉它在同一家重问一次；重问开了口才记住，以后不发。
 * 重问仍失败就交出那次的失败，按原来的规则处理，也不记。用在 Codex 的画图工具（不认命名空间的厂商，magpie #949）
 * 与翻译时的 prompt_cache_key（不认识的字段一律不收的厂商，原话不一定点名，magpie gateway.go 的 forwardTranslated）。
 */
export async function askWithoutField(input: {
  refusals: ShapeRefusals;
  field: DroppedField;
  // 这次发出的请求带着这个字段，且这家可能不收。
  offered: boolean;
  outcome: UpstreamOpening;
  ask: (refusals: ShapeRefusals) => Promise<UpstreamOpening>;
}): Promise<UpstreamOpening> {
  const { outcome, refusals, field } = input;
  if (outcome.kind !== "failed") return outcome;
  const bareRefusal = input.offered && refusesBare(outcome);
  if (!bareRefusal) return outcome;
  const without: ShapeRefusals = {
    has: (shape) => shape === field || refusals.has(shape),
    add: (shape) => refusals.add(shape),
  };
  const retried = await input.ask(without);
  if (retried.kind === "opened") refusals.add(field);
  return retried;
}

/** 这个格式的地址说不提供这个模型（magpie 的 wrongEndpoint）：同一家别的格式的地址也许提供。 */
export function refusesFormat(input: { status: number; text: string }): boolean {
  const clientError = input.status >= 400 && input.status < 500;
  return clientError && FAILURE_WORDS.wrongFormat.test(wordsOf(input.text));
}

export function formatShape(format: ApiEndpointRequestFormat): RefusedShape {
  return `format:${format}`;
}

// 两个头一起带被拒时说的话：两个头名都在，再加一句「不能同时」（magpie 的 BothAuthRefused）。
const BOTH_KEY_HEADERS_WORDS = [
  "同时",
  "并存",
  "共存",
  "只能使用一个",
  "只能选择一个",
  "只能有一个",
  "cannot both",
  "can't both",
  "can not both",
  "cannot be both",
  "not both",
  "together",
  "at the same time",
  "simultaneous",
  "mutually exclusive",
  "only one of",
  "only one auth",
  "only one header",
  "both present",
  "both be present",
  "both provided",
  "both be provided",
];

/** 401 说 x-api-key 和 Authorization 不能同时带。 */
export function refusesBothKeyHeaders(input: { status: number; text: string }): boolean {
  if (input.status !== 401) return false;
  const text = input.text.toLowerCase();
  const namesBoth = text.includes("x-api-key") && text.includes("authorization");
  if (!namesBoth) return false;
  return BOTH_KEY_HEADERS_WORDS.some((words) => text.includes(words));
}

/** key 放在哪个请求头：两个都放、只放 x-api-key、只放 Authorization: Bearer、只放 Azure 的 api-key。 */
export type KeyHeaders = "both" | "xApiKey" | "bearer" | "apiKey";

/**
 * 发给这家时 key 放哪：Bedrock、Azure 由模板定（templateKeyHeaders）；其余 OpenAI 格式只放 Bearer，
 * Anthropic 地址两个都放，这家说过不能同时带的只放它收的那个。
 */
export function keyHeadersFor(input: {
  format: ApiEndpointRequestFormat;
  templateId: string | undefined;
  refusals: ShapeRefusals | undefined;
}): KeyHeaders {
  const { refusals } = input;
  const fixed = templateKeyHeaders({ templateId: input.templateId, format: input.format });
  if (fixed !== null) return fixed;
  if (input.format !== "anthropic_messages") return "bearer";
  if (refusals?.has("xApiKeyAlone")) return "bearer";
  return refusals?.has("bothKeyHeaders") ? "xApiKey" : "both";
}

/** 没 key 的接口（apiKey 为 null）一个认证头都不带。 */
export function keyHeaderValues(input: {
  apiKey: string | null;
  keys: KeyHeaders;
}): Record<string, string> {
  const { apiKey, keys } = input;
  if (apiKey === null) return {};
  if (keys === "apiKey") return { "api-key": apiKey };
  const headers: Record<string, string> = {};
  if (keys !== "xApiKey") headers.authorization = `Bearer ${apiKey}`;
  if (keys !== "bearer") headers["x-api-key"] = apiKey;
  return headers;
}

/** 问一次上游的结果（开口、失败、Agent 走了）里，要不要换头只看这些。 */
export type AskedUpstream = { kind: "opened" | "gone" } | { kind: "failed"; status: number };

// 两个头不能同时带时，先只带 Anthropic 自己的 x-api-key，再只带 Bearer（magpie 的 OneAuthOrder）。
const ONE_KEY_HEADER_ORDER = [
  { keys: "xApiKey", learned: "bothKeyHeaders" },
  { keys: "bearer", learned: "xApiKeyAlone" },
] as const;

/**
 * 两个头一起带被 401 拒：按顺序只带一个头各问一次，第一个不再被 401 / 403 拒的记住；都被拒时交出最后一次的失败，
 * 按原来的规则处理。不是这样被拒、或已经只带一个头的，原样交出 `failed`。
 */
export async function askWithOneKeyHeader<T extends AskedUpstream>(input: {
  refusals: ShapeRefusals;
  sent: KeyHeaders;
  failed: FailedAttempt;
  ask: (keys: KeyHeaders) => Promise<T | FailedAttempt>;
}): Promise<T | FailedAttempt> {
  const { failed } = input;
  if (input.sent !== "both") return failed;
  if (!refusesBothKeyHeaders(failed)) return failed;
  let outcome: T | FailedAttempt = failed;
  for (const { keys, learned } of ONE_KEY_HEADER_ORDER) {
    outcome = await input.ask(keys);
    if (outcome.kind === "gone") return outcome;
    if (!refusedAgain(outcome)) {
      input.refusals.add(learned);
      return outcome;
    }
  }
  return outcome;
}

function refusedAgain(outcome: AskedUpstream): boolean {
  if (outcome.kind !== "failed") return false;
  return outcome.status === 401 || outcome.status === 403;
}

/** 记住一种写法时写的 info 日志。 */
export function refusalNote(shape: RefusedShape): string {
  if (shape.startsWith("format:")) {
    return "API endpoint does not serve this model in this format; asking its next format";
  }
  if (shape === "bothKeyHeaders" || shape === "xApiKeyAlone") {
    return "API endpoint takes its key in one header only; sending it that way";
  }
  if (shape === "none" || shape === "thinkingOff") {
    return "API endpoint refused reasoning off; asking it again with reasoning on";
  }
  if (shape === "jsonSchema") {
    return "API endpoint refused a JSON schema; asking it again for a JSON object with the schema in the system prompt";
  }
  if (shape === "structuredOutput") {
    return "API endpoint refused structured output; asking it again with the format told in the system prompt";
  }
  if (shape === "prefill") {
    return "API endpoint refused a conversation ending with the assistant's message; it takes no prefill for this model";
  }
  if (shape === "rootUnion") {
    return "API endpoint refused a tool schema with a union at its root; asking it again with an object root";
  }
  return "API endpoint refused a field of the request; asking it again without it";
}

/** 这家这个模型说过不收以 assistant 结尾的对话（预填）。 */
export function refusesPrefill(refusals: ShapeRefusals): boolean {
  return refusals.has("prefill");
}

/** 这次问的那家的那个模型：直通与翻译读它决定怎么发，被拒时记进去。 */
export interface ShapeRefusals {
  has(shape: RefusedShape): boolean;
  add(shape: RefusedShape): void;
}

/** 哪家的哪个模型不收哪种写法；只在内存里。 */
export class RefusedShapes {
  private readonly refused = new Set<string>();

  has(endpointId: string, model: string, shape: RefusedShape): boolean {
    return this.refused.has(key(endpointId, model, shape));
  }

  add(endpointId: string, model: string, shape: RefusedShape): void {
    this.refused.add(key(endpointId, model, shape));
  }

  forget(input: { endpointId: string; model: string; shapes: RefusedShape[] }): void {
    for (const shape of input.shapes)
      this.refused.delete(key(input.endpointId, input.model, shape));
  }
}

function key(endpointId: string, model: string, shape: RefusedShape): string {
  return `${endpointId}\0${model}\0${shape}`;
}
