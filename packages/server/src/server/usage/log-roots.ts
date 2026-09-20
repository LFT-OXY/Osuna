import { homedir } from "node:os";
import path from "node:path";
import type { UsageCli } from "@osuna/protocol/usage/types";
import { resolveOmpSessionPaths } from "../agent/providers/omp/provider-config.js";
import { resolvePiSessionsDir } from "../agent/providers/pi/session-descriptor.js";

/** Where each CLI keeps its session transcripts, by that CLI's own rules. */
export type UsageLogRoots = Record<UsageCli, string[]>;

export interface ResolveUsageLogRootsOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

/**
 * Async because Pi's directory can come from its own `settings.json`, and the
 * scanner has to look exactly where Pi and OMP look.
 */
export async function resolveUsageLogRoots(
  options: ResolveUsageLogRootsOptions = {},
): Promise<UsageLogRoots> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const codexHome = trimmed(env.CODEX_HOME) ?? path.join(home, ".codex");
  return {
    claude: [path.join(trimmed(env.CLAUDE_CONFIG_DIR) ?? path.join(home, ".claude"), "projects")],
    codex: [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")],
    pi: [await resolvePiSessionsDir({ env, homeDir: home })],
    omp: [resolveOmpSessionPaths({ env, homeDir: home }).sessionsDir],
  };
}

function trimmed(value: string | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}
