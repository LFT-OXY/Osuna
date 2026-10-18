import type pino from "pino";
import { z } from "zod";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { REAL_PRICING_TIMERS, type UsagePricingTimers } from "../usage/pricing/service.js";
import { readOptionalFile } from "./config-file.js";
import {
  indexModelsDev,
  indexSamplingByHost,
  lookupModelFacts,
  ModelFactsSchema,
  samplingFor,
  type ModelFacts,
  type ModelsDevIndex,
  type SamplingByHost,
} from "./model-facts.js";
import { isRecord, parseJson } from "./upstream-http.js";

/*
 * models.dev 的公开模型资料（上下文、回复上限、思考档位、能否看图），给 Claude Code 的模型提示与 Codex 的模型目录用。
 * 只在 Claude Code 或 Codex 的总开关开着、价格表自动更新也开着时才下载（isAllowed）；规则见 docs/usage.md 的对外请求一节。
 * 下载后只留查询要用的几项，存到 api-endpoints/models-dev.json；不随安装包带快照。
 * 中转站另外按服务商的主机名查它自己说的收不收 temperature 与 top_p（sampling）。
 */

export const MODELS_DEV_URL = "https://models.dev/api.json";

const FETCH_TIMEOUT_MS = 15_000;
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;

const CacheFileSchema = z.object({
  fetchedAt: z.string(),
  etag: z.string().nullable(),
  models: z.record(z.string(), ModelFactsSchema),
  // 旧缓存没有；下次下载补上。
  sampling: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  // Claude Code 自己的模型，新发布的在前（claudeCodeOwnModels）；旧缓存没有，下次下载补上。
  claude: z.array(z.string()).optional(),
});
type CacheFile = z.infer<typeof CacheFileSchema>;

export interface ModelsDevCatalogOptions {
  filePath: string;
  logger: pino.Logger;
  now?: () => number;
  // 每次检查前问一次：不许就不发请求，一小时后再问。
  isAllowed: () => boolean;
  // 资料内容变了（不含 304）之后调用。
  onUpdated: () => void;
  fetch?: typeof globalThis.fetch;
  // 和价格表同一种可替换的 setTimeout。
  timers?: UsagePricingTimers;
}

export class ModelsDevCatalog {
  private readonly filePath: string;
  private readonly logger: pino.Logger;
  private readonly now: () => number;
  private readonly isAllowed: () => boolean;
  private readonly onUpdated: () => void;
  private readonly fetchApi: typeof globalThis.fetch;
  private readonly timers: UsagePricingTimers;
  private cache: CacheFile | null;
  private index: ModelsDevIndex;
  private sampling: SamplingByHost;
  private cancelPendingCheck: (() => void) | null = null;
  private checking = false;
  private disposed = false;

  constructor(options: ModelsDevCatalogOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.isAllowed = options.isAllowed;
    this.onUpdated = options.onUpdated;
    this.fetchApi = options.fetch ?? globalThis.fetch;
    this.timers = options.timers ?? REAL_PRICING_TIMERS;
    this.cache = this.readCache();
    this.index = this.cache?.models ?? {};
    this.sampling = this.cache?.sampling ?? {};
  }

  /** Claude Code 自己的模型（Anthropic 的 claude- 文字模型），新发布的在前；还没下载过为空。 */
  claudeCodeModels(): string[] {
    return this.cache?.claude ?? [];
  }

  /** 按模型名查；不知道的是空对象。 */
  facts(modelId: string): ModelFacts {
    return lookupModelFacts(this.index, modelId);
  }

  /** 这个模型在这几个主机名的服务商那里收不收 temperature 与 top_p；models.dev 没说为 undefined。 */
  takesSampling(input: { hosts: string[]; modelId: string }): boolean | undefined {
    return samplingFor({ byHost: this.sampling, ...input });
  }

  start(): void {
    this.scheduleCheck(FIRST_CHECK_DELAY_MS);
  }

  /** 刚允许下载（打开了 Claude Code 或 Codex 的总开关）：马上检查一次，缓存还新就不发请求。 */
  wake(): void {
    if (this.checking) return;
    this.scheduleCheck(0);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPendingCheck?.();
    this.cancelPendingCheck = null;
  }

  private scheduleCheck(delayMs: number): void {
    this.cancelPendingCheck?.();
    this.cancelPendingCheck = null;
    if (this.disposed) return;
    this.cancelPendingCheck = this.timers.schedule(() => {
      this.cancelPendingCheck = null;
      void this.check();
    }, delayMs);
  }

  private async check(): Promise<void> {
    if (this.disposed) return;
    if (!this.isAllowed()) {
      this.scheduleCheck(RETRY_MS);
      return;
    }
    const age = this.cache ? this.now() - Date.parse(this.cache.fetchedAt) : Number.NaN;
    const isCacheFresh = Number.isFinite(age) && age >= 0 && age < CHECK_INTERVAL_MS;
    if (isCacheFresh) {
      this.scheduleCheck(CHECK_INTERVAL_MS - age);
      return;
    }
    this.checking = true;
    const ok = await this.download().finally(() => {
      this.checking = false;
    });
    this.scheduleCheck(ok ? CHECK_INTERVAL_MS : RETRY_MS);
  }

  /** 下不到不是事故：已有的资料照用，一小时后再试。 */
  private async download(): Promise<boolean> {
    const etag = this.cache?.etag ?? null;
    try {
      const response = await this.fetchApi(MODELS_DEV_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: etag ? { "if-none-match": etag } : {},
      });
      const fetchedAt = new Date(this.now()).toISOString();
      if (response.status === 304 && this.cache) {
        this.writeCache({ ...this.cache, fetchedAt });
        return true;
      }
      if (!response.ok) throw new Error(`models.dev request failed with ${response.status}`);
      const raw: unknown = await response.json();
      const models = indexModelsDev(raw);
      if (Object.keys(models).length === 0) throw new Error("models.dev listed no models");
      const sampling = indexSamplingByHost(raw);
      const claude = claudeCodeOwnModels(raw);
      const newEtag = response.headers.get("etag");
      this.writeCache({ fetchedAt, etag: newEtag, models, sampling, claude });
      this.index = models;
      this.sampling = sampling;
      this.onUpdated();
      return true;
    } catch (error) {
      this.logger.info(
        { err: error },
        "models.dev refresh failed; keeping the current model facts",
      );
      return false;
    }
  }

  /** 缓存读不出（坏了或格式旧了）当没有：下一次检查会重新下载。 */
  private readCache(): CacheFile | null {
    const bytes = readOptionalFile(this.filePath);
    if (bytes === null) return null;
    const parsed = CacheFileSchema.safeParse(parseJson(bytes.toString("utf8")));
    if (!parsed.success) {
      this.logger.warn({ filePath: this.filePath }, "Ignoring an unreadable models.dev cache");
      return null;
    }
    return parsed.data;
  }

  private writeCache(cache: CacheFile): void {
    this.cache = CacheFileSchema.parse(cache);
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(this.cache)}\n`);
  }
}

// Claude Code 自己的模型照 magpie（https://github.com/yetone/magpie，internal/catalog/catalog.go 的 Provider 与 textModel、
// internal/agent/claude.go 的 claudeOwn）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
const NOT_TEXT_MODEL = [
  "embed",
  "-tts",
  "image",
  "audio",
  "-live",
  "robotics",
  "computer-use",
  "deep-research",
  "transcribe",
  "realtime",
  "moderation",
  "whisper",
  "dall-e",
  "sora",
];

interface ReleasedModel {
  id: string;
  released: string;
}

/**
 * models.dev 上 Anthropic 的 claude- 文字模型，按发布日期新的在前、同一天按 id：打开开关时 CLI 没设模型，
 * magpie 拿其中第一个当 Claude Code 自己的默认（default-model-pick.ts 的 default）。
 */
export function claudeCodeOwnModels(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  const anthropic = raw.anthropic;
  if (!isRecord(anthropic) || !isRecord(anthropic.models)) return [];
  const models: ReleasedModel[] = [];
  for (const [id, model] of Object.entries(anthropic.models)) {
    if (!id.startsWith("claude") || !isRecord(model) || !isTextModel({ id, model })) continue;
    const released = typeof model.release_date === "string" ? model.release_date : "";
    models.push({ id, released });
  }
  models.sort((a, b) => {
    if (a.released !== b.released) return a.released > b.released ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return models.map((model) => model.id);
}

function isTextModel(input: { id: string; model: Record<string, unknown> }): boolean {
  const modalities = isRecord(input.model.modalities) ? input.model.modalities : {};
  const output = Array.isArray(modalities.output) ? modalities.output : [];
  const isWithoutText = output.length > 0 && !output.includes("text");
  if (isWithoutText) return false;
  return !NOT_TEXT_MODEL.some((word) => input.id.includes(word));
}
