import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SERVER_FIXTURES = path.join(__dirname, "../../../../server/src/server/usage/fixtures");

/** The day every server fixture is stamped with, and the only date in their text. */
const SOURCE_DAY = "2026-09-18";

/**
 * How far back the copies are dated. Two days keeps every fixture in the past
 * whichever side of UTC midnight the browser and the daemon land on, and well
 * inside the report's trailing 7-day, 30-day and 26-week windows.
 */
const DAYS_AGO = 2;

export interface UsageFixtureRoots {
  root: string;
  /**
   * The local day every fixture line lands on. The server fixtures carry a fixed
   * date, so the copies are restamped relative to today: an assertion about the
   * statistics footer, the heatmap or the trend would otherwise start failing on
   * the day that date fell out of the report's trailing windows.
   */
  day: string;
  /** Environment for the worker daemon: one fixture tree per CLI, in that CLI's own layout. */
  environment: Record<string, string>;
}

function daysAgo(count: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - count);
  return at.toISOString().slice(0, 10);
}

/**
 * Copies the parser fixtures into the directory shape each CLI really writes,
 * so the daemon's scanner finds them the way it finds a developer's own logs.
 * Built synchronously at module scope: the worker daemon starts before the
 * first test body runs.
 */
export function createUsageFixtureRoots(prefix: string): UsageFixtureRoots {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const day = daysAgo(DAYS_AGO);

  // Claude files a transcript under a directory named after the encoded cwd.
  const claudeProjects = path.join(root, "claude", "projects", "-work-osuna");
  copyJsonl(path.join(SERVER_FIXTURES, "claude"), claudeProjects, day);

  // Codex rollouts live under `<CODEX_HOME>/sessions/YYYY/MM/DD`.
  const codexDay = path.join(root, "codex", "sessions", ...day.split("-"));
  copyJsonl(path.join(SERVER_FIXTURES, "codex"), codexDay, day);

  const piSessions = path.join(root, "pi", "sessions");
  copyJsonl(path.join(SERVER_FIXTURES, "pi"), piSessions, day);

  const ompSessions = path.join(root, "omp", "agent", "sessions");
  copyJsonl(path.join(SERVER_FIXTURES, "omp"), ompSessions, day);

  return {
    root,
    day,
    environment: {
      CLAUDE_CONFIG_DIR: path.join(root, "claude"),
      CODEX_HOME: path.join(root, "codex"),
      PI_CODING_AGENT_SESSION_DIR: piSessions,
      // OMP derives its sessions directory from the shared agent-dir variable;
      // Pi ignores it because its own session-dir variable above wins.
      PI_CODING_AGENT_DIR: path.join(root, "omp", "agent"),
      PASEO_USAGE_SCAN_INTERVAL_MS: "1000",
      PASEO_USAGE_PRICING_AUTO_UPDATE: "0",
    },
  };
}

function copyJsonl(from: string, to: string, day: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (!name.endsWith(".jsonl")) continue;
    const source = readFileSync(path.join(from, name), "utf8");
    writeFileSync(path.join(to, name), source.replaceAll(SOURCE_DAY, day));
  }
}
