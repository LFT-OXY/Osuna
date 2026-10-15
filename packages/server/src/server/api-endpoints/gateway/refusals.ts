// 拒绝判定移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic.go 的 alwaysThinks、refusesThinkingOff、thinkingOffRefused，gateway.go 的 mandatoryReasoning、effortLevelsNamed、noneQuoted）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "../upstream-http.js";
import { wordsOf } from "./failure.js";

/*
 * 上游不收「不思考」的写法：OpenAI 格式的 effort none，或 Anthropic 格式的关思考。
 * 中转站在第一段到达前、换家判断之前，用 low（或打开思考）在同一家重问一次，并记住这家的这个模型不收，
 * 以后直接换写法发。记录只在内存里，daemon 重启清零（和冷却一样）。
 */

/** none：不收 effort none；thinkingOff：不让关思考。 */
export type RefusedShape = "none" | "thinkingOff";

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
  return openAIEffortOf(input.format, body) === "none" && refusesNone(text) ? "none" : null;
}

function openAIEffortOf(format: ApiEndpointRequestFormat, body: Record<string, unknown>): unknown {
  if (format === "openai_chat") return body.reasoning_effort;
  return isRecord(body.reasoning) ? body.reasoning.effort : undefined;
}

/**
 * 发出去的 `body` 被拒，是因为不思考的写法：记进 `refusals`，返回 true，调用方在同一家换写法重问一次。
 * 同一模型并发的请求可能都按旧写法发出，所以已经记过的也照样重问。
 */
export function noteRefusal(input: {
  refusals: ShapeRefusals;
  format: ApiEndpointRequestFormat;
  body: unknown;
  failed: { status: number; text: string };
}): boolean {
  const { failed } = input;
  const shape = refusedShape({ ...input, status: failed.status, text: failed.text });
  if (shape === null) return false;
  input.refusals.add(shape);
  return true;
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
}

function key(endpointId: string, model: string, shape: RefusedShape): string {
  return `${endpointId}\0${model}\0${shape}`;
}
