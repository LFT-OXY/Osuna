import type pino from "pino";
import { z } from "zod";
import type { ProviderRuntimeSettings } from "../agent/provider-launch-config.js";
import { requestTemporaryCodexAppServer } from "../agent/providers/codex-app-server-agent.js";

/*
 * Codex 是怎么登录的（ADR 0010）：决定 config.toml 用哪种接法。Osuna 不读 auth.json、钥匙串，
 * 起一个临时的 Codex app-server、覆盖成内置 openai 服务商后问 account/read。
 * 当前服务商是 Osuna 的服务商表时 account/read 报不出账号（那张表不要求 OpenAI 登录），所以要覆盖。
 */

export type CodexSignIn = "chatgpt" | "api_key" | "signed_out" | "other";

/** 可替换的「登录方式」适配器：生产起临时 app-server，测试换成固定答案，绝不碰真的 Codex。 */
export type ReadCodexSignIn = () => Promise<CodexSignIn>;

// ChatGPT 账号的 account/read 会先向 chatgpt.com 查工作区路由，Codex 自己最多等 15 秒。
const ACCOUNT_READ_TIMEOUT_MS = 20_000;

const AccountReadSchema = z.object({
  account: z.object({ type: z.string() }).passthrough().nullable(),
});

/** account/read 的回答换成登录方式；认不出就抛错，调用方保持现在的接法。 */
export function codexSignInOf(response: unknown): CodexSignIn {
  const { account } = AccountReadSchema.parse(response);
  if (account === null) return "signed_out";
  if (account.type === "chatgpt") return "chatgpt";
  if (account.type === "apiKey") return "api_key";
  return "other";
}

export function createCodexSignInReader(input: {
  runtimeSettings?: ProviderRuntimeSettings;
  logger: pino.Logger;
}): ReadCodexSignIn {
  return async () =>
    codexSignInOf(
      await requestTemporaryCodexAppServer({
        runtimeSettings: input.runtimeSettings,
        logger: input.logger,
        configOverrides: ['model_provider="openai"'],
        method: "account/read",
        params: { refreshToken: false },
        timeoutMs: ACCOUNT_READ_TIMEOUT_MS,
      }),
    );
}
