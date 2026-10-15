/*
 * 向上游发的可取消请求（拉模型、测试连接、自动检测）共用：自己生成 requestId，取消时才知道要取消哪一条。
 */

let upstreamRequestCounter = 0;

export function createUpstreamRequestId(): string {
  upstreamRequestCounter += 1;
  return `api-endpoint-upstream-${Date.now().toString(36)}-${upstreamRequestCounter}`;
}

/** 调用方取消时通知 daemon 取消对应的上游请求；返回解除监听的函数。 */
export function linkAbortToCancel(signal: AbortSignal, cancel: () => Promise<unknown>): () => void {
  // 取消只是尽力而为：连接已断时 daemon 那边也会随连接一起取消。
  const onAbort = () => void cancel().catch(() => undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
