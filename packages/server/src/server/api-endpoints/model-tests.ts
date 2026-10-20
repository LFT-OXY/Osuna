// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/test.go 的 TestModels、testOne）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointFormatDetection,
  ApiEndpointModelTestResult,
  ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { disabledMessage } from "./disabled-models.js";
import { probeUpstreamFormat } from "./upstream-detect.js";

/*
 * 测试模型（prd 第 26–28 条，照 magpie TestModels）：每个模型发一条「hi」、回复上限 16，几个一起问。
 * 一个模型按给它的格式依次试，答上一个就算能用；都没答上报第一个格式的原因（magpie 只问那一种）。
 * 单个模型有总时限，超了不再试别的格式；整批也有总时限，到点还没测完的都记成整批超时。
 */

export const MODEL_TEST_DEFAULTS = {
  concurrency: 4,
  modelTimeoutMs: 20_000,
  batchTimeoutMs: 180_000,
} as const;

export interface ModelTestLimits {
  concurrency: number;
  modelTimeoutMs: number;
  batchTimeoutMs: number;
}

export interface ModelTestAttempt {
  format: ApiEndpointRequestFormat;
  baseUrl: string;
}

export interface ModelTestPlan {
  modelId: string;
  // 请求体里的模型名（上游模型名）。
  sentModel: string;
  // 命中的「已禁用的模型」条目；没被禁为 null。
  disabledBy: string | null;
  // 按先后要试的格式与地址；空的即这家没有能问它的地址。
  attempts: ModelTestAttempt[];
}

export type ModelTestsOutcome =
  | { kind: "done"; results: ApiEndpointModelTestResult[] }
  // 被取消：只带取消前已测完的。
  | { kind: "cancelled"; results: ApiEndpointModelTestResult[] };

export async function runModelTests(input: {
  plans: ModelTestPlan[];
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
  templateId: string | undefined;
  limits: ModelTestLimits;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  onResult: (progress: { result: ApiEndpointModelTestResult; done: number; total: number }) => void;
}): Promise<ModelTestsOutcome> {
  const { plans, limits } = input;
  const batch = AbortSignal.timeout(limits.batchTimeoutMs);
  const signal = AbortSignal.any([input.signal, batch]);
  const results: (ApiEndpointModelTestResult | null)[] = plans.map(() => null);
  let done = 0;
  const finish = (index: number, result: ApiEndpointModelTestResult) => {
    results[index] = result;
    done += 1;
    input.onResult({ result, done, total: plans.length });
  };
  let next = 0;
  const worker = async () => {
    while (next < plans.length && !signal.aborted) {
      const index = next;
      next += 1;
      const plan = plans[index];
      if (!plan) return;
      const result = await testOne({
        plan,
        apiKey: input.apiKey,
        templateId: input.templateId,
        modelTimeoutMs: limits.modelTimeoutMs,
        signal,
      });
      // 取消或整批到点时被打断的不算测完。
      if (signal.aborted) return;
      finish(index, result);
    }
  };
  const workers = Math.max(1, Math.min(limits.concurrency, plans.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (input.signal.aborted) {
    return { kind: "cancelled", results: results.filter((result) => result !== null) };
  }
  const minutes = Math.round(limits.batchTimeoutMs / 60_000);
  plans.forEach((plan, index) => {
    if (results[index] !== null) return;
    finish(index, {
      modelId: plan.modelId,
      ok: false,
      format: null,
      status: null,
      durationMs: 0,
      error: {
        code: "batch_timeout",
        message:
          minutes >= 1
            ? `The test ran out of its ${minutes} min before this model answered`
            : `The test ran out of its ${limits.batchTimeoutMs} ms before this model answered`,
      },
    });
  });
  return { kind: "done", results: results.filter((result) => result !== null) };
}

async function testOne(input: {
  plan: ModelTestPlan;
  apiKey: string | null;
  templateId: string | undefined;
  modelTimeoutMs: number;
  signal: AbortSignal;
}): Promise<ApiEndpointModelTestResult> {
  const { plan, modelTimeoutMs } = input;
  const { modelId } = plan;
  if (plan.disabledBy !== null) {
    // 用户禁用了它：连测试都不发（magpie testOne）。
    return {
      modelId,
      ok: false,
      format: null,
      status: null,
      durationMs: 0,
      error: {
        code: "model_disabled",
        params: { model: modelId, pattern: plan.disabledBy },
        message: disabledMessage({ model: modelId, pattern: plan.disabledBy }),
      },
    };
  }
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const deadline = AbortSignal.timeout(modelTimeoutMs);
  const signal = AbortSignal.any([input.signal, deadline]);
  let firstFailure: ApiEndpointModelTestResult | null = null;
  for (const attempt of plan.attempts) {
    const detection = await probeUpstreamFormat({
      format: attempt.format,
      baseUrl: attempt.baseUrl,
      apiKey: input.apiKey,
      templateId: input.templateId,
      modelId,
      sentModel: plan.sentModel,
      capsReply: true,
      signal,
      // 单个模型的总时限由 deadline 管，这里只要不早于它。
      timeoutMs: modelTimeoutMs + 1_000,
    });
    if (deadline.aborted && !input.signal.aborted) {
      return {
        modelId,
        ok: false,
        format: attempt.format,
        status: null,
        durationMs: elapsed(),
        error: {
          code: "upstream_timeout",
          message: `No response within ${Math.round(modelTimeoutMs / 1000)}s`,
        },
      };
    }
    if (detection.status === "ok") {
      return {
        modelId,
        ok: true,
        format: attempt.format,
        status: detection.httpStatus,
        durationMs: elapsed(),
        error: null,
      };
    }
    firstFailure ??= failureOf({ modelId, detection, durationMs: elapsed() });
  }
  if (firstFailure !== null) return { ...firstFailure, durationMs: elapsed() };
  return {
    modelId,
    ok: false,
    format: null,
    status: null,
    durationMs: 0,
    error: { code: "no_format", message: "This endpoint has no URL in a format that serves it" },
  };
}

function failureOf(input: {
  modelId: string;
  detection: ApiEndpointFormatDetection;
  durationMs: number;
}): ApiEndpointModelTestResult {
  const { detection } = input;
  let code = "upstream_error";
  if (detection.status === "auth_failed") code = "auth_failed";
  else if (detection.httpStatus === null) code = "upstream_unreachable";
  return {
    modelId: input.modelId,
    ok: false,
    format: detection.format,
    status: detection.httpStatus,
    durationMs: input.durationMs,
    error: { code, message: detection.message ?? "" },
  };
}
