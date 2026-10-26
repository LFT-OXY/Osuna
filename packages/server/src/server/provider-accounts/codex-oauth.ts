// 登录页参数、换 token 与续期的请求移植自 magpie（https://github.com/yetone/magpie，d5805372）：
// internal/provider/signin.go 的 begin、codexExchange、codexLogin，account.go 的 codexRefresh、refreshFailed。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { createHash, randomBytes } from "node:crypto";
import { decodeJwtClaims, isRecord, nonEmptyString } from "./cli-login.js";

/*
 * Codex 的 ChatGPT 登录：Osuna 用 Codex 自己的 OAuth 客户端跑登录、续期（ADR 0015 的身份例外 1、2）。
 * 续期请求一旦发出就等它回来，不随调用方（读额度、保活、daemon 关闭）取消：OpenAI 回复时就换掉了
 * refresh token，丢掉回复就只剩用过的那个。只有它自己 30 秒的上限（同 magpie 的 codexRefresh）。
 */

export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_SCOPES =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
const REFRESH_SCOPES = "openid profile email";
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

/** 登录页与发 token 的地址；测试指向本机的假服务。 */
export interface CodexOAuthEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
}

export const CODEX_OAUTH_ENDPOINTS: CodexOAuthEndpoints = {
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
};

export interface CodexTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

/** 与 `codex login` 写的 auth.json 同形；存着的号整份存它。 */
export type CodexLogin = Record<string, unknown>;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export function createPkcePair(): PkcePair {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function codexAuthorizeUrl(input: {
  endpoints: CodexOAuthEndpoints;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CODEX_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: CODEX_SCOPES,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: input.state,
    originator: "codex_cli_rs",
  });
  return `${input.endpoints.authorizeUrl}?${query.toString()}`;
}

/** 换 token 或续期没成功；refused 为真是 OpenAI 回了话、拒绝了这个登录（号要重新登录）。 */
export interface CodexTokenRequestFailure {
  message: string;
  refused: boolean;
  // OpenAI 回的错误码（invalid_grant 等）；被拒却没回码时为 refused。
  code?: string;
  // 不带句子的技术细节（「HTTP 400: invalid_grant」「fetch failed」），界面接在翻译过的原因后面。
  detail: string;
  cause?: unknown;
}

export class CodexTokenRequestError extends Error {
  readonly refused: boolean;
  readonly code: string | undefined;
  readonly detail: string;

  constructor(failure: CodexTokenRequestFailure) {
    super(failure.message, failure.cause === undefined ? undefined : { cause: failure.cause });
    this.name = "CodexTokenRequestError";
    this.refused = failure.refused;
    this.code = failure.code;
    this.detail = failure.detail;
  }
}

// 续期被拒就是登录没了（magpie 的 refreshRefused）：OpenAI 回的这几个错误码，或 400 / 401。
const REFUSED_CODES = new Set(["invalid_grant", "refresh_token_reused", "token_revoked"]);

export async function exchangeCodexCode(input: {
  endpoints: CodexOAuthEndpoints;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<CodexTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: input.verifier,
  });
  const reply = await postToken({
    tokenUrl: input.endpoints.tokenUrl,
    contentType: "application/x-www-form-urlencoded",
    body: body.toString(),
  });
  const idToken = nonEmptyString(reply.body?.id_token);
  const accessToken = nonEmptyString(reply.body?.access_token);
  const refreshToken = nonEmptyString(reply.body?.refresh_token);
  if (reply.status !== 200 || !idToken || !accessToken || !refreshToken) {
    const detail = `HTTP ${reply.status}${describeError(reply.body)}`;
    const code = errorCode(reply.body);
    throw new CodexTokenRequestError({
      message: `ChatGPT didn't sign in (${detail})`,
      refused: false,
      ...(code ? { code } : {}),
      detail,
    });
  }
  return { idToken, accessToken, refreshToken };
}

/** 续一个 auth.json 形状的登录；返回换好 token 的新一份，其余字段照旧。 */
export async function refreshCodexLogin(input: {
  endpoints: CodexOAuthEndpoints;
  login: CodexLogin;
  now: () => number;
}): Promise<CodexLogin> {
  const tokens = isRecord(input.login.tokens) ? input.login.tokens : {};
  const refreshToken = nonEmptyString(tokens.refresh_token);
  if (!refreshToken) {
    throw new CodexTokenRequestError({
      message: "The saved login has no refresh token",
      refused: true,
      code: "refused",
      detail: "no refresh token",
    });
  }
  const reply = await postToken({
    tokenUrl: input.endpoints.tokenUrl,
    contentType: "application/json",
    body: JSON.stringify({
      client_id: CODEX_OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: REFRESH_SCOPES,
    }),
  });
  const accessToken = nonEmptyString(reply.body?.access_token);
  if (reply.status !== 200 || !accessToken) {
    const code = errorCode(reply.body);
    const refused =
      reply.status === 400 ||
      reply.status === 401 ||
      (code !== undefined && REFUSED_CODES.has(code));
    const detail = `HTTP ${reply.status}${describeError(reply.body)}`;
    const failureCode = code ?? (refused ? "refused" : undefined);
    throw new CodexTokenRequestError({
      message: `Codex token refresh failed (${detail})`,
      refused,
      ...(failureCode ? { code: failureCode } : {}),
      detail,
    });
  }
  const idToken = nonEmptyString(reply.body?.id_token);
  const nextRefresh = nonEmptyString(reply.body?.refresh_token);
  return {
    ...input.login,
    tokens: {
      ...tokens,
      access_token: accessToken,
      ...(idToken ? { id_token: idToken } : {}),
      ...(nextRefresh ? { refresh_token: nextRefresh } : {}),
    },
    last_refresh: new Date(input.now()).toISOString(),
  };
}

/** 刚登录拿到的 token 做成 `codex login` 写的那种 auth.json。 */
export function codexLoginFromTokens(input: {
  tokens: CodexTokens;
  accountId: string;
  now: () => number;
}): CodexLogin {
  return {
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    tokens: {
      id_token: input.tokens.idToken,
      access_token: input.tokens.accessToken,
      refresh_token: input.tokens.refreshToken,
      account_id: input.accountId,
    },
    last_refresh: new Date(input.now()).toISOString(),
  };
}

export interface CodexLoginTokens {
  accessToken: string | undefined;
  refreshToken: string | undefined;
  accountId: string | undefined;
  // access token 的到期时间（毫秒）；读不出为 undefined。
  expiresAt: number | undefined;
  lastRefresh: number | undefined;
}

export function codexLoginTokens(login: CodexLogin): CodexLoginTokens {
  const tokens = isRecord(login.tokens) ? login.tokens : {};
  const accessToken = nonEmptyString(tokens.access_token);
  const exp = decodeJwtClaims(accessToken)?.exp;
  const lastRefresh = Date.parse(nonEmptyString(login.last_refresh) ?? "");
  return {
    accessToken,
    refreshToken: nonEmptyString(tokens.refresh_token),
    accountId: nonEmptyString(tokens.account_id),
    expiresAt: typeof exp === "number" ? exp * 1000 : undefined,
    lastRefresh: Number.isFinite(lastRefresh) ? lastRefresh : undefined,
  };
}

interface TokenReply {
  status: number;
  body: Record<string, unknown> | null;
}

async function postToken(input: {
  tokenUrl: string;
  contentType: string;
  body: string;
}): Promise<TokenReply> {
  let response: Response;
  try {
    response = await fetch(input.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": input.contentType, Accept: "application/json" },
      body: input.body,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CodexTokenRequestError({
      message: `Can't reach ChatGPT's sign-in service: ${detail}`,
      refused: false,
      detail,
      cause: error,
    });
  }
  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    body = isRecord(parsed) ? parsed : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/** OpenAI 的错误码：`{"error":"invalid_grant"}` 或 `{"error":{"code":"refresh_token_reused"}}`。 */
function errorCode(body: Record<string, unknown> | null): string | undefined {
  const error = body?.error;
  if (typeof error === "string") return error;
  if (isRecord(error)) return nonEmptyString(error.code) ?? nonEmptyString(error.type);
  return nonEmptyString(body?.code);
}

function describeError(body: Record<string, unknown> | null): string {
  const code = errorCode(body);
  return code ? `: ${code}` : "";
}
