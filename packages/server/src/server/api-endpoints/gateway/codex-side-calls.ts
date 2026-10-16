// 移植自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_memory.go、codex_backend.go 的 callKind、
// internal/usage/purpose.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import { isRecord, parseJson } from "../upstream-http.js";

/*
 * Codex 整理记忆、做 auto-review 时用自己的模型名（gpt-5.6-terra、gpt-5.6-luna、codex-auto-review），
 * 不管它配的是哪个模型。中转站没有这些模型时，把它们发给 Codex 上一轮对话用的模型（magpie #742）。
 * 上一轮记在内存里；Osuna 每个 Agent 一个口令，所以按 Agent 记，等于 magpie 的「Agent + 口令」。
 */

const MEMORY_KINDS = new Set(["memory_consolidation", "memgen", "memory"]);
const REVIEW_KIND = "guardian";
const REVIEW_MODEL = "codex-auto-review";

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** 这个请求为什么发：x-openai-subagent 写的，或 x-codex-turn-metadata 里的 thread_source；对话本身的一轮为空。 */
function callKind(headers: IncomingHttpHeaders): string {
  const subagent = header(headers, "x-openai-subagent");
  if (subagent) return subagent;
  if (header(headers, "x-openai-memgen-request")) return "memgen";
  const metadata = parseJson(header(headers, "x-codex-turn-metadata"));
  const source = isRecord(metadata) ? metadata.thread_source : undefined;
  if (typeof source !== "string") return "";
  const ownTurn = source === "user" || source === "subagent";
  return ownTurn ? "" : source;
}

export class CodexLastTurn {
  private model: string | null = null;

  /** 记下 Codex 对话本身的一轮问的模型；记忆、审查等别的请求不记。 */
  asked(headers: IncomingHttpHeaders, model: string): void {
    if (callKind(headers) === "") this.model = model;
  }

  /** 记忆整理或 auto-review 找不到模型时改问的模型；不是这类请求、或还没有上一轮时为 null。 */
  standIn(headers: IncomingHttpHeaders, asked: string): string | null {
    const kind = callKind(headers);
    const sideCall = MEMORY_KINDS.has(kind) || kind === REVIEW_KIND || asked === REVIEW_MODEL;
    if (!sideCall || this.model === asked) return null;
    return this.model;
  }
}
