import { CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE } from "@getpaseo/protocol/codex-session/rpc-schemas";

/*
 * 续 Codex 对话时 Codex 按它记的 Codex 服务商加载配置；那个服务商已不在 config.toml 里时整个配置加载失败，
 * 报 ``Model provider `<id>` not found``（codex-rs core/src/config/mod.rs，app-server 前面再加
 * "failed to load configuration: "）。认出来后换成带可识别原因的错误，app 据此给出「挪到另一个 Codex 服务商」。
 */
const MISSING_MODEL_PROVIDER = /Model provider `([^`]+)` not found/;

export class CodexModelProviderMissingError extends Error {
  readonly code = CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE;

  constructor(
    message: string,
    readonly modelProvider: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CodexModelProviderMissingError";
  }
}

/** Codex 报的是「服务商不在了」时返回那个服务商的 id，否则 null。 */
export function findMissingCodexModelProvider(message: string): string | null {
  return MISSING_MODEL_PROVIDER.exec(message)?.[1] ?? null;
}

/** 错误本身或它的 cause 链上有没有「Codex 服务商不在了」。 */
export function isCodexModelProviderMissing(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof CodexModelProviderMissingError) return true;
    current = current.cause;
  }
  return false;
}
