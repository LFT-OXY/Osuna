// 断流后接着写移植自 magpie（https://github.com/yetone/magpie，internal/gateway/continuation.go 的 streamRetries、prefillHow、chatPrefill、continuation（possible、prefillText、request、emit、add、unecho），
// chat.go buildChat 里 Resume 的 prefix / partial，gateway.go forwardTranslated 里 DeepSeek 前缀模式的 /beta）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { BlockList, isIP } from "node:net";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "../upstream-http.js";
import { refusesPrefill, type ShapeRefusals } from "./refusals.js";
import type { EmitEvent, Message, Part, StreamEvent } from "./translation/ir.js";
import { upstreamUrl } from "./upstream-call.js";

/*
 * 翻译的回复开口后断了：把 Agent 已经收到的部分作为最后一条 assistant 消息交回同一家，让模型接着写，
 * 只把新说的交给 Agent，最多续 STREAM_RETRIES 次。只在上游能从一半接着写时续：Anthropic 原生支持；
 * Chat 只限厂商自己的预填模式（DeepSeek 的 prefix、Kimi 的 partial），别的 Chat 会从头重答，
 * 接在已有的半截后面 Agent 分不出来。已经开始工具调用的不续（调用参数不能预填），
 * 这家这个模型拒过预填的不续（refusals.ts 的 refusesPrefill）。
 */

// 一份断了的回复最多接着写几次，之后在流尾补错误。
export const STREAM_RETRIES = 2;

/** 上游怎么从一半接着写：Anthropic 原生；Chat 的 DeepSeek 前缀模式、Kimi 的 partial。 */
export type PrefillMode = "anthropic" | "prefix" | "partial";

type ChatPrefillMode = Exclude<PrefillMode, "anthropic">;

/** 这家这个模型怎么接着写；接不了的（Responses、多数 Chat、拒过预填的）为 null。 */
export function prefillMode(input: {
  to: ApiEndpointRequestFormat;
  baseUrl: string;
  model: string;
  refusals: ShapeRefusals;
}): PrefillMode | null {
  if (refusesPrefill(input.refusals)) return null;
  if (input.to === "anthropic_messages") return "anthropic";
  if (input.to === "openai_chat") return chatPrefill(input);
  return null;
}

// 本机与局域网的地址：这里的中转服务在转它模型名所属的那家（magpie 的 IsLoopback、IsPrivate）。
const LOCAL_NETWORKS = new BlockList();
LOCAL_NETWORKS.addSubnet("127.0.0.0", 8, "ipv4");
LOCAL_NETWORKS.addSubnet("10.0.0.0", 8, "ipv4");
LOCAL_NETWORKS.addSubnet("172.16.0.0", 12, "ipv4");
LOCAL_NETWORKS.addSubnet("192.168.0.0", 16, "ipv4");
LOCAL_NETWORKS.addAddress("::1", "ipv6");
LOCAL_NETWORKS.addSubnet("fc00::", 7, "ipv6");

/** Chat 上游的预填模式：DeepSeek、Kimi 自己的地址，或本机、局域网上转它们模型的中转服务。 */
function chatPrefill(input: { baseUrl: string; model: string }): ChatPrefillMode | null {
  const host = new URL(input.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const deepseekHost = host === "api.deepseek.com" || host.endsWith(".deepseek.com");
  if (deepseekHost) return "prefix";
  if (host.includes("moonshot") || host.includes("kimi")) return "partial";
  if (!isLocalHost(host)) return null;
  const model = input.model.toLowerCase();
  if (model.includes("deepseek")) return "prefix";
  return model.includes("kimi") ? "partial" : null;
}

function isLocalHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".local")) return true;
  const family = isIP(host);
  if (family === 0) return false;
  return LOCAL_NETWORKS.check(host, family === 4 ? "ipv4" : "ipv6");
}

/** 接着写的请求发到哪：DeepSeek 的前缀模式在 /beta 下（与 /v1 并列），别的照常。 */
export function continuationUrl(input: {
  baseUrl: string;
  to: ApiEndpointRequestFormat;
  mode: PrefillMode;
}): URL {
  const { baseUrl, to } = input;
  if (input.mode !== "prefix") return upstreamUrl({ baseUrl, format: to });
  const base = baseUrl.trim().replace(/\/+$/, "");
  return upstreamUrl({ baseUrl: `${base.replace(/\/v1$/, "")}/beta`, format: to });
}

/** Chat 的预填标记：最后一条 assistant 消息带上 prefix 或 partial，有推理时一并带上（reasoning_content）。 */
export function withPrefillMark(input: {
  body: Record<string, unknown>;
  mode: PrefillMode;
  thinking: string;
}): Record<string, unknown> {
  const { body, mode } = input;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last: unknown = messages.at(-1);
  if (mode === "anthropic" || !isRecord(last)) return body;
  const marked: Record<string, unknown> = { ...last, [mode]: true };
  if (input.thinking !== "") marked.reasoning_content = input.thinking;
  return { ...body, messages: [...messages.slice(0, -1), marked] };
}

/** 最后一条消息里的推理文字：接着写时它就是 Agent 已经收到的那段推理。 */
export function lastThinking(messages: Message[]): string {
  const parts = messages.at(-1)?.parts ?? [];
  return parts.map((part) => (part.kind === "thinking" ? part.text : "")).join("");
}

/**
 * Agent 已经收到的那部分回复：边往下交边记下文字、推理、有没有开始工具调用。
 * 接着写之后，新的一次的推理不再显示，开头把已交出的文字原样重说一遍的也去掉（magpie 的 unecho）。
 */
export class ReplySoFar {
  private thinking = "";
  private text = "";
  private calling = false;
  private resumed = false;
  // 预填进去的文字：接着写的回复把它整段重说一遍时去掉。
  private echo = "";
  // 已经来了、还可能是重说的那段。
  private seen = "";

  constructor(private readonly emit: EmitEvent) {}

  event(event: StreamEvent): void {
    if (this.resumed && isThinking(event)) return;
    let passed = event;
    if (this.resumed && event.kind === "text") {
      passed = { kind: "text", text: this.unecho(event.text) };
      if (passed.text === "") return;
    }
    this.add(passed);
    this.emit(passed);
  }

  /** 还能接着写：已经说了点什么（文字或推理），还没开始工具调用。 */
  mayGoOn(): boolean {
    const said = this.thinking !== "" || this.text !== "";
    return said && !this.calling;
  }

  /** 接着写的请求：原来的对话后面加上 Agent 已经收到的这部分；之后来的事件按接着写的读。 */
  resume<T extends { messages: Message[] }>(request: T): T {
    const prefill = this.prefillText();
    this.resumed = true;
    this.echo = prefill;
    this.seen = "";
    const parts: Part[] = [];
    if (this.thinking !== "") parts.push({ kind: "thinking", text: this.thinking, signature: "" });
    if (prefill !== "") parts.push({ kind: "text", text: prefill });
    return { ...request, messages: [...request.messages, { role: "assistant", parts }] };
  }

  /** 预填的文字去掉结尾的空白：Anthropic 整个请求不收以空白结尾的预填；Agent 已经有这些空白，模型从最后一个词接着写。 */
  private prefillText(): string {
    return this.text.trimEnd();
  }

  private add(event: StreamEvent): void {
    if (event.kind === "think") this.thinking += event.text;
    else if (event.kind === "text") this.text += event.text;
    else if (event.kind === "tool_start" || event.kind === "tool_args") this.calling = true;
  }

  /** 去掉接着写的回复开头对预填文字的整段重说；还可能是重说的先扣着，读得出来再交。 */
  private unecho(piece: string): string {
    if (this.echo === "") return piece;
    this.seen += piece;
    const echo = this.echo;
    const mayStillEcho = this.seen.length < echo.length && echo.startsWith(this.seen);
    if (mayStillEcho) return "";
    const said = this.seen.startsWith(echo) ? this.seen.slice(echo.length) : this.seen;
    this.seen = "";
    this.echo = "";
    return said;
  }
}

function isThinking(event: StreamEvent): boolean {
  return event.kind === "think" || event.kind === "think_start" || event.kind === "sig";
}
