import { cpSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SERVER_FIXTURES = path.join(__dirname, "../../../../server/src/server/usage/fixtures");

export interface UsageFixtureRoots {
  root: string;
  /** Environment for the worker daemon: one fixture tree per CLI, in that CLI's own layout. */
  environment: Record<string, string>;
}

/**
 * Copies the parser fixtures into the directory shape each CLI really writes,
 * so the daemon's scanner finds them the way it finds a developer's own logs.
 * Built synchronously at module scope: the worker daemon starts before the
 * first test body runs.
 */
export function createUsageFixtureRoots(prefix: string): UsageFixtureRoots {
  const root = mkdtempSync(path.join(tmpdir(), prefix));

  // Claude files a transcript under a directory named after the encoded cwd.
  const claudeProjects = path.join(root, "claude", "projects", "-work-osuna");
  copyJsonl(path.join(SERVER_FIXTURES, "claude"), claudeProjects);

  // Codex rollouts live under `<CODEX_HOME>/sessions/YYYY/MM/DD`.
  const codexDay = path.join(root, "codex", "sessions", "2026", "09", "18");
  copyJsonl(path.join(SERVER_FIXTURES, "codex"), codexDay);

  const piSessions = path.join(root, "pi", "sessions");
  copyJsonl(path.join(SERVER_FIXTURES, "pi"), piSessions);

  const ompSessions = path.join(root, "omp", "agent", "sessions");
  copyJsonl(path.join(SERVER_FIXTURES, "omp"), ompSessions);

  return {
    root,
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

function copyJsonl(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (!name.endsWith(".jsonl")) continue;
    cpSync(path.join(from, name), path.join(to, name));
  }
}
