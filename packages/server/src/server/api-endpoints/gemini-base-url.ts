// Gemini 地址的存法移植自 magpie（https://github.com/yetone/magpie，internal/provider/gemini_api.go 的 GeminiBase，7597c132）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

// 整条粘进来的 Gemini 方法地址：…/models/gemini-2.5-pro:streamGenerateContent?alt=sse，或模型清单 …/models。
const GEMINI_METHOD = /\/models(?:\/[^/?#]*)?(?:[?#].*)?$/;

/**
 * Gemini 地址存成的 base（`models/{model}:generateContent` 接在它后面）：去掉首尾空白与末尾 `/`，没写协议补 https://，
 * 整条粘进来的方法地址剪回 base，只有主机时补上 Google 的版本 /v1beta（Gemini 的 SDK 也这样补）；已带路径的不动。
 */
export function geminiBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (url === "") return "";
  if (!url.includes("://")) url = `https://${url}`;
  url = url.replace(GEMINI_METHOD, "").replace(/\/+$/, "");
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  const isBareHost = parsed.host !== "" && parsed.pathname.replace(/\//g, "") === "";
  return isBareHost ? `${url}/v1beta` : url;
}
