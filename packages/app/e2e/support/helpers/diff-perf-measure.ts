import path from "node:path";
import type { CDPSession, Page } from "@playwright/test";
import { spawnTsx } from "./spawn-node";

/*
 * Diff 面板性能场景的渲染进程测量：生成场景、longtask 记录与 CPU 采样分段。
 * diff-performance.spec.ts 和桌面版 CDP 测量脚本共用，保证两边口径一致。
 */

const SERVER_PACKAGE_DIR = path.resolve(__dirname, "../../../../server");
const DIFF_PERF_SCENARIO_CLI = path.join(
  SERVER_PACKAGE_DIR,
  "src/server/daemon-e2e/diff-perf-scenario-cli.ts",
);

interface LongTaskEntry {
  startTime: number;
  duration: number;
}

interface LongTaskScope {
  __PASEO_LONG_TASKS__?: LongTaskEntry[];
}

interface PageWindow {
  page: Page;
  start: number;
  end: number;
}

/** 跑 server 包里的场景命令行：`create <空目录>` 或 `agent <仓库> [持续毫秒]`。 */
export async function runDiffPerfScenario(args: string[]): Promise<void> {
  const child = spawnTsx(DIFF_PERF_SCENARIO_CLI, args, {
    cwd: SERVER_PACKAGE_DIR,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  if (code !== 0) throw new Error(`diff-perf-scenario ${args[0]} exited with ${code}`);
}

function recordLongTasks(): void {
  const scope: typeof globalThis & LongTaskScope = globalThis;
  const tasks: LongTaskEntry[] = [];
  scope.__PASEO_LONG_TASKS__ = tasks;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      tasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: "longtask", buffered: true });
}

/** 浏览器用例：页面加载前挂上，从第一帧开始记。 */
export async function observeLongTasks(page: Page): Promise<void> {
  await page.addInitScript(recordLongTasks);
}

/** 桌面版：接到已经在跑的窗口上，从现在开始记。 */
export async function startLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(recordLongTasks);
}

export async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

export async function waitForLongTaskQuiet(input: {
  page: Page;
  quietMs: number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = performance.now() + input.timeoutMs;
  while (performance.now() < deadline) {
    const quietFor = await input.page.evaluate(() => {
      const scope: typeof globalThis & LongTaskScope = globalThis;
      const last = scope.__PASEO_LONG_TASKS__?.at(-1);
      return last ? performance.now() - (last.startTime + last.duration) : performance.now();
    });
    if (quietFor >= input.quietMs) return;
    await input.page.waitForTimeout(1_000);
  }
}

export async function summarizeLongTasks({ page, start, end }: PageWindow) {
  return page.evaluate(
    ({ windowStart, windowEnd }) => {
      const scope: typeof globalThis & LongTaskScope = globalThis;
      const tasks = (scope.__PASEO_LONG_TASKS__ ?? []).filter(
        (task) => task.startTime >= windowStart && task.startTime < windowEnd,
      );
      const durations = tasks.map((task) => task.duration).sort((left, right) => left - right);
      return {
        count: durations.length,
        over500ms: durations.filter((duration) => duration > 500).length,
        maxMs: Math.round(durations.at(-1) ?? 0),
        p95Ms: Math.round(durations[Math.floor(durations.length * 0.95)] ?? 0),
        totalMs: Math.round(durations.reduce((sum, duration) => sum + duration, 0)),
      };
    },
    { windowStart: start, windowEnd: end },
  );
}

// 结构与 CDP Profiler.Profile 一致，samples / timeDeltas 在协议里是可选的。
interface CpuProfileNode {
  id: number;
  callFrame: { functionName: string };
  children?: number[];
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

export async function startCpuProfile(cdp: CDPSession): Promise<void> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1_000 });
  await cdp.send("Profiler.start");
}

export async function stopCpuProfile(cdp: CDPSession): Promise<CpuProfile> {
  const { profile } = await cdp.send("Profiler.stop");
  return profile;
}

type CpuSegment =
  | "gc"
  | "jsonParse"
  | "validate"
  | "shareCheckoutDiff"
  | "buildDiffDocumentModel"
  | "paint"
  | "reactOther"
  | "messageDispatchOther"
  | "program"
  | "otherJs";

// 栈里由内往外找第一个命中的函数，把这一次采样记到对应分段。
const CPU_SEGMENT_BY_FUNCTION = new Map<string, CpuSegment>([
  ["(garbage collector)", "gc"],
  ["shareCheckoutDiff", "shareCheckoutDiff"],
  ["retainDiffFiles", "shareCheckoutDiff"],
  ["equalFile", "shareCheckoutDiff"],
  ["buildDiffDocumentModel", "buildDiffDocumentModel"],
  ["paintWebViewport", "paint"],
  ["paintWebFileHeader", "paint"],
  ["validateWSOutboundMessage", "validate"],
]);
const REACT_ROOT_FUNCTIONS = new Set([
  "performWorkOnRoot",
  "performSyncWorkOnRoot",
  "renderRootSync",
  "renderRootConcurrent",
  "commitRoot",
]);
const LONG_RUN_MIN_US = 50_000;

interface ProfileSample {
  nodeId: number;
  us: number;
}

/**
 * 把 CPU 采样按「连续非空闲 ≥50ms」切出忙段（和 longtask 的阈值一致），
 * 再把忙段里的时间按 解析 / 校验 / 深比较 / 行模型 / 绘制 / React / 其余 归类。
 */
export function summarizeCpuProfile(profile: CpuProfile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parentById = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parentById.set(child, node.id);
  }
  const segmentCache = new Map<number, CpuSegment>();
  function segmentOf(nodeId: number): CpuSegment {
    const cached = segmentCache.get(nodeId);
    if (cached) return cached;
    let segment: CpuSegment | null = null;
    let inReact = false;
    let inMessage = false;
    for (let id: number | undefined = nodeId; id !== undefined; id = parentById.get(id)) {
      const { functionName } = byId.get(id)!.callFrame;
      segment ??= CPU_SEGMENT_BY_FUNCTION.get(functionName) ?? null;
      if (REACT_ROOT_FUNCTIONS.has(functionName)) inReact = true;
      if (functionName === "handleJsonPayload") inMessage = true;
    }
    const resolved = segment ?? fallbackSegment(byId.get(nodeId)!.callFrame.functionName);
    segmentCache.set(nodeId, resolved);
    return resolved;

    function fallbackSegment(leaf: string): CpuSegment {
      // JSON.parse 是内建函数，CPU 采样里不单独成帧，耗时记在调用方 handleJsonPayload 自身上。
      if (leaf === "handleJsonPayload") return "jsonParse";
      if (inReact) return "reactOther";
      if (inMessage) return "messageDispatchOther";
      if (leaf === "(program)") return "program";
      return "otherJs";
    }
  }

  function isIdle(nodeId: number): boolean {
    return byId.get(nodeId)!.callFrame.functionName === "(idle)";
  }

  const longRunTotals = new Map<CpuSegment, number>();
  let longRunUs = 0;
  let longRuns = 0;
  let longestRunUs = 0;
  let run: ProfileSample[] = [];
  function flush(): void {
    const runUs = run.reduce((sum, sample) => sum + sample.us, 0);
    if (runUs >= LONG_RUN_MIN_US) {
      longRuns += 1;
      longRunUs += runUs;
      longestRunUs = Math.max(longestRunUs, runUs);
      for (const sample of run) {
        const segment = segmentOf(sample.nodeId);
        longRunTotals.set(segment, (longRunTotals.get(segment) ?? 0) + sample.us);
      }
    }
    run = [];
  }
  const timeDeltas = profile.timeDeltas ?? [];
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    // timeDeltas[i] 是第 i 个采样与上一个的间隔，归到下一个采样更接近真实耗时。
    const us = timeDeltas[index + 1] ?? 0;
    if (isIdle(nodeId)) flush();
    else run.push({ nodeId, us });
  }
  flush();

  return {
    longRuns,
    longestRunMs: Math.round(longestRunUs / 1_000),
    longRunTotalMs: Math.round(longRunUs / 1_000),
    segments: Object.fromEntries(
      [...longRunTotals.entries()]
        .sort(([, left], [, right]) => right - left)
        .map(([segment, us]) => [
          segment,
          { ms: Math.round(us / 1_000), share: Number((us / Math.max(longRunUs, 1)).toFixed(3)) },
        ]),
    ),
  };
}
