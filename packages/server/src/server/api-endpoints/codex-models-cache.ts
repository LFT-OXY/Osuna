// ETag 里的清单标记、读 Codex 模型缓存时去掉接口模型、把缓存标成过期移植自 magpie（https://github.com/yetone/magpie，
// internal/codexcat/codexcat.go 的 Tag、WithTag、Tagged、CacheEntries，internal/catalog/catalog.go 的 MagpieAdded，
// internal/agent/codex.go 的 codexStaleCache）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash } from "node:crypto";
import path from "node:path";
import { readOptionalFile, writeConfigFileGuarded } from "./config-file.js";
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
  const cache = text === null ? null : parseJson(text);
  if (!isRecord(cache) || !Array.isArray(cache.models)) return [];
  const etag = typeof cache.etag === "string" ? cache.etag : "";
  const isTagged = etag.includes(TAG_MARK);
  return cache.models.filter((model) => {
    const slug = isRecord(model) && typeof model.slug === "string" ? model.slug : "";
    return !(isTagged && slug.includes("/"));
  });
}

/** 缓存的标记不是现在的、又还没标过期时，返回 fetched_at 改成 1970 年后的内容；不用改为 null。 */
export function staleModelsCache(text: string, tag: string): string | null {
  const cache = parseJson(text);
  if (!isRecord(cache)) return null;
  const etag = typeof cache.etag === "string" ? cache.etag : "";
  if (isListTagged(etag, tag) || cache.fetched_at === AGED) return null;
  return `${JSON.stringify({ ...cache, fetched_at: AGED }, null, 2)}\n`;
}

/** 只动传进来的这个 CODEX_HOME 里的缓存；没有缓存不新建。 */
export function markCodexModelsCacheStale(input: { codexHome: string; tag: string }): void {
  const filePath = path.join(input.codexHome, CODEX_MODELS_CACHE_FILE);
  writeConfigFileGuarded({
    filePath,
    compute: (current) => {
      const aged = current === null ? null : staleModelsCache(current.toString("utf8"), input.tag);
      return {
        change: aged === null ? { kind: "keep" } : { kind: "write", text: aged },
        value: null,
      };
    },
    commit: () => {},
    rollback: () => {},
  });
}

/** 读这个 CODEX_HOME 里的缓存；没有为 null。 */
export function readCodexModelsCache(codexHome: string): string | null {
  return readOptionalFile(path.join(codexHome, CODEX_MODELS_CACHE_FILE))?.toString("utf8") ?? null;
}
