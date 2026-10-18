// 「Codex Subagent 可用任意模型」时把 ChatGPT 自带模型标成 V1、记下 ChatGPT 原来给的版本并在读回缓存时放回，
// 移植自 magpie（https://github.com/yetone/magpie，internal/codexcat/codexcat.go 的 Stamp、unstamp、Remember、originals、
// PolicyTag、MarkedV1 与 CacheEntries）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { z } from "zod";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { readOptionalFile } from "./config-file.js";
import { AGENTS_V1 } from "./codex-model-catalog.js";
import { isRecord, parseJson } from "./upstream-http.js";

/*
 * 开关开着时，中转站给 Codex 的清单里 ChatGPT 自带模型也写 multi_agent_version = "v1"：GPT 主对话的 Subagent 拿到明文任务，
 * 才能跑在接口模型上。Codex 把这份清单原样存进 models_cache.json，所以 ChatGPT 自己给的版本另记一份
 * （每个 slug 一个，没写为空串），拿不到 ChatGPT 的清单、改用缓存时按它放回，关掉开关后缓存里的 v1 不会留下来。
 * 带标记的清单 ETag 里的标记以 `v1.` 开头，开关一换标记就变，Codex 会重拉。
 */

const V1_MARK = "v1.";
const TAG_MARK = "+osuna-";

const AgentVersionsSchema = z.record(z.string(), z.string());

/** 开关开着时清单标记前加 `v1.`（magpie PolicyTag）。 */
export function agentsV1Tag(tag: string): string {
  return `${V1_MARK}${tag}`;
}

/** 这份 ETag 是开关开着时给出的清单（magpie MarkedV1）。 */
export function isAgentsV1Marked(etag: string): boolean {
  return etag.includes(`${TAG_MARK}${V1_MARK}`);
}

/** 每个条目都写 multi_agent_version = "v1"，别的不变。 */
export function markedAgentsV1(models: unknown[]): unknown[] {
  return models.map((model) => (isRecord(model) ? { ...model, ...AGENTS_V1 } : model));
}

/** 记下 ChatGPT 给的版本：这次有的 slug 换成这次的，其余留着；内容没变不写。 */
export function rememberAgentVersions(input: { filePath: string; models: unknown[] }): void {
  const was = readAgentVersions(input.filePath);
  const next = { ...was };
  for (const model of input.models) {
    if (!isRecord(model) || typeof model.slug !== "string" || model.slug === "") continue;
    next[model.slug] = versionOf(model);
  }
  if (JSON.stringify(next) === JSON.stringify(was)) return;
  writePrivateFileAtomicSync(input.filePath, `${JSON.stringify(next, null, 2)}\n`);
}

/** 缓存里被 Osuna 标过的版本换回 ChatGPT 给的（没写过的拿掉）；没记过的 slug 不动。 */
export function restoredAgentVersions(input: { filePath: string; models: unknown[] }): unknown[] {
  const was = readAgentVersions(input.filePath);
  return input.models.map((model) => {
    if (!isRecord(model) || typeof model.slug !== "string") return model;
    const original = was[model.slug];
    if (original === undefined) return model;
    const { multi_agent_version: _stamped, ...rest } = model;
    if (original === "") return rest;
    return { ...rest, multi_agent_version: original };
  });
}

function versionOf(model: Record<string, unknown>): string {
  const version = model.multi_agent_version;
  return typeof version === "string" ? version : "";
}

/** 读不到或读不懂当作什么都没记。 */
function readAgentVersions(filePath: string): Record<string, string> {
  const text = readOptionalFile(filePath)?.toString("utf8") ?? null;
  if (text === null) return {};
  const parsed = AgentVersionsSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : {};
}
