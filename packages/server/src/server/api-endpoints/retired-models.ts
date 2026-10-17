// 已下线模型的记法移植自 magpie（https://github.com/yetone/magpie，internal/provider/retired.go 的 Retire、Unretire、retiredNow）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type pino from "pino";
import { z } from "zod";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { readOptionalFile } from "./config-file.js";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";
import { parseJson } from "./upstream-http.js";

/*
 * 厂商说某家的某个模型已下线（failure.ts 的 modelRetired），中转站按「接口 + 模型」记下时间，一周内
 * 这家的这一项不出现在给 Agent 选模型的列表里，只写模型名的请求也不选它；写了「接口标识/模型」的照发，
 * 厂商答成功一次就恢复。厂商自己的模型清单往往还列着它，所以重拉清单不算恢复；一周后放回列表，
 * 再被说下线就再记一周（magpie 的 retiredFor）。
 * 存在 api-endpoints/retired-models.json，daemon 重启不丢；它是缓存，读不懂当作空的。
 * 接口页上的已选模型、各 Agent 的默认模型都不改，只在算列表时去掉。
 */

export const RETIRED_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const RetiredFileSchema = z.object({
  models: z.array(
    z.object({ endpointId: z.string(), model: z.string(), retiredAt: z.string().datetime() }),
  ),
});
type RetiredEntry = z.infer<typeof RetiredFileSchema>["models"][number];

/** 一家接口的一个模型，按这家自己的写法。 */
export interface EndpointModel {
  endpoint: Pick<StoredApiEndpoint, "id" | "name">;
  model: string;
}

export interface RetiredModelsOverrides {
  // 只给测试：记录用的时钟，用来快进一周。
  retiredModelsNow?: () => number;
}

export interface RetiredModelsOptions {
  filePath: string;
  logger: pino.Logger;
  now?: () => number;
  // 记下、恢复或一周到期之后调用：给 Agent 选模型的列表跟着变。
  onChanged: () => void;
}

export class RetiredModels {
  private readonly filePath: string;
  private readonly logger: pino.Logger;
  private readonly now: () => number;
  private readonly onChanged: () => void;
  private entries: RetiredEntry[];

  constructor(options: RetiredModelsOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger.child({ module: "api-endpoint-retired-models" });
    this.now = options.now ?? Date.now;
    this.onChanged = options.onChanged;
    this.entries = this.read();
  }

  /** 厂商说这家的这个模型已下线；一周内再说不重新计时。 */
  retire(input: EndpointModel): void {
    this.expire();
    if (this.find(input) !== undefined) return;
    const at = this.now();
    const entry = {
      endpointId: input.endpoint.id,
      model: input.model,
      retiredAt: new Date(at).toISOString(),
    };
    this.save([...this.entries, entry]);
    this.logger.info(
      {
        endpoint: input.endpoint.name,
        model: input.model,
        until: new Date(at + RETIRED_FOR_MS).toISOString(),
      },
      "API endpoint model retired",
    );
  }

  /** 厂商答了这家这个模型的请求：记过下线的就恢复。 */
  restore(input: EndpointModel): void {
    const entry = this.find(input);
    if (entry === undefined) return;
    this.save(this.entries.filter((kept) => kept !== entry));
    this.logger.info(
      { endpoint: input.endpoint.name, model: input.model, why: "answered" },
      "API endpoint model back in service",
    );
  }

  /** 去掉一周内下线的模型之后的接口状态：列表与只写模型名的选路都按它。映射到这些模型的 Claude 档位一并去掉。 */
  listed(state: ApiEndpointState): ApiEndpointState {
    this.expire(state);
    if (this.entries.length === 0) return state;
    const endpoints = state.endpoints.map((endpoint) => this.withoutRetired(endpoint));
    return { ...state, endpoints };
  }

  private withoutRetired(endpoint: StoredApiEndpoint): StoredApiEndpoint {
    const gone = new Set(
      this.entries.filter((entry) => entry.endpointId === endpoint.id).map((entry) => entry.model),
    );
    if (gone.size === 0) return endpoint;
    const models = endpoint.models.filter((model) => !gone.has(model.id));
    if (endpoint.modelMapping === undefined) return { ...endpoint, models };
    const mapping = Object.entries(endpoint.modelMapping).filter(([, model]) => !gone.has(model));
    return { ...endpoint, models, modelMapping: Object.fromEntries(mapping) };
  }

  private find(input: EndpointModel): RetiredEntry | undefined {
    return this.entries.find(
      (entry) => entry.endpointId === input.endpoint.id && entry.model === input.model,
    );
  }

  /** 去掉满一周的记录；日志里的接口名从 state 找，找不到（已删除）用 id。 */
  private expire(state?: ApiEndpointState): void {
    const now = this.now();
    const isExpired = (entry: RetiredEntry) => now - Date.parse(entry.retiredAt) >= RETIRED_FOR_MS;
    const expired = this.entries.filter(isExpired);
    if (expired.length === 0) return;
    this.save(this.entries.filter((entry) => !isExpired(entry)));
    for (const entry of expired) {
      const endpoint = state?.endpoints.find((candidate) => candidate.id === entry.endpointId);
      this.logger.info(
        { endpoint: endpoint?.name ?? entry.endpointId, model: entry.model, why: "expired" },
        "API endpoint model back in service",
      );
    }
  }

  private save(entries: RetiredEntry[]): void {
    const file = RetiredFileSchema.parse({ models: entries });
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
    this.entries = file.models;
    this.onChanged();
  }

  /** 缓存读不懂（坏了或格式不对）当作空的：下次记下时整份重写。 */
  private read(): RetiredEntry[] {
    const bytes = readOptionalFile(this.filePath);
    if (bytes === null) return [];
    const parsed = RetiredFileSchema.safeParse(parseJson(bytes.toString("utf8")));
    if (!parsed.success) {
      this.logger.warn({ filePath: this.filePath }, "Ignoring an unreadable retired models file");
      return [];
    }
    return parsed.data.models;
  }
}
