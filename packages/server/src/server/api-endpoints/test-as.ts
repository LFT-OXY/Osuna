// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/test_as.go 的 clientProto、TestsAs、TestClients、
// errNotSeen、asClient，internal/provider/provider.go 的 IsBedrock，internal/provider/azure.go 的 IsAzure、AzureHost）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointError,
  ApiEndpointRequestFormat,
  ApiEndpointTestAs,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "./store.js";
import { AZURE_TEMPLATE_ID, BEDROCK_TEMPLATE_ID, findTemplate } from "./templates.js";

/*
 * 「按 Claude Code / Codex 的样子测」（ADR 0013）：问那个 CLI 的请求去的格式，带中转站记下的它的请求头。
 * 每个 CLI 的规矩在 CLI_TEST_POLICIES 一张表里：走哪几种格式、没有样本能不能测、是否只给中转服务。
 */

/** 「按 Claude Code / Codex 的样子测」的两种 CLI。 */
export type CliTestClient = "claude_code" | "codex";

interface CliTestPolicy {
  // 先有哪种地址就走哪种（magpie clientProto）。
  formats: ApiEndpointRequestFormat[];
  // 没有样本时不测（Claude Code 的头从不自己编）；为 false 的用 ChatGPT 账号那套头。
  needsSample: boolean;
  // 只给中转服务（relay 分组的模板或「自定义」加的），厂商自己的 API 不冒充这个 CLI 去问。
  relayOnly: boolean;
  // 这家没有那种地址时拒收的原因。
  noAddress: string;
}

const CLI_TEST_POLICIES: Record<CliTestClient, CliTestPolicy> = {
  codex: {
    formats: ["openai_responses", "openai_chat"],
    needsSample: false,
    relayOnly: false,
    noAddress: "This endpoint has no Responses or Chat Completions URL, where Codex's requests go",
  },
  claude_code: {
    formats: ["anthropic_messages"],
    needsSample: true,
    relayOnly: true,
    noAddress: "This endpoint has no Anthropic URL, where Claude Code's requests go",
  },
};

// 列出的先后照 magpie TestClients：Codex 在前。
const CLI_TEST_CLIENTS: readonly CliTestClient[] = ["codex", "claude_code"];

const NOT_A_RELAY =
  "Testing as Claude Code is only offered for relay services, not a vendor's own API";

// Anthropic 地址在这些主机上的是厂商自己的 API（magpie TestsAs）。
const VENDOR_ANTHROPIC_HOSTS = ["anthropic.com", "googleapis.com"];
// Azure OpenAI 资源的主机（magpie azureHosts），看 Chat 与 Responses 地址。
const AZURE_HOST_SUFFIXES = [
  ".openai.azure.com",
  ".cognitiveservices.azure.com",
  ".services.ai.azure.com",
];

export const CLI_SAMPLE_MISSING: ApiEndpointError = {
  code: "cli_sample_missing",
  message:
    "Claude Code hasn't used API endpoints yet: use Claude Code once with Use API endpoints on, then test again",
};

export function isCliTestClient(method: string): method is CliTestClient {
  return CLI_TEST_CLIENTS.some((client) => client === method);
}

/** 没有样本时还能不能测。 */
export function needsCliSample(client: CliTestClient): boolean {
  return CLI_TEST_POLICIES[client].needsSample;
}

/** 这个 CLI 的请求在这家走的格式与地址；这家没有那种地址为 null（magpie clientProto）。 */
export function cliTestAddress(input: {
  endpoint: StoredApiEndpoint;
  client: CliTestClient;
}): { format: ApiEndpointRequestFormat; baseUrl: string } | null {
  const { baseUrls } = input.endpoint;
  for (const format of CLI_TEST_POLICIES[input.client].formats) {
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

function isBedrockHost(host: string): boolean {
  return host.startsWith("bedrock-runtime.") && host.endsWith(".amazonaws.com");
}

function isAzureHost(host: string): boolean {
  return AZURE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/**
 * 厂商或云自己的 API：Bedrock、Azure 的模板或主机，Anthropic 地址在 Anthropic、Google 的主机上（magpie TestsAs 的
 * anthropic.com、googleapis.com、IsBedrock、IsAzure）。
 */
function isVendorApi(endpoint: StoredApiEndpoint): boolean {
  const isCloudTemplate =
    endpoint.templateId === BEDROCK_TEMPLATE_ID || endpoint.templateId === AZURE_TEMPLATE_ID;
  if (isCloudTemplate) return true;
  return endpoint.baseUrls.some(({ format, url }) => {
    const host = hostOf(url);
    if (isBedrockHost(host)) return true;
    if (format === "anthropic_messages") {
      return VENDOR_ANTHROPIC_HOSTS.some((suffix) => host.endsWith(suffix));
    }
    return isAzureHost(host);
  });
}

/** 中转服务：从 relay 分组的模板加的，或「自定义」加的。 */
function isRelayService(endpoint: StoredApiEndpoint): boolean {
  if (endpoint.templateId === undefined) return true;
  return findTemplate(endpoint.templateId)?.group === "relay";
}

/** 不提供时为什么（拒收用）；提供时为 null。 */
export function cliTestRefusal(input: {
  endpoint: StoredApiEndpoint;
  client: CliTestClient;
}): string | null {
  const policy = CLI_TEST_POLICIES[input.client];
  if (cliTestAddress(input) === null) return policy.noAddress;
  if (!policy.relayOnly) return null;
  const isRelay = isRelayService(input.endpoint) && !isVendorApi(input.endpoint);
  return isRelay ? null : NOT_A_RELAY;
}

/**
 * 这家提供的 CLI 测法，每种带现在测不了的原因（能测为 null）：要样本的 CLI 还没有样本时测不了（magpie TestClients、
 * errNotSeen）。
 */
export function cliTestsOffered(input: {
  endpoint: StoredApiEndpoint;
  hasSample: (client: CliTestClient) => boolean;
}): ApiEndpointTestAs[] {
  const offered = CLI_TEST_CLIENTS.filter(
    (client) => cliTestRefusal({ endpoint: input.endpoint, client }) === null,
  );
  return offered.map((client) => {
    const isMissingSample = needsCliSample(client) && !input.hasSample(client);
    return { method: client, unavailable: isMissingSample ? CLI_SAMPLE_MISSING : null };
  });
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
