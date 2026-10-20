import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * 结果只在这个页面的内存里（prd 第 29 条）；离开页面时还在测的一并取消，不再花用户的 token。
 */

export type ModelTestRun =
  | { status: "idle" }
  | { status: "running"; requestId: string; done: number; total: number; isCancelling: boolean }
  | { status: "finished"; failed: number; total: number }
  | { status: "cancelled" }
  // 请求本身没成（主机拒收、连接断开）；原因留到下次测试。
  | { status: "failed"; message: string };

export interface UseModelTestsResult {
  tests: ModelTests;
  run: ModelTestRun;
  testAll: (modelIds: string[]) => void;
  testOne: (modelId: string) => void;
  cancel: () => void;
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
    (modelIds: string[], modelId: string | null) => {
      if (!client || runningRef.current !== null || modelIds.length === 0) return;
      const requestId = createUpstreamRequestId();
      runningRef.current = requestId;
      setTests((previous) => startTests(previous, modelIds));
      setRun({
        status: "running",
        requestId,
        done: 0,
        total: modelIds.length,
        isCancelling: false,
      });
      void (async () => {
        try {
          const response = await client.apiEndpointTestModels(
            { endpointId, ...(modelId === null ? {} : { modelId }) },
            {
              requestId,
              onProgress: ({ result, done, total }) => {
                if (runningRef.current !== requestId) return;
                setTests((previous) => afterProgress(previous, result));
                setRun((previous) =>
                  previous.status === "running" ? { ...previous, done, total } : previous,
                );
              },
            },
          );
          if (runningRef.current !== requestId) return;
          setTests((previous) => afterResponse(previous, response.results));
          if (response.error?.code === "cancelled") setRun({ status: "cancelled" });
          else if (response.error) setRun({ status: "failed", message: response.error.message });
          else setRun({ status: "finished", ...testSummary(response.results) });
        } catch (error) {
          if (runningRef.current !== requestId) return;
          setTests((previous) => afterResponse(previous, []));
          setRun({ status: "failed", message: toErrorMessage(error) });
        } finally {
          if (runningRef.current === requestId) runningRef.current = null;
        }
      })();
    },
    [client, endpointId],
  );

  const testAll = useCallback((modelIds: string[]) => start(modelIds, null), [start]);
  const testOne = useCallback((modelId: string) => start([modelId], modelId), [start]);

  const cancel = useCallback(() => {
    const requestId = runningRef.current;
    if (!client || requestId === null) return;
    setRun((previous) =>
      previous.status === "running" ? { ...previous, isCancelling: true } : previous,
    );
    // 取消只是尽力而为：daemon 那边已测完时照常回结果。
    void client.apiEndpointCancel(requestId).catch(() => undefined);
  }, [client]);

  // 离开页面：结果随组件丢掉，还在测的请 daemon 停下。
  useEffect(
    () => () => {
      const requestId = runningRef.current;
      runningRef.current = null;
      if (client && requestId !== null)
        void client.apiEndpointCancel(requestId).catch(() => undefined);
    },
    [client],
  );

  return useMemo(
    () => ({ tests, run, testAll, testOne, cancel }),
    [cancel, run, testAll, testOne, tests],
  );
}
