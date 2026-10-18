// ETag 里的清单标记、读 Codex 模型缓存时去掉接口模型、把缓存标成过期移植自 magpie（https://github.com/yetone/magpie，
// internal/codexcat/codexcat.go 的 Tag、WithTag、Tagged、CacheEntries，internal/catalog/catalog.go 的 MagpieAdded，
// internal/agent/codex.go 的 codexStaleCache）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash } from "node:crypto";
import path from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import {
  readOptionalFile,
  writeConfigFileGuarded,
  type ConfigFileChange,
  type GuardedConfigWriteResult,
} from "./config-file.js";
import { isRecord, parseJson } from "./upstream-http.js";

/*
 * 用 ChatGPT 登录的 Codex 把中转站给它的模型清单连同 ETag 存在 $CODEX_HOME/models_cache.json，
 * 缓存满几分钟、或某次回复的 X-Models-Etag 与它不同时才重拉。中转站给的 ETag 是 ChatGPT 的 ETag 加上
 * 接口模型那部分的标记（`+osuna-<tag>`），接口模型变了，标记跟着变，Codex 就会重拉。
 * 打开开关、默认模型或接口的已选模型变了时，缓存里的标记不是现在的就把 fetched_at 改成 1970 年，
 * 下一个启动的 Codex 马上重拉；缓存的其余部分照 Codex 写的留着。
 */

export const CODEX_MODELS_CACHE_FILE = "models_cache.json";

const TAG_MARK = "+osuna-";
const AGED = "1970-01-01T00:00:00Z";

/** 接口模型那部分清单的标记：内容不同，标记就不同（magpie Tag）。 */
export function codexListTag(list: unknown): string {
  return createHash("sha256").update(JSON.stringify(list)).digest("hex").slice(0, 12);
}

/** ChatGPT 的 ETag（或空）带上标记：W/"abc" 变成 W/"abc+osuna-<tag>"。 */
export function withListTag(etag: string, tag: string): string {
  if (etag.length > 1 && etag.endsWith('"')) return `${etag.slice(0, -1)}${TAG_MARK}${tag}"`;
  return `${etag}${TAG_MARK}${tag}`;
}

export function isListTagged(etag: string, tag: string): boolean {
  return etag.includes(`${TAG_MARK}${tag}`);
}

/**
 * 缓存里 ChatGPT 自己的模型：Codex 存的是上次拿到的整份清单，带标记的清单里斜杠名字是 Osuna 加的接口模型
 * （ChatGPT 的 slug 从不带斜杠），去掉。没有缓存或读不懂时为空。
 */
export function codexCachedModels(text: string | null): unknown[] {
  if (text === null) return [];
  const cache = parseJson(text);
  if (!isRecord(cache) || !Array.isArray(cache.models)) return [];
  const isTagged = etagOf(cache).includes(TAG_MARK);
  return cache.models.filter((model) => {
    const isOsunaAdded = isTagged && slugOf(model).includes("/");
    return !isOsunaAdded;
  });
}

function etagOf(cache: Record<string, unknown>): string {
  return typeof cache.etag === "string" ? cache.etag : "";
}

function slugOf(model: unknown): string {
  if (isRecord(model) && typeof model.slug === "string") return model.slug;
  return "";
}

/**
 * 缓存的标记不是现在的、又还没标过期时，返回只把 fetched_at 改成 1970 年后的内容（其余逐字节不变，
 * Codex 自己写的格式留着）；不用改为 null。
 */
export function staleModelsCache(text: string, tag: string): string | null {
  const cache = parseJson(text);
  if (!isRecord(cache)) return null;
  const isCurrent = isListTagged(etagOf(cache), tag);
  const isAged = cache.fetched_at === AGED;
  if (isCurrent || isAged) return null;
  return applyEdits(text, modify(text, ["fetched_at"], AGED, {}));
}

export type CodexModelsCacheMark = GuardedConfigWriteResult<null>;

/**
 * 只动传进来的这个 CODEX_HOME 里的缓存；没有缓存不新建。Codex 同时在写它、三次都没写成时返回 conflict，
 * 由调用方决定怎么报。
 */
export function markCodexModelsCacheStale(input: {
  codexHome: string;
  tag: string;
}): CodexModelsCacheMark {
  const filePath = path.join(input.codexHome, CODEX_MODELS_CACHE_FILE);
  return writeConfigFileGuarded({
    filePath,
    compute: (current) => ({ change: staleChange({ current, tag: input.tag }), value: null }),
    commit: () => {},
    rollback: () => {},
  });
}

function staleChange(input: { current: Buffer | null; tag: string }): ConfigFileChange {
  if (input.current === null) return { kind: "keep" };
  const aged = staleModelsCache(input.current.toString("utf8"), input.tag);
  if (aged === null) return { kind: "keep" };
  return { kind: "write", text: aged };
}

/** 读这个 CODEX_HOME 里的缓存；没有为 null。 */
export function readCodexModelsCache(codexHome: string): string | null {
  return readOptionalFile(path.join(codexHome, CODEX_MODELS_CACHE_FILE))?.toString("utf8") ?? null;
}
