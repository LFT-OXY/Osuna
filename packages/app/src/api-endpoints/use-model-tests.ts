import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  DaemonConnectionError,
  DaemonRpcError,
  type ApiEndpointTestModelsOptions,
  type DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type { ApiEndpointModelTestResult } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import {
  afterProgress,
  afterResponse,
  startTests,
  testSummary,
  type ModelTests,
} from "./internal/model-tests";
import { createUpstreamRequestId } from "./internal/upstream-request";

/*
 * 接口详情页的「测试模型」：一次只跑一批（整批或只测一个），每测完一个就更新那一行。
 * 标「测试中」的是 daemon 开测时报来的那些（它真要测的），不是页面自己猜的。
 * 结果只在这个页面的内存里（prd 第 29 条）；离开页面时还在测的一并取消，不再花用户的 token。
 */

export type ModelTestRun =
  | { status: "idle" }
  // total 在 daemon 报来要测哪些之前为 null。
  | {
      status: "running";
      requestId: string;
      done: number;
      total: number | null;
      isCancelling: boolean;
    }
  | { status: "finished"; failed: number; total: number }
  | { status: "cancelled" }
  // 请求本身没成（主机拒收、连接断开）；原因留到下次测试。
  | { status: "failed"; message: string };

export interface UseModelTestsResult {
  tests: ModelTests;
  run: ModelTestRun;
  testAll: () => void;
  testOne: (modelId: string) => void;
  cancel: () => void;
}

type SetTests = (update: (previous: ModelTests) => ModelTests) => void;
type SetRun = (update: ModelTestRun | ((previous: ModelTestRun) => ModelTestRun)) => void;

interface RunInput {
  client: DaemonClient;
  endpointId: string;
  modelId: string | null;
  requestId: string;
  runningRef: MutableRefObject<string | null>;
  setTests: SetTests;
  setRun: SetRun;
}

/**
 * 请 daemon 停下还在测的。只有连接已断开时不算失败：daemon 那边已随连接一起取消了。
 * 取消请求超时等别的错误照抛，由调用方显示出来。
 */
async function cancelOnHost(input: { client: DaemonClient; requestId: string }): Promise<void> {
  try {
    await input.client.apiEndpointCancel(input.requestId);
  } catch (error) {
    const isConnectionGone =
      error instanceof DaemonConnectionError && error.code === "DAEMON_CONNECTION_LOST";
    if (!isConnectionGone) throw error;
  }
}

function runningWith(
  previous: ModelTestRun,
  update: { done?: number; total?: number; isCancelling?: boolean },
): ModelTestRun {
  if (previous.status !== "running") return previous;
  return { ...previous, ...update };
}

async function runTests(input: RunInput): Promise<void> {
  const { client, requestId, runningRef, setTests, setRun } = input;
  const isCurrent = () => runningRef.current === requestId;
  const options: ApiEndpointTestModelsOptions = { endpointId: input.endpointId };
  if (input.modelId !== null) options.modelId = input.modelId;
  const onStarted = ({ modelIds }: { modelIds: string[] }) => {
    if (!isCurrent()) return;
    setTests((previous) => startTests(previous, modelIds));
    setRun((previous) => runningWith(previous, { total: modelIds.length }));
  };
  const onProgress = (progress: {
    result: ApiEndpointModelTestResult;
    done: number;
    total: number;
  }) => {
    if (!isCurrent()) return;
    setTests((previous) => afterProgress(previous, progress.result));
    setRun((previous) => runningWith(previous, { done: progress.done, total: progress.total }));
  };
  try {
    const response = await client.apiEndpointTestModels(options, {
      requestId,
      onStarted,
      onProgress,
    });
    if (!isCurrent()) return;
    setTests((previous) => afterResponse(previous, response.results));
    if (response.error?.code === "cancelled") setRun({ status: "cancelled" });
    else if (response.error) setRun({ status: "failed", message: response.error.message });
    else setRun({ status: "finished", ...testSummary(response.results) });
  } catch (error) {
    const isRequestFailure =
      error instanceof DaemonConnectionError || error instanceof DaemonRpcError;
    if (!isRequestFailure) throw error;
    if (!isCurrent()) return;
    setTests((previous) => afterResponse(previous, []));
    setRun({ status: "failed", message: error.message });
  } finally {
    if (isCurrent()) runningRef.current = null;
  }
}

export function useModelTests(input: {
  serverId: string;
  endpointId: string;
}): UseModelTestsResult {
  const { serverId, endpointId } = input;
  const client = useHostRuntimeClient(serverId);
  const [tests, setTests] = useState<ModelTests>({});
  const [run, setRun] = useState<ModelTestRun>({ status: "idle" });
  const runningRef = useRef<string | null>(null);

  const start = useCallback(
    (modelId: string | null) => {
      if (!client || runningRef.current !== null) return;
      const requestId = createUpstreamRequestId();
      runningRef.current = requestId;
      setRun({ status: "running", requestId, done: 0, total: null, isCancelling: false });
      // 没料到的错误也落在这一批的失败状态里，不留成没人接的 rejection。
      const showFailure = (error: unknown) => {
        runningRef.current = null;
        setRun({ status: "failed", message: toErrorMessage(error) });
      };
      void runTests({ client, endpointId, modelId, requestId, runningRef, setTests, setRun }).catch(
        showFailure,
      );
    },
    [client, endpointId],
  );

  const testAll = useCallback(() => start(null), [start]);
  const testOne = useCallback((modelId: string) => start(modelId), [start]);

  const cancel = useCallback(() => {
    const requestId = runningRef.current;
    if (!client || requestId === null) return;
    setRun((previous) => runningWith(previous, { isCancelling: true }));
    // daemon 那边已测完时照常回结果。
    const showFailure = (error: unknown) =>
      setRun({ status: "failed", message: toErrorMessage(error) });
    void cancelOnHost({ client, requestId }).catch(showFailure);
  }, [client]);

  // 离开页面：结果随组件丢掉，还在测的请 daemon 停下。
  useEffect(
    () => () => {
      const requestId = runningRef.current;
      runningRef.current = null;
      if (!client || requestId === null) return;
      // 页面已经没了，没有地方显示：记到控制台。
      const report = (error: unknown) =>
        console.error("[api-endpoints] Couldn't cancel the model test", error);
      void cancelOnHost({ client, requestId }).catch(report);
    },
    [client],
  );

  return useMemo(
    () => ({ tests, run, testAll, testOne, cancel }),
    [cancel, run, testAll, testOne, tests],
  );
}
