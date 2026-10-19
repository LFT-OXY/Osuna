import path from "node:path";
import { createDiffPerfScenario, runSimulatedAgent } from "./diff-perf-scenario.js";

/*
 *   node --import tsx diff-perf-scenario-cli.ts create <空目录>
 *   node --import tsx diff-perf-scenario-cli.ts agent <仓库目录> [持续毫秒] [间隔毫秒]
 */
const [command, cwd, durationMs, intervalMs] = process.argv.slice(2);

function parseOptionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

if (!cwd || (command !== "create" && command !== "agent")) {
  throw new Error("usage: diff-perf-scenario-cli.ts create|agent <dir> [durationMs] [intervalMs]");
}
if (command === "create") {
  process.stdout.write(`${JSON.stringify(createDiffPerfScenario(path.resolve(cwd)))}\n`);
} else {
  const edits = await runSimulatedAgent({
    cwd: path.resolve(cwd),
    durationMs: parseOptionalNumber(durationMs),
    intervalMs: parseOptionalNumber(intervalMs),
  });
  process.stdout.write(`${JSON.stringify({ edits: edits.length })}\n`);
}
