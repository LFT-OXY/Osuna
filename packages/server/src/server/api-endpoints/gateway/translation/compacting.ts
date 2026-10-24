// 认出 Agent 在压缩对话移植自 magpie（https://github.com/yetone/magpie，internal/gateway/compacting.go 的 compactLead、compactSystems、compactAsks、leads 与 compacting）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { GatewayRequest } from "./ir.js";

/*
 * Agent 压缩对话时让模型总结它，提示在系统提示里，或在最后一条用户消息里。提示是各 Agent 自己的原话。
 * 只认开头 2048 字节以内的：更靠后的是别的东西在引用它（记忆、用户在说它，magpie #1635）。
 */

const COMPACT_LEAD = 2048;

// 压缩请求的系统提示以这些开头（或就是它）。
const COMPACT_SYSTEMS = [
  // Claude Code 2.1，OpenCode 自己的 agent 之前的
  "You are a helpful AI assistant tasked with summarizing conversations.",
  // OpenCode 的压缩 agent
  "You are a context summarization agent.",
  // Pi
  "You are a context summarization assistant.",
  // Gemini CLI
  "You are a specialized system component responsible for distilling chat history into a structured XML <state_snapshot>",
  // Qwen Code
  "You are the component that summarizes a conversation when its context window is about to overflow.",
  // Minis
  "You are a context compaction engine. Your summary will REPLACE the original messages in the conversation context window.",
  // Kimi Code
  "You are a helpful assistant that compacts conversation context.",
];

// 压缩请求最后一条用户消息里说的；opens 是把对话放在同一段里发的 Agent 那段的开头。
const COMPACT_ASKS: { ask: string; opens: string }[] = [
  // Claude Code 的 /compact 与自动压缩
  { ask: "Your task is to create a detailed summary of the conversation so far", opens: "" },
  // Codex
  { ask: "You are performing a CONTEXT CHECKPOINT COMPACTION.", opens: "" },
  // Kimi Code
  { ask: "You are now given a task to compact this conversation context", opens: "" },
  // Minis，包着它发的整段对话
  {
    ask: "END OF CONVERSATION TO COMPACT.",
    opens: "Compact this conversation into a context summary:",
  },
];

function leads(text: string, phrase: string): boolean {
  const at = text.indexOf(phrase);
  return at >= 0 && at <= COMPACT_LEAD;
}

/** 这个请求是 Agent 在压缩它的对话。 */
export function compacting(request: GatewayRequest): boolean {
  if (COMPACT_SYSTEMS.some((phrase) => leads(request.system, phrase))) return true;
  const lastUser = request.messages.findLast((message) => message.role === "user");
  if (lastUser === undefined) return false;
  return lastUser.parts.some((part) => {
    if (part.kind !== "text") return false;
    return COMPACT_ASKS.some(({ ask, opens }) => {
      if (opens === "") return leads(part.text, ask);
      return part.text.trim().startsWith(opens) && part.text.includes(ask);
    });
  });
}
