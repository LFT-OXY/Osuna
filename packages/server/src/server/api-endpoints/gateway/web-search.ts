// 「自己能联网搜索」何时算数移植自 magpie（https://github.com/yetone/magpie，internal/gateway/search.go 的 searchesItself），
// 认出请求里的联网搜索工具照 internal/gateway/anthropic.go 读 tools 的那段（r.WebSearch）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointState, StoredApiEndpoint } from "../store.js";
import { isRecord } from "../upstream-http.js";

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
