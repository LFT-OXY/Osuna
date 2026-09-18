import path from "node:path";
import type { UsageCli } from "@getpaseo/protocol/usage/types";
import {
  createClaudeParserState,
  parseClaudeChunk,
  settleClaudeOpenTurn,
} from "./claude-parser.js";
import type { UsageParserState, UsageParseResult } from "./types.js";

export interface UsageFileIdentity {
  /** Identifies the file across renames; also the `(cli, sessionId)` cursor key. */
  cursorKey: string;
  parser: UsageParserState;
}

export interface UsageSourceAdapter {
  cli: UsageCli;
  /** Null for a path this source does not own. */
  identify(root: string, filePath: string): UsageFileIdentity | null;
  parse(bytes: Buffer, state: UsageParserState): UsageParseResult;
  /** Close out a turn whose file has gone quiet. */
  settleIdle(state: UsageParserState): UsageParseResult;
}

const SUBAGENTS_DIR = "subagents";

const claudeAdapter: UsageSourceAdapter = {
  cli: "claude",
  identify(root, filePath) {
    const segments = path.relative(root, filePath).split(path.sep);
    // <project>/<sessionId>.jsonl, or <project>/<sessionId>/subagents/agent-<id>.jsonl
    const subagentsIndex = segments.indexOf(SUBAGENTS_DIR);
    if (subagentsIndex > 0) {
      const sessionId = segments[subagentsIndex - 1];
      const agentFile = segments[segments.length - 1];
      if (!sessionId || !agentFile) return null;
      return {
        cursorKey: `claude ${sessionId} ${basename(agentFile)}`,
        parser: createClaudeParserState({ subagent: true }),
      };
    }
    const fileName = segments[segments.length - 1];
    if (!fileName) return null;
    return {
      cursorKey: `claude ${basename(fileName)}`,
      parser: createClaudeParserState({ subagent: false }),
    };
  },
  parse(bytes, state) {
    return parseClaudeChunk(bytes, assertClaudeState(state));
  },
  settleIdle(state) {
    return settleClaudeOpenTurn(assertClaudeState(state));
  },
};

/** Sources whose parser exists. A configured root with no adapter is not scanned. */
export const USAGE_SOURCE_ADAPTERS: Partial<Record<UsageCli, UsageSourceAdapter>> = {
  claude: claudeAdapter,
};

function assertClaudeState(state: UsageParserState) {
  if (state.kind !== "claude") {
    throw new Error(`Expected a Claude usage parser state, got "${state.kind}"`);
  }
  return state;
}

function basename(fileName: string): string {
  return fileName.replace(/\.jsonl$/, "");
}
