// 模型清单的合并、等 ChatGPT 3 秒、拿不到时用 Codex 上次的清单、401 与 403 原样回移植自 magpie
// （https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 codexModels、codexModelsWait、modelsEtag）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { Request, Response } from "express";
import type pino from "pino";
import { isErrnoException } from "../../pid-lock.js";
import type { CodexModelEntry } from "../codex-model-catalog.js";
import {
  isAgentsV1Marked,
  markedAgentsV1,
  rememberAgentVersions,
  restoredAgentVersions,
} from "../codex-agent-versions.js";
import {
  codexCachedModels,
  codexModelsCacheEtag,
  readCodexModelsCache,
  withListTag,
} from "../codex-models-cache.js";
import { isRecord, parseJson } from "../upstream-http.js";
import { relayedHeaders, type ChatGptBases } from "./chatgpt-backend.js";

/*
 * 用 ChatGPT 登录的 Codex 的 GET /models（ADR 0010）：先把它的请求原样转给 ChatGPT，最多等 3 秒
 * （Codex 自己整个请求只等 5 秒，过了就用它启动时的清单，接口模型一个都没有）。拿到就用 ChatGPT 的清单；
 * ChatGPT 的 401、403 原样回给 Codex（要它重新登录）；别的失败、超时、连不上，就用 Codex 上次存下的清单里
 * ChatGPT 自己的那些（$CODEX_HOME/models_cache.json）。后面接上开着的接口的已选模型，ETag 带上接口模型的标记。
 */

export const CHATGPT_MODELS_WAIT_MS = 3000;

// 清单最大读这么多（magpie 同样 16 MB）；ChatGPT 的清单实际几十 KB。
const MAX_LIST_BYTES = 16 * 1024 * 1024;
// 接口模型排在 ChatGPT 自带模型之后（magpie：len(own)+100 起）。
const ENDPOINT_PRIORITY_GAP = 100;

/**
 * 接口模型那部分清单：条目（priority 从 1 起）、它的标记、读 Codex 上次清单用的 CODEX_HOME，
 * 「Codex Subagent 可用任意模型」开着没有（ChatGPT 自带模型也标成 V1），以及记 ChatGPT 原来给的多 Agent 版本的文件。
 */
export interface ChatGptModelsListing {
  entries: CodexModelEntry[];
  tag: string;
  codexHome: string;
  marksAgentsV1: boolean;
  agentVersionsPath: string;
}

/** ChatGPT 自带模型原样在前，接口模型排在它们后面。 */
export function mergeChatGptModels<Entry extends { priority: number }>(input: {
  own: unknown[];
  endpoints: Entry[];
}): unknown[] {
  const after = input.own.length + ENDPOINT_PRIORITY_GAP;
  return [
    ...input.own,
    ...input.endpoints.map((entry) => ({ ...entry, priority: after + entry.priority })),
  ];
}

type ChatGptList =
  | { kind: "list"; models: unknown[]; etag: string }
  | { kind: "refused"; status: number; contentType: string | undefined; body: Buffer }
  | { kind: "missing"; why: string };

export async function answerChatGptModels(input: {
  req: Request;
  res: Response;
  bases: ChatGptBases;
  listing: () => ChatGptModelsListing;
  waitMs: number;
  logger: pino.Logger;
}): Promise<void> {
  const { res } = input;
  const asked = await askChatGptModels(input);
  if (res.destroyed) return;
  if (asked.kind === "refused") {
    if (asked.contentType !== undefined) res.setHeader("content-type", asked.contentType);
    res.status(asked.status).end(asked.body);
    return;
  }
  const listing = input.listing();
  let own: unknown[];
  let etag = "";
  if (asked.kind === "list") {
    own = asked.models;
    etag = asked.etag;
  } else {
    input.logger.info({ why: asked.why }, "ChatGPT's model list missing; using Codex's last one");
    own = codexLastOwnModels({ listing, logger: input.logger });
  }
  if (asked.kind === "list") rememberVersions({ listing, models: own, logger: input.logger });
  if (listing.marksAgentsV1) own = markedAgentsV1(own);
  res
    .status(200)
    .set("etag", withListTag(etag, listing.tag))
    .json({ models: mergeChatGptModels({ own, endpoints: listing.entries }) });
}

/**
 * Codex 上次存下的清单里 ChatGPT 自带的那些：那份清单是开关开着时给的，版本换回 ChatGPT 原来给的；
 * 不是的，就是 ChatGPT 给的原样，记下来（magpie CacheEntries）。
 */
function codexLastOwnModels(input: {
  listing: ChatGptModelsListing;
  logger: pino.Logger;
}): unknown[] {
  const { listing } = input;
  const text = readCodexModelsCache(listing.codexHome);
  const own = codexCachedModels(text);
  const filePath = listing.agentVersionsPath;
  if (isAgentsV1Marked(codexModelsCacheEtag(text))) {
    return restoredAgentVersions({ filePath, models: own });
  }
  rememberVersions({ ...input, models: own });
  return own;
}

/** 记下 ChatGPT 给的多 Agent 版本；写不成只记日志，清单照给。 */
function rememberVersions(input: {
  listing: ChatGptModelsListing;
  models: unknown[];
  logger: pino.Logger;
}): void {
  try {
    rememberAgentVersions({ filePath: input.listing.agentVersionsPath, models: input.models });
  } catch (error) {
    // 写不进 $PASEO_HOME 只少了这份记录：关掉开关后缓存顶替时 v1 留着，清单照给。
    if (!isErrnoException(error)) throw error;
    input.logger.warn({ err: error }, "Could not keep ChatGPT's multi-agent versions");
  }
}

function askChatGptModels(input: {
  req: Request;
  bases: ChatGptBases;
  waitMs: number;
}): Promise<ChatGptList> {
  const { url } = input.req;
  const queryAt = url.indexOf("?");
  let query = "";
  if (queryAt !== -1) query = url.slice(queryAt);
  const target = new URL(`${input.bases.chatgpt.replace(/\/+$/, "")}/models${query}`);
  const headers = relayedHeaders(input.req.headers);
  // 要读清单：不要压缩过的回复。
  delete headers["accept-encoding"];
  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.request(target, { method: "GET", headers });
  const answered = new Promise<ChatGptList>((resolve) => {
    upstream.once("response", (reply) => void readList(reply).then(resolve));
    upstream.once("error", (error) => resolve({ kind: "missing", why: error.message }));
  });
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<ChatGptList>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "missing", why: `no answer within ${input.waitMs / 1000}s` }),
      input.waitMs,
    );
  });
  upstream.end();
  return Promise.race([answered, late]).finally(() => {
    clearTimeout(timer);
    // 超时了就不再等；答完了 destroy 也无害。
    upstream.destroy();
  });
}

async function readList(reply: IncomingMessage): Promise<ChatGptList> {
  const body = await readWhole(reply);
  const status = reply.statusCode ?? 502;
  if (body === null)
    return { kind: "missing", why: `the list from ChatGPT was cut off (${status})` };
  if (status === 401 || status === 403) {
    return { kind: "refused", status, contentType: reply.headers["content-type"], body };
  }
  if (status >= 300) return { kind: "missing", why: `ChatGPT answered ${status}` };
  const parsed = parseJson(body.toString("utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    return { kind: "missing", why: "ChatGPT's answer is not a model list" };
  }
  const etag = reply.headers.etag;
  return { kind: "list", models: parsed.models, etag: typeof etag === "string" ? etag : "" };
}

/** 读完整份回复；断了或超过上限为 null。 */
function readWhole(reply: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    reply.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_LIST_BYTES) {
        reply.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    reply.once("end", () => resolve(Buffer.concat(chunks)));
    reply.once("error", () => resolve(null));
    reply.once("aborted", () => resolve(null));
  });
}
