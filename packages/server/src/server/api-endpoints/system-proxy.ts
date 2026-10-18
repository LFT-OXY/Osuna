// 系统代理的读法移植自 magpie（https://github.com/yetone/magpie，internal/netproxy/scutil.go 的 parseScutil、
// windows.go 的 parseWindows、system_windows.go 的 system、netproxy.go 的 System 与 systemKeep / noneKeep、Redact）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 系统设置里的代理：macOS 读 `scutil --proxy`（CFNetwork 用的同一份），Windows 读 Internet Options 的手动代理
 * （注册表 HKCU\…\Internet Settings，大多数代理客户端写的就是它）；别的系统的桌面代理以 *_PROXY 变量交给应用。
 * 真正去读的是「进程与命令」适配器（host-processes.ts），这里只解析它的输出。
 */

/** 系统设置里的代理；都没设时全为 null、bypass 为空。 */
export interface SystemProxy {
  // 一个地址的代理：HTTPS 优先于 HTTP 优先于 SOCKS（magpie 的 URL）。
  url: string | null;
  // macOS「网页代理（HTTP）」那一项本身；Windows 只有给所有协议一个代理时才有（reqwest 读不了按协议的列表）。
  http: string | null;
  socks: string | null;
  // 「忽略这些主机与域」/ ProxyOverride 的每一项。
  bypass: string[];
}

export const NO_SYSTEM_PROXY: SystemProxy = { url: null, http: null, socks: null, bypass: [] };

/** `scutil --proxy` 的输出。 */
export function parseScutil(output: string): SystemProxy {
  const values = new Map<string, string>();
  const bypass: string[] = [];
  let isInList = false;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    const separator = line.indexOf(" : ");
    if (isInList) {
      if (line === "}") isInList = false;
      else if (separator >= 0) bypass.push(line.slice(separator + 3));
      continue;
    }
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    if (key === "ExceptionsList") {
      isInList = true;
      continue;
    }
    values.set(key, line.slice(separator + 3));
  }
  const entry = (slot: { key: string; scheme: string }): string | null => {
    const host = values.get(`${slot.key}Proxy`) ?? "";
    const isEnabled = values.get(`${slot.key}Enable`) === "1" && host !== "";
    if (!isEnabled) return null;
    const port = values.get(`${slot.key}Port`) ?? "";
    return `${slot.scheme}://${joinHostPort({ host, port })}`;
  };
  const http = entry({ key: "HTTP", scheme: "http" });
  const socks = entry({ key: "SOCKS", scheme: "socks5" });
  const url = entry({ key: "HTTPS", scheme: "http" }) ?? http ?? socks;
  if (url === null) return NO_SYSTEM_PROXY;
  return { url, http, socks, bypass };
}

/**
 * Internet Options 的 ProxyServer（"host:port"，或 "http=h:p;https=h:p;socks=h:p"）与 ProxyOverride（"a;*.b;<local>"）。
 * 只有给所有协议一个代理时才算 HTTP 那一项：reqwest 把 ProxyServer 当一个地址读，读不了按协议的列表。
 */
export function parseWindowsProxy(input: { server: string; override: string }): SystemProxy {
  const server = input.server.trim();
  if (server === "") return NO_SYSTEM_PROXY;
  const bypass = input.override.split(";");
  if (!server.includes("=")) {
    const url = withScheme({ address: server, scheme: "http" });
    return { url, http: url, socks: null, bypass };
  }
  const byProtocol = new Map<string, string>();
  for (const part of server.split(";")) {
    const equals = part.indexOf("=");
    if (equals < 0) continue;
    byProtocol.set(part.slice(0, equals).trim().toLowerCase(), part.slice(equals + 1).trim());
  }
  const entry = (slot: { key: string; scheme: string }): string | null => {
    const value = byProtocol.get(slot.key) ?? "";
    if (value === "") return null;
    return withScheme({ address: value, scheme: slot.scheme });
  };
  const socks = entry({ key: "socks", scheme: "socks5" });
  const url =
    entry({ key: "https", scheme: "http" }) ?? entry({ key: "http", scheme: "http" }) ?? socks;
  if (url === null) return NO_SYSTEM_PROXY;
  return { url, http: null, socks, bypass };
}

/**
 * `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"` 的输出：
 * ProxyEnable 不是 0 时按 ProxyServer、ProxyOverride 读（magpie 的 system，读的是同几个值）。
 */
export function parseInternetSettings(output: string): SystemProxy {
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\S+)\s+REG_\w+\s+(.*?)\s*$/.exec(line);
    if (match !== null) values.set(match[1], match[2]);
  }
  const enabled = Number(values.get("ProxyEnable") ?? "0");
  const isEnabled = Number.isFinite(enabled) && enabled !== 0;
  const server = values.get("ProxyServer");
  if (!isEnabled || server === undefined) return NO_SYSTEM_PROXY;
  return parseWindowsProxy({ server, override: values.get("ProxyOverride") ?? "" });
}

// 设了代理的读一次管 15 秒，没设的只管 2 秒：开机时代理软件可能比 daemon 晚起来（magpie #1518）。
const SET_PROXY_KEEP_MS = 15_000;
const NO_PROXY_KEEP_MS = 2_000;

interface SystemProxyAnswer {
  at: number;
  proxy: SystemProxy;
}

/** 带缓存地读系统代理；同时来的几次合成一次。 */
export function createSystemProxyReader(input: {
  read: () => Promise<SystemProxy>;
  now?: () => number;
}): () => Promise<SystemProxy> {
  const now = input.now ?? Date.now;
  let answer: SystemProxyAnswer | null = null;
  let pending: Promise<SystemProxyAnswer> | null = null;
  return async () => {
    if (answer !== null) {
      const keepMs = answer.proxy.url === null ? NO_PROXY_KEEP_MS : SET_PROXY_KEEP_MS;
      if (now() - answer.at <= keepMs) return answer.proxy;
    }
    pending ??= input
      .read()
      .then((proxy) => ({ at: now(), proxy }))
      .finally(() => {
        pending = null;
      });
    answer = await pending;
    return answer.proxy;
  };
}

/** 代理地址去掉账号密码再给人看（magpie 的 Redact）；读不出的地址为空串。 */
export function redactProxy(raw: string): string {
  const parsed = parseProxyUrl(raw);
  if (parsed === null) return "";
  const url = parsed;
  const hasAccount = url.username !== "" || url.password !== "";
  if (!hasAccount) return raw;
  url.username = "";
  url.password = "";
  const address = url.toString().replace(/\/$/, "");
  if (raw.includes("://")) return address;
  return address.replace(/^http:\/\//, "");
}

/** 代理地址；没写协议的按 http://（magpie 的 Parse），读不出为 null。 */
export function parseProxyUrl(raw: string): URL | null {
  const address = withScheme({ address: raw.trim(), scheme: "http" });
  if (!URL.canParse(address)) return null;
  return new URL(address);
}

function withScheme(input: { address: string; scheme: string }): string {
  if (input.address.includes("://")) return input.address;
  return `${input.scheme}://${input.address}`;
}

function joinHostPort(input: { host: string; port: string }): string {
  if (input.port === "") return input.host;
  if (input.host.includes(":")) return `[${input.host}]:${input.port}`;
  return `${input.host}:${input.port}`;
}
