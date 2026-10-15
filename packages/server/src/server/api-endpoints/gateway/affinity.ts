// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/affinity.go、gateway.go、prompt.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { isRecord } from "../upstream-http.js";
import type { AgentWire } from "./agent-errors.js";

/*
 * 粘性（magpie 的 auto 模式）：一段对话上次由哪家接口回答，记在内存里。
 * 同一轮内（Agent 在回传工具结果）留在那家；新一轮回到用户选的那家，
 * 除非那家 5 分钟内缓存命中至少 1024 token，那就继续用到缓存冷掉；冷却中的不粘。
 */

const MINUTE = 60_000;

export const AFFINITY = {
  // 上次从厂商缓存读到至少这么多 token 才值得跨轮留下。
  cacheWorth: 1024,
  // Anthropic / OpenAI 最短的缓存存活。
  cacheCold: 5 * MINUTE,
  // 记住上次回答者多久。
  stickKeep: 24 * 60 * MINUTE,
  // 最多记多少段对话。
  sticksKept: 512,
} as const;

/** auto 是默认；其余是 magpie 路由组的设置，Osuna 只用 auto，判定表照抄完整。 */
export type AffinityMode = "auto" | "session" | "turn" | "off" | "strict";

export type AffinityWhy =
  | "off"
  | "first"
  | "gone"
  | "strict"
  | "resting"
  | "spent"
  | "session"
  | "turn"
  | "new-turn"
  | "no-cache"
  | "cold"
  | "cache";

export interface AffinityInput {
  mode: AffinityMode;
  rotate: boolean;
  // 这段对话有人答过（且没超过 stickKeep）。
  had: boolean;
  // 上次回答者在这次候选里的位置，不在为 -1。
  at: number;
  resting: boolean;
  // 几乎用完了额度（magpie 读订阅用量；Osuna 不读，恒为 false）。
  spent: boolean;
  // 同一轮内：Agent 在回传工具结果。
  within: boolean;
  cacheRead: number;
  sinceAnsweredMs: number;
}

/** magpie affine() 的 12 步判定，第一个成立的为准。 */
export function affinityWhy(input: AffinityInput): AffinityWhy {
  if (input.mode === "off") return "off";
  if (!input.had) return "first";
  if (input.at < 0) return "gone";
  if (input.mode === "strict") return "strict";
  if (input.resting) return "resting";
  if (input.at > 0 && input.spent) return "spent";
  if (input.mode === "session") return "session";
  if (input.within) return "turn";
  if (input.mode === "turn" || input.rotate) return "new-turn";
  if (input.cacheRead < AFFINITY.cacheWorth) return "no-cache";
  if (input.sinceAnsweredMs > AFFINITY.cacheCold) return "cold";
  return "cache";
}

// Codex 的头名改过几次（thread_id → thread-id 等），老版本也要对得上；子代理的 thread-id 是它自己的。
const SESSION_HEADERS = [
  "x-claude-code-session-id",
  "thread-id",
  "thread_id",
  "session-id",
  "session_id",
  "x-client-request-id",
];

/** Messages / Chat 的 messages，或 Responses 的 input 数组。 */
function conversationItems(request: Record<string, unknown>): unknown[] {
  if (Array.isArray(request.messages)) return request.messages;
  return Array.isArray(request.input) ? request.input : [];
}

/** 一段对话的标识：Agent 自己发的会话头；没有就取对话第一条用户消息的摘要，之后每个请求都会重复它。 */
export function conversationId(headers: IncomingHttpHeaders, body: unknown): string {
  for (const name of SESSION_HEADERS) {
    const value = headers[name];
    const first = (Array.isArray(value) ? value[0] : value)?.trim();
    if (first) return first;
  }
  const request = isRecord(body) ? body : {};
  const items = conversationItems(request);
  const first =
    items.find((item) => isRecord(item) && item.role === "user") ??
    items[0] ??
    request.input ??
    body;
  const digest = createHash("sha256").update(JSON.stringify(first)).digest("hex");
  return `osuna-${digest.slice(0, 24)}`;
}

const REMINDERS = /<system-reminder(?:\s[^>]*)?>.*?<\/system-reminder>/gs;
// Codex App 把用户输入放在它加的上下文之后。
const MY_REQUEST = /^## My request(?: for Codex)?:[ \t]*\n?/gm;
const AGENTS_FOR = /^# (\S+\.md) instructions for (\S.*?)[ \t]*\n/;
// Agent 以用户身份写进来的文字开头：上下文、通知、子代理列表、待办提醒。
const INJECTED = [
  "<system-reminder",
  "<environment_context>",
  "<user_instructions>",
  "<turn_aborted>",
  "<user_shell_command>",
  "<subagent_notification>",
  "<in-app-browser-context",
  "<task-notification>",
  "<subagent-notification>",
  "<plugin_reference>",
  "Available agent types for the Agent tool:",
  "Available agent types and the tools they have access to:",
  "New agent types are now available for the Agent tool:",
  "The TodoWrite tool hasn't been used recently.",
  "The task tools haven't been used recently.",
  "Conversation rewind applied.",
  "Workspace rewind applied.",
];

/** 一段文字里用户自己说的话；Agent 代写的（提醒、上下文、通知）为空。 */
function userWords(text: string): string {
  let words = text.replace(REMINDERS, "").trim();
  const requests = [...words.matchAll(MY_REQUEST)];
  const lastRequest = requests.at(-1);
  if (lastRequest) words = words.slice(lastRequest.index + lastRequest[0].length).trim();
  if (words === "" || AGENTS_FOR.test(words)) return "";
  return INJECTED.some((lead) => words.startsWith(lead)) ? "" : words;
}

interface TurnMessage {
  role: "user" | "assistant" | "other";
  said: boolean;
  result: boolean;
}

function userMessage(texts: string[], other: { media: boolean; result: boolean }): TurnMessage {
  return {
    role: "user",
    said: other.media || texts.some((text) => userWords(text) !== ""),
    result: other.result,
  };
}

function anthropicMessages(body: Record<string, unknown>): TurnMessage[] {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.filter(isRecord).map((message) => {
    if (message.role !== "user") {
      return {
        role: message.role === "assistant" ? "assistant" : "other",
        said: false,
        result: false,
      };
    }
    if (typeof message.content === "string") {
      return userMessage([message.content], { media: false, result: false });
    }
    const blocks = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
    return userMessage(
      blocks.flatMap((block) =>
        block.type === "text" && typeof block.text === "string" ? [block.text] : [],
      ),
      {
        media: blocks.some((block) => block.type === "image" || block.type === "document"),
        result: blocks.some((block) => block.type === "tool_result"),
      },
    );
  });
}

function responsesParts(content: unknown): { texts: string[]; media: boolean } {
  if (typeof content === "string") return { texts: [content], media: false };
  const parts = Array.isArray(content) ? content.filter(isRecord) : [];
  return {
    texts: parts.flatMap((part) => (typeof part.text === "string" ? [part.text] : [])),
    media: parts.some((part) => part.type === "input_image" || part.type === "input_file"),
  };
}

/** Responses 的 input 按 magpie 的解析归成用户 / 助手消息；回复之后的 developer 说明算 Agent 代写的用户消息。 */
function responsesMessages(body: Record<string, unknown>): TurnMessage[] {
  if (typeof body.input === "string") {
    return [userMessage([body.input], { media: false, result: false })];
  }
  const items = Array.isArray(body.input) ? body.input.filter(isRecord) : [];
  const out: TurnMessage[] = [];
  let replied = false;
  for (const item of items) {
    const type = typeof item.type === "string" ? item.type : "";
    const role = typeof item.role === "string" ? item.role : "";
    const assistantSide =
      role === "assistant" ||
      type.startsWith("function_call") ||
      type.startsWith("custom_tool_call") ||
      type.startsWith("tool_search") ||
      type === "reasoning";
    const message = responsesItem({ item, type, role, assistantSide, replied });
    if (message) out.push(message);
    if (assistantSide) replied = true;
  }
  return out;
}

function responsesItem(input: {
  item: Record<string, unknown>;
  type: string;
  role: string;
  assistantSide: boolean;
  replied: boolean;
}): TurnMessage | null {
  const { type, role } = input;
  if (type.endsWith("_output")) return { role: "user", said: false, result: true };
  const isMessage = type === "message" || (type === "" && role !== "");
  if (isMessage && role === "assistant") return { role: "assistant", said: false, result: false };
  if (isMessage && (role === "system" || role === "developer")) {
    return input.replied ? { role: "user", said: false, result: false } : null;
  }
  if (isMessage || type === "agent_message") {
    const { texts, media } = responsesParts(input.item.content);
    // 子代理收到的任务（agent_message）没内容时不算一条消息。
    if (!isMessage && texts.length === 0 && !media) return null;
    return userMessage(texts, { media, result: false });
  }
  return input.assistantSide ? { role: "assistant", said: false, result: false } : null;
}

/**
 * 对话里用户说了几轮，以及这个请求是不是同一轮内 Agent 在回传工具结果。
 * 用户的话（或图片、文件）开始新一轮；Agent 代写的用户消息在回复之后延续当前轮。
 */
export function turnOf(wire: AgentWire, body: unknown): { turn: number; within: boolean } {
  const request = isRecord(body) ? body : {};
  const messages = wire === "anthropic" ? anthropicMessages(request) : responsesMessages(request);
  let turn = 0;
  let within = false;
  let answered = false;
  for (const message of messages) {
    if (message.role === "assistant") answered = true;
    if (message.role !== "user") continue;
    if (message.result) within = true;
    else if (message.said) {
      turn++;
      within = false;
    } else if (answered) within = turn > 0;
    answered = false;
  }
  return { turn, within };
}

interface Stick {
  endpointId: string;
  model: string;
  at: number;
  cacheRead: number;
}

interface StickyCandidate {
  endpoint: { id: string };
  upstreamModel: string;
}

export class ConversationSticks {
  private readonly now: () => number;
  // 按最近回答排序：最早的在前，超出上限时先丢。
  private readonly sticks = new Map<string, Stick>();

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  /** 按粘性重排候选：留下时把上次回答者挪到最前，否则保持用户选的顺序。 */
  order<T extends StickyCandidate>(input: {
    key: string;
    candidates: T[];
    within: boolean;
    resting: (candidate: T) => boolean;
  }): T[] {
    const { candidates } = input;
    const stick = this.sticks.get(input.key);
    const sinceAnsweredMs = stick ? this.now() - stick.at : 0;
    const had = stick !== undefined && sinceAnsweredMs <= AFFINITY.stickKeep;
    const sameModel = candidates.findIndex(
      (c) => c.endpoint.id === stick?.endpointId && c.upstreamModel === stick.model,
    );
    const at =
      sameModel >= 0 ? sameModel : candidates.findIndex((c) => c.endpoint.id === stick?.endpointId);
    const answerer = candidates[at];
    const why = affinityWhy({
      mode: "auto",
      rotate: false,
      had,
      at: had ? at : -1,
      resting: answerer !== undefined && input.resting(answerer),
      spent: false,
      within: input.within,
      cacheRead: stick?.cacheRead ?? 0,
      sinceAnsweredMs,
    });
    const kept = why === "session" || why === "turn" || why === "cache";
    if (!kept || answerer === undefined || at === 0) return candidates;
    return [answerer, ...candidates.filter((_, index) => index !== at)];
  }

  /** 记下这段对话这次由谁答、缓存读了多少。 */
  answered(key: string, answer: { endpointId: string; model: string; cacheRead: number }): void {
    this.sticks.delete(key);
    this.sticks.set(key, { ...answer, at: this.now() });
    if (this.sticks.size > AFFINITY.sticksKept) {
      const oldest = this.sticks.keys().next().value;
      if (oldest !== undefined) this.sticks.delete(oldest);
    }
  }
}
