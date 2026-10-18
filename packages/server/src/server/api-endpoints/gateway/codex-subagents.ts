// 移植自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_subagent.go 的 codexSubagentPick、sealedTaskIn，
// codex_backend.go 的 hasSealedAgentMessage、withoutSealedMessages、sealedTaskError、sealedWayOut 与 sealedTaskItself，internal/usage/purpose.go 的 Subagent 一组）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import { isRecord } from "../upstream-http.js";
import { callKind } from "./codex-side-calls.js";

/*
 * 强制 Subagent 模型（magpie CodexSubagentModel）：Codex 的主对话在 spawn_agent 的 model 参数里自己挑 Subagent 的模型，
 * [agents] default_subagent_model 只管没挑的那些。设了这个模型，中转站就把 Subagent 的请求（x-openai-subagent 是 Subagent 那一组）
 * 改到它上面，不管主对话挑的是什么。这个模型现在没人提供，或它打不开这个 Subagent 的任务时，请求照主对话挑的发，并说明原因：
 * 设了从不会比不设更糟。
 */

// Codex 不同版本给 Subagent 请求的写法（magpie usage/purpose.go 的 Subagent 一组）。
const SUBAGENT_KINDS = new Set(["collab_spawn", "thread_spawn", "agent_job"]);

// ChatGPT 后端封存的 Agent 消息（magpie nativeSealedAgentPayload）。
const SEALED_PAYLOAD = /^gAAAAA[A-Za-z0-9_-]+={0,2}$/;
const MESSAGE_HEADER = "Message Type: MESSAGE\n";

/** 这个请求是 Codex 的 Subagent 发的。 */
export function isCodexSubagentCall(headers: IncomingHttpHeaders): boolean {
  return SUBAGENT_KINDS.has(callKind(headers));
}

/** 改不改模型：不是 Subagent 的请求或没设（none），改到强制的模型（moved），或照主对话挑的发（kept，why 说原因）。 */
export type CodexSubagentPick =
  | { kind: "none" }
  | { kind: "moved"; to: string }
  | { kind: "kept"; to: string; why: string };

/**
 * `forced` 是强制 Subagent 模型（没设为 null）；`isServed` 说这个模型现在有人提供；`opensSealed` 说它打得开 ChatGPT 后端
 * 封存的任务（只有 ChatGPT 自带模型打得开）。
 */
export function pickCodexSubagentModel(input: {
  headers: IncomingHttpHeaders;
  asked: string;
  forced: string | null;
  parsed: unknown;
  isServed: (model: string) => boolean;
  opensSealed: (model: string) => boolean;
}): CodexSubagentPick {
  const { forced } = input;
  const isUnforced = forced === null || forced === input.asked;
  if (isUnforced || !isCodexSubagentCall(input.headers)) return { kind: "none" };
  if (!input.isServed(forced)) {
    return { kind: "kept", to: forced, why: "no API endpoint that is on serves it now" };
  }
  if (!input.opensSealed(forced) && hasSealedAgentTask(input.parsed)) {
    return {
      kind: "kept",
      to: forced,
      why: "its task was sealed by the ChatGPT backend that answered its lead, and only a ChatGPT model can open it",
    };
  }
  return { kind: "moved", to: forced };
}

/**
 * 请求里有封存的任务，不只是封存的消息（magpie sealedTaskIn）：多 Agent V2 下 ChatGPT 自带模型交出的任务与消息
 * 都以 encrypted_content 放在 agent_message 里，标题写「Message Type: MESSAGE」的是消息，别的当作任务。
 */
export function hasSealedAgentTask(parsed: unknown): boolean {
  if (!isRecord(parsed) || !Array.isArray(parsed.input)) return false;
  return parsed.input.some((item) => {
    const isAgentMessage = isRecord(item) && item.type === "agent_message";
    if (!isAgentMessage || !Array.isArray(item.content)) return false;
    const parts = item.content.filter(isRecord);
    return parts.some(isSealedPart) && !parts.some(isMessageHeader);
  });
}

function isSealedPart(part: Record<string, unknown>): boolean {
  const sealed = part.encrypted_content;
  const isEncrypted = part.type === "encrypted_content" && typeof sealed === "string";
  return isEncrypted && SEALED_PAYLOAD.test(sealed);
}

function isMessageHeader(part: Record<string, unknown>): boolean {
  const text = part.text;
  const isText = part.type === "input_text" && typeof text === "string";
  return isText && text.startsWith(MESSAGE_HEADER);
}

// magpie sealedTaskItself：封存的是任务本身。
const SEALED_TASK_ITSELF =
  "What is sealed is the task itself: the message the agent that spawned this subagent wrote in spawn_agent, which Codex hands on as the backend sealed it. fork_turns=\"none\" keeps the lead's earlier turns out of the subagent, but not the seal on its task, so it doesn't help here.";

/**
 * 封存的任务交到接口模型上时回给 Codex 的话（magpie sealedTaskError 的第三种，加 sealedWayOut）：
 * 开关关着时让用户打开「Codex Subagent 可用任意模型」；开着时说这个对话仍在多 Agent V2 上。
 */
export function sealedTaskMessage(input: {
  model: string;
  allowsAnySubagentModel: boolean;
}): string {
  return (
    `This subagent's task was sealed by the ChatGPT backend that answered its lead, and only one of Codex's own models can open it; ${input.model} is served by an API endpoint, which can't. ` +
    `${SEALED_TASK_ITSELF} Give the subagent the lead's model, or a lead model that isn't served by the ChatGPT backend, so its subagents get a task they can read. ` +
    `To go on with this task, use the lead's model, or have the lead spawn the subagent again.${sealedWayOut(input.allowsAnySubagentModel)}`
  );
}

function sealedWayOut(allowsAnySubagentModel: boolean): string {
  if (allowsAnySubagentModel) {
    return " \"Codex Subagents can use any model\" is on in Osuna's settings, but this thread runs Codex's multi-agent V2, whose tasks are sealed: it began before the setting was turned on, or Codex's own features.multi_agent_v2 is on in its config. Start a new thread, with features.multi_agent_v2 off.";
  }
  return " For subagents on any model while the lead is on a ChatGPT model, turn on \"Codex Subagents can use any model\" on Codex's page in Osuna's settings and start a new thread: the lead then hands its subagents their tasks as text.";
}
