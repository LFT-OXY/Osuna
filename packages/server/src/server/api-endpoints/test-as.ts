// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/test_as.go 的 clientProto、TestsAs、TestClients、
// errNotSeen、asClient）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointError,
  ApiEndpointRequestFormat,
  ApiEndpointTestAs,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { CliTestClient, StoredApiEndpoint } from "./store.js";
import { findTemplate } from "./templates.js";

/*
 * 「按 Claude Code / Codex 的样子测」（ADR 0013）：问那个 CLI 的请求去的格式，带中转站记下的它的请求头。
 * 按 Claude Code 测只走 Anthropic，只给中转服务（模板分组是 relay，或「自定义」加的）；Anthropic 与 Google 自己的地址
 * 也不给（magpie 按主机排除）。按 Codex 测走 Responses，没有就走 Chat，不限地址。
 */

// 列出的先后照 magpie TestClients：Codex 在前。
const CLI_TEST_CLIENTS: readonly CliTestClient[] = ["codex", "claude_code"];

const CLIENT_FORMATS: Record<CliTestClient, ApiEndpointRequestFormat[]> = {
  codex: ["openai_responses", "openai_chat"],
  claude_code: ["anthropic_messages"],
};

// 这些主机是厂商自己的 API，不冒充 Claude Code 去问（magpie TestsAs）。
const VENDOR_HOST_SUFFIXES = ["anthropic.com", "googleapis.com"];

export const CLI_SAMPLE_MISSING: ApiEndpointError = {
  code: "cli_sample_missing",
  message:
    "No Claude Code request has come through the gateway yet: run Claude Code with API endpoints once, then test again",
};

export function isCliTestClient(method: string): method is CliTestClient {
  return CLI_TEST_CLIENTS.some((client) => client === method);
}

/** 这个 CLI 的请求在这家走的格式与地址；这家没有那种地址为 null（magpie clientProto）。 */
export function cliTestAddress(input: {
  endpoint: StoredApiEndpoint;
  client: CliTestClient;
}): { format: ApiEndpointRequestFormat; baseUrl: string } | null {
  const { baseUrls } = input.endpoint;
  for (const format of CLIENT_FORMATS[input.client]) {
    const url = baseUrls.find((entry) => entry.format === format)?.url;
    if (url !== undefined) return { format, baseUrl: url.replace(/\/+$/, "") };
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (error) {
    if (error instanceof TypeError) return "";
    throw error;
  }
}

/** 中转服务：从 relay 分组的模板加的，或「自定义」加的。 */
function isRelayService(endpoint: StoredApiEndpoint): boolean {
  if (endpoint.templateId === undefined) return true;
  return findTemplate(endpoint.templateId)?.group === "relay";
}

/** 这家提不提供按这个 CLI 的样子测（不管有没有样本）。 */
function offersClient(input: { endpoint: StoredApiEndpoint; client: CliTestClient }): boolean {
  const address = cliTestAddress(input);
  if (address === null) return false;
  if (input.client === "codex") return true;
  const host = hostOf(address.baseUrl);
  const isVendorHost = VENDOR_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  return isRelayService(input.endpoint) && !isVendorHost;
}

/**
 * 这家提供的 CLI 测法，每种带现在测不了的原因（能测为 null）。只有 Claude Code 会因为没有样本测不了：
 * Codex 没样本时用 ChatGPT 账号那套请求头（magpie TestClients、errNotSeen）。
 */
export function cliTestsOffered(input: {
  endpoint: StoredApiEndpoint;
  hasSample: (client: CliTestClient) => boolean;
}): ApiEndpointTestAs[] {
  return CLI_TEST_CLIENTS.filter((client) =>
    offersClient({ endpoint: input.endpoint, client }),
  ).map((client) => {
    const isMissingSample = client === "claude_code" && !input.hasSample(client);
    return { method: client, unavailable: isMissingSample ? CLI_SAMPLE_MISSING : null };
  });
}

/** 不提供时为什么（拒收用）；提供时为 null。 */
export function cliTestRefusal(input: {
  endpoint: StoredApiEndpoint;
  client: CliTestClient;
}): string | null {
  if (offersClient(input)) return null;
  if (cliTestAddress(input) === null) {
    return input.client === "claude_code"
      ? "This endpoint has no Anthropic URL, where Claude Code's requests go"
      : "This endpoint has no Responses or Chat Completions URL, where Codex's requests go";
  }
  return "Testing as Claude Code is only offered for relay services, not a vendor's own API";
}

/** 按 CLI 的样子测的请求体：两个 CLI 都流式发；Codex 在 Responses 上不让上游存（magpie asClient）。 */
export function asCliBody(input: {
  client: CliTestClient;
  format: ApiEndpointRequestFormat;
  body: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input.body, stream: true };
  if (input.client === "codex" && input.format === "openai_responses") body.store = false;
  return body;
}
