// 消息里带的工具提升到请求的 tools 移植自 magpie（https://github.com/yetone/magpie，internal/gateway/message_tools.go 的
// liftMessageTools、chatToolKey，与 anthropic_shapes.go 的 emptyContent）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { applyEdits, modify } from "jsonc-parser";
import { isRecord, parseJson } from "../upstream-http.js";

/*
 * Pi 打开 supportsMidConvoToolAdditions 后，对话中途加的工具放在一条自己的消息里，不进请求的 tools
 * （magpie #2322）：{"role":"system","tools":[…]}。没有哪家 Chat 接口读那里的工具（OpenAI 还会拒收没内容的
 * system 消息），所以 Chat 请求一进中转站就把它们并进请求的 tools，每个名字只留第一次给的定义。
 */

/**
 * 消息带的工具并进请求的 tools；只带工具、没有内容的 system / developer 消息丢掉，有内容的留在原处、去掉工具。
 * 没有消息带工具、或读不懂的请求原样。
 */
export function liftMessageTools(text: string): string {
  if (!text.includes('"tools"')) return text;
  const body = parseJson(text);
  if (!isRecord(body) || !Array.isArray(body.messages)) return text;
  const carriesTools = body.messages.some((message) => isRecord(message) && "tools" in message);
  if (!carriesTools) return text;
  const tools = Array.isArray(body.tools) ? [...body.tools] : [];
  const have = new Set(tools.map(chatToolKey));
  const messages: unknown[] = [];
  for (const message of body.messages) {
    if (!isRecord(message) || !("tools" in message)) {
      messages.push(message);
      continue;
    }
    const more = Array.isArray(message.tools) ? message.tools : [];
    for (const tool of more) {
      if (!isRecord(tool)) continue;
      const key = chatToolKey(tool);
      if (have.has(key)) continue;
      have.add(key);
      tools.push(tool);
    }
    const isInstruction = message.role === "system" || message.role === "developer";
    if (isInstruction && emptyContent(message.content)) continue;
    const kept = { ...message };
    delete kept.tools;
    messages.push(kept);
  }
  let out = applyEdits(text, modify(text, ["messages"], messages, {}));
  if (tools.length > 0) out = applyEdits(out, modify(out, ["tools"], tools, {}));
  return out;
}

/** Chat 工具的名字；没有名字的托管工具按类型。 */
function chatToolKey(tool: unknown): string {
  if (!isRecord(tool)) return "#";
  const fn = isRecord(tool.function) ? tool.function : {};
  if (typeof fn.name === "string" && fn.name !== "") return fn.name;
  if (typeof tool.name === "string" && tool.name !== "") return tool.name;
  return `#${typeof tool.type === "string" ? tool.type : ""}`;
}

/** 没有内容：没写、null、空字符串，或只有空文字的数组。 */
function emptyContent(content: unknown): boolean {
  if (content === undefined || content === null) return true;
  if (typeof content === "string") return content === "";
  if (Array.isArray(content)) {
    return content.every((part) => isRecord(part) && part.type === "text" && part.text === "");
  }
  return false;
}
