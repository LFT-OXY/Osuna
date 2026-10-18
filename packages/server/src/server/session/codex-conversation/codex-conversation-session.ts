import { promises as fs } from "node:fs";
import path from "node:path";
import type pino from "pino";
import type {
  CodexSessionError,
  CodexSessionMoved,
  CodexSessionMoveSkipped,
} from "@getpaseo/protocol/codex-session/rpc-schemas";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ApiEndpointService, CodexLocation } from "../../api-endpoints/service.js";
import {
  CodexConfigUnreadableError,
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

/** 挪 Codex 对话的 Codex 目录跟着第三方接口服务走：daemon 没有这项服务时为 null。 */
export function createCodexConversationSession(options: {
  host: CodexConversationSessionHost;
  apiEndpointService: ApiEndpointService | undefined;
  paseoHome: string;
  logger: pino.Logger;
}): CodexConversationSession | null {
  const { apiEndpointService } = options;
  if (!apiEndpointService) return null;
  return new CodexConversationSession({
    host: options.host,
    resolveLocation: () => apiEndpointService.resolveCodexLocation(),
    paseoHome: options.paseoHome,
    logger: options.logger,
  });
}

/**
 * 把 Codex 对话挪到另一个 Codex 服务商（ADR 0011）。Codex 目录与第三方接口改写的 config.toml 是同一处
 * （`resolveLocation`），所以列出的「Osuna 自己的服务商」就是那里的表。
 */
export class CodexConversationSession {
  private readonly host: CodexConversationSessionHost;
  private readonly resolveLocation: () => CodexLocation;
  private readonly backupRoot: string;
  private readonly logger: pino.Logger;

  constructor(options: {
    host: CodexConversationSessionHost;
    resolveLocation: () => CodexLocation;
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
      const settings = await this.readSettings();
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
      const { codexHome } = this.resolveLocation();
      const settings = await this.readSettings();
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
        if (outcome.kind === "failed") {
          this.logger.warn(
            { threadId, to, reason: outcome.message },
            "Codex conversation not moved",
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
      const message = outcome.kind === "failed" ? outcome.message : SKIP_MESSAGES[outcome.kind];
      skipped.push({ threadId: outcome.threadId, reason: outcome.kind, message });
    }
    this.host.emit({
      type: "provider.codex.session.move_model_provider.response",
      payload: { requestId: input.requestId, to: input.to, moved, skipped, error: input.error },
    });
  }

  private async readSettings(): Promise<CodexConversationSettings> {
    const { codexHome, env } = this.resolveLocation();
    const configText = await readOptionalText(path.join(codexHome, "config.toml"));
    return readCodexConversationSettings({ configText, codexHome, env });
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
  if (error instanceof CodexConfigUnreadableError) {
    return { code: "config_unparsable", message: error.message };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
