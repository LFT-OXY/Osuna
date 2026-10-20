// 不校验证书只给这家自己地址的主机、按主机各用一套连接移植自 magpie（https://github.com/yetone/magpie，
// internal/provider/insecure_tls.go 的 TakesInsecureTLS、UncheckedHosts，internal/provider/proxy.go 的 Via，
// internal/netproxy/unchecked.go 的 WithUncheckedTLS、uncheckedHost、hostKey，netproxy.go 的 dispatch.transport）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { takesInsecureTls } from "@getpaseo/protocol/api-endpoint/request-extras";
import { Agent, Pool, type Dispatcher } from "undici";

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
    const key = httpsHostKey(url.trim());
    if (key !== null) hosts.add(key);
  }
  return [...hosts];
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

/** 发往这家上游的 fetch：主机不校验证书时用那台主机自己的一套连接，其余照常用全局的。 */
export function upstreamFetch(input: {
  url: string;
  init: RequestInit;
  uncheckedHosts: readonly string[];
}): Promise<Response> {
  const url = new URL(input.url);
  if (!skipsCertificateCheck({ url, uncheckedHosts: input.uncheckedHosts })) {
    return fetch(url, input.init);
  }
  const dispatcher = uncheckedDispatcher(httpsHostKey(url.href) ?? "");
  // Node 自带的 fetch 收 undici 的 dispatcher（同一大版本）；lib.dom 的 RequestInit 里没有这一项。
  const init: RequestInit & { dispatcher: Dispatcher } = { ...input.init, dispatcher };
  return fetch(url, init);
}

// 不校验证书的主机各一套连接（magpie 每条路线一个 Transport）；主机来来去去，满了全部关掉重来。
const MAX_UNCHECKED_DISPATCHERS = 32;
const uncheckedDispatchers = new Map<string, Agent>();

/**
 * 只对 host 不校验证书的 dispatcher：同一个 fetch 重定向到别的主机时，那台照常校验。与校验证书的请求不共用连接，
 * 别家指向同一台服务时走的是全局的那套，照常校验。
 */
function uncheckedDispatcher(host: string): Agent {
  const kept = uncheckedDispatchers.get(host);
  if (kept) return kept;
  if (uncheckedDispatchers.size >= MAX_UNCHECKED_DISPATCHERS) {
    for (const agent of uncheckedDispatchers.values()) void agent.close();
    uncheckedDispatchers.clear();
  }
  const agent = new Agent({
    factory: (origin, options) => {
      const isUnchecked = httpsHostKey(String(origin)) === host;
      if (!isUnchecked) return new Pool(origin, options);
      return new Pool(origin, { ...options, connect: { rejectUnauthorized: false } });
    },
  });
  uncheckedDispatchers.set(host, agent);
  return agent;
}

/** https 地址的「主机名:端口」（小写、去掉末尾的点，没写端口是 443）；不是 https 或读不出为 null。 */
function httpsHostKey(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname === "") return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return `${hostname}:${parsed.port || "443"}`;
}
