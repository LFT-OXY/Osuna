// 「自己能联网搜索」何时算数移植自 magpie（https://github.com/yetone/magpie，internal/gateway/search.go 的 searchesItself），
// 认出请求里的联网搜索工具照 internal/gateway/anthropic.go 读 tools 的那段（r.WebSearch）；
// 不会搜的那家收不到 Codex 的 web_search 与历史里的 web_search_call 照 gateway.go 的 ownAPI / searchesFor 与 responses.go 读 input 的那段
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointState, StoredApiEndpoint } from "../store.js";
import { isRecord } from "../upstream-http.js";
import { withoutKeys } from "./refused-fields.js";

type Body = Record<string, unknown>;

/*
 * 联网搜索按接口放行（ADR 0009）。开关只在这家填了 Anthropic 或 OpenAI Responses 地址时算数：
 * 只有 Chat 地址的接口收不到原生的搜索工具。Osuna 不按主机或厂商自己认定谁会搜（magpie 另有官方主机表，这里不要）。
 */

const SEARCHABLE_FORMATS: readonly ApiEndpointRequestFormat[] = [
  "anthropic_messages",
  "openai_responses",
];

/** 这家在这个格式上自己会搜：打开了开关，且有这个格式的地址；不给格式时看任一能搜的格式。 */
export function searchesWebItself(
  endpoint: Pick<StoredApiEndpoint, "searchesWeb" | "baseUrls">,
  format?: ApiEndpointRequestFormat,
): boolean {
  if (endpoint.searchesWeb !== true) return false;
  const formats = format ? [format] : SEARCHABLE_FORMATS;
  return endpoint.baseUrls.some(
    (entry) => SEARCHABLE_FORMATS.includes(entry.format) && formats.includes(entry.format),
  );
}

/** 至少一家开着的接口自己会搜：这时 Claude Code 的 settings.json 不写 WebSearch 禁止规则。 */
export function someEndpointSearchesWeb(state: Pick<ApiEndpointState, "endpoints">): boolean {
  return state.endpoints.some((endpoint) => endpoint.enabled && searchesWebItself(endpoint));
}

/**
 * Anthropic Messages 请求带着联网搜索的服务端工具：`type` 以 web_search 开头、不是 custom、没有 input_schema。
 * Claude Code 的 WebSearch 子请求就是这样（`web_search_20250305`，research/web-search.md 第 1 题）。
 */
export function asksAnthropicWebSearch(parsed: unknown): boolean {
  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) return false;
  return parsed.tools.some(
    (tool) =>
      isRecord(tool) &&
      typeof tool.type === "string" &&
      tool.type.startsWith("web_search") &&
      tool.input_schema === undefined,
  );
}

function isWebSearchTool(tool: unknown): boolean {
  return isRecord(tool) && typeof tool.type === "string" && tool.type.startsWith("web_search");
}

/**
 * 发给不会搜的那家的 Responses 请求：去掉 Codex 每轮都带的 web_search 工具、点名它的 tool_choice，
 * 以及历史里的 web_search_call 项（magpie 在客户端协议上重建请求时不读这一项，research/implementation-notes.md「05」）。
 * 一个工具都不剩时 tool_choice 也去掉。没有要改的就原样交回同一个对象。
 */
export function withoutResponsesWebSearch(body: Body): Body {
  let out = body;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const kept = tools.filter((tool) => !isWebSearchTool(tool));
  if (kept.length !== tools.length) {
    out = kept.length > 0 ? { ...out, tools: kept } : withoutKeys(out, ["tools", "tool_choice"]);
  }
  out = withoutWebSearchChoice(out);
  if (Array.isArray(body.input) && body.input.some(isWebSearchCall)) {
    out = { ...out, input: body.input.filter((item) => !isWebSearchCall(item)) };
  }
  return out;
}

function isWebSearchCall(item: unknown): boolean {
  return isRecord(item) && item.type === "web_search_call";
}

/** 点名 web_search 的 tool_choice 去掉；allowed_tools 里列了它的拿掉这一项，一项不剩时整个去掉。 */
function withoutWebSearchChoice(body: Body): Body {
  const choice = body.tool_choice;
  if (!isRecord(choice)) return body;
  if (isWebSearchTool(choice)) return withoutKeys(body, ["tool_choice"]);
  if (choice.type !== "allowed_tools" || !Array.isArray(choice.tools)) return body;
  const allowed = choice.tools.filter((tool) => !isWebSearchTool(tool));
  if (allowed.length === choice.tools.length) return body;
  if (allowed.length === 0) return withoutKeys(body, ["tool_choice"]);
  return { ...body, tool_choice: { ...choice, tools: allowed } };
}
