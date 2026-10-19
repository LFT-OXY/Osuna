import { describe, test, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { highlightCode, isLanguageSupported } from "@getpaseo/highlight";
import { createDaemonTestContext } from "../test-utils/index.js";
import { getCheckoutDiff } from "../../utils/checkout-git.js";
import { resolveGitProcessPolicy } from "../../utils/git-process-scheduler.js";
import { configureGitProcessPolicy } from "../../utils/run-git-command.js";
import {
  DIFF_PERF_SCENARIO,
  createDiffPerfScenario,
  editScenarioModule,
  runSimulatedAgent,
} from "./diff-perf-scenario.js";

interface ReceivedUpdate {
  receivedAt: number;
  bytes: number;
}

interface ExtensionHighlightCost {
  files: number;
  totalMs: number;
}

const RUN = process.env.PASEO_GIT_DIFF_BOTTLENECK_E2E === "1";
const SCENARIO_AGENT_MS = Number.parseInt(
  process.env.PASEO_GIT_DIFF_BOTTLENECK_AGENT_MS ?? String(DIFF_PERF_SCENARIO.agentDurationMs),
  10,
);
const SCENARIO_REPORT_PATH = process.env.PASEO_GIT_DIFF_BOTTLENECK_REPORT_PATH;
const LARGE_CHANGESET_SIZE = Number.parseInt(
  process.env.PASEO_GIT_DIFF_BOTTLENECK_FILE_COUNT ?? "1200",
  10,
);

function tmpRepo(): string {
  return mkdtempSync(path.join(tmpdir(), "paseo-git-diff-bottleneck-"));
}

function initGitRepo(cwd: string): void {
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd, stdio: "pipe" });
}

function seedLargeDirtyRepo(cwd: string, fileCount: number): void {
  mkdirSync(path.join(cwd, "files"), { recursive: true });
  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(path.join(cwd, "files", `f-${i}.txt`), `line ${i}\n`);
  }
  execSync("git add .", { cwd, stdio: "pipe" });
  execSync("git -c commit.gpgsign=false commit -m 'init'", {
    cwd,
    stdio: "pipe",
  });
  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(path.join(cwd, "files", `f-${i}.txt`), `line ${i} changed\n`);
  }

  // Explicit binary artifact to verify we do not diff binary contents.
  writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0x00, 0xff, 0x10, 0x80, 0x00, 0x7f]));
}

const runDescribe = RUN ? describe : describe.skip;

runDescribe("daemon E2E git diff bottleneck profiling", () => {
  test("shows per-file git diff subprocess fanout and timeout pressure", async () => {
    const cwd = tmpRepo();

    try {
      initGitRepo(cwd);
      seedLargeDirtyRepo(cwd, LARGE_CHANGESET_SIZE);

      const cliStart = performance.now();
      const cliDiff = execSync("git diff HEAD", { cwd, stdio: "pipe" }).toString();
      const cliMs = performance.now() - cliStart;

      const ctx = await createDaemonTestContext();
      try {
        const checkoutStart = performance.now();
        const checkoutPayload = await ctx.client.getCheckoutDiff(cwd, {
          mode: "uncommitted",
        });
        const checkoutMs = performance.now() - checkoutStart;

        expect(checkoutPayload.error).toBeNull();
        expect(checkoutPayload.files.length).toBeGreaterThanOrEqual(LARGE_CHANGESET_SIZE);

        const binaryEntry = checkoutPayload.files.find((file) => file.path === "blob.bin");
        expect(binaryEntry).toBeTruthy();
        expect(binaryEntry?.status).toBe("binary");

        // Keep this visible in test output for local bottleneck analysis.
        console.info(
          "[git-diff-bottleneck]",
          JSON.stringify(
            {
              fileCount: LARGE_CHANGESET_SIZE,
              cliMs: Math.round(cliMs),
              cliDiffBytes: cliDiff.length,
              checkoutMs: Math.round(checkoutMs),
              checkoutFiles: checkoutPayload.files.length,
              speedRatio: Number((checkoutMs / Math.max(cliMs, 1)).toFixed(2)),
            },
            null,
            2,
          ),
        );

        expect(checkoutMs).toBeLessThan(cliMs * 10);
      } finally {
        await ctx.cleanup();
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 240000);

  test("measures refresh cost of the fixed diff-panel scenario under a simulated agent", async () => {
    const cwd = tmpRepo();
    const originalMaxProcessesPerSecond = process.env.PASEO_GIT_MAX_PROCESSES_PER_SECOND;
    // vitest 配置把 git 子进程速率放到 10000/s；基线要按正式版默认的 64/s 量。
    delete process.env.PASEO_GIT_MAX_PROCESSES_PER_SECOND;
    configureGitProcessPolicy(resolveGitProcessPolicy({ env: process.env }));

    try {
      const scenario = createDiffPerfScenario(cwd);
      const ctx = await createDaemonTestContext();
      try {
        const coldStart = performance.now();
        const cold = await ctx.client.getCheckoutDiff(cwd, { mode: "uncommitted" });
        const coldMs = performance.now() - coldStart;
        expect(cold.error).toBeNull();

        const subscription = ctx.client.observeCheckoutDiff(cwd, { mode: "uncommitted" });
        const initial = await subscription.ready;
        const updates: ReceivedUpdate[] = [];
        const unsubscribe = ctx.client.on("checkout_diff_update", (message) => {
          if (message.type !== "checkout_diff_update") return;
          if (message.payload.subscriptionId !== initial.subscriptionId) return;
          updates.push({
            receivedAt: performance.now(),
            bytes: Buffer.byteLength(JSON.stringify(message.payload)),
          });
        });

        const agentStart = performance.now();
        const edits = await runSimulatedAgent({ cwd, durationMs: SCENARIO_AGENT_MS });
        const lastEditAt = edits.at(-1)?.writtenAtMs ?? agentStart;
        // 等到最后一次改动之后的推送到达，再静默 2 秒，确认没有排队的刷新。
        await waitUntil({
          predicate: () => (updates.at(-1)?.receivedAt ?? 0) > lastEditAt,
          timeoutMs: 300_000,
        });
        await waitForQuiet({ lastEventAt: () => updates.at(-1)!.receivedAt, quietMs: 2_000 });
        unsubscribe();
        await subscription.release();

        // 订阅释放后直接调 daemon 刷新时跑的同一个函数：改一个文件、算一次，量单次刷新耗时；
        // 不带结构化结果再量一次，就是只有 git 子进程、没有读全文和高亮的那部分。
        const refreshMs = await timeSingleFileRefreshes({ cwd, count: 5, includeStructured: true });
        const gitOnlyMs = await timeSingleFileRefreshes({
          cwd,
          count: 5,
          includeStructured: false,
        });
        const highlightOkPaths = cold.files
          .filter((file) => (file.status ?? "ok") === "ok")
          .map((file) => file.path);
        const highlight = measureFullRefreshHighlight({ cwd, paths: highlightOkPaths });
        const refreshMedianMs = median(refreshMs);

        const payloadBytes = Buffer.byteLength(JSON.stringify(cold));
        const stringifyStart = performance.now();
        JSON.stringify(cold);
        const stringifyMs = performance.now() - stringifyStart;

        const report = JSON.stringify(
          {
            scenario: {
              ...DIFF_PERF_SCENARIO,
              agentDurationMs: SCENARIO_AGENT_MS,
              trackedModifiedFiles: scenario.trackedModifiedFiles,
              untrackedFiles: scenario.untrackedFiles,
            },
            gitPolicy: resolveGitProcessPolicy({ env: process.env }),
            cold: {
              requestMs: Math.round(coldMs),
              files: cold.files.length,
              statuses: countBy(cold.files.map((file) => file.status ?? "ok")),
              payloadBytes,
              stringifyMs: Math.round(stringifyMs),
            },
            agent: {
              edits: edits.length,
              updates: updates.length,
              updateBytes: summarize(updates.map((update) => update.bytes)),
              updateGapsMs: summarize(
                updates
                  .slice(1)
                  .map((update, index) => update.receivedAt - updates[index]!.receivedAt),
              ),
              lastEditToLastUpdateMs: Math.round((updates.at(-1)?.receivedAt ?? 0) - lastEditAt),
            },
            singleFileRefresh: {
              refreshMs: summarize(refreshMs),
              gitOnlyMs: summarize(gitOnlyMs),
              highlightTotalMs: Math.round(highlight.totalMs),
              highlightShareOfRefresh: ratio(highlight.totalMs, refreshMedianMs),
              highlightByExtension: Object.fromEntries(
                Object.entries(highlight.byExtension).map(([extension, cost]) => [
                  extension,
                  {
                    files: cost.files,
                    totalMs: Math.round(cost.totalMs),
                    shareOfRefresh: ratio(cost.totalMs, refreshMedianMs),
                  },
                ]),
              ),
            },
          },
          null,
          2,
        );
        console.info("[git-diff-bottleneck:scenario]", report);
        if (SCENARIO_REPORT_PATH) writeFileSync(SCENARIO_REPORT_PATH, `${report}\n`);

        expect(edits.length).toBe(
          Math.floor(SCENARIO_AGENT_MS / DIFF_PERF_SCENARIO.agentIntervalMs),
        );
        expect(updates.length).toBeGreaterThan(0);
        expect(cold.files.length).toBe(scenario.trackedModifiedFiles + scenario.untrackedFiles);
      } finally {
        await ctx.cleanup();
      }
    } finally {
      if (originalMaxProcessesPerSecond === undefined) {
        delete process.env.PASEO_GIT_MAX_PROCESSES_PER_SECOND;
      } else {
        process.env.PASEO_GIT_MAX_PROCESSES_PER_SECOND = originalMaxProcessesPerSecond;
      }
      configureGitProcessPolicy(resolveGitProcessPolicy({ env: process.env }));
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 600_000);
});

async function timeSingleFileRefreshes(input: {
  cwd: string;
  count: number;
  includeStructured: boolean;
}): Promise<number[]> {
  const durations: number[] = [];
  for (let index = 0; index < input.count; index += 1) {
    // 接着模拟 Agent 的编号往后改，避免和之前的改动重复。
    editScenarioModule({ cwd: input.cwd, edit: 10_000 + index });
    const startedAt = performance.now();
    await getCheckoutDiff(input.cwd, {
      mode: "uncommitted",
      includeStructured: input.includeStructured,
    });
    durations.push(performance.now() - startedAt);
  }
  return durations;
}

/** 按 daemon 的做法给每个可显示的文件高亮新旧两版全文，量一次全量刷新里高亮本身的耗时。 */
function measureFullRefreshHighlight(input: { cwd: string; paths: string[] }) {
  const byExtension: Record<string, ExtensionHighlightCost> = {};
  let totalMs = 0;
  for (const filePath of input.paths) {
    if (!isLanguageSupported(filePath)) continue;
    const newContent = readFileSync(path.join(input.cwd, filePath), "utf8");
    const oldContent = readHeadContent({ cwd: input.cwd, filePath });
    const startedAt = performance.now();
    highlightCode(newContent, filePath);
    if (oldContent !== null) highlightCode(oldContent, filePath);
    const durationMs = performance.now() - startedAt;
    const extension = path.extname(filePath).slice(1);
    const cost = (byExtension[extension] ??= { files: 0, totalMs: 0 });
    cost.files += 1;
    cost.totalMs += durationMs;
    totalMs += durationMs;
  }
  return { totalMs, byExtension };
}

function readHeadContent(input: { cwd: string; filePath: string }): string | null {
  try {
    return execFileSync("git", ["show", `HEAD:${input.filePath}`], {
      cwd: input.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    // 未跟踪的新文件没有旧版本。
    return null;
  }
}

function summarize(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  function at(fraction: number): number {
    return Math.round(
      ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]!,
    );
  }
  return {
    count: values.length,
    median: at(0.5),
    p95: at(0.95),
    max: Math.round(ordered.at(-1)!),
  };
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Number((part / total).toFixed(3));
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

async function waitUntil(input: { predicate: () => boolean; timeoutMs: number }): Promise<void> {
  const deadline = performance.now() + input.timeoutMs;
  while (!input.predicate()) {
    if (performance.now() > deadline) {
      throw new Error(`condition not met within ${input.timeoutMs}ms`);
    }
    await delay(250);
  }
}

async function waitForQuiet(input: { lastEventAt: () => number; quietMs: number }): Promise<void> {
  while (performance.now() - input.lastEventAt() < input.quietMs) {
    await delay(250);
  }
}
