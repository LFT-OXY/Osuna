import path from "node:path";
import type { UsageCli } from "@getpaseo/protocol/usage/types";
import {
  createClaudeParserState,
  parseClaudeChunk,
  settleClaudeOpenTurn,
} from "./claude-parser.js";
import { createCodexParserState, parseCodexChunk, settleCodexOpenTurn } from "./codex-parser.js";
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
/** `rollout-<local time>-<thread id>.jsonl`, with a `_<rollout id>` suffix after a revert. */
const CODEX_ROLLOUT_NAME = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/;

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
        cursorKey: `claude ${sessionId} ${stripJsonlExtension(agentFile)}`,
        parser: createClaudeParserState({ subagent: true }),
      };
    }
    const fileName = segments[segments.length - 1];
    if (!fileName) return null;
    return {
      cursorKey: `claude ${stripJsonlExtension(fileName)}`,
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

const codexAdapter: UsageSourceAdapter = {
  cli: "codex",
  identify(_root, filePath) {
    const fileName = stripJsonlExtension(path.basename(filePath));
    const threadId = CODEX_ROLLOUT_NAME.exec(fileName)?.[1]?.split("_")[0] ?? null;
    // Archiving a thread moves its file under `archived_sessions/`; keying on
    // the thread id rather than the path is what keeps it one file to scan.
    return {
      cursorKey: `codex ${threadId ?? fileName}`,
      parser: createCodexParserState({ threadId }),
    };
  },
  parse(bytes, state) {
    return parseCodexChunk(bytes, assertCodexState(state));
  },
  settleIdle(state) {
    return settleCodexOpenTurn(assertCodexState(state));
  },
};

/** Sources whose parser exists. A configured root with no adapter is not scanned. */
export const USAGE_SOURCE_ADAPTERS: Partial<Record<UsageCli, UsageSourceAdapter>> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

function assertClaudeState(state: UsageParserState) {
  if (state.kind !== "claude") {
    throw new Error(`Expected a Claude usage parser state, got "${state.kind}"`);
  }
  return state;
}

function assertCodexState(state: UsageParserState) {
  if (state.kind !== "codex") {
    throw new Error(`Expected a Codex usage parser state, got "${state.kind}"`);
  }
  return state;
}

function stripJsonlExtension(fileName: string): string {
  return fileName.replace(/\.jsonl$/, "");
}
