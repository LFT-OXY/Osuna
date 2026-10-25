import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * 本机的假 OpenAI 登录服务（auth.openai.com/oauth/token）：多号自动轮换的测试用它代替真的，绝不连 OpenAI。
 * - authorization_code：issueCode 登记过的 code 换出那个号的 token（只换一次）；带的 code_verifier 记在 requests 里，用例自己核对；
 * - refresh_token：每次换出新的 refresh token，旧的作废；再用旧的回 refresh_token_reused（同 OpenAI）。
 */

export interface FakeOpenAiAccount {
  accountId: string;
  email: string;
  plan: string;
}

export interface TokenRequest {
  grantType: string;
  body: Record<string, string>;
}

export function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

export function idToken(account: FakeOpenAiAccount): string {
  return jwt({
    email: account.email,
    "https://api.openai.com/auth": {
      chatgpt_account_id: account.accountId,
      chatgpt_plan_type: account.plan,
    },
  });
}

/** access token 带到期时间（秒），续期测试按它判断要不要续。 */
export function accessToken(input: { name: string; expiresAt: number }): string {
  return jwt({ sub: input.name, exp: Math.floor(input.expiresAt / 1000) });
}

export class FakeOpenAiAuth {
  readonly requests: TokenRequest[] = [];
  private server: Server | null = null;
  private codes = new Map<string, { account: FakeOpenAiAccount }>();
  // 还能用的 refresh token → 它属于哪个号。
  private live = new Map<string, FakeOpenAiAccount>();
  private spent = new Set<string>();
  private serial = 0;
  // 续期一律拒绝时回的错误码。
  refuseRefresh: string | null = null;
  // 续期回复前等这么久（并发测试用）。
  refreshDelayMs = 0;
  // 换出的 access token 的有效期。
  accessTtlMs = 60 * 60_000;
  now: () => number = Date.now;

  get tokenUrl(): string {
    return `${this.origin}/oauth/token`;
  }

  get authorizeUrl(): string {
    return `${this.origin}/oauth/authorize`;
  }

  private get origin(): string {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) throw new Error("FakeOpenAiAuth isn't started");
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void (async () => {
        const { status, body } = await this.handle(request);
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      })();
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  /** 登录页把这个 code 发给浏览器。 */
  issueCode(code: string, account: FakeOpenAiAccount): void {
    this.codes.set(code, { account });
  }

  refreshRequests(): TokenRequest[] {
    return this.requests.filter((request) => request.grantType === "refresh_token");
  }

  private nextRefreshToken(account: FakeOpenAiAccount): string {
    this.serial += 1;
    const token = `refresh-${account.accountId}-${this.serial}`;
    this.live.set(token, account);
    return token;
  }

  private async handle(
    request: IncomingMessage,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const text = await readBody(request);
    const body: Record<string, string> = (request.headers["content-type"] ?? "").includes("json")
      ? (JSON.parse(text) as Record<string, string>)
      : Object.fromEntries(new URLSearchParams(text));
    const grantType = body.grant_type ?? "";
    this.requests.push({ grantType, body });
    if (grantType === "authorization_code") return this.exchange(body);
    if (grantType === "refresh_token") {
      if (this.refreshDelayMs > 0) await new Promise((r) => setTimeout(r, this.refreshDelayMs));
      return this.refresh(body);
    }
    return { status: 400, body: { error: "unsupported_grant_type" } };
  }

  private exchange(body: Record<string, string>) {
    const issued = this.codes.get(body.code ?? "");
    if (!issued || !body.code_verifier) return { status: 400, body: { error: "invalid_grant" } };
    this.codes.delete(body.code ?? "");
    return { status: 200, body: this.tokensFor(issued.account) };
  }

  private refresh(body: Record<string, string>) {
    if (this.refuseRefresh) return { status: 400, body: { error: this.refuseRefresh } };
    const token = body.refresh_token ?? "";
    if (this.spent.has(token)) {
      return { status: 401, body: { error: { code: "refresh_token_reused" } } };
    }
    const account = this.live.get(token);
    if (!account) return { status: 400, body: { error: "invalid_grant" } };
    this.live.delete(token);
    this.spent.add(token);
    return { status: 200, body: this.tokensFor(account) };
  }

  private tokensFor(account: FakeOpenAiAccount) {
    return {
      id_token: idToken(account),
      access_token: accessToken({
        name: `${account.accountId}-${this.serial + 1}`,
        expiresAt: this.now() + this.accessTtlMs,
      }),
      refresh_token: this.nextRefreshToken(account),
    };
  }
}

/** PKCE：code_verifier 的 S256。 */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
