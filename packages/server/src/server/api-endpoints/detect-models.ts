// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/detect.go 的 DetectModels、
// internal/catalog/catalog.go 的 ImagesAPI）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpointFormatDetection,
  type ApiEndpointModelDetection,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { UsagePricingTimers } from "../usage/pricing/service.js";
import { disabledMessage } from "./disabled-models.js";
import { deadlineSignal, runPool } from "./model-tests.js";
import { DETECT_MAX_MODELS, probeUpstreamFormat, suggestedBaseUrls } from "./upstream-detect.js";

/*
 * 逐个模型识别（prd 第 11a 条，照 magpie DetectModels）：表单里已选的模型（前 30 个）在每种格式上各问一次最小请求，
 * 几个一起问；每个请求有自己的时限，整次识别也有总时限，到点还没问的记成没问。被禁的模型和生图模型不问。
 * 每种格式的总结论是第一个答上的模型的，都没答上取第一个模型的（magpie 的 sum）。
 */

export const DETECT_EACH_DEFAULTS = {
  concurrency: 8,
  probeTimeoutMs: 12_000,
  batchTimeoutMs: 120_000,
} as const;

export interface DetectEachLimits {
  concurrency: number;
  probeTimeoutMs: number;
  batchTimeoutMs: number;
}

export type DetectEachOutcome =
  | {
      kind: "result";
      results: ApiEndpointFormatDetection[];
      models: ApiEndpointModelDetection[];
    }
  | { kind: "noModels" }
  | { kind: "cancelled" };

// 只能走生图接口的模型（magpie ImagesAPI）：不能对话，不问。
const IMAGE_MODEL_WORDS = [
  "gpt-image",
  "chatgpt-image",
  "dall-e",
  "imagen",
  "imagine",
  "qwen-image",
  "wanx",
  "wan2",
  "seedream",
  "cogview",
  "flux",
  "stable-diffusion",
  "sdxl",
  "kolors",
  "hidream",
];

function isImageModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return IMAGE_MODEL_WORDS.some((word) => id.includes(word));
}

const NOT_ASKED_OUT_OF_TIME = "Not asked: the detection ran out of time";
const CUT_OFF_OUT_OF_TIME = "No response before the detection ran out of time";

interface ProbeTask {
  row: number;
  column: number;
}

export async function detectEachModel(input: {
  baseUrl: string;
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
  modelIds: string[];
  // 命中的「已禁用的模型」条目；没被禁为 null。
  disabledBy: (modelId: string) => string | null;
  // 发给上游时模型叫什么（已保存那家的上游模型名）。
  sentNameOf: (modelId: string) => string;
  limits: DetectEachLimits;
  timers: UsagePricingTimers;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
}): Promise<DetectEachOutcome> {
  const { limits, timers } = input;
  const ids = [...new Set(input.modelIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    DETECT_MAX_MODELS,
  );
  if (ids.length === 0) return { kind: "noModels" };
  const urls = suggestedBaseUrls(input.baseUrl);
  const tasks: ProbeTask[] = [];
  const cell = (modelId: string, column: number, message: string): ApiEndpointFormatDetection => {
    const format = API_ENDPOINT_REQUEST_FORMATS[column];
    return {
      format,
      url: urls[format],
      status: "not_detected",
      httpStatus: null,
      message,
      modelId,
    };
  };
  const models: ApiEndpointModelDetection[] = ids.map((modelId, row) => {
    const pattern = input.disabledBy(modelId);
    let skipped: string | null = null;
    if (pattern !== null) skipped = disabledMessage({ model: modelId, pattern });
    else if (isImageModel(modelId)) skipped = "An image model can't chat, so it isn't asked here";
    const results = API_ENDPOINT_REQUEST_FORMATS.map((_, column) => {
      if (skipped === null) tasks.push({ row, column });
      return cell(modelId, column, skipped ?? NOT_ASKED_OUT_OF_TIME);
    });
    return { modelId, results };
  });
  const batch = deadlineSignal({ timers, ms: limits.batchTimeoutMs });
  const signal = AbortSignal.any([input.signal, batch.signal]);
  await runPool({
    count: tasks.length,
    concurrency: limits.concurrency,
    signal,
    run: async (index) => {
      const task = tasks[index];
      if (!task) return;
      const row = models[task.row];
      if (!row) return;
      const modelId = row.modelId;
      const format = API_ENDPOINT_REQUEST_FORMATS[task.column];
      const deadline = deadlineSignal({ timers, ms: limits.probeTimeoutMs });
      const detection = await probeUpstreamFormat({
        format,
        baseUrl: urls[format],
        apiKey: input.apiKey,
        // 自动识别只给「自定义」用。
        templateId: undefined,
        modelId,
        sentModel: input.sentNameOf(modelId),
        signal: AbortSignal.any([signal, deadline.signal]),
        // 单个请求的时限由 deadline 管，这里只要不早于它。
        timeoutMs: limits.probeTimeoutMs + 1_000,
      });
      deadline.clear();
      row.results[task.column] = cutOffResult({
        detection,
        isProbeLate: deadline.signal.aborted,
        isBatchLate: batch.signal.aborted,
        probeTimeoutMs: limits.probeTimeoutMs,
      });
    },
  });
  batch.clear();
  if (input.signal.aborted) return { kind: "cancelled" };
  const results = API_ENDPOINT_REQUEST_FORMATS.map((_, column) => {
    const answered = models.find((model) => model.results[column]?.status === "ok");
    return (answered ?? models[0]).results[column];
  });
  return { kind: "result", results, models };
}

/** 这一问被时限打断时改写原因：自己的时限到了说几秒没回，整次识别到点了说没赶上。 */
function cutOffResult(input: {
  detection: ApiEndpointFormatDetection;
  isProbeLate: boolean;
  isBatchLate: boolean;
  probeTimeoutMs: number;
}): ApiEndpointFormatDetection {
  const { detection } = input;
  if (detection.status === "ok") return detection;
  if (input.isProbeLate) {
    const seconds = Math.round(input.probeTimeoutMs / 1000);
    return { ...detection, httpStatus: null, message: `No response within ${seconds}s` };
  }
  if (input.isBatchLate) return { ...detection, httpStatus: null, message: CUT_OFF_OUT_OF_TIME };
  return detection;
}
