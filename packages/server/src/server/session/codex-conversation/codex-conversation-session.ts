import { promises as fs } from "node:fs";
import path from "node:path";
import type pino from "pino";
import type {
  CodexSessionError,
  CodexSessionMoved,
  CodexSessionMoveSkipped,
} from "@getpaseo/protocol/codex-session/rpc-schemas";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { CodexLocation } from "../../agent/agent-sdk-types.js";
import {
  readCodexConversationSettings,
  type CodexConversationSettings,
} from "../../codex-conversations/model-providers.js";
import {
  CODEX_MODEL_PROVIDER_ID_PATTERN,
  moveCodexConversation,
  type CodexConversationMoveOutcome,
} from "../../codex-conversations/move-to-model-provider.js";

export interface CodexConversationSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

type ListRequest = Extract<
  SessionInboundMessage,
  { type: "provider.codex.session.list_model_providers.request" }
>;
type MoveRequest = Extract<
  SessionInboundMessage,
  { type: "provider.codex.session.move_model_provider.request" }
>;
export type CodexConversationRequest = ListRequest | MoveRequest;

/** 挪动的备份放在 $PASEO_HOME 下这个目录里（docs/data-model.md）。 */
export const CODEX_MOVE_BACKUP_DIRECTORY = "codex-model-provider-moves";

const SKIP_MESSAGES = {
  active: "The conversation was written to in the last minute; it may still be running",
  not_found: "No Codex conversation file has this id",
} as const;

class NotACodexProviderError extends Error {
  constructor(readonly providerId: string) {
    super(`"${providerId}" is not a Codex provider`);
    this.name = "NotACodexProviderError";
  }
}

/**
 * 挪 Codex 对话与 apiEndpointCliWiring 能力位同在：daemon 没有第三方接口服务时为 null（也不声明能力位）。
 */
export function createCodexConversationSession(options: {
  host: CodexConversationSessionHost;
  isAvailable: boolean;
  resolveLocation: (providerId: string) => CodexLocation | null;
  paseoHome: string;
  logger: pino.Logger;
}): CodexConversationSession | null {
  if (!options.isAvailable) return null;
  return new CodexConversationSession(options);
}

/**
 * 把 Codex 对话挪到另一个 Codex 服务商（ADR 0011）。在会话历史列出它的那个提供方的 CODEX_HOME 里找
 * 对话文件、状态库与 config.toml（magpie 按文件所在的 Codex 目录 codexHomeOf 找状态库）。
 */
export class CodexConversationSession {
  private readonly host: CodexConversationSessionHost;
  private readonly resolveLocation: (providerId: string) => CodexLocation | null;
  private readonly backupRoot: string;
  private readonly logger: pino.Logger;

  constructor(options: {
    host: CodexConversationSessionHost;
    resolveLocation: (providerId: string) => CodexLocation | null;
    paseoHome: string;
    logger: pino.Logger;
  }) {
    this.host = options.host;
    this.resolveLocation = options.resolveLocation;
    this.backupRoot = path.join(options.paseoHome, CODEX_MOVE_BACKUP_DIRECTORY);
    this.logger = options.logger;
  }

  async handle(request: CodexConversationRequest): Promise<void> {
    switch (request.type) {
      case "provider.codex.session.list_model_providers.request":
        return this.handleList(request);
      case "provider.codex.session.move_model_provider.request":
        return this.handleMove(request);
    }
  }

  private async handleList(request: ListRequest): Promise<void> {
    try {
      const { settings } = await this.readSettings(request.providerId);
      this.host.emit({
        type: "provider.codex.session.list_model_providers.response",
        payload: {
          requestId: request.requestId,
          modelProviders: settings.modelProviders,
          error: null,
        },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to list Codex model providers");
      this.host.emit({
        type: "provider.codex.session.list_model_providers.response",
        payload: { requestId: request.requestId, modelProviders: [], error: toWireError(error) },
      });
    }
  }

  private async handleMove(request: MoveRequest): Promise<void> {
    const { requestId, to } = request;
    if (!CODEX_MODEL_PROVIDER_ID_PATTERN.test(to)) {
      this.emitMoveResponse({
        requestId,
        to,
        outcomes: [],
        error: { code: "invalid_input", message: `"${to}" isn't a Codex model provider id` },
      });
      return;
    }
    try {
      const { codexHome, settings } = await this.readSettings(request.providerId);
      const outcomes: CodexConversationMoveOutcome[] = [];
      for (const threadId of request.threadIds) {
        const outcome = await moveCodexConversation({
          codexHome,
          stateDirectory: settings.stateDirectory,
          backupRoot: this.backupRoot,
          threadId,
          to,
          now: new Date(),
        });
        if (outcome.kind === "failed" || outcome.kind === "state_database_failed") {
          this.logger.warn(
            { threadId, to, kind: outcome.kind, reason: outcome.message },
            "Codex conversation not fully moved",
          );
        }
        outcomes.push(outcome);
      }
      this.emitMoveResponse({ requestId, to, outcomes, error: null });
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to move Codex conversations");
      this.emitMoveResponse({ requestId, to, outcomes: [], error: toWireError(error) });
    }
  }

  private emitMoveResponse(input: {
    requestId: string;
    to: string;
    outcomes: CodexConversationMoveOutcome[];
    error: CodexSessionError | null;
  }): void {
    const moved: CodexSessionMoved[] = [];
    const skipped: CodexSessionMoveSkipped[] = [];
    for (const outcome of input.outcomes) {
      if (outcome.kind === "moved") {
        const { kind: _kind, ...entry } = outcome;
        moved.push(entry);
        continue;
      }
      skipped.push(toSkipped(outcome));
    }
    this.host.emit({
      type: "provider.codex.session.move_model_provider.response",
      payload: { requestId: input.requestId, to: input.to, moved, skipped, error: input.error },
    });
  }

  private async readSettings(
    providerId: string,
  ): Promise<{ codexHome: string; settings: CodexConversationSettings }> {
    const location = this.resolveLocation(providerId);
    if (!location) throw new NotACodexProviderError(providerId);
    const { codexHome, env } = location;
    const configText = await readOptionalText(path.join(codexHome, "config.toml"));
    return { codexHome, settings: readCodexConversationSettings({ configText, codexHome, env }) };
  }
}

function toSkipped(
  outcome: Exclude<CodexConversationMoveOutcome, { kind: "moved" }>,
): CodexSessionMoveSkipped {
  switch (outcome.kind) {
    case "active":
    case "not_found":
      return {
        threadId: outcome.threadId,
        reason: outcome.kind,
        message: SKIP_MESSAGES[outcome.kind],
      };
    case "failed":
    case "state_database_failed": {
      const backup = outcome.backupPath ? { backupPath: outcome.backupPath } : {};
      return {
        threadId: outcome.threadId,
        reason: outcome.kind,
        message: outcome.message,
        ...backup,
      };
    }
  }
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function toWireError(error: unknown): CodexSessionError {
  if (error instanceof NotACodexProviderError) {
    return { code: "invalid_input", message: error.message };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
