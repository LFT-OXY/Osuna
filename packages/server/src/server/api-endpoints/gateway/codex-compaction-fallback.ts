// 摘要请求失败时以纯文字重问、再失败就本地拼摘要、一段对话压缩一直失败时暂停移植自 magpie
// （https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 plainCompact、plainCompactMax、localSummary、
// localSummaryMax、itemText、compactItems、upstreamFailed、itemNotFound、unreadableItem，fallback.go 的 protectionWords、
// protectionRefused，codex_compact_guard.go 的 compactFails、compactKey、compactFailsMost、compactHeldFor）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../upstream-http.js";
import { CODEX_COMPACT_PROMPT, userMessage } from "./codex-compaction.js";

/*
 * 接口模型的摘要请求失败时（magpie #866、#1008、#1270）：
 * - 404、说某个条目找不到的 400、中转站自己说「Upstream request failed」的 4xx、「response protection is unavailable」
 *   这几种是这次请求的内容问题，不是这家的错：以纯文字的对话再问一次（不带条目 id、加密推理和调用）；
 * - 再失败就不用模型，把用户说过的话和最后一次回复拼成「摘要」交回，压缩照样完成，Codex 能接着做。
 * 一段对话（Codex 的线程，prompt_cache_key）在同一个模型上连续失败 3 次、每次间隔不到 5 分钟，之后的压缩直接回 400
 * 说明，不再问模型，到最后一次失败满 5 分钟为止（magpie #2274：后台压缩每一步都问，6 小时问了 1169 次）。
 * 登录失败（401、403）不算：没花钱，重新登录就好。
 */

const PLAIN_COMPACT_MAX = 400_000;
const LOCAL_SUMMARY_MAX = 80_000;
const TOOL_OUTPUT_MAX = 4000;
const FAILS_MOST = 3;
const HELD_FOR_MS = 5 * 60_000;
const WHY_MAX = 300;

const UNREADABLE_ITEM =
  /(?:encrypted content for item|item with id) '?([A-Za-z]+_[A-Za-z0-9_-]+)'?/i;
const UPSTREAM_FAILED = /upstream request failed/i;
const PROTECTION_REFUSED = /response protection is unavailable/i;

/** 失败的回复：状态码与回复原文。 */
export interface FailedSummary {
  status: number;
  said: string;
}

/** 这次失败值得以纯文字的对话再问一次。 */
export function isAskedAgainAsText(failed: FailedSummary): boolean {
  const { status, said } = failed;
  const isNotFound = status === 404;
  const isItemNotFound =
    status === 400 && UNREADABLE_ITEM.test(said) && said.toLowerCase().includes("not found");
  const isSignInOrLimit = status === 401 || status === 403 || status === 429;
  const isUpstreamFailed =
    status >= 400 && status < 500 && !isSignInOrLimit && UPSTREAM_FAILED.test(said);
  const isProtection = status >= 400 && isProtectionRefusal(said);
  return isNotFound || isItemNotFound || isUpstreamFailed || isProtection;
}

/** 回复开口后以「response protection is unavailable」断掉的流也以纯文字再问（magpie #1270）。 */
export function isProtectionRefusal(said: string): boolean {
  return PROTECTION_REFUSED.test(said);
}

interface ItemText {
  role: string;
  text: string;
}

/** 一个条目说的话（magpie itemText）：消息的文字、调用的名字与参数、调用结果（太长去掉中间）、推理的摘要。 */
function itemText(item: unknown): ItemText | null {
  if (!isRecord(item)) return null;
  switch (item.type) {
    case "message":
    case undefined:
      return { role: textOf(item.role) || "user", text: partsText(item.content) };
    case "function_call":
    case "custom_tool_call":
      return {
        role: "tool call",
        text: `${textOf(item.name)} ${textOf(item.arguments) || textOf(item.input)}`,
      };
    case "function_call_output":
    case "custom_tool_call_output":
      return { role: "tool output", text: shortened(partsText(item.output)) };
    case "reasoning":
      return { role: "reasoning", text: partsText(item.summary) };
    default:
      return null;
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function partsText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  const texts = value.map(partText);
  return texts.filter((text) => text !== "").join("\n");
}

function partText(part: unknown): string {
  if (!isRecord(part)) return "";
  return textOf(part.text);
}

function shortened(text: string): string {
  if (text.length <= TOOL_OUTPUT_MAX) return text;
  const half = TOOL_OUTPUT_MAX / 2;
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

/** 对话里有话可说、又不是摘要提示本身的条目。 */
function spokenItems(request: Record<string, unknown>): ItemText[] {
  const items = Array.isArray(request.input) ? request.input : [];
  return items.flatMap((item) => {
    const spoken = itemText(item);
    if (spoken === null) return [];
    const text = spoken.text.trim();
    const isSilent = text === "" || text === CODEX_COMPACT_PROMPT;
    return isSilent ? [] : [spoken];
  });
}

/** 纯文字的摘要请求（magpie plainCompact）：整段对话写成一条用户消息，后面接摘要提示；太长去掉最早的。 */
export function plainCompact(body: string): string {
  const request = parseJson(body);
  if (!isRecord(request)) return body;
  const lines = spokenItems(request).map((spoken) => `[${spoken.role}]\n${spoken.text}\n\n`);
  let conversation = lines.join("");
  if (conversation.length > PLAIN_COMPACT_MAX) {
    conversation = `…\n${conversation.slice(-PLAIN_COMPACT_MAX)}`;
  }
  const plain: Record<string, unknown> = {
    ...request,
    input: [
      userMessage(`This is the conversation so far:\n\n${conversation}`),
      userMessage(CODEX_COMPACT_PROMPT),
    ],
  };
  delete plain.previous_response_id;
  return JSON.stringify(plain);
}

/** 不用模型拼的「摘要」（magpie localSummary）：用户说过的话（只留最近的）与最后一次回复。 */
export function localSummary(body: string, why: string): string {
  const request = parseJson(body);
  let spoken: ItemText[] = [];
  if (isRecord(request)) spoken = spokenItems(request);
  const asked = spoken.filter((item) => item.role === "user").map((item) => item.text.trim());
  const replies = spoken.filter((item) => item.role === "assistant");
  const last = replies.at(-1)?.text.trim() ?? "";
  let from = asked.length;
  let size = 0;
  while (from > 0 && size + (asked[from - 1]?.length ?? 0) <= LOCAL_SUMMARY_MAX) {
    from -= 1;
    size += asked[from]?.length ?? 0;
  }
  let summary = `Osuna compacted this conversation without a model (${why}), so this is no summary: it is what the user asked`;
  if (from > 0) summary += ` (the latest ${asked.length - from} of ${asked.length} messages)`;
  summary +=
    " and the last reply. Look at the workspace for where the work stands before going on.\n\n## The user's messages\n";
  for (const message of asked.slice(from)) summary += `\n${message}\n`;
  if (last !== "") summary += `\n## The last reply\n\n${last}\n`;
  return summary;
}

/** 摘要请求是哪段对话、哪个模型的；没说对话（prompt_cache_key）的为 null，不计数。 */
export function compactionKey(body: string): string | null {
  const request = parseJson(body);
  if (!isRecord(request)) return null;
  const { model, prompt_cache_key: conversation } = request;
  const isKeyed = typeof conversation === "string" && conversation !== "";
  if (!isKeyed) return null;
  return `${textOf(model)}\u0000${conversation}`;
}

interface CompactionFail {
  count: number;
  last: number;
  why: string;
}

/** 一段对话的压缩连续失败的次数（magpie compactFails），只记在内存里。 */
export class CompactionFailures {
  private readonly fails = new Map<string, CompactionFail>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 连续失败够多、最近一次还不到 5 分钟时，告诉 Codex 的话；不用拦为 null。 */
  held(input: { key: string | null; model: string }): string | null {
    if (input.key === null) return null;
    const fail = this.fails.get(input.key);
    if (fail === undefined) return null;
    const since = this.now() - fail.last;
    const isHeld = fail.count >= FAILS_MOST && since < HELD_FOR_MS;
    if (!isHeld) return null;
    const left = clock(HELD_FOR_MS - since);
    return (
      `compaction: ${input.model} failed to summarise this conversation ${fail.count} times in a row (last: ${fail.why}); ` +
      `Osuna doesn't ask it again for ${left}, so a compaction that can't succeed isn't paid for over and over. ` +
      "Pick another model for this conversation"
    );
  }

  failed(input: { key: string | null; status: number; why: string }): void {
    const isSignIn = input.status === 401 || input.status === 403;
    if (input.key === null || isSignIn) return;
    const now = this.now();
    let why = input.why;
    if (why.length > WHY_MAX) why = `${why.slice(0, WHY_MAX)}…`;
    const before = this.fails.get(input.key);
    const isRecent = before !== undefined && now - before.last < HELD_FOR_MS;
    const count = isRecent ? before.count + 1 : 1;
    this.fails.set(input.key, { count, last: now, why });
    for (const [key, fail] of this.fails) {
      if (now - fail.last >= HELD_FOR_MS) this.fails.delete(key);
    }
  }

  done(key: string | null): void {
    if (key !== null) this.fails.delete(key);
  }
}

/** 剩下的时间，取整到秒，写成 Go 的 Duration 那样（4m59s）。 */
function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m${rest}s`;
}
