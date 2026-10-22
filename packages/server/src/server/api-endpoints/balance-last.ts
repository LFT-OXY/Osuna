// 上次读数移植自 magpie（https://github.com/yetone/magpie，internal/provider/quota_last.go 的 keepLast、passing 与 keyTag，7597c132）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { createHash } from "node:crypto";
import type pino from "pino";
import { z } from "zod";
import {
  ApiEndpointBalanceItemSchema,
  ApiEndpointBalanceWindowSchema,
  type ApiEndpointBalanceReading,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { readOptionalFile } from "./config-file.js";
import type { StoredApiEndpoint } from "./store.js";
import { parseJson } from "./upstream-http.js";

/*
 * 每家接口最近一次成功的余额读数，存在 api-endpoints/balance-readings.json，重启后还在：
 * 对方忙或断网（暂时查不到）时界面看上次读数，不看一句错误。只有余额各项、限额窗口与读数时间，不含 key 与令牌；
 * 每条带这家查余额用的地址、余额设置、key 与账户令牌的指纹（摘要，还原不出 key），对不上即作废（magpie 按 key 的摘要记，换了 key 自然对不上）。
 * 它是缓存，读不懂当作空的。
 */

const LastReadingSchema = z.object({
  // 读数时这家的地址与 key 的指纹（fingerprintOf）。
  fingerprint: z.string(),
  readAt: z.string(),
  items: z.array(ApiEndpointBalanceItemSchema),
  windows: z.array(ApiEndpointBalanceWindowSchema).optional(),
});
type LastReading = z.infer<typeof LastReadingSchema>;

const LastReadingsFileSchema = z.object({ readings: z.record(z.string(), LastReadingSchema) });

/** 查余额用到的设置：地址、余额设置、key 与账户令牌。以后加的余额设置也要进指纹。 */
export interface BalanceSettings {
  endpoint: Pick<StoredApiEndpoint, "baseUrls" | "balance">;
  apiKey: string | null;
  balanceToken: string | null;
}

export class LastBalanceReadings {
  private readonly filePath: string;
  private readonly logger: pino.Logger;
  private readings: Record<string, LastReading> | null = null;

  constructor(options: { filePath: string; logger: pino.Logger }) {
    this.filePath = options.filePath;
    this.logger = options.logger.child({ module: "api-endpoint-balance-last" });
  }

  /** 记下一次成功的读数；没有余额项的不记（照 magpie：没有可显示的就不留，上一份照留）。 */
  keep(settings: BalanceSettings, reading: ApiEndpointBalanceReading): void {
    const hasItems = reading.status === "ok" && reading.items.length > 0;
    if (!hasItems || reading.readAt === null) return;
    this.save({
      ...this.all(),
      [reading.endpointId]: {
        fingerprint: fingerprintOf(settings),
        readAt: reading.readAt,
        items: reading.items,
        ...(reading.windows === undefined ? {} : { windows: reading.windows }),
      },
    });
  }

  /**
   * 这次暂时查不到（reason temporary，含开关关着没去读的 not_asked）时，换成这家的上次读数并标上这次的原因；
   * 别的读数、没有上次读数、地址或 key 改过（作废，顺手删掉）时原样回。
   */
  standIn(
    settings: BalanceSettings,
    reading: ApiEndpointBalanceReading,
  ): ApiEndpointBalanceReading {
    const failure = reading.failure;
    if (failure === null || failure.reason !== "temporary") return reading;
    const last = this.all()[reading.endpointId];
    if (last === undefined) return reading;
    if (last.fingerprint !== fingerprintOf(settings)) {
      this.forget(reading.endpointId);
      return reading;
    }
    return {
      endpointId: reading.endpointId,
      status: "ok",
      items: last.items,
      ...(last.windows === undefined ? {} : { windows: last.windows }),
      readAt: last.readAt,
      failure: null,
      stale: failure,
    };
  }

  /** 接口删掉了：它的上次读数作废。 */
  forget(endpointId: string): void {
    const all = this.all();
    if (all[endpointId] === undefined) return;
    const { [endpointId]: _gone, ...rest } = all;
    this.save(rest);
  }

  private all(): Record<string, LastReading> {
    this.readings ??= this.read();
    return this.readings;
  }

  private save(readings: Record<string, LastReading>): void {
    this.readings = readings;
    const file = LastReadingsFileSchema.parse({ readings });
    try {
      writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
    } catch (error) {
      // 写不进只记日志：这次的读数照样回，内存里的照样用，下次成功的读数再写。
      this.logger.warn({ err: error, filePath: this.filePath }, "Failed to write balance readings");
    }
  }

  private read(): Record<string, LastReading> {
    const bytes = readOptionalFile(this.filePath);
    if (bytes === null) return {};
    const parsed = LastReadingsFileSchema.safeParse(parseJson(bytes.toString("utf8")));
    if (!parsed.success) {
      this.logger.warn({ filePath: this.filePath }, "Ignoring an unreadable balance readings file");
      return {};
    }
    return parsed.data.readings;
  }
}

function fingerprintOf(input: BalanceSettings): string {
  const settings = JSON.stringify({
    baseUrls: input.endpoint.baseUrls,
    apiKey: input.apiKey,
    // 没设的不进摘要：升级前记下的读数指纹照旧对得上。
    ...(input.endpoint.balance === undefined ? {} : { balance: input.endpoint.balance }),
    ...(input.balanceToken === null ? {} : { balanceToken: input.balanceToken }),
  });
  return createHash("sha256").update(settings).digest("hex").slice(0, 32);
}
