// 回调监听、粘贴地址完成、超时与取消移植自 magpie（https://github.com/yetone/magpie，d5805372）：
// internal/provider/signin.go 的 begin、listenCodexCallback、pastedCallback、ownCallback、claim、finish、callback。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isErrnoException } from "../../utils/errno.js";
import type {
  ProviderAccountError,
  ProviderAccountSignIn,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import {
  CodexTokenRequestError,
  codexAuthorizeUrl,
  createPkcePair,
  exchangeCodexCode,
  randomToken,
  type CodexOAuthEndpoints,
  type CodexTokens,
} from "./codex-oauth.js";

/*
 * 一次 Codex 加号：浏览器在 OpenAI 登录完跳回 http://localhost:<端口>/auth/callback?code=…&state=…，
 * 这里拿 code 换 token，交给 keep 存进账号存储。浏览器到不了这台主机（远程设备、端口被占）时，
 * 用户把浏览器最后跳到的地址粘回来，走同一个处理，两者谁先到算谁的，code 只换一次。
 */

// OpenAI 只把 Codex 的客户端送回这个端口（magpie 的 codexCallbackAddr）。
export const CODEX_CALLBACK_PORT = 1455;
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/auth/callback";
const LISTEN_TRIES = 10;
const LISTEN_RETRY_MS = 200;
const PORT_TAKEN_CODES = new Set(["EADDRINUSE", "EACCES"]);
// 粘贴的地址等换 token 最多这么久（magpie 一分钟）。
const SUBMIT_WAIT_MS = 60_000;

/** 登录失败的已知原因；含义见 protocol 的 ProviderAccountSignInSchema。 */
export type SignInFailureCode =
  | "timed_out"
  | "refused"
  | "exchange_failed"
  | "no_account"
  | "different_account"
  | "cli_sign_ins_off"
  | "not_found";

/** 存号被拒；keep 抛这个就是登录失败，code 进 ProviderAccountSignIn 的 failed。 */
export class SignInFailure extends Error {
  constructor(
    readonly code: SignInFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "SignInFailure";
  }
}

/** 加上或更新的号，即 ProviderAccountSignIn 完成时的 result。 */
export type SignInKept = Extract<ProviderAccountSignIn, { status: "done" }>["result"];

const PASTE_WHOLE_ADDRESS = "Paste the whole address the browser ended on, starting with http://";
const SIGN_IN_OVER_PAGE: Page = {
  ok: false,
  title: "This sign-in is over",
  detail: "Start it again from Osuna.",
};

/** 粘贴的地址不能用，这次登录照旧等着；code 见 protocol 的加号回复。 */
export class SignInPasteError extends Error {
  constructor(
    readonly code: "paste_invalid" | "paste_mismatch" | "not_waiting",
    message: string,
  ) {
    super(message);
    this.name = "SignInPasteError";
  }
}

export interface CodexSignInOptions {
  endpoints: CodexOAuthEndpoints;
  // 0 是随便一个空端口（只给测试）。
  callbackPort: number;
  timeoutMs: number;
  accountId?: string;
  // 「读取 CLI 登录凭证」开着；关着时浏览器回来也不去换 token。
  allowed: () => boolean;
  keep: (tokens: CodexTokens) => Promise<SignInKept>;
  // 状态变了（完成、失败、取消）。
  onChange: () => void;
}

type Outcome =
  | { status: "waiting" }
  | { status: "done"; result: SignInKept }
  | { status: "failed"; error: ProviderAccountError }
  | { status: "canceled" };

export class CodexSignIn {
  readonly id = randomToken(9);
  private readonly pkce = createPkcePair();
  private readonly state = randomToken(24);
  private redirectUri = "";
  private authUrl = "";
  private callbackBlocked = false;
  private server: Server | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private outcome: Outcome = { status: "waiting" };
  private claimed = false;
  private settled!: Promise<void>;
  private settle!: () => void;

  private constructor(private readonly options: CodexSignInOptions) {
    this.settled = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  static async start(options: CodexSignInOptions): Promise<CodexSignIn> {
    const signIn = new CodexSignIn(options);
    await signIn.begin();
    return signIn;
  }

  view(): ProviderAccountSignIn {
    const base = {
      id: this.id,
      provider: "codex",
      ...(this.options.accountId ? { accountId: this.options.accountId } : {}),
      authUrl: this.authUrl,
      callbackBlocked: this.callbackBlocked,
    };
    return { ...base, ...this.outcome };
  }

  get waiting(): boolean {
    return this.outcome.status === "waiting";
  }

  cancel(): void {
    this.finish({ status: "canceled" });
  }

  /** 用户粘回来的地址；等这次登录结束再返回。 */
  async submit(raw: string): Promise<void> {
    if (!this.waiting)
      throw new SignInPasteError("not_waiting", "This sign-in is over; start it again");
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new SignInPasteError("paste_invalid", PASTE_WHOLE_ADDRESS);
    }
    const answered = url.searchParams.has("code") || url.searchParams.has("error");
    if (url.protocol !== "http:" || !answered) {
      throw new SignInPasteError("paste_invalid", PASTE_WHOLE_ADDRESS);
    }
    if (!this.ownCallback(url)) {
      throw new SignInPasteError(
        "paste_mismatch",
        "That address isn't from this sign-in: paste the one its browser tab ended on",
      );
    }
    void this.handleCallback(url.searchParams);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SUBMIT_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /** daemon 关闭：不再等浏览器。 */
  dispose(): void {
    this.finish({ status: "canceled" });
  }

  private async begin(): Promise<void> {
    const server = createServer((request, response) => this.serve(request, response));
    const port = await listenCallback(server, this.options.callbackPort);
    if (port === null) {
      // 端口被占（别的程序或 Windows 保留）不挡登录：只能粘贴地址完成。
      this.callbackBlocked = true;
    } else {
      this.server = server;
    }
    const redirectPort = port ?? this.options.callbackPort;
    this.redirectUri = `http://localhost:${redirectPort}${CALLBACK_PATH}`;
    this.authUrl = codexAuthorizeUrl({
      endpoints: this.options.endpoints,
      redirectUri: this.redirectUri,
      challenge: this.pkce.challenge,
      state: this.state,
    });
    this.timer = setTimeout(() => {
      this.finish({
        status: "failed",
        error: { code: "timed_out", message: "The sign-in timed out; start it again" },
      });
    }, this.options.timeoutMs);
  }

  private ownCallback(url: URL): boolean {
    const want = new URL(this.redirectUri);
    if (url.port !== want.port || url.pathname !== want.pathname) return false;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())) return false;
    return url.searchParams.get("state") === this.state;
  }

  private serve(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", `http://${CALLBACK_HOST}`);
    if (url.pathname === "/cancel") {
      this.cancel();
      response.writeHead(204).end();
      return;
    }
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    void (async () => {
      const page = await this.handleCallback(url.searchParams);
      response.writeHead(page.ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(signInPage(page));
    })();
  }

  private async handleCallback(query: URLSearchParams): Promise<Page> {
    if (!this.waiting) return SIGN_IN_OVER_PAGE;
    const oauthError = query.get("error");
    if (oauthError) {
      const message = query.get("error_description") || oauthError;
      this.finish({ status: "failed", error: { code: "refused", message } });
      return { ok: false, title: "Sign-in didn't finish", detail: message };
    }
    const code = query.get("code");
    if (query.get("state") !== this.state || !code) {
      return {
        ok: false,
        title: "This link isn't from Osuna's sign-in",
        detail: "Start it again from Osuna.",
      };
    }
    if (this.claimed) {
      return {
        ok: false,
        title: "This sign-in is already finishing",
        detail: "Osuna shows the account when it's done.",
      };
    }
    this.claimed = true;
    // 登录中途关掉了「读取 CLI 登录凭证」：不再拿 code 去 OpenAI 换 token。
    if (!this.options.allowed()) {
      const error = { code: "cli_sign_ins_off", message: "Read CLI sign-ins was turned off" };
      this.finish({ status: "failed", error });
      return { ok: false, title: "Sign-in didn't finish", detail: error.message };
    }
    try {
      const tokens = await exchangeCodexCode({
        endpoints: this.options.endpoints,
        code,
        verifier: this.pkce.verifier,
        redirectUri: this.redirectUri,
      });
      // 换 token 时被取消或超时了：不存这个号。
      if (!this.waiting) return SIGN_IN_OVER_PAGE;
      const result = await this.options.keep(tokens);
      this.finish({ status: "done", result });
      return {
        ok: true,
        title: "You're signed in",
        detail: "The account is added to Osuna. You can close this tab.",
      };
    } catch (error) {
      const failure = signInFailure(error);
      this.finish({ status: "failed", error: failure });
      return { ok: false, title: "Sign-in didn't finish", detail: failure.message };
    }
  }

  private finish(outcome: Exclude<Outcome, { status: "waiting" }>): void {
    if (!this.waiting) return;
    this.outcome = outcome;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const server = this.server;
    this.server = null;
    // 先让浏览器拿到页面再关。
    if (server) setTimeout(() => server.close(), 1000).unref();
    this.settle();
    this.options.onChange();
  }
}

/** 失败原因：exchange_failed 的 message 只放技术细节，界面接在翻译过的原因后面。 */
function signInFailure(error: unknown): { code: string; message: string } {
  if (error instanceof SignInFailure) return { code: error.code, message: error.message };
  if (error instanceof CodexTokenRequestError)
    return { code: "exchange_failed", message: error.detail };
  return {
    code: "exchange_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

interface Page {
  ok: boolean;
  title: string;
  detail: string;
}

/** 占住回调端口；被占时先请那里等着的 `codex login` 停下（Codex 自己也这么做），再试几次。占不到返回 null。 */
async function listenCallback(server: Server, port: number): Promise<number | null> {
  for (let attempt = 0; attempt < LISTEN_TRIES; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, CALLBACK_HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      return typeof address === "object" && address !== null ? address.port : port;
    } catch (error) {
      // 被占（EADDRINUSE）或系统保留（Windows 的 EACCES）就只能粘贴地址；别的错照抛。
      if (!isErrnoException(error) || !PORT_TAKEN_CODES.has(error.code ?? "")) throw error;
      if (port === 0) return null;
      if (attempt === 0) {
        await fetch(`http://${CALLBACK_HOST}:${port}/cancel`, {
          signal: AbortSignal.timeout(2000),
        }).catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, LISTEN_RETRY_MS));
    }
  }
  return null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function signInPage(page: Page): string {
  return `<!doctype html><meta charset="utf-8"><title>Osuna</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.detail)}</p></body>`;
}
