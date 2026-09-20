/**
 * Builds Claude transcript lines for tests that need a specific turn shape —
 * a half-written turn, a resume that replays its parent — which the checked-in
 * `.jsonl` fixtures cannot express.
 */

export interface ClaudeUserLineInput {
  sessionId: string;
  promptId: string;
  at: string;
  cwd: string;
}

export function claudeUserLine(input: ClaudeUserLineInput): string {
  return JSON.stringify({
    type: "user",
    sessionId: input.sessionId,
    cwd: input.cwd,
    promptId: input.promptId,
    uuid: `u-${input.promptId}`,
    timestamp: input.at,
    message: { role: "user", content: "hi" },
  });
}

export interface ClaudeAssistantLineInput {
  sessionId: string;
  at: string;
  cwd: string;
  output: number;
  messageId: string;
  model?: string;
  /**
   * A line with no stop reason leaves the turn open, which is what a read that
   * lands mid-turn sees.
   */
  finished: boolean;
  /** Marks the line as replayed from the session this one was resumed from. */
  forkedFrom?: string;
}

export function claudeAssistantLine(input: ClaudeAssistantLineInput): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: input.sessionId,
    cwd: input.cwd,
    uuid: `a-${input.messageId}`,
    timestamp: input.at,
    ...(input.forkedFrom ? { forkedFrom: { sessionId: input.forkedFrom, messageUuid: "x" } } : {}),
    message: {
      id: input.messageId,
      role: "assistant",
      model: input.model ?? "claude-opus-5",
      ...(input.finished ? { stop_reason: "end_turn" } : {}),
      usage: {
        input_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: input.output,
      },
    },
  });
}

export interface ClaudeTurnInput {
  sessionId: string;
  promptId: string;
  at: string;
  cwd: string;
  output: number;
  /** Defaults to five seconds after the prompt. */
  answeredAt?: string;
}

/** One finished turn: the prompt, then the answer that closes it. */
export function claudeTurn(input: ClaudeTurnInput): string {
  const answeredAt = input.answeredAt ?? new Date(Date.parse(input.at) + 5_000).toISOString();
  const user = claudeUserLine(input);
  const assistant = claudeAssistantLine({
    sessionId: input.sessionId,
    at: answeredAt,
    cwd: input.cwd,
    output: input.output,
    messageId: `msg-${input.promptId}`,
    finished: true,
  });
  return `${user}\n${assistant}\n`;
}
