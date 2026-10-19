// 「别的地址也能通到中转站」的判断移植自 magpie（https://github.com/yetone/magpie，internal/agent/reach.go 的
// proxyBase / loopbackWithPath / reachesMagpie / magpieProbe / probedNow，zcode.go 的 onAnotherMachine）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isIP } from "node:net";

/*
 * 配置里写的地址不是中转站自己的，也可能是一条通到它的路：另一台机器或域名上的反向代理，
 * 或本机回环上带自己路径的代理（如合规代理的 http://127.0.0.1:8788/<route>）。问它的根路径，
 * 答出中转站的自我介绍（{"name":"osuna"}）就算通到中转站。答案记 20 秒。
 */

export const GATEWAY_INFO_NAME = "osuna";
const PROBE_TIMEOUT_MS = 3_000;
const ANSWER_MAX_AGE_MS = 20_000;

/** 问 base 的根路径是不是中转站；生产发 HTTP，测试可换。 */
export type ProbeGatewayAt = (base: string) => Promise<boolean>;

/** 生产用的问法；userAgent 是 Osuna 自己的身份（Osuna/<daemon 版本>）：这是 daemon 主动发出的请求。 */
export function createGatewayProbe(input: { userAgent: string }): ProbeGatewayAt {
  return (base) => probeGatewayAt({ base, userAgent: input.userAgent });
}

async function probeGatewayAt(input: { base: string; userAgent: string }): Promise<boolean> {
  try {
    const response = await fetch(`${input.base.replace(/\/+$/, "")}/`, {
      headers: { "user-agent": input.userAgent },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status !== 200) return false;
    const info: unknown = await response.json();
    return isRecord(info) && info.name === GATEWAY_INFO_NAME;
  } catch {
    // 连不上、超时、答的不是 JSON：都不是中转站。
    return false;
  }
}

/**
 * 地址 value 能不能当作通到中转站 gateway 的另一条路：http(s)、不带账号、查询与片段，
 * 且在另一台机器上，或在本机回环上带着中转站路径以外的自己的路径。本机回环上的中转站路径是
 * 换了端口的中转站自己，不算。
 */
export function proxyBase(input: { value: string; gateway: string }): string | null {
  const base = input.value.trim().replace(/\/+$/, "");
  const parsed = parseHttpUrl(base);
  const gateway = parseHttpUrl(input.gateway);
  if (!parsed || !gateway) return null;
  const hasExtras = parsed.username !== "" || parsed.search !== "" || parsed.hash !== "";
  if (hasExtras) return null;
  const ownPath = parsed.pathname.replace(/\/+$/, "");
  const isGatewayPath = ownPath === gateway.pathname.replace(/\/+$/, "");
  const isLoopbackWithPath = !isOnAnotherMachine(parsed) && ownPath !== "" && !isGatewayPath;
  return isOnAnotherMachine(parsed) || isLoopbackWithPath ? base : null;
}

interface ProbeAnswer {
  at: number;
  ok: boolean;
}

/** 等着问：20 秒内问过就用上次的答案（magpie 的 probedNow）。 */
export function createGatewayReach(input: {
  probe: ProbeGatewayAt;
  now?: () => number;
}): (base: string) => Promise<boolean> {
  const now = input.now ?? Date.now;
  const answers = new Map<string, ProbeAnswer>();
  return async (base) => {
    const last = answers.get(base);
    if (last && now() - last.at <= ANSWER_MAX_AGE_MS) return last.ok;
    const ok = await input.probe(base);
    answers.set(base, { at: now(), ok });
    return ok;
  };
}

function parseHttpUrl(value: string): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  return isHttp && url.hostname !== "" ? url : null;
}

/** 不是 localhost、不是回环或未指定地址。 */
function isOnAnotherMachine(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost") return false;
  if (isIP(host) === 0) return true;
  const isLoopback = host.startsWith("127.") || host === "::1" || host.startsWith("::ffff:127.");
  const isUnspecified = host === "0.0.0.0" || host === "::";
  return !isLoopback && !isUnspecified;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
