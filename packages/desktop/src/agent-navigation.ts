import { parseAgentDeepLink, type AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import { RendererInbox } from "./window/renderer-inbox.js";

export function parseAgentDeepLinkFromArgv(argv: string[]): AgentDeepLinkTarget | null {
  for (const arg of argv) {
    const target = parseAgentDeepLink(arg);
    if (target) {
      return target;
    }
  }
  return null;
}

export class AgentNavigationInbox extends RendererInbox<AgentDeepLinkTarget> {}
