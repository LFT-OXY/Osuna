// 导入链接的认法照 magpie（https://github.com/yetone/magpie，internal/provider/importurl.go 的 ParseImport 开头，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 导入链接（ADR 0013）：`paseo://import?...`，沿用桌面端已注册的 paseo 链接类型（ADR 0002）。
 * 这里只认「是不是导入链接」：桌面端主进程据此交给窗口，daemon 解析前也先认它。字段与拒收规则在 daemon。
 */

const IMPORT_LINK_SCHEME = "paseo";

/** `paseo://import?…`，以及 magpie 也认的 `paseo:import?…`、`paseo:///import?…`、`paseo://import/?…`。 */
export function isApiEndpointImportLink(input: string): boolean {
  return importLinkAction(input) === "import";
}

/** 链接说要做什么（magpie 的 action）：不是 paseo 链接为 null。 */
export function importLinkAction(input: string): string | null {
  const text = input.trim();
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol.toLowerCase() !== `${IMPORT_LINK_SCHEME}:`) return null;
  if (url.host !== "") return url.host.toLowerCase();
  return url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
}
