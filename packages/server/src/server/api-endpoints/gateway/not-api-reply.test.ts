// 用例照 magpie（https://github.com/yetone/magpie，internal/gateway/notapi_test.go 的 TestNotAnAPIReplyFailsOver、TestAPIReplyUntouched 与 cloudflarePage）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import { notApiDetail, notApiReply, saysNothingYet } from "./not-api-reply.js";

const CLOUDFLARE_PAGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body><div class="main-wrapper" role="main"><div class="main-content"><noscript>Enable JavaScript and cookies to continue</noscript></div></div></body></html>`;

describe("a 2xx that is no API reply", () => {
  test.each([
    { name: "html", type: "text/html; charset=utf-8", body: CLOUDFLARE_PAGE, kind: "page" },
    { name: "html as json", type: "application/json", body: CLOUDFLARE_PAGE, kind: "page" },
    { name: "html as sse", type: "text/event-stream", body: `\n${CLOUDFLARE_PAGE}`, kind: "page" },
    { name: "empty", type: "application/json", body: "", kind: "empty" },
    { name: "empty sse", type: "text/event-stream", body: "", kind: "empty" },
    {
      name: "not json",
      type: "application/json",
      body: "upstream connect error or disconnect/reset before headers",
      kind: "not_json",
    },
  ])("$name is read as $kind", ({ type, body, kind }) => {
    expect(notApiReply({ headers: { "content-type": type }, head: Buffer.from(body) })).toBe(kind);
  });

  test.each([
    { type: "application/json", encoding: undefined, body: '\n  {"ok":true}' },
    { type: "text/event-stream", encoding: undefined, body: "data: {}\n\n" },
    { type: undefined, encoding: undefined, body: "data: {}\n\n" },
    { type: "text/plain", encoding: undefined, body: "event: x\ndata: {}\n\n" },
    { type: "application/json", encoding: "gzip", body: "\x1f\x8b\x08" },
    { type: "application/xml", encoding: undefined, body: '<?xml version="1.0"?><a/>' },
  ])("what an API does answer is left alone: $type $body", ({ type, encoding, body }) => {
    const headers = { "content-type": type, "content-encoding": encoding };
    expect(notApiReply({ headers, head: Buffer.from(body) })).toBeNull();
  });

  test("blank lines and a BOM say nothing yet; the first other byte does", () => {
    expect(saysNothingYet(Buffer.from(" \r\n\t\uFEFF"))).toBe(true);
    expect(saysNothingYet(Buffer.from("\n<"))).toBe(false);
  });

  test("a page is told by its title, its entities read and its spaces joined", () => {
    const detail = notApiDetail({
      kind: "page",
      statusLine: "200 OK",
      headers: { "content-type": "text/html; charset=utf-8" },
      text: "<html><head><title>\n  Sign in &amp;\n  continue </title></head></html>",
    });

    expect(detail).toBe(
      "answered 200 OK with a web page (text/html), not an API reply: “Sign in & continue”",
    );
  });

  test("a firewall's block page says what to do about it", () => {
    const detail = notApiDetail({
      kind: "page",
      statusLine: "200 OK",
      headers: {},
      text: "<html><body>Your request has been blocked. errors.aliyun.com</body></html>",
    });

    expect(detail).toBe(
      "answered 200 OK with a web page (no Content-Type), not an API reply — the provider's network firewall blocked requests from this IP; wait a while, or switch to another network or proxy",
    );
  });

  test("a reply that isn't JSON is quoted, cut at 200 characters", () => {
    const detail = notApiDetail({
      kind: "not_json",
      statusLine: "200 OK",
      headers: { "content-type": "application/json" },
      text: ` ${"x".repeat(250)} `,
    });

    expect(detail).toBe(
      `answered 200 OK with a reply that isn't JSON, not an API reply: ${"x".repeat(200)}…`,
    );
  });
});
