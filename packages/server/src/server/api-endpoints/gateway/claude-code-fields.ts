// 计费行、自动模式审查 beta 与 advisor 工具的改法移植自 magpie（https://github.com/yetone/magpie，internal/gateway/billing_line.go 的 withoutBillingLine、
// claude_subscription.go 的 billingHeader，automode.go 的 serverReview，advisor.go 的 advisorTools、advisorModel、advisorGoneIn、withoutAdvisor、advisorRefName）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { StoredApiEndpoint } from "../store.js";
import { isRecord } from "../upstream-http.js";
import { isDeferredBlock, withoutKeys } from "./refused-fields.js";
import { listedAs } from "./routing.js";
import { isAnthropicModel } from "./translation/anthropic.js";

/*
 * Claude Code 只对 Anthropic 有用的几处，直通给 Anthropic 地址时按上游模型改：
 * 计费行与自动模式的审查只给 Claude 模型；advisor 服务端工具只在同一家的 Claude 上留着，模型名换成这家的写法。
 */

type Body = Record<string, unknown>;

/** advisor 工具要看的这家接口：标识与已选模型。 */
export type AdvisorEndpoint = Pick<StoredApiEndpoint, "slug" | "models">;

// 只有计费行的 system 块；system 开头的计费行（后面直接接提示词，中间没有换行）。
const BILLING_LINE = /^x-anthropic-billing-header:(\s*[A-Za-z_]+=[^;\s]*;)*\s*$/;
const BILLING_HEADER = /^x-anthropic-billing-header:(\s*[A-Za-z_]+=[^;\s]*;)*\s*/;

// Claude Code 让 API 审查自动模式动作时带的 beta（dangerous-tool-use-2026-09-03）。
const REVIEW_BETA = "dangerous-tool-use-";

const ADVISOR_TOOL = "advisor_";
// Claude Code 写在对话里的 advisor 说明的开头，与关掉 advisor 后它自己说的话。
const ADVISOR_NOTE = "# Advisor Tool\n";
const ADVISOR_GONE =
  "The advisor tool is no longer available; disregard the earlier advisor instructions.";
// Claude Code 给百万窗口的模型名后加的标记。
const ONE_MILLION_MARK = /\[1m\]$/;

/**
 * 去掉 system 里 Claude Code 的计费行：每轮都变（cch），别家模型把它当提示词的开头，前缀缓存每轮从第一个字节就失效
 * （magpie #1600）。只是计费行的块去掉，第一个块或 system 字符串开头的计费行切掉；只剩它时整个 system 去掉。
 * 只是提到它的提示词、消息里的同样文字不动；没有就原样交回同一个对象。
 */
export function withoutBillingLine(body: Body): Body {
  const { system } = body;
  if (typeof system === "string") {
    const cut = system.replace(BILLING_HEADER, "");
    return cut === system ? body : { ...body, system: cut };
  }
  if (!Array.isArray(system)) return body;
  let changed = false;
  const kept = system.flatMap((block, index) => {
    if (!isTextBlock(block)) return [block];
    const { text } = block;
    if (BILLING_LINE.test(text)) {
      changed = true;
      return [];
    }
    if (index > 0) return [block];
    const cut = text.replace(BILLING_HEADER, "");
    if (cut === text) return [block];
    changed = true;
    return [{ ...block, text: cut }];
  });
  if (!changed) return body;
  if (kept.length === 0) return withoutKeys(body, ["system"]);
  return { ...body, system: kept };
}

/**
 * anthropic-beta 去掉自动模式审查的 beta：只有 Claude 会审查，别家看到不认识的 beta 可能整个请求都拒（magpie serverReview）。
 * 没有这个 beta 时原样交回；只剩它时为 null（这个请求头不发）。
 */
export function withoutReviewBeta(value: string | string[]): string | string[] | null {
  const betas = [value]
    .flat()
    .flatMap((line) => line.split(","))
    .map((beta) => beta.trim());
  const named = betas.filter((beta) => beta !== "");
  const kept = named.filter((beta) => !beta.startsWith(REVIEW_BETA));
  if (kept.length === named.length) return value;
  if (kept.length === 0) return null;
  return kept.join(",");
}

/**
 * Claude Code 的 advisor 服务端工具（{"type":"advisor_20260301","name":"advisor","model":…}）按它给自己的模型起名的写法
 * 说 advisor 的模型（Osuna 里是 `接口标识/模型`），哪家都不认，整个请求被拒（magpie advisorTools）。
 * 上游模型是 Claude、advisor 的模型是这家的 Claude 时，模型换成这家的写法；否则去掉这个工具，
 * 连同对话里它的说明与点名它的 tool_addition（withoutAdvisor），一个工具都不剩时 tool_choice 也去掉。
 * 没有要改的就原样交回同一个对象。
 */
export function withAdvisorFitted(input: {
  body: Body;
  model: string;
  endpoint: AdvisorEndpoint;
}): Body {
  const { body, endpoint } = input;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (!tools.some(isAdvisorTool)) return body;
  const claude = isAnthropicModel(input.model);
  const gone = new Set<string>();
  let changed = false;
  const kept = tools.flatMap((tool) => {
    if (!isAdvisorTool(tool)) return [tool];
    const name = advisorModel({ endpoint, model: tool.model });
    const leftOut = !claude || name === null;
    if (leftOut) {
      gone.add(String(tool.name));
      changed = true;
      return [];
    }
    if (name === tool.model) return [tool];
    changed = true;
    return [{ ...tool, model: name }];
  });
  if (!changed) return body;
  let out: Body = { ...body, tools: kept };
  if (kept.length === 0) out = withoutKeys(out, ["tools", "tool_choice"]);
  if (Array.isArray(body.messages)) out.messages = withoutAdvisor(body.messages, gone);
  return out;
}

function isAdvisorTool(tool: unknown): tool is Body {
  return isRecord(tool) && typeof tool.type === "string" && tool.type.startsWith(ADVISOR_TOOL);
}

/**
 * 这家怎么写 advisor 的模型；这家跑不了（别家的、不是 Claude、没选这个模型）为 null。
 * `这家标识/模型` 取这家列出的写法；别的带斜杠的名字说的是别家；不带斜杠的是 Claude 自己的 id，原样用。
 */
function advisorModel(input: { endpoint: AdvisorEndpoint; model: unknown }): string | null {
  const asked = typeof input.model === "string" ? input.model : "";
  const model = asked.trim().replace(ONE_MILLION_MARK, "");
  if (model === "") return null;
  const slash = model.indexOf("/");
  const own = `${input.endpoint.slug}/`;
  let name: string | null = model;
  if (model.startsWith(own)) name = listedAs(input.endpoint, model.slice(own.length));
  else if (slash !== -1) name = null;
  if (name === null || !isAnthropicModel(name)) return null;
  return name;
}

/**
 * 去掉的 advisor 在对话里留下的：点名它的延后加载工具块（只剩它们的消息也去掉），以及它的说明，
 * 改成 Claude Code 关掉 advisor 时自己说的那句。留着的话模型会把 advisor() 当 Agent 的工具调用，
 * Claude Code 回「No such tool available: advisor」。
 */
function withoutAdvisor(messages: unknown[], gone: ReadonlySet<string>): unknown[] {
  if (gone.size === 0) return messages;
  let changed = false;
  const out = messages.flatMap((message) => {
    if (!isRecord(message)) return [message];
    const { content } = message;
    if (typeof content === "string") {
      const said = advisorGoneIn(content);
      if (said === content) return [message];
      changed = true;
      return [{ ...message, content: said }];
    }
    if (!Array.isArray(content)) return [message];
    const kept = content.flatMap((block) => advisorBlockKept({ block, gone }));
    const moved = kept.length !== content.length || kept.some((block, i) => block !== content[i]);
    if (!moved) return [message];
    changed = true;
    // 只说了 advisor 来了或走了的消息整条去掉。
    if (kept.length === 0) return [];
    return [{ ...message, content: kept }];
  });
  return changed ? out : messages;
}

/** 消息里的一块：点名去掉的 advisor 的延后加载工具块不留；文字块里的 advisor 说明换掉；别的原样。 */
function advisorBlockKept(input: { block: unknown; gone: ReadonlySet<string> }): unknown[] {
  const { block } = input;
  const namesGone = isDeferredBlock(block) && input.gone.has(deferredToolName(block));
  if (namesGone) return [];
  if (!isTextBlock(block)) return [block];
  const said = advisorGoneIn(block.text);
  if (said === block.text) return [block];
  return [{ ...block, text: said }];
}

interface TextBlock extends Body {
  type: "text";
  text: string;
}

function isTextBlock(block: unknown): block is TextBlock {
  return isRecord(block) && block.type === "text" && typeof block.text === "string";
}

/** advisor 的说明（到它所在的 system-reminder 结尾，或文字结尾）换成「advisor 已不可用」；没有就原样。 */
function advisorGoneIn(text: string): string {
  const start = text.indexOf(ADVISOR_NOTE);
  if (start < 0) return text;
  const close = text.indexOf("</system-reminder>", start);
  const end = close < 0 ? text.length : close;
  const note = text.slice(start, end);
  const trail = note.slice(note.replace(/[ \t\r\n]+$/, "").length);
  return text.slice(0, start) + ADVISOR_GONE + trail + text.slice(end);
}

/** 延后加载工具块点名的工具：tool_addition、tool_removal 的 tool.name，tool_reference 自己的 name 或 tool_name。 */
function deferredToolName(block: unknown): string {
  if (!isRecord(block)) return "";
  if (isRecord(block.tool)) return String(block.tool.name ?? "");
  if (typeof block.name === "string" && block.name !== "") return block.name;
  return String(block.tool_name ?? "");
}
