// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/test.go 的 TestModels、testOne）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointError,
  ApiEndpointFormatDetection,
  ApiEndpointModelTestResult,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { UsagePricingTimers } from "../usage/pricing/service.js";
import { disabledMessage } from "./disabled-models.js";
import type { CliHeaderSample } from "./store.js";
import type { CliTestClient } from "./test-as.js";
import { probeUpstreamFormat, type ProbedFormat } from "./upstream-detect.js";
import type { RequestExtras } from "./request-extras.js";

/*
 * 测试模型（prd 第 26–28 条，照 magpie TestModels）：每个模型发一条「hi」、回复上限 16，几个一起问。
 * 一个模型按给它的格式依次试，答上一个就算能用；都没答上报第一个格式的原因（magpie 只问那一种），
 * 后面的格式超时也不盖掉它。单个模型有总时限，超了不再试别的格式；整批也有总时限，到点还没测完的都记成整批超时。
 * 时钟与计时器由调用方给（测试换成手动的）。
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

export interface ModelTestClock {
  now: () => Date;
  timers: UsagePricingTimers;
}

export interface ModelTestAttempt {
  format: ProbedFormat;
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

/**
 * 以谁的样子测：Osuna 自己；某个 CLI（带它的请求头，ADR 0013）；或这个 CLI 还没有样本，每个模型都记成这个原因、不发请求
 * （magpie testOne 的 TestsAs 回 errNotSeen）。
 */
export type ModelTestIdentity =
  | { kind: "own" }
  | { kind: "cli"; client: CliTestClient; headers: CliHeaderSample }
  | { kind: "sampleMissing"; error: ApiEndpointError };

export interface ModelTestProgress {
  result: ApiEndpointModelTestResult;
  done: number;
  total: number;
}

/** 到点就 abort 的信号；用完要 clear，免得计时器留着。 */
export function deadlineSignal(input: { timers: UsagePricingTimers; ms: number }): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const clear = input.timers.schedule(() => controller.abort(), input.ms);
  return { signal: controller.signal, clear };
}

/** 没答上（或没发）的一个模型的结果。 */
function failedResult(input: {
  modelId: string;
  format: string | null;
  status: number | null;
  durationMs: number;
  code: string;
  message: string;
  params?: Record<string, string>;
}): ApiEndpointModelTestResult {
  const error: ApiEndpointError = { code: input.code, message: input.message };
  if (input.params) error.params = input.params;
  return {
    modelId: input.modelId,
    ok: false,
    format: input.format,
    status: input.status,
    durationMs: input.durationMs,
    error,
  };
}

/** 最多 concurrency 件一起做，按序号先后取下一件；signal 中止后不再取新的（测试模型与逐个模型识别共用）。 */
export async function runPool(input: {
  count: number;
  concurrency: number;
  signal: AbortSignal;
  run: (index: number) => Promise<void>;
}): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < input.count && !input.signal.aborted) {
      const index = next;
      next += 1;
      await input.run(index);
    }
  };
  const workers = Math.max(1, Math.min(input.concurrency, input.count));
  await Promise.all(Array.from({ length: workers }, worker));
}

export async function runModelTests(input: {
  plans: ModelTestPlan[];
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
  templateId: string | undefined;
  // 这家的请求头、附加请求体与 key 放哪个头（request-extras.ts）。
  extras: RequestExtras;
  identity: ModelTestIdentity;
  limits: ModelTestLimits;
  clock: ModelTestClock;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  onResult: (progress: ModelTestProgress) => void;
}): Promise<ModelTestsOutcome> {
  const { plans, limits, clock } = input;
  const batch = deadlineSignal({ timers: clock.timers, ms: limits.batchTimeoutMs });
  const signal = AbortSignal.any([input.signal, batch.signal]);
  const results: (ApiEndpointModelTestResult | null)[] = plans.map(() => null);
  let done = 0;
  const finish = (index: number, result: ApiEndpointModelTestResult) => {
    results[index] = result;
    done += 1;
    input.onResult({ result, done, total: plans.length });
  };
  await runPool({
    count: plans.length,
    concurrency: limits.concurrency,
    signal,
    run: async (index) => {
      const plan = plans[index];
      if (!plan) return;
      const result = await testOne({ ...input, plan, signal });
      // 取消或整批到点时被打断的不算测完。
      if (signal.aborted) return;
      finish(index, result);
    },
  });
  batch.clear();
  const finished = () => results.filter((result) => result !== null);
  if (input.signal.aborted) return { kind: "cancelled", results: finished() };
  plans.forEach((plan, index) => {
    if (results[index] !== null) return;
    finish(
      index,
      failedResult({
        modelId: plan.modelId,
        format: null,
        status: null,
        durationMs: 0,
        code: "batch_timeout",
        message: "The test ran out of time before this model answered",
      }),
    );
  });
  return { kind: "done", results: finished() };
}

async function testOne(input: {
  plan: ModelTestPlan;
  apiKey: string | null;
  templateId: string | undefined;
  // 这家的请求头、附加请求体与 key 放哪个头（request-extras.ts）。
  extras: RequestExtras;
  identity: ModelTestIdentity;
  limits: ModelTestLimits;
  clock: ModelTestClock;
  signal: AbortSignal;
}): Promise<ApiEndpointModelTestResult> {
  const { plan, clock } = input;
  const { modelTimeoutMs } = input.limits;
  const { modelId } = plan;
  if (plan.disabledBy !== null) {
    // 用户禁用了它：连测试都不发（magpie testOne）。
    return failedResult({
      modelId,
      format: null,
      status: null,
      durationMs: 0,
      code: "model_disabled",
      message: disabledMessage({ model: modelId, pattern: plan.disabledBy }),
      params: { model: modelId, pattern: plan.disabledBy },
    });
  }
  const { identity } = input;
  if (identity.kind === "sampleMissing") {
    return failedResult({
      modelId,
      format: null,
      status: null,
      durationMs: 0,
      code: identity.error.code,
      message: identity.error.message,
    });
  }
  let asCli: { client: CliTestClient; headers: CliHeaderSample } | undefined;
  if (identity.kind === "cli") asCli = { client: identity.client, headers: identity.headers };
  const startedAt = clock.now().getTime();
  const elapsed = () => clock.now().getTime() - startedAt;
  const deadline = deadlineSignal({ timers: clock.timers, ms: modelTimeoutMs });
  const signal = AbortSignal.any([input.signal, deadline.signal]);
  let firstFailure: ApiEndpointModelTestResult | null = null;
  try {
    for (const attempt of plan.attempts) {
      const detection = await probeUpstreamFormat({
        format: attempt.format,
        baseUrl: attempt.baseUrl,
        apiKey: input.apiKey,
        templateId: input.templateId,
        modelId,
        sentModel: plan.sentModel,
        capsReply: true,
        asCli,
        extras: input.extras,
        signal,
        // 单个模型的总时限由 deadline 管，这里只要不早于它。
        timeoutMs: modelTimeoutMs + 1_000,
      });
      const timedOut = deadline.signal.aborted && !input.signal.aborted;
      if (timedOut && firstFailure !== null) break;
      if (timedOut) {
        const seconds = String(Math.round(modelTimeoutMs / 1000));
        return failedResult({
          modelId,
          format: attempt.format,
          status: null,
          durationMs: elapsed(),
          code: "upstream_timeout",
          message: `No response within ${seconds}s`,
          params: { seconds },
        });
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
      firstFailure ??= failureOf({ modelId, detection });
    }
  } finally {
    deadline.clear();
  }
  if (firstFailure !== null) return { ...firstFailure, durationMs: elapsed() };
  return failedResult({
    modelId,
    format: null,
    status: null,
    durationMs: 0,
    code: "no_format",
    message: "This endpoint has no URL in a format that serves it",
  });
}

// 检测结论的原因前面带着「POST <地址>: HTTP <状态码>:」；状态码另有字段，地址不给界面看（magpie 的行上只写原因）。
const REQUEST_PREFIX = /^POST \S+: /;
const STATUS_PREFIX = /^HTTP \d+(: )?/;

function failureOf(input: {
  modelId: string;
  detection: ApiEndpointFormatDetection;
}): ApiEndpointModelTestResult {
  const { detection } = input;
  let code = "upstream_error";
  if (detection.status === "auth_failed") code = "auth_failed";
  else if (detection.code === "invalid_header") code = detection.code;
  else if (detection.httpStatus === null) code = "upstream_unreachable";
  const reason = (detection.message ?? "").replace(REQUEST_PREFIX, "").replace(STATUS_PREFIX, "");
  // 发不出去的头：带上 params.name，界面按语言说。
  const isUnsendable = code === "invalid_header";
  const params = isUnsendable ? detection.params : undefined;
  return failedResult({
    modelId: input.modelId,
    format: detection.format,
    status: detection.httpStatus,
    durationMs: 0,
    code,
    message: reason,
    params,
  });
}
