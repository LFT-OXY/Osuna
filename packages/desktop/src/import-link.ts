import { isApiEndpointImportLink } from "@getpaseo/protocol/api-endpoint/import-link";
import { RendererInbox } from "./window/renderer-inbox.js";

/*
 * 导入链接（`paseo://import?…`，ADR 0013）：主进程只认出它、交给窗口，确认框与解析、拒收在窗口与它所在的主机上。
 * 链接里有 key，主进程不写日志。
 */

export function parseImportLinkFromArgv(argv: string[]): string | null {
  const link = argv.find((arg) => isApiEndpointImportLink(arg));
  return link === undefined ? null : link.trim();
}

/** 窗口的渲染层准备好之前收到的导入链接先存着，准备好时交出最新的一条。 */
export class ImportLinkInbox extends RendererInbox<string> {}
