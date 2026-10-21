// 不校验证书只给这家自己地址的主机、按主机各用一套连接移植自 magpie（https://github.com/yetone/magpie，
// internal/provider/insecure_tls.go 的 TakesInsecureTLS、UncheckedHosts，internal/provider/proxy.go 的 Via，
// internal/netproxy/unchecked.go 的 WithUncheckedTLS、uncheckedHost、hostKey，netproxy.go 的 dispatch.transport）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isHttpsUrl, takesInsecureTls } from "@getpaseo/protocol/api-endpoint/request-extras";
import { Agent, Pool, fetch as undiciFetch } from "undici";
import type { StoredApiEndpoint } from "./store.js";

/*
 * 不校验证书（insecureTls）：用户自己加的接口（没有模板）连自签证书或公司 CA 的服务。只有发往这家自己各格式地址的
 * https 主机（主机名 + 端口）的请求不校验；别的主机（重定向去的、别家指向同一台服务的、models.dev、ChatGPT 后端……）照常校验。
 * daemon 发往上游的两条路都经这里决定：拉模型、测试、检测用的 fetch（upstreamFetch），中转站用的 node:https
 * （skipsCertificateCheck，sendOnce 里 rejectUnauthorized）。从不改全局：不设 NODE_TLS_REJECT_UNAUTHORIZED，
 * 不换全局 dispatcher 或 agent。
 */

/** 这家不校验证书的主机（hostKey）；不开、模板接口或没有 https 地址时为空。 */
export function uncheckedHostsOf(input: {
  insecureTls: boolean | undefined;
  templateId: string | undefined;
  urls: string[];
}): string[] {
  const isOn = input.insecureTls === true && takesInsecureTls(input);
  if (!isOn) return [];
  const hosts = new Set<string>();
  for (const url of input.urls) {
    const key = httpsHostKey(url);
    if (key !== null) hosts.add(key);
  }
  return [...hosts];
}

/** 开着的这家现在不校验证书的主机；关着的为空（不会有请求发过去）。 */
export function liveUncheckedHostsOf(
  endpoint: Pick<StoredApiEndpoint, "insecureTls" | "templateId" | "baseUrls" | "enabled">,
): string[] {
  if (!endpoint.enabled) return [];
  return uncheckedHostsOf({
    insecureTls: endpoint.insecureTls,
    templateId: endpoint.templateId,
    urls: endpoint.baseUrls.map(({ url }) => url),
  });
}

/** 这个请求不校验证书：https，且主机是这家自己的。 */
export function skipsCertificateCheck(input: {
  url: URL;
  uncheckedHosts: readonly string[];
}): boolean {
  if (input.uncheckedHosts.length === 0) return false;
  const key = httpsHostKey(input.url.href);
  return key !== null && input.uncheckedHosts.includes(key);
}

/** fetch 的回复：照常的是全局 fetch 的，不校验证书的是 npm undici 的；只用两边都有的这几样。 */
export interface UpstreamResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  // 回复体按段读（流式回答读到第一段内容为止，提前跳出即取消）；和 text 二选一。
  chunks(): AsyncIterable<Uint8Array>;
}

/**
 * 发往这家上游的 fetch：主机不校验证书时用 npm undici 自己的 fetch，配这家这组主机自己的一套连接（Agent 与 fetch 出自同一个包，
 * 不把它的 dispatcher 交给 Node 自带的 fetch：Node 22 自带的 undici 是 6.x，大版本对不上），其余照常用全局的。
 */
export async function upstreamFetch(input: {
  url: string;
  init: UpstreamRequestInit;
  uncheckedHosts: readonly string[];
}): Promise<UpstreamResponse> {
  const url = new URL(input.url);
  if (!skipsCertificateCheck({ url, uncheckedHosts: input.uncheckedHosts })) {
    const response = await fetch(url, input.init);
    return {
      status: response.status,
      ok: response.ok,
      text: () => response.text(),
      chunks: () => chunksOf(response.body),
    };
  }
  const dispatcher = uncheckedDispatcher(input.uncheckedHosts);
  const response = await undiciFetch(url, { ...input.init, dispatcher });
  return {
    status: response.status,
    ok: response.ok,
    text: () => response.text(),
    chunks: () => chunksOf(response.body),
  };
}

/** 两种 fetch 的回复体都能这样一段段读。 */
interface ChunkStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void>;
  };
}

async function* chunksOf(body: ChunkStream | null): AsyncGenerator<Uint8Array> {
  if (body === null) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done || chunk.value === undefined) return;
      yield chunk.value;
    }
  } finally {
    await reader.cancel();
  }
}

/** 发往上游的请求：两种 fetch 都收的那几项。 */
export interface UpstreamRequestInit {
  method?: "POST";
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

/** 这些主机不再不校验（地址换了、关掉了、整家开关关了、删了）：关掉含它们的那几套连接。 */
export function releaseUncheckedHosts(hosts: readonly string[]): void {
  for (const [key, kept] of uncheckedDispatchers) {
    if (!kept.hosts.some((host) => hosts.includes(host))) continue;
    uncheckedDispatchers.delete(key);
    void kept.agent.close();
  }
}

/** daemon 停下：关掉所有不校验证书的连接。 */
export function closeUncheckedDispatchers(): void {
  for (const kept of uncheckedDispatchers.values()) void kept.agent.close();
  uncheckedDispatchers.clear();
}

// 每组不校验证书的主机一套连接（magpie 每条路线一个 Transport）；组合来来去去，满了全部关掉重来。
const MAX_UNCHECKED_DISPATCHERS = 32;
const uncheckedDispatchers = new Map<string, { hosts: readonly string[]; agent: Agent }>();

/**
 * 只对这组主机不校验证书的 dispatcher：同一个 fetch 重定向到这家另一个地址的主机照样不校验，到别的主机照常校验。
 * 与校验证书的请求不共用连接，别家指向同一台服务时走的是全局的那套，照常校验。
 */
function uncheckedDispatcher(hosts: readonly string[]): Agent {
  const key = [...hosts].sort().join(" ");
  const kept = uncheckedDispatchers.get(key);
  if (kept) return kept.agent;
  if (uncheckedDispatchers.size >= MAX_UNCHECKED_DISPATCHERS) closeUncheckedDispatchers();
  const agent = new Agent({
    factory: (origin, options) => {
      const isUnchecked = skipsCertificateCheck({
        url: new URL(String(origin)),
        uncheckedHosts: hosts,
      });
      if (!isUnchecked) return new Pool(origin, options);
      return new Pool(origin, { ...options, connect: { rejectUnauthorized: false } });
    },
  });
  uncheckedDispatchers.set(key, { hosts: [...hosts], agent });
  return agent;
}

/** https 地址的「主机名:端口」（小写、去掉末尾的点，没写端口是 443）；不是 https（isHttpsUrl）或读不出为 null。 */
function httpsHostKey(url: string): string | null {
  const trimmed = url.trim();
  if (!isHttpsUrl(trimmed) || !URL.canParse(trimmed)) return null;
  const parsed = new URL(trimmed);
  if (parsed.hostname === "") return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return `${hostname}:${parsed.port || "443"}`;
}
