// 「本机或局域网」的认法照 magpie（https://github.com/yetone/magpie，internal/provider/importurl.go 的 local，7597c132），
// IP 的判断照 Go 的 net.IP.IsLoopback 与 IsPrivate（IPv4 映射的 IPv6 地址按它的 IPv4 算）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import net from "node:net";

const MAPPED_V4_PREFIX = "::ffff:";

/** 这台电脑或局域网上的主机：localhost、*.local、回环或私有地址（含 IPv4 映射的 IPv6）。主机名可带方括号。 */
export function isLocalHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare.endsWith(".local")) return true;
  if (net.isIPv4(bare)) return isLoopbackOrPrivateV4(bare);
  if (!net.isIPv6(bare)) return false;
  const mapped = mappedV4(bare);
  if (mapped !== null) return isLoopbackOrPrivateV4(mapped);
  return bare === "::1" || /^f[cd]/.test(bare);
}

function isLoopbackOrPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** `::ffff:127.0.0.1` 或 URL 写成的 `::ffff:7f00:1` 里的 IPv4；不是映射地址为 null。 */
function mappedV4(ip: string): string | null {
  if (!ip.startsWith(MAPPED_V4_PREFIX)) return null;
  const tail = ip.slice(MAPPED_V4_PREFIX.length);
  if (net.isIPv4(tail)) return tail;
  const groups = tail.split(":");
  if (groups.length !== 2 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  const [high, low] = groups.map((group) => Number.parseInt(group, 16));
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}
