import path from "node:path";
import type { UsageCli } from "@osuna/protocol/usage/types";
import {
  createClaudeParserState,
  parseClaudeChunk,
  settleClaudeOpenTurn,
} from "./claude-parser.js";
import { createCodexParserState, parseCodexChunk, settleCodexOpenTurn } from "./codex-parser.js";
import {
  createPiLikeParserState,
  parsePiLikeChunk,
  settlePiLikeOpenTurn,
} from "./pi-like-parser.js";
import type { PiLikeParserState, UsageParserState, UsageParseResult } from "./types.js";

/**
 * The cursor key of a session's own transcript. A subagent file of that session
 * appends a segment, so this is also the prefix its files share.
 */
export function sessionCursorKey(cli: UsageCli, sessionId: string): string {
  return `${cli} ${sessionId}`;
}

/** Whether a cursor key names this session's transcript or one of its subagents. */
export function cursorKeyOfSession(key: string, cli: UsageCli, sessionId: string): boolean {
  const prefix = sessionCursorKey(cli, sessionId);
  return key === prefix || key.startsWith(`${prefix} `);
}

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
        cursorKey: `${sessionCursorKey("claude", sessionId)} ${stripJsonlExtension(agentFile)}`,
        parser: createClaudeParserState({ subagent: true }),
      };
    }
    const fileName = segments[segments.length - 1];
    if (!fileName) return null;
    return {
      cursorKey: sessionCursorKey("claude", stripJsonlExtension(fileName)),
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
      cursorKey: sessionCursorKey("codex", threadId ?? fileName),
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

/**
 * Pi and OMP lay their transcripts out the same way: `<cwd dir>/<stamp>_<id>.jsonl`
 * is a session, and the directory named after that file holds its subagents —
 * Pi under `tasks/` or a nested `run-N/`, OMP as `<Agent>.jsonl` and deeper.
 * So anything more than two levels below the root belongs to the session its
 * second path segment names.
 */
function piLikeAdapter(cli: PiLikeParserState["kind"]): UsageSourceAdapter {
  return {
    cli,
    identify(root, filePath) {
      const segments = path.relative(root, filePath).split(path.sep);
      const fileName = segments[segments.length - 1];
      if (!fileName) return null;
      const sessionDir = segments[1];
      if (segments.length > 2 && sessionDir) {
        const sessionId = sessionIdFromName(sessionDir);
        return {
          cursorKey: `${sessionCursorKey(cli, sessionId)} ${segments.slice(2).join("/")}`,
          parser: createPiLikeParserState({ cli, sessionId, subagent: true }),
        };
      }
      // The header overrides this, but a file read from the top needs a session
      // before it gets there.
      const sessionId = sessionIdFromName(stripJsonlExtension(fileName));
      return {
        cursorKey: sessionCursorKey(cli, sessionId),
        parser: createPiLikeParserState({ cli, sessionId, subagent: false }),
      };
    },
    parse(bytes, state) {
      return parsePiLikeChunk(bytes, assertPiLikeState(state, cli));
    },
    settleIdle(state) {
      return settlePiLikeOpenTurn(assertPiLikeState(state, cli));
    },
  };
}

/** Sources whose parser exists. A configured root with no adapter is not scanned. */
export const USAGE_SOURCE_ADAPTERS: Partial<Record<UsageCli, UsageSourceAdapter>> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  pi: piLikeAdapter("pi"),
  omp: piLikeAdapter("omp"),
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

function assertPiLikeState(
  state: UsageParserState,
  cli: PiLikeParserState["kind"],
): PiLikeParserState {
  if (state.kind !== cli) {
    throw new Error(`Expected a ${cli} usage parser state, got "${state.kind}"`);
  }
  return state;
}

/** `<stamp>_<session id>`, which both CLIs name a session file and its directory. */
function sessionIdFromName(name: string): string {
  return name.slice(name.lastIndexOf("_") + 1);
}

function stripJsonlExtension(fileName: string): string {
  return fileName.replace(/\.jsonl$/, "");
}
