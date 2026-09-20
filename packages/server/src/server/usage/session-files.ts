import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeProjectDirNameSync } from "../agent/providers/claude/project-dir.js";
import type { UsageAgentBacking } from "./agent-sessions.js";
import type { UsageLogRoots } from "./log-roots.js";
import { sessionCursorKey } from "./sources.js";
import { isMissingPathError, type UsageScanState } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LocateSessionFileInput {
  backing: UsageAgentBacking;
  roots: UsageLogRoots;
  /** The cursors double as the session-id to path index. */
  scanState: UsageScanState;
  now: () => number;
}

/**
 * Where the CLI is writing the agent's current session, by that CLI's own
 * rules. Null means "not placed" — for Codex that is a rollout no cursor knows
 * and no recent date directory holds, which the periodic scan will pick up.
 */
export async function locateSessionFile(input: LocateSessionFileInput): Promise<string | null> {
  const { backing } = input;
  const sessionId = backing.sessionIds.at(-1);
  if (!sessionId) return null;
  switch (backing.cli) {
    case "pi":
    case "omp":
      // Both write the path into the handle they hand back.
      return backing.logPath ? await existingPath(backing.logPath) : null;
    case "claude":
      return await claudeTranscript(input.roots.claude, backing.cwd, sessionId);
    case "codex": {
      const known = input.scanState.cursors[sessionCursorKey("codex", sessionId)];
      const seen = known ? await existingPath(known.path) : null;
      return seen ?? (await codexRollout(input.roots.codex, sessionId, input.now()));
    }
  }
}

/** Claude files itself under a directory named after the encoded cwd. */
async function claudeTranscript(
  roots: readonly string[],
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const projectDir = claudeProjectDirNameSync(cwd);
  for (const root of roots) {
    const candidate = await existingPath(path.join(root, projectDir, `${sessionId}.jsonl`));
    if (candidate) return candidate;
  }
  return null;
}

/** Codex rollouts sit under `<root>/YYYY/MM/DD`, stamped in local time. */
async function codexRollout(
  roots: readonly string[],
  threadId: string,
  nowMs: number,
): Promise<string | null> {
  for (const offset of [0, DAY_MS]) {
    const at = new Date(nowMs - offset);
    const day = [
      String(at.getFullYear()),
      String(at.getMonth() + 1).padStart(2, "0"),
      String(at.getDate()).padStart(2, "0"),
    ];
    for (const root of roots) {
      const dir = path.join(root, ...day);
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch (error) {
        if (isMissingPathError(error)) continue;
        throw error;
      }
      // `rollout-<stamp>-<thread id>.jsonl`, with a `_<rollout id>` after a revert.
      const match = names.find(
        (name) => name.endsWith(`${threadId}.jsonl`) || name.includes(`${threadId}_`),
      );
      if (match) return path.join(dir, match);
    }
  }
  return null;
}

async function existingPath(filePath: string): Promise<string | null> {
  try {
    await fs.stat(filePath);
    return filePath;
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}
