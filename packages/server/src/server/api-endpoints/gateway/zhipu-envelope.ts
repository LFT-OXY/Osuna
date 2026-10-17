// 智谱包在 200 里的拒绝移植自 magpie（https://github.com/yetone/magpie，internal/provider/zhipu_envelope.go 的 zhipuCodeStatus、zhipuEnvelope、ZhipuEnveloped，
// zhipu_coding.go 的 zhipuHost）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import { isRecord, parseJson } from "../upstream-http.js";

/*
 * 智谱与 Z.ai 的 /api/v1（GLM Coding Plan 的 Responses 接口）拒绝时回 200，包在平台自己的信封里：
 * {"code":1000,"msg":"身份验证失败。","success":false}；同一把 key 它们的 OpenAI、Anthropic 地址回的是 401。
 * 原样收下，被拒的 key 也像答了话，CLI 拿到的是这个信封。按智谱的错误码表（docs.bigmodel.cn/cn/faq/api-code）
 * 读成它代表的状态码，错误体写成 OpenAI 的样子，判错与冷却照常走。流、压缩过的与别家的回复不动。
 */

const ZHIPU_HOSTS = new Set(["open.bigmodel.cn", "api.z.ai"]);
// 拒绝很短：比这长的是回复。
const MAX_ENVELOPE_BYTES = 64 * 1024;

/** 信封读成的上游失败：状态码与 OpenAI 写法的错误体。 */
export interface ZhipuRefusal {
  status: number;
  text: string;
}

/** 智谱或 Z.ai 的 2xx 整份回复是平台的拒绝信封时，它代表的失败；别的回复为 null。 */
export function zhipuRefusal(input: {
  host: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}): ZhipuRefusal | null {
  if (!ZHIPU_HOSTS.has(input.host.toLowerCase())) return null;
  const contentType = String(input.headers["content-type"] ?? "").toLowerCase();
  const plainJson = contentType.includes("json") && !contentType.includes("event-stream");
  const compressed = (input.headers["content-encoding"] ?? "") !== "";
  if (!plainJson || compressed || input.body.length > MAX_ENVELOPE_BYTES) return null;
  const envelope = zhipuEnvelope(parseJson(input.body.toString("utf8")));
  if (envelope === null) return null;
  const message = envelope.message || "request failed";
  const error: Record<string, string> = { message };
  if (envelope.code !== 0) error.code = String(envelope.code);
  const status = zhipuCodeStatus(envelope.code);
  return { status, text: JSON.stringify({ error }) };
}

interface ZhipuEnvelope {
  code: number;
  message: string;
}

/** 平台的拒绝：`success` 是 false，带错误码或说明。 */
function zhipuEnvelope(body: unknown): ZhipuEnvelope | null {
  if (!isRecord(body) || body.success !== false) return null;
  const parsed = Number.parseInt(String(body.code ?? ""), 10);
  const known = { code: 0, message: "" };
  if (!Number.isNaN(parsed)) known.code = parsed;
  if (typeof body.msg === "string") known.message = body.msg.trim();
  const saysWhy = known.code !== 0 || known.message !== "";
  return saysWhy ? known : null;
}

/** 智谱业务错误码对应的 HTTP 状态；表里没有的，或平台自己的 500，算 502。 */
function zhipuCodeStatus(code: number): number {
  const keyRefused = code >= 1000 && code <= 1005;
  const limited = code === 1113 || (code >= 1302 && code <= 1399);
  const badRequest = (code >= 1210 && code <= 1229) || code === 1261 || code === 1301;
  if (keyRefused) return 401;
  if (limited) return 429;
  if (code === 1220) return 403;
  if (badRequest) return 400;
  return 502;
}
