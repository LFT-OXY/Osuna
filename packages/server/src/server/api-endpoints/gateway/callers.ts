// 认调用方移植自 magpie（https://github.com/yetone/magpie）：本机来源照 internal/gateway/lan.go 的 local、proxied 与 forwardHeaders，
// DNS 重绑定照 lan.go 的 rebound、fromBrowser 与 ownHost，网页拒收照 cors.go 的 corsGuard、foreignPage 与 localhostSubdomain，
// 带了几个口令照 lan.go 的 callerKeys，按 User-Agent 认 Agent 照 gateway.go 的 agentOf 与 internal/usage/usage.go 的 AgentOf
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { isIP, isIPv4 } from "node:net";
import { API_ENDPOINT_PROVIDERS, type ApiEndpointProvider, type GatewayTokens } from "../store.js";

/*
 * 中转站认调用方（ADR 0010，取代 ADR 0007 的口令认证）：
 * 本机回环来的、不带转发头的请求一律收，口令只用来认是哪个 Agent；网页发来的照 magpie 拒收。
 * Osuna 的口令是每个 Agent 一个随机值，网页猜不到，所以在 magpie 要「网关 key」的地方，带了口令就算数。
 * magpie 另有的「用户列出的网页」「局域网共享」「信任代理」Osuna 没有，对应的放行一概不做。
 */

// 代理、隧道转发时加的头（cloudflared、ngrok、Tailscale serve/funnel、frp、Caddy、nginx）；Agent 自己从不带。
const FORWARD_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "tailscale-user-login",
];

// 容器运行时给宿主机起的名字。
const CONTAINER_HOST_NAMES = new Set([
  "host.docker.internal",
  "gateway.docker.internal",
  "host.containers.internal",
  "host.orb.internal",
  "docker.for.mac.localhost",
]);

/** 每个 Agent 的 id 与别名（User-Agent 的产品名整个等于它），以及产品名的开头。 */
const AGENT_USER_AGENTS: Record<ApiEndpointProvider, { names: string[]; prefixes: string[] }> = {
  claude: { names: ["claude", "cc", "claude-code"], prefixes: ["claude-cli", "claude-code"] },
  // ACP 适配器的缺省客户端名会成为 Codex 的 originator。
  codex: { names: ["codex"], prefixes: ["codex", "acp-extension-codex"] },
  // magpie 的 piLike 只有 id，OMP 另有别名与 User-Agent 开头（internal/agent/agents.go、omp.go）。
  pi: { names: ["pi"], prefixes: [] },
  omp: { names: ["omp", "oh-my-pi"], prefixes: ["oh-my-pi"] },
};

export type CallerVerdict =
  | { kind: "refused"; status: 403; message: string }
  // agent 为 null：口令与 User-Agent 都认不出，交给请求路径决定。
  | { kind: "accepted"; agent: ApiEndpointProvider | null };

export interface CallerInput {
  remoteAddress: string | undefined;
  headers: IncomingHttpHeaders;
  tokens: GatewayTokens;
  // 本机的名字（os.hostname()）：浏览器用它访问不算重绑定。
  machineName: string;
  platform: NodeJS.Platform;
}

export function judgeCaller(input: CallerInput): CallerVerdict {
  const { headers } = input;
  if (!isLoopback(input.remoteAddress)) {
    return refuse("The API endpoint gateway only accepts requests from this computer");
  }
  if (proxied(headers)) {
    return refuse(
      "The API endpoint gateway only accepts requests from this computer: this one came through a proxy or tunnel (it carries a forwarding header such as X-Forwarded-For or Cf-Connecting-IP)",
    );
  }
  const keyed = tokenAgent(headers, input.tokens);
  const host = header(headers, "host");
  if (keyed === null && fromBrowser(headers) && !ownHost(host, input.machineName)) {
    return refuse(
      `The API endpoint gateway doesn't answer a browser that reached it as ${host} (a web site's name pointed at this computer): call it as localhost or 127.0.0.1`,
    );
  }
  const origin = header(headers, "origin");
  if (foreignPage(origin, host)) {
    return refuse(`The API endpoint gateway doesn't answer the web page ${origin}`);
  }
  if (origin === "null" && keyed === null) {
    return refuse(
      "The API endpoint gateway doesn't answer a sandboxed frame or a local page (Origin: null)",
    );
  }
  if (keyed === null && localhostSubdomain(origin, input.platform)) {
    return refuse(
      `The API endpoint gateway doesn't answer the web page ${origin}: browsers may ask the network's DNS for a localhost subdomain, so the page may not be on this computer. Open it at localhost or 127.0.0.1`,
    );
  }
  return { kind: "accepted", agent: keyed ?? userAgentAgent(header(headers, "user-agent")) };
}

function refuse(message: string): CallerVerdict {
  return { kind: "refused", status: 403, message };
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** 127.0.0.0/8、::1，以及映射成 IPv6 的 127.x。 */
function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  const lower = address.toLowerCase();
  const v4 = lower.startsWith("::ffff:") ? lower.slice("::ffff:".length) : lower;
  if (isIPv4(v4)) return v4.startsWith("127.");
  return lower === "::1" || lower === "0:0:0:0:0:0:0:1";
}

function proxied(headers: IncomingHttpHeaders): boolean {
  return FORWARD_HEADERS.some((name) => header(headers, name) !== "");
}

/** 请求带的口令，按读的顺序：Authorization 的 Bearer、x-api-key；空的跳过、重复的只算一次。 */
function callerKeys(headers: IncomingHttpHeaders): string[] {
  const keys: string[] = [];
  const add = (value: string) => {
    if (value !== "" && !keys.includes(value)) keys.push(value);
  };
  const authorization = header(headers, "authorization");
  if (authorization.slice(0, 7).toLowerCase() === "bearer ") {
    add(authorization.slice(7).trim());
  } else if (authorization.toLowerCase() !== "bearer") {
    add(authorization);
  }
  add(header(headers, "x-api-key"));
  return keys;
}

/** 带的口令里第一个对得上的那个 Agent。 */
function tokenAgent(
  headers: IncomingHttpHeaders,
  tokens: GatewayTokens,
): ApiEndpointProvider | null {
  for (const key of callerKeys(headers)) {
    const given = Buffer.from(key);
    const agent = API_ENDPOINT_PROVIDERS.find((provider) => {
      const expected = tokens[provider];
      if (expected === undefined) return false;
      const wanted = Buffer.from(expected);
      return wanted.length === given.length && timingSafeEqual(wanted, given);
    });
    if (agent) return agent;
  }
  return null;
}

/** User-Agent 的产品名（第一个 / 或空格之前，小写）先整个比 id 与别名，再比开头。 */
function userAgentAgent(userAgent: string): ApiEndpointProvider | null {
  const product = userAgent.split("/")[0]!.split(" ")[0]!.toLowerCase();
  if (product === "") return null;
  const named = API_ENDPOINT_PROVIDERS.find((provider) =>
    AGENT_USER_AGENTS[provider].names.includes(product),
  );
  if (named) return named;
  return (
    API_ENDPOINT_PROVIDERS.find((provider) =>
      AGENT_USER_AGENTS[provider].prefixes.some((prefix) => product.startsWith(prefix)),
    ) ?? null
  );
}

/** 浏览器每个请求都带、网页脚本去不掉的东西。 */
function fromBrowser(headers: IncomingHttpHeaders): boolean {
  return (
    header(headers, "origin") !== "" ||
    header(headers, "sec-fetch-site") !== "" ||
    header(headers, "sec-fetch-mode") !== "" ||
    header(headers, "user-agent").startsWith("Mozilla/")
  );
}

/** Host 头说的是本机：IP、localhost、容器给宿主机的名字、本机自己的名字。localhost 的子域名不算。 */
function ownHost(host: string, machineName: string): boolean {
  const name = splitHostPort(host).host.replace(/\.$/, "");
  if (name === "" || isIP(name) !== 0 || name === "localhost") return true;
  if (CONTAINER_HOST_NAMES.has(name)) return true;
  const machine = machineName.toLowerCase().replace(/\.local$/, "");
  return machine !== "" && (name === machine || name === `${machine}.local`);
}

/**
 * Origin 是一个 http(s) 网页，既不在本机（localhost、*.localhost、回环地址，任何端口），也不是请求自己的源。
 * 只判 http 与 https：app://、file://、vscode-webview://、chrome-extension:// 这类只有应用和扩展发得出。
 * "null" 与 localhost 子域名不在这里判，见调用处。
 */
function foreignPage(origin: string, host: string): boolean {
  if (origin === "") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return origin.toLowerCase().startsWith("http");
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme !== "http" && scheme !== "https") return false;
  const name = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (name === "localhost" || name.endsWith(".localhost")) return false;
  if (isLoopbackIp(name)) return false;
  return hostPort(url.host, scheme) !== hostPort(host, scheme);
}

function isLoopbackIp(name: string): boolean {
  return isIP(name) !== 0 && isLoopback(name);
}

/**
 * Origin 是 localhost 子域名上的 http(s) 网页：Safari 等 WebKit 会把这种名字交给系统去问 DNS，页面可能不在本机。
 * Windows 上 tauri.localhost 与 wails.localhost 是这两种 webview 自己的名字，不算。
 */
function localhostSubdomain(origin: string, platform: NodeJS.Platform): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme !== "http" && scheme !== "https") return false;
  const name = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!name.endsWith(".localhost")) return false;
  return platform !== "win32" || (name !== "tauri.localhost" && name !== "wails.localhost");
}

/** 小写的主机与端口，没写端口时按协议补上，https://a.example 与 a.example:443 相同。 */
function hostPort(value: string, scheme: string): string {
  if (value === "") return "";
  const { host, port } = splitHostPort(value);
  return `${host}|${port ?? (scheme === "https" ? "443" : "80")}`;
}

/** host[:port] 拆开并小写，IPv6 去掉方括号；只有一个冒号时才当作带了端口。 */
function splitHostPort(value: string): { host: string; port: string | null } {
  const lower = value.trim().toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    if (end === -1) return { host: lower, port: null };
    const rest = lower.slice(end + 1);
    return { host: lower.slice(1, end), port: rest.startsWith(":") ? rest.slice(1) : null };
  }
  const colon = lower.indexOf(":");
  if (colon === -1 || colon !== lower.lastIndexOf(":")) return { host: lower, port: null };
  return { host: lower.slice(0, colon), port: lower.slice(colon + 1) };
}
