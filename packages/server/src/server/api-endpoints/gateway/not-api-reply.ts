// 不是模型接口回复的 2xx 的认法移植自 magpie（https://github.com/yetone/magpie，internal/gateway/notapi.go 的 notAnAPIReply、webPage、htmlStart、pageTitle，
// internal/provider/test.go 的 BlockedHint）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import { contentTypeOf, isCompressed } from "../upstream-http.js";
import { FAILURE_WORDS } from "./failure.js";

/*
 * 2xx 却不可能是模型接口的回复：网页（登录页、Cloudflare 的挑战页、中转服务自己的错误页，用 200 text/html 回）、
 * 空的、说是 JSON 却不以 JSON 开头。当作回复交出去，CLI 会拿到一张网页（magpie #1012：Codex 报
 * 「stream closed before response.completed」），日志里却是一次什么都没说的成功。按 502 算，和开口前的
 * 别的失败一样换家、冷却，日志写明为什么。只看回复开头的字节；压缩过的不看。
 */

/** 不是接口回复的哪一种：网页、什么都没有、不是 JSON 的「JSON」。 */
export type NotApiReply = "page" | "empty" | "not_json";

const HTML_START = /^<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i;
const PAGE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
// 网页标题与「不是 JSON」的原文最多留这么多字（magpie 的 clipRunes）。
const TITLE_MOST = 120;
const NOT_JSON_MOST = 200;
// 被厂商的边缘防火墙挡住时怎么办（magpie 的 BlockedHint）。
const BLOCKED_HINT =
  "the provider's network firewall blocked requests from this IP; wait a while, or switch to another network or proxy";

/** 回复开头（`head`，收完时一个字节都没有就是空的）说它不是接口回复的哪一种；是回复，或压缩过看不出，为 null。 */
export function notApiReply(input: {
  headers: IncomingHttpHeaders;
  head: Buffer;
}): NotApiReply | null {
  const contentType = contentTypeOf(input.headers);
  if (contentType.startsWith("text/html")) return "page";
  if (input.head.length === 0) return "empty";
  if (isCompressed(input.headers)) return null;
  const start = startOf(input.head);
  const isPage = HTML_START.test(start) && !contentType.includes("xml");
  if (isPage) return "page";
  const saysJson = contentType.includes("json");
  const startsAsJson = start === "" || start.startsWith("{") || start.startsWith("[");
  if (saysJson && !startsAsJson) return "not_json";
  return null;
}

/** 回复到目前为止只有空白（或什么都没有）：还看不出它是什么，要等后面的字节。 */
export function saysNothingYet(head: Buffer): boolean {
  return startOf(head) === "";
}

/** 去掉开头空白与 BOM 的回复原文。 */
function startOf(head: Buffer): string {
  return head.toString("utf8").replace(/^[ \t\r\n\uFEFF]+/, "");
}

/** 给 Agent 与日志看的说法：上游回了什么（状态行如 `200 OK`），网页带标题，防火墙的拦截页说怎么办。 */
export function notApiDetail(input: {
  kind: NotApiReply;
  statusLine: string;
  headers: IncomingHttpHeaders;
  // 回复的原文（读到的那些）。
  text: string;
}): string {
  const answered = `answered ${input.statusLine}`;
  switch (input.kind) {
    case "empty":
      return `${answered} with nothing in it, not an API reply`;
    case "not_json": {
      const quoted = clip(input.text.trim(), NOT_JSON_MOST);
      return `${answered} with a reply that isn't JSON, not an API reply: ${quoted}`;
    }
    case "page":
      return webPage({ answered, headers: input.headers, text: input.text });
  }
}

function webPage(input: { answered: string; headers: IncomingHttpHeaders; text: string }): string {
  const [baseType = ""] = contentTypeOf(input.headers).split(";");
  const shownType = baseType.trim() || "no Content-Type";
  let why = `${input.answered} with a web page (${shownType}), not an API reply`;
  const title = clip(pageTitle(input.text), TITLE_MOST);
  if (title !== "") why += `: “${title}”`;
  if (FAILURE_WORDS.blocked.test(input.text)) why += ` — ${BLOCKED_HINT}`;
  return why;
}

/** 网页的标题：解开实体、空白并成一个空格；没有为空。 */
function pageTitle(text: string): string {
  const match = PAGE_TITLE.exec(text);
  if (!match?.[1]) return "";
  return unescapeHtml(match[1]).split(/\s+/).filter(Boolean).join(" ");
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return HTML_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** 最多留 `most` 个字，多的换成省略号。 */
function clip(text: string, most: number): string {
  const chars = [...text];
  if (chars.length <= most) return text;
  return `${chars.slice(0, most).join("")}…`;
}
