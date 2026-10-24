// Gemini 地址的存法与方法路径移植自 magpie（https://github.com/yetone/magpie，internal/provider/gemini_api.go 的 GeminiBase 与 GeminiPath，7597c132）
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

// Go 的 url.PathEscape 不转义而 encodeURIComponent 转义的几个字符，与反过来的几个。
const PATH_SEGMENT_KEPT = /%(?:24|26|2B|3A|3D|40)/g;
const PATH_SEGMENT_ESCAPED = /[!'()*]/g;

/** 模型名放进路径的一段：去掉 `models/` 前缀，照 Go 的 url.PathEscape 转义。 */
function modelSegment(model: string): string {
  const bare = model.startsWith("models/") ? model.slice("models/".length) : model;
  return encodeURIComponent(bare)
    .replace(PATH_SEGMENT_KEPT, (escaped) => decodeURIComponent(escaped))
    .replace(PATH_SEGMENT_ESCAPED, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 接在 Gemini base 后面问这个模型的路径：流式是 SSE（alt=sse），否则是一份 JSON。 */
export function geminiPath(input: { model: string; stream: boolean }): string {
  const segment = modelSegment(input.model);
  return input.stream
    ? `/models/${segment}:streamGenerateContent?alt=sse`
    : `/models/${segment}:generateContent`;
}
