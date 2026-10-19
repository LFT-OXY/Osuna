import { CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE } from "@getpaseo/protocol/codex-session/rpc-schemas";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { CodexModelProviderMissingError } from "./codex-conversations/model-provider-missing.js";

/*
 * 续一段提供方对话（导入、resume_agent_request、refresh_agent_request）失败时发给 app 的原因。
 * app 只认 code，不匹配英文原文；认不出的是 unknown，各处理器按自己原来的码发出。
 */
export type AgentResumeWireErrorCode = typeof CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE | "unknown";

export interface AgentResumeWireError {
  code: AgentResumeWireErrorCode;
  message: string;
}

export function toAgentResumeWireError(error: unknown): AgentResumeWireError {
  const message = getErrorMessage(error);
  if (isCodexModelProviderMissing(error)) {
    return { code: CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE, message };
  }
  return { code: "unknown", message };
}

export function isCodexModelProviderMissing(error: unknown): boolean {
  // 提供方抛的类型化错误可能被上层包了一层，顺着 cause 找。
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof CodexModelProviderMissingError) return true;
    current = current.cause;
  }
  return false;
}
