// 算出 Codex 经哪个代理、经代理问中转站移植自 magpie（https://github.com/yetone/magpie，internal/agent/codex_proxy.go 的
// codexEnv / codexProxyFor / systemProxyName / reqwestNoProxy / systemBypassed / realProxyProbe / codexThroughProxy /
// codexProxiedDetail，reach.go 的 probed / proxied）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type pino from "pino";
import { GATEWAY_INFO_NAME } from "./gateway-reach.js";
import { parseProxyUrl, redactProxy, type SystemProxy } from "./system-proxy.js";

/*
 * Codex 发给本机中转站（http://127.0.0.1:<端口>）的请求和别的请求一样会交给代理。它的 HTTP 客户端是默认特性的 reqwest，
 * 代理按 hyper-util 的 Matcher::from_system 取：HTTP_PROXY（大写优先），没有再用系统给 http:// 的代理
 * （Windows 给所有协议一个代理时、macOS 只看「网页代理（HTTP）」那一项），再没有用 ALL_PROXY；
 * 绕过只看 NO_PROXY（Windows 上 NO_PROXY 为空时用 ProxyOverride），对 IP 主机只认精确 IP 或 CIDR，
 * 「localhost」「127.*」都挡不住 127.0.0.1，macOS 的例外列表根本不读。
 * [features] respect_system_proxy 打开时 Codex 只问系统（codex-rs http-client/src/outbound_proxy.rs:341-399）：
 * 系统的绕过列表按通配与 <local> 匹配，系统没设代理就直连；macOS 上只有 SOCKS 一项时它用不了，改用 HTTP_PROXY / ALL_PROXY。
 * reqwest 没开 SOCKS，socks5:// 的代理按 HTTP 代理说话。
 * 代理不把 127.0.0.1 转回本机（全局模式的 Clash、没有局域网直连规则的规则集）就回 502，Codex 每一轮都失败。
 */

/** Codex 读的代理变量：登录 shell 的，没有再用 daemon 自己的（magpie 的 codexEnv）。 */
export const CODEX_PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

export type ProxyEnv = Readonly<Record<string, string | undefined>>;

/** 代理写在哪：哪个环境变量，或系统的代理设置。 */
export type CodexProxySource =
  | { kind: "env"; key: "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" }
  | { kind: "system" };

export interface CodexProxyRoute {
  proxy: string;
  source: CodexProxySource;
}

export interface CodexProxyForInput {
  // 中转站地址。
  base: string;
  env: ProxyEnv;
  system: SystemProxy;
  platform: NodeJS.Platform;
  // Codex 的 config.toml 开了 [features] respect_system_proxy。
  respectsSystemProxy: boolean;
}

/** 这台机器上的 Codex 发往 base 的请求经过的代理与它写在哪；直连为 null。 */
export function codexProxyFor(input: CodexProxyForInput): CodexProxyRoute | null {
  if (!URL.canParse(input.base)) return null;
  const url = new URL(input.base);
  const host = url.hostname;
  if (host === "") return null;
  const env = (keys: readonly string[]): string => {
    for (const key of keys) {
      const value = input.env[key]?.trim() ?? "";
      if (value !== "") return value;
    }
    return "";
  };
  const httpKey = httpProxyKey(url);
  const httpKeys = [httpKey, httpKey.toLowerCase()];
  const { system } = input;
  if (input.respectsSystemProxy) {
    // 只问系统，按系统自己的绕过列表；系统没设代理就直连，HTTP_PROXY 设了也一样。
    if (system.url === null || systemBypassed({ host, bypass: system.bypass })) return null;
    if (input.platform !== "darwin") return { proxy: system.url, source: { kind: "system" } };
    // CFNetwork 给 http:// 地址的是 HTTP 那一项；只有 SOCKS 一项时 Codex 用不了，改用环境变量。
    if (system.http !== null) return { proxy: system.http, source: { kind: "system" } };
    if (system.socks === null) return null;
    return envRoute({ host, env, httpKey, httpKeys });
  }
  // reqwest 的：先环境变量，没有再用系统给 http:// 的，再没有用 ALL_PROXY；NO_PROXY（Windows 上没有它时用系统的绕过列表）绕开它们。
  let proxy = env(httpKeys);
  let source: CodexProxySource = { kind: "env", key: httpKey };
  if (proxy === "" && system.http !== null) {
    proxy = system.http;
    source = { kind: "system" };
  }
  if (proxy === "") {
    proxy = env(["ALL_PROXY", "all_proxy"]);
    source = { kind: "env", key: "ALL_PROXY" };
  }
  let noProxy = env(["NO_PROXY", "no_proxy"]);
  const isWindowsBypassUsed = noProxy === "" && input.platform === "win32" && system.url !== null;
  if (isWindowsBypassUsed) noProxy = system.bypass.join(",").replaceAll("*.", "");
  if (proxy === "" || reqwestNoProxy({ host, list: noProxy })) return null;
  return { proxy, source };
}

/** 请求 https:// 地址看 HTTPS_PROXY，别的看 HTTP_PROXY。 */
function httpProxyKey(url: URL): "HTTP_PROXY" | "HTTPS_PROXY" {
  if (url.protocol === "https:") return "HTTPS_PROXY";
  return "HTTP_PROXY";
}

function envRoute(input: {
  host: string;
  env: (keys: readonly string[]) => string;
  httpKey: "HTTP_PROXY" | "HTTPS_PROXY";
  httpKeys: readonly string[];
}): CodexProxyRoute | null {
  let proxy = input.env(input.httpKeys);
  let source: CodexProxySource = { kind: "env", key: input.httpKey };
  if (proxy === "") {
    proxy = input.env(["ALL_PROXY", "all_proxy"]);
    source = { kind: "env", key: "ALL_PROXY" };
  }
  const isBypassed = reqwestNoProxy({
    host: input.host,
    list: input.env(["NO_PROXY", "no_proxy"]),
  });
  if (proxy === "" || isBypassed) return null;
  return { proxy, source };
}

/**
 * hyper-util 的 NoProxy.contains：逗号分隔；地址只被包含它的 IP 或 CIDR 匹配，主机名被它自己或它所在的域匹配；
 * 「*」匹配所有主机名，从不匹配地址。
 */
export function reqwestNoProxy(input: { host: string; list: string }): boolean {
  const host = input.host.replace(/^\[|\]$/g, "");
  const family = ipFamily(host);
  for (const rawEntry of input.list.split(",")) {
    const entry = rawEntry.trim();
    if (entry === "") continue;
    if (family !== null) {
      if (ipEntryHolds({ entry, ip: host, family })) return true;
      continue;
    }
    const domain = entry.replace(/^\./, "").toLowerCase();
    const lowerHost = host.toLowerCase();
    const isUnder = lowerHost === domain || lowerHost.endsWith(`.${domain}`);
    if (entry === "*" || isUnder) return true;
  }
  return false;
}

type IpFamily = "ipv4" | "ipv6";

function ipFamily(value: string): IpFamily | null {
  const version = isIP(value);
  if (version === 4) return "ipv4";
  if (version === 6) return "ipv6";
  return null;
}

/** NO_PROXY 的一项是 IP 或 CIDR 且包含 ip。 */
function ipEntryHolds(input: { entry: string; ip: string; family: IpFamily }): boolean {
  const slash = input.entry.indexOf("/");
  const list = new BlockList();
  if (slash < 0) {
    if (ipFamily(input.entry) !== input.family) return false;
    list.addAddress(input.entry, input.family);
    return list.check(input.ip, input.family);
  }
  const address = input.entry.slice(0, slash);
  const family = ipFamily(address);
  if (family !== input.family) return false;
  const prefixText = input.entry.slice(slash + 1);
  const prefix = Number(prefixText);
  const maxPrefix = family === "ipv4" ? 32 : 128;
  const isPrefix = /^\d+$/.test(prefixText) && prefix <= maxPrefix;
  if (!isPrefix) return false;
  list.addSubnet(address, prefix, family);
  return list.check(input.ip, family);
}

/**
 * Codex 自己拿主机比系统的绕过列表（codex-rs outbound_proxy/windows.rs）：<local> 是不带点的名字，
 * 带 * 的按通配，别的是主机本身，前面带点的是它所在的域。
 */
export function systemBypassed(input: { host: string; bypass: readonly string[] }): boolean {
  const host = input.host.replace(/^\[|\]$/g, "").toLowerCase();
  for (const rawEntry of input.bypass) {
    const entry = rawEntry
      .trim()
      .toLowerCase()
      .replace(/^http:\/\//, "")
      .replace(/^https:\/\//, "");
    if (entry === "") continue;
    if (entry === "<local>") {
      if (!host.includes(".")) return true;
      continue;
    }
    if (entry === "*") return true;
    if (entry.startsWith(".")) {
      if (host === entry.slice(1) || host.endsWith(entry)) return true;
      continue;
    }
    if (entry.includes("*")) {
      if (globMatches({ pattern: entry, value: host })) return true;
      continue;
    }
    if (host === entry) return true;
  }
  return false;
}

/** Go 的 path.Match：* 是不含 / 的任意串，? 是一个字符，[...] 是字符类。 */
function globMatches(input: { pattern: string; value: string }): boolean {
  let source = "";
  for (let index = 0; index < input.pattern.length; index += 1) {
    const char = input.pattern[index];
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "[") {
      const end = input.pattern.indexOf("]", index + 1);
      if (end < 0) return false;
      source += `[${input.pattern.slice(index + 1, end)}]`;
      index = end;
    } else source += char.replace(/[.+^${}()|\\/]/g, "\\$&");
  }
  return new RegExp(`^${source}$`).test(input.value);
}

/** 线上 params.from：环境变量的名字，或哪个系统的代理设置。 */
export type CodexProxyFrom =
  | "HTTP_PROXY"
  | "HTTPS_PROXY"
  | "ALL_PROXY"
  | "windows_settings"
  | "system_settings";

/** 「如何修复」用哪种说法（magpie 的三种）：代理来自环境变量、Windows 设置、别处。 */
export type CodexProxyFix = "environment" | "windows" | "other";

export function codexProxyFrom(input: {
  source: CodexProxySource;
  platform: NodeJS.Platform;
}): CodexProxyFrom {
  if (input.source.kind === "env") return input.source.key;
  if (input.platform === "win32") return "windows_settings";
  return "system_settings";
}

export function codexProxyFix(input: {
  source: CodexProxySource;
  platform: NodeJS.Platform;
}): CodexProxyFix {
  if (input.source.kind === "env") return "environment";
  if (input.platform === "win32") return "windows";
  return "other";
}

const FROM_WORDS: Record<CodexProxyFrom, string> = {
  HTTP_PROXY: "HTTP_PROXY",
  HTTPS_PROXY: "HTTPS_PROXY",
  ALL_PROXY: "ALL_PROXY",
  windows_settings: "Windows' proxy settings",
  system_settings: "the system's proxy settings",
};

const FIX_WORDS: Record<CodexProxyFix, (from: string) => string> = {
  environment: (from) =>
    `or add 127.0.0.1 to NO_PROXY where ${from} is set (your shell profile, such as ~/.zshrc, if it's there), `,
  windows: () =>
    `or add 127.0.0.1 to "Don't use the proxy server for addresses beginning with" in Windows' proxy settings (127.* there is not enough for Codex), `,
  other: () =>
    "or add export NO_PROXY=127.0.0.1 to your shell profile (~/.zshrc): Codex in a terminal and the ChatGPT app's Codex both read it, ",
};

/** 提示区的英文原文（magpie 的 codexProxiedDetail，magpie 换成 Osuna）。 */
export function codexProxiedMessage(input: {
  host: string;
  proxy: string;
  from: CodexProxyFrom;
  fix: CodexProxyFix;
}): string {
  const from = FROM_WORDS[input.from];
  return (
    `Codex sends its requests for Osuna (${input.host}) through the proxy at ${input.proxy}, set in ${from}, ` +
    "and that proxy doesn't pass them on to Osuna: every turn fails, with 502 Bad Gateway, whichever model it is on. " +
    "Have the proxy send 127.0.0.1 direct (a DIRECT rule for 127.0.0.0/8, or rule mode rather than global), " +
    FIX_WORDS[input.fix](from) +
    "then quit and reopen Codex. Until then, Switch to official puts Codex's config back as it was."
  );
}

const PROBE_TIMEOUT_MS = 3_000;
// 中转站的自我介绍只有一小段 JSON；多了不是它。
const PROBE_BODY_LIMIT_BYTES = 64 * 1024;

export interface ProbeThroughProxyInput {
  // 中转站地址（http://）。
  base: string;
  proxy: string;
  // Osuna 自己的身份（Osuna/<版本>）：这是 daemon 主动发出的请求。
  userAgent: string;
}

/** 经代理问 base 的根路径，答出中转站的自我介绍才算通；生产发 HTTP，测试可换。 */
export type ProbeThroughProxy = (input: ProbeThroughProxyInput) => Promise<boolean>;

/**
 * 经代理 GET base/（3 秒超时），回 200 且 JSON 里 name 是 osuna 才算通到中转站；代理自己的 502 或别的都不算。
 * socks 代理照 Codex 的样子当作同一地址的 HTTP 代理问（它的 reqwest 没有 SOCKS）。
 */
export function probeThroughProxy(input: ProbeThroughProxyInput): Promise<boolean> {
  const target = new URL(`${input.base.replace(/\/+$/, "")}/`);
  if (target.protocol !== "http:") {
    throw new Error(`The gateway is only probed over http://, not ${input.base}`);
  }
  const proxy = parseProxyUrl(input.proxy);
  if (proxy === null) return Promise.resolve(false);
  const isSocks = proxy.protocol.toLowerCase().startsWith("socks");
  const isHttpsProxy = proxy.protocol === "https:";
  const isHttpProxy = proxy.protocol === "http:" || isSocks;
  if (!isHttpProxy && !isHttpsProxy) return Promise.resolve(false);
  const headers: Record<string, string> = { host: target.host, "user-agent": input.userAgent };
  if (proxy.username !== "") {
    const account = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
    headers["proxy-authorization"] = `Basic ${Buffer.from(account).toString("base64")}`;
  }
  const send = isHttpsProxy ? httpsRequest : httpRequest;
  const port = proxyPort({ proxy, isHttpsProxy });
  return new Promise((resolve) => {
    const request = send({
      host: proxy.hostname.replace(/^\[|\]$/g, ""),
      port,
      method: "GET",
      // 发给代理的是完整地址（absolute-form），代理据此转发。
      path: target.toString(),
      headers,
      timeout: PROBE_TIMEOUT_MS,
    });
    request.on("timeout", () => request.destroy());
    // 连不上、超时、被代理掐断：都不是通到中转站。
    request.on("error", () => resolve(false));
    request.on("response", (response) => {
      void readsAsGateway(response).then(resolve);
    });
    request.end();
  });
}

/** 代理地址里的端口；没写时按协议（https 443，别的 80）。 */
function proxyPort(input: { proxy: URL; isHttpsProxy: boolean }): number {
  if (input.proxy.port !== "") return Number(input.proxy.port);
  if (input.isHttpsProxy) return 443;
  return 80;
}

async function readsAsGateway(response: IncomingMessage): Promise<boolean> {
  if (response.statusCode !== 200) {
    response.resume();
    return false;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    if (!Buffer.isBuffer(chunk)) continue;
    size += chunk.length;
    if (size > PROBE_BODY_LIMIT_BYTES) {
      response.destroy();
      return false;
    }
    chunks.push(chunk);
  }
  let info: unknown;
  try {
    info = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (typeof info !== "object" || info === null) return false;
  return Reflect.get(info, "name") === GATEWAY_INFO_NAME;
}

/** 经代理连不上中转站：提示区要的全部。 */
export interface CodexProxyFinding {
  // 中转站的主机与端口。
  host: string;
  // 去掉账号密码的代理地址。
  proxy: string;
  from: CodexProxyFrom;
  fix: CodexProxyFix;
}

export interface CodexProxyCheckOptions {
  readEnv: () => Promise<ProxyEnv>;
  readSystemProxy: () => Promise<SystemProxy>;
  probeThroughProxy: ProbeThroughProxy;
  // 直连问中转站（gateway-reach.ts，20 秒缓存）。
  reachesGateway: (base: string) => Promise<boolean>;
  userAgent: string;
  platform: NodeJS.Platform;
  logger: pino.Logger;
  now?: () => number;
}

export interface CodexProxyCheckInput {
  // 中转站地址（写进 Codex 的那个，不带 /v1）。
  base: string;
  respectsSystemProxy: boolean;
}

// 经代理问的答案管 20 秒（magpie 的 reachAge）。
const PROBE_ANSWER_MAX_AGE_MS = 20_000;
// 列表等一次检查最多这么久，没查完就用上次的答案，查完的留给下一次（读登录 shell、问代理都可能要几秒）。
const CHECK_WAIT_MS = 3_000;

interface ProbeAnswer {
  at: number;
  isReached: boolean;
}

interface CheckResult {
  key: string;
  finding: CodexProxyFinding | null;
}

/**
 * 在后台查 Codex 经代理能不能到中转站：只有直连能通、经代理不通时才报（magpie 的 proxied）。
 * 读登录 shell、读系统代理、问代理都不挡列表：等最多 3 秒，没查完先用上次的答案。
 */
export class CodexProxyCheck {
  private readonly options: CodexProxyCheckOptions;
  private readonly now: () => number;
  private readonly probes = new Map<string, ProbeAnswer>();
  private last: CheckResult | null = null;
  private pending: { key: string; done: Promise<CheckResult> } | null = null;

  constructor(options: CodexProxyCheckOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  async read(input: CodexProxyCheckInput): Promise<CodexProxyFinding | null> {
    const key = `${input.base} ${input.respectsSystemProxy}`;
    if (this.pending?.key !== key) {
      const done = this.check(input).then((finding) => {
        const result = { key, finding };
        this.last = result;
        return result;
      });
      const pending = { key, done };
      this.pending = pending;
      void done
        .catch((error: unknown) => {
          this.options.logger.error({ err: error }, "Failed to check Codex's proxy");
        })
        .finally(() => {
          if (this.pending === pending) this.pending = null;
        });
    }
    const waited = await waitAtMost({ task: this.pending.done, ms: CHECK_WAIT_MS });
    if (waited !== null) return waited.finding;
    if (this.last?.key !== key) return null;
    return this.last.finding;
  }

  private async check(input: CodexProxyCheckInput): Promise<CodexProxyFinding | null> {
    const [env, system] = await Promise.all([
      this.options.readEnv(),
      this.options.readSystemProxy(),
    ]);
    const { platform } = this.options;
    const route = codexProxyFor({ ...input, env, system, platform });
    if (route === null) return null;
    const [isReachedThroughProxy, isReachedDirectly] = await Promise.all([
      this.probe({ base: input.base, proxy: route.proxy }),
      this.options.reachesGateway(input.base),
    ]);
    const isProxied = isReachedDirectly && !isReachedThroughProxy;
    if (!isProxied) return null;
    return {
      host: new URL(input.base).host,
      proxy: redactProxy(route.proxy),
      from: codexProxyFrom({ source: route.source, platform }),
      fix: codexProxyFix({ source: route.source, platform }),
    };
  }

  private async probe(input: { base: string; proxy: string }): Promise<boolean> {
    const key = `${input.proxy} ${input.base}`;
    const last = this.probes.get(key);
    if (last && this.now() - last.at <= PROBE_ANSWER_MAX_AGE_MS) return last.isReached;
    const isReached = await this.options.probeThroughProxy({
      ...input,
      userAgent: this.options.userAgent,
    });
    this.probes.set(key, { at: this.now(), isReached });
    return isReached;
  }
}

async function waitAtMost<T>(input: { task: Promise<T>; ms: number }): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), input.ms);
  });
  try {
    return await Promise.race([input.task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
