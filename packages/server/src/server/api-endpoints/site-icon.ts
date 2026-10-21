// 「从网站取图标」照 magpie（https://github.com/yetone/magpie，internal/provider/favicon.go 与 icon.go 的 guardClient、
// publicDial、publicIP、iconIPs，importurl.go 的 local、iconURL，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { MAX_ICON_BYTES } from "./endpoint-icons.js";

/*
 * 「自定义」接口的图标从它的地址所在网站取（只在用户点「从网站取图标」时）：先问 API 自己的主机，再问它上面的各级域名
 * （api.deepseek.com，再 deepseek.com）；每个站点先看首页 <link rel="icon"> 指的图，再看 /favicon.ico。
 * new-api / one-api 面板的 logo 只写在 /api/status 里，它的 favicon 是面板自己的、每家都一样，所以取那里的 logo，
 * 都没有就用名称的首字画一块图标。只连公网 https 主机；解析出的每个地址都要是公网的（防 DNS 重绑定）。
 */

export type SiteIconFailure = "site_icon_no_address" | "site_icon_local" | "site_icon_not_found";

export class SiteIconError extends Error {
  readonly code: SiteIconFailure;

  constructor(code: SiteIconFailure, message: string) {
    super(message);
    this.name = "SiteIconError";
    this.code = code;
  }
}

export interface SiteResponse {
  status: number;
  // 跟着跳转之后的地址：页面里的相对地址按它解析。
  url: string;
  body: Buffer;
}

/** 取一个网址（跟着跳转）；只读到 maxBytes 加一个字节为止。测试换成本机的假站点。 */
export type FetchSite = (input: {
  url: string;
  accept: string;
  maxBytes: number;
  signal: AbortSignal;
}) => Promise<SiteResponse>;

const OVERALL_TIMEOUT_MS = 30_000;
const ICON_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_STATUS_BYTES = 1 << 20;
const MAX_REDIRECTS = 10;

/** 这台电脑或局域网上的主机（magpie local）：localhost、*.local、回环或私有地址。 */
export function isLocalHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare.endsWith(".local")) return true;
  if (net.isIPv4(bare)) return isLoopbackOrPrivateV4(bare);
  if (net.isIPv6(bare)) return bare === "::1" || /^f[cd]/.test(bare);
  return false;
}

function isLoopbackOrPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** 图片地址要是公网主机上的 https、不带账号与锚点（magpie iconURL）。 */
function checkedIconUrl(raw: string): string | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  const isPlain = url.username === "" && url.password === "" && url.hash === "";
  if (url.protocol !== "https:" || url.hostname === "" || !isPlain) return null;
  return isLocalHost(url.hostname) ? null : url.toString();
}

/** 要找图标的站点：主机带端口，再不带端口，再往上每一级域名到剩两段为止（IP 不往上找）（magpie faviconSites）。 */
export function siteIconSites(baseUrl: string): string[] {
  const trimmed = baseUrl.trim();
  if (!URL.canParse(trimmed) || new URL(trimmed).hostname === "") {
    throw new SiteIconError(
      "site_icon_no_address",
      "Type the endpoint's base URL first: its site's icon is looked for there",
    );
  }
  const url = new URL(trimmed);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isLocalHost(host)) {
    throw new SiteIconError(
      "site_icon_local",
      "The base URL is on this computer or the local network; its icon can't be fetched",
    );
  }
  const sites = [`https://${url.host}`];
  if (url.host !== url.hostname) sites.push(`https://${url.hostname}`);
  if (!net.isIP(host)) {
    const labels = host.split(".");
    for (let index = 1; labels.length - index >= 2; index += 1) {
      sites.push(`https://${labels.slice(index).join(".")}`);
    }
  }
  return sites;
}

/**
 * 找到网站的图标并存下（store 同手选的图片），返回图标值。一个都取不到时抛 site_icon_not_found，写明问过哪些站点与最后的原因。
 */
export async function findSiteIcon(input: {
  baseUrl: string;
  name: string;
  fetchSite: FetchSite;
  store: (bytes: Buffer) => string;
  signal: AbortSignal;
}): Promise<string> {
  const sites = siteIconSites(input.baseUrl);
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(OVERALL_TIMEOUT_MS)]);
  const context = { fetchSite: input.fetchSite, signal };
  let last: string | null = null;
  for (const site of sites) {
    const status = await panelStatus(context, site);
    const pageIcons = await pageIconsOf(context, site);
    const candidates =
      status === null
        ? [...pageIcons, `${site}/favicon.ico`]
        : [
            ...(status.logo ? [status.logo] : []),
            // 面板自己的 favicon 与 logo 每家都一样，不要。
            ...pageIcons.filter((url) => !isPanelOwnIcon(site, url)),
          ];
    for (const candidate of candidates) {
      const outcome = await iconFrom({ ...context, candidate, store: input.store });
      if (outcome.icon !== null) return outcome.icon;
      last = outcome.why ?? last;
    }
    if (status !== null) {
      // 面板自己的图标和别的中转站一模一样，用名称首字画一块。
      const name = input.name.trim() || panelName(status.systemName) || siteLabel(site);
      return input.store(Buffer.from(letterIconSvg(name)));
    }
    if (signal.aborted) break;
  }
  throw new SiteIconError(
    "site_icon_not_found",
    `Couldn't find the site's icon (${sites.join(", ")}): ${last ?? "no icon found"}`,
  );
}

/**
 * 导入链接给的图标图片（照 magpie FetchIcon，用户点了添加才取）：取到并存下，返回图标值；取不到为 null，留着默认图标。
 * 只取公网主机上的 https 图片。
 */
export async function fetchIconPicture(input: {
  url: string;
  fetchSite: FetchSite;
  store: (bytes: Buffer) => string;
  signal: AbortSignal;
}): Promise<string | null> {
  const outcome = await iconFrom({
    fetchSite: input.fetchSite,
    signal: input.signal,
    candidate: input.url,
    store: input.store,
  });
  return outcome.icon;
}

interface FetchContext {
  fetchSite: FetchSite;
  signal: AbortSignal;
}

async function iconFrom(
  input: FetchContext & { candidate: string; store: (bytes: Buffer) => string },
): Promise<{ icon: string | null; why: string | null }> {
  if (input.candidate.startsWith("data:")) {
    const bytes = dataUriBytes(input.candidate.slice("data:".length));
    return { icon: bytes === null ? null : storedOrNull(input.store, bytes), why: null };
  }
  const url = checkedIconUrl(input.candidate);
  if (url === null) return { icon: null, why: `not a public https picture: ${input.candidate}` };
  try {
    const response = await input.fetchSite({
      url,
      accept: "image/*",
      maxBytes: MAX_ICON_BYTES,
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(ICON_TIMEOUT_MS)]),
    });
    if (response.status !== 200) return { icon: null, why: `${url} answered ${response.status}` };
    return { icon: input.store(response.body), why: null };
  } catch (error) {
    return { icon: null, why: error instanceof Error ? error.message : String(error) };
  }
}

function storedOrNull(store: (bytes: Buffer) => string, bytes: Buffer): string | null {
  try {
    return store(bytes);
  } catch {
    // data: 里写的不是认得的图片：换下一个。
    return null;
  }
}

function isPanelOwnIcon(site: string, url: string): boolean {
  const path = url.startsWith(site) ? url.slice(site.length) : null;
  return path === "/favicon.ico" || path === "/logo.png";
}

/** new-api / one-api 面板在 /api/status 里写的名称与 logo（magpie statusLogo）；不是这种面板为 null。 */
async function panelStatus(
  context: FetchContext,
  site: string,
): Promise<{ logo: string | null; systemName: string } | null> {
  const response = await fetchQuietly(context, {
    url: `${site}/api/status`,
    accept: "application/json",
    maxBytes: MAX_STATUS_BYTES,
  });
  if (response === null || response.status !== 200) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch {
    return null;
  }
  const status = parsed as { success?: unknown; data?: { system_name?: unknown; logo?: unknown } };
  const systemName = status.data?.system_name;
  if (status.success !== true || typeof systemName !== "string") return null;
  const rawLogo = typeof status.data?.logo === "string" ? status.data.logo.trim() : "";
  return { logo: rawLogo === "" ? null : resolvedUrl(rawLogo, response.url), systemName };
}

/** 页面或 /api/status 取不到时当作没有：换下一个地方找（magpie 同样不报这一步的错）。 */
async function fetchQuietly(
  context: FetchContext,
  input: { url: string; accept: string; maxBytes: number },
): Promise<SiteResponse | null> {
  try {
    return await context.fetchSite({ ...input, signal: context.signal });
  } catch {
    return null;
  }
}

function resolvedUrl(raw: string, base: string): string | null {
  if (raw.startsWith("data:")) return raw;
  return URL.canParse(raw, base) ? new URL(raw, base).toString() : null;
}

const LINK_TAG = /<link\b[^>]*>/gis;
const TAG_ATTR = /\b(rel|href|sizes|type)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gis;
const HEAD_DONE = /<\/head>|<body\b/i;

/** 首页 <head> 里写的图标，好看的先：SVG，再大一些的 apple-touch-icon，其余按页面顺序（magpie pageIcons）。 */
async function pageIconsOf(context: FetchContext, site: string): Promise<string[]> {
  const response = await fetchQuietly(context, {
    url: `${site}/`,
    accept: "text/html",
    maxBytes: MAX_PAGE_BYTES,
  });
  if (response === null || response.status !== 200) return [];
  let html = response.body.subarray(0, MAX_PAGE_BYTES).toString("utf8");
  const headEnd = html.search(HEAD_DONE);
  if (headEnd !== -1) html = html.slice(0, headEnd);
  const svg: string[] = [];
  const touch: string[] = [];
  const rest: string[] = [];
  for (const [tag] of html.matchAll(LINK_TAG)) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(TAG_ATTR)) {
      attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    const rels = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    const isIcon = rels.includes("icon");
    const isTouch =
      rels.includes("apple-touch-icon") || rels.includes("apple-touch-icon-precomposed");
    const href = resolvedUrl((attrs.get("href") ?? "").trim(), response.url);
    if ((!isIcon && !isTouch) || href === null || href === "") continue;
    const isSvg =
      attrs.get("type") === "image/svg+xml" || href.split("?")[0].toLowerCase().endsWith(".svg");
    if (isSvg) svg.push(href);
    else if (isTouch) touch.push(href);
    else rest.push(href);
  }
  return [...svg, ...touch, ...rest];
}

/** data: 之后的部分解出来的字节；不是 data URI 为 null。 */
function dataUriBytes(text: string): Buffer | null {
  const comma = text.indexOf(",");
  if (comma === -1) return null;
  const meta = text.slice(0, comma);
  const data = text.slice(comma + 1);
  if (meta.toLowerCase().endsWith(";base64")) return Buffer.from(data, "base64");
  try {
    return Buffer.from(decodeURIComponent(data));
  } catch {
    return null;
  }
}

/** 面板自己起的名字；还是面板默认的名字时为空。 */
function panelName(name: string): string {
  const trimmed = name.trim();
  const plain = trimmed.toLowerCase().replaceAll(" ", "");
  return plain === "newapi" || plain === "oneapi" ? "" : trimmed;
}

/** 域名给出的名字：api.relay.com 是 relay。 */
function siteLabel(site: string): string {
  const labels = new URL(site).hostname.split(".");
  return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
}

/**
 * 名称首字画在一块按名称取色的方块上（magpie letterIcon）：中日韩名字一个字，否则头两个词的首字母，一个词取前两个字母。
 */
export function letterIconSvg(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
  const [firstWord = "?", secondWord] = words.length === 0 ? ["?"] : words;
  const first = Array.from(firstWord);
  const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    first[0],
  );
  let mark: string;
  if (isCjk) mark = first[0];
  else if (secondWord !== undefined) mark = (first[0] + Array.from(secondWord)[0]).toUpperCase();
  else if (first.length > 1) mark = first[0].toUpperCase() + first[1].toLowerCase();
  else mark = first[0].toUpperCase();
  const size = Array.from(mark).length === 1 ? 32 : 26;
  const hue = fnv1a32(name) % 360;
  const text = mark.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="hsl(${hue},52%,46%)"/>` +
    `<text x="32" y="32" dy=".35em" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif" font-size="${size}" font-weight="600" fill="#fff">${text}</text></svg>`
  );
}

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * 公网地址（magpie publicIP）：不是回环、私有、链路本地、未指定、组播与几段保留地址；198.18.0.0/15 放过
 * （Clash、Surge 的 fake-ip 把每个名字都答成那里，连接经代理去真正的主机）。
 */
export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !RESERVED_V4.some((range) => inV4Range(ip, range));
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPublicAddress(mapped[1]);
  return !RESERVED_V6.some((pattern) => pattern.test(lower));
}

// 不是公网的 IPv4 段：[起始地址, 前缀长度]。
const RESERVED_V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];

// 未指定、回环、唯一本地（fc00::/7）、链路本地（fe80::/10）、组播与 6to4。
const RESERVED_V6: readonly RegExp[] = [/^::$/, /^::1$/, /^f[cd]/, /^fe[89ab]/, /^ff/, /^2002:/];

function v4Number(ip: string): number {
  return ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function inV4Range(ip: string, [start, prefix]: [string, number]): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(v4Number(ip) / size) === Math.floor(v4Number(start) / size);
}

// Loon 把假的 IPv4 嵌进 fd27:712::/96 当 AAAA 答：有对应的公网 A 记录时丢掉它，别的私有地址照样拒绝（magpie iconIPs）。
function isLoonPairedAddress(address: LookupAddress, all: readonly LookupAddress[]): boolean {
  const match = /^fd27:712::(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(
    address.address,
  );
  if (!match) return false;
  const v4 =
    match[1] ??
    [
      Number.parseInt(match[2], 16) >> 8,
      Number.parseInt(match[2], 16) & 0xff,
      Number.parseInt(match[3], 16) >> 8,
      Number.parseInt(match[3], 16) & 0xff,
    ].join(".");
  return all.some((other) => other.family === 4 && other.address === v4 && isPublicAddress(v4));
}

/** 解析出的地址里能连的：任何一个不是公网的（配对的 Loon 地址除外）都整个拒绝。 */
export function publicAddresses(
  host: string,
  addresses: readonly LookupAddress[],
): LookupAddress[] {
  const allowed: LookupAddress[] = [];
  for (const address of addresses) {
    if (isPublicAddress(address.address)) {
      allowed.push(address);
      continue;
    }
    if (isLoonPairedAddress(address, addresses)) continue;
    throw new Error(`the icon host ${host} resolves to ${address.address}, which is not public`);
  }
  return allowed;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** 连接用的地址解析：判的就是这次解析出的地址，名字不会第一次答公网、第二次答内网（防 DNS 重绑定）。 */
function publicLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    let allowed: LookupAddress[];
    try {
      allowed = publicAddresses(hostname, addresses);
    } catch (rejection) {
      callback(rejection as NodeJS.ErrnoException, []);
      return;
    }
    if (allowed.length === 0) {
      callback(
        Object.assign(new Error(`could not resolve ${hostname}`), { code: "ENOTFOUND" }),
        [],
      );
      return;
    }
    if (options.all) callback(null, allowed);
    else callback(null, allowed[0].address, allowed[0].family);
  });
}

/** 真的取：跟着跳转，每一跳都只连公网地址；User-Agent 写明是 Osuna（有的站拒绝没有名字的请求）。 */
export function createPublicFetchSite(input: { userAgent: string }): FetchSite {
  return async function fetchSite(request) {
    let url = request.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await getOnce({ ...request, url, userAgent: input.userAgent });
      if (response.redirect === null) return { status: response.status, url, body: response.body };
      url = response.redirect;
    }
    throw new Error(`stopped after ${MAX_REDIRECTS} redirects`);
  };
}

function getOnce(input: {
  url: string;
  accept: string;
  maxBytes: number;
  signal: AbortSignal;
  userAgent: string;
}): Promise<{ status: number; redirect: string | null; body: Buffer }> {
  const target = new URL(input.url);
  const client = target.protocol === "https:" ? https : http;
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return Promise.reject(new Error(`not a web address: ${input.url}`));
  }
  return new Promise((resolve, reject) => {
    const request = client.get(
      target,
      {
        headers: { Accept: input.accept, "User-Agent": input.userAgent },
        lookup: publicLookup as unknown as net.LookupFunction,
        signal: input.signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({
            status,
            redirect: new URL(location, target).toString(),
            body: Buffer.alloc(0),
          });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (size > input.maxBytes) return;
          chunks.push(chunk);
          size += chunk.length;
          // 多读一个字节就够判断太大，不把整个回复读进来。
          if (size > input.maxBytes) response.destroy();
        });
        const finish = () =>
          resolve({
            status,
            redirect: null,
            body: Buffer.concat(chunks).subarray(0, input.maxBytes + 1),
          });
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}
