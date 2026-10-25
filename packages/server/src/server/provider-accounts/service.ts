import { homedir } from "node:os";
import path from "node:path";
import type pino from "pino";
import type {
  AccountRotationProvider,
  ProviderAccount,
  ProviderAccountBlock,
  ProviderAccountSettings,
  ProviderAccountSignIn,
  ProviderAccountUsage,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import type { CliLoginReading } from "./cli-login.js";
import { readClaudeLogin } from "./claude-login.js";
import { codexLoginProfile, readCodexLogin, type CodexLoginProfile } from "./codex-login.js";
import {
  CODEX_OAUTH_ENDPOINTS,
  CodexTokenRequestError,
  codexLoginFromTokens,
  codexLoginTokens,
  refreshCodexLogin,
  type CodexOAuthEndpoints,
  type CodexTokens,
} from "./codex-oauth.js";
import {
  CODEX_CALLBACK_PORT,
  CodexSignIn,
  SignInFailure,
  type SignInKept,
} from "./codex-sign-in.js";
import { withFileLock } from "./file-lock.js";
import { createSystemKeychain, type CliKeychain } from "./keychain.js";
import { createPlanUsageAccountReader, type PlanUsageReports } from "./plan-usage-reader.js";
import { ProviderAccountStore, type StoredAccount } from "./store.js";

/*
 * 「账号」一节背后的服务：读 CLI 现在登录的号、登记第 1 个号、多号自动轮换的开关与风险提示；
 * Codex 加号（codex-sign-in.ts）、存着的 Codex 号的续期与每 24 小时保活、各号的额度。
 * 每次读 CLI 登录、续期、查额度、加号前问「读取 CLI 登录凭证」的同一个闸门；关着时什么都不做，存着的号照留。
 * 换号在后面的工单里加在这里。
 */

/** 一个号的额度读完的结果：读到了或读不到，形状同 protocol 的 ProviderAccountUsage。 */
export type AccountUsageResult = Exclude<ProviderAccountUsage, { status: "reading" }>;

/** 要读额度的那个号；login 是存着的号自己的 token（CLI 现在登录的号没有，走套餐用量来源）。 */
export interface AccountUsageQuery {
  provider: AccountRotationProvider;
  identity: string;
  login?: { accessToken: string; accountId?: string };
}

/** 读一个号的额度；当前号沿用套餐用量来源的读法（plan-usage-reader.ts），测试换成假的。 */
export interface AccountUsageReader {
  read(query: AccountUsageQuery): Promise<AccountUsageResult>;
}

export interface CliSignInGate {
  allowed(): boolean;
}

export interface ProviderAccountServiceOptions {
  store: ProviderAccountStore;
  cliSignIns: CliSignInGate;
  readLogin: (provider: AccountRotationProvider) => Promise<CliLoginReading>;
  usage: AccountUsageReader;
  // 账号或设置变了；daemon 广播 provider.account.changed。
  onChanged: (provider: AccountRotationProvider) => void;
  logger: pino.Logger;
  now?: () => number;
  // 续期的跨进程锁文件。
  renewLockPath: string;
  codexSignIn: CodexSignInSettings;
  checks?: AccountCheckTiming;
}

/** Codex 加号的登录服务、回调端口与超时；测试指向本机的假服务、随便一个空端口。 */
export interface CodexSignInSettings {
  endpoints: CodexOAuthEndpoints;
  callbackPort: number;
  timeoutMs: number;
}

/** 定时检查：daemon 启动后多久第一次、之后每隔多久；测试调短。 */
export interface AccountCheckTiming {
  firstDelayMs: number;
  intervalMs: number;
}

export interface StartSignInInput {
  provider: AccountRotationProvider;
  // 「重新登录」的那个号。
  accountId?: string;
}

export interface SetRotationInput {
  provider: AccountRotationProvider;
  enabled: boolean;
  // 用户在风险提示里按了「我知道了，打开」。
  acknowledgeRiskNotice: boolean;
}

interface StateInput {
  blocked: ProviderAccountBlock | null;
  signedIn: CliLoginReading | null;
}

interface ProjectInput {
  account: StoredAccount;
  signedIn: boolean;
  // 这一节没停着：可以在后台读当前号的额度。
  mayRead: boolean;
}

export interface ProviderAccountState {
  settings: ProviderAccountSettings;
  accounts: ProviderAccount[];
  blocked: ProviderAccountBlock | null;
}

/** 打开或关掉轮换被拒；code 见 protocol 的 ProviderAccountError。 */
export class ProviderAccountRequestError extends Error {
  constructor(
    readonly code:
      | "risk_notice_required"
      | "cli_sign_ins_off"
      | "login_unsupported"
      | "unsupported_provider"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "ProviderAccountRequestError";
  }
}

// 与套餐用量注册表的缓存同长：5 分钟内不再读同一个号。
const USAGE_TTL_MS = 300_000;
// 照 magpie：access token 离到期 5 分钟内就续；存着的号每 24 小时保活一次（keepalive.go）。
const RENEW_BEFORE_EXPIRY_MS = 5 * 60_000;
const KEEP_ALIVE_MS = 24 * 60 * 60_000;
// 照 magpie：登录 10 分钟内没完成算超时（signin.go 的 signInTimeout）。
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
// 照 magpie：daemon 启动 1 分钟后检查一次，之后每 5 分钟（codex_switch.go）。
const DEFAULT_CHECKS: AccountCheckTiming = { firstDelayMs: 60_000, intervalMs: 5 * 60_000 };

interface KnownUsage {
  at: number;
  usage: ProviderAccountUsage;
}

export class ProviderAccountService {
  private readonly store: ProviderAccountStore;
  private readonly cliSignIns: CliSignInGate;
  private readonly readLogin: (provider: AccountRotationProvider) => Promise<CliLoginReading>;
  private readonly usageReader: AccountUsageReader;
  private readonly onChanged: (provider: AccountRotationProvider) => void;
  private readonly logger: pino.Logger;
  private readonly now: () => number;
  private readonly usage = new Map<string, KnownUsage>();
  private readonly reading = new Set<string>();
  private readonly renewLockPath: string;
  private readonly codexSignInSettings: CodexSignInSettings;
  private readonly checks: AccountCheckTiming;
  // 同一个号的续期在这个进程里排队；跨进程靠锁文件。
  private readonly renewals = new Map<string, Promise<unknown>>();
  // 每家同时只有一次登录；查过的登录留着，直到这家开始新的一次。
  private readonly signIns = new Map<AccountRotationProvider, CodexSignIn>();
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: ProviderAccountServiceOptions) {
    this.store = options.store;
    this.cliSignIns = options.cliSignIns;
    this.readLogin = options.readLogin;
    this.usageReader = options.usage;
    this.onChanged = options.onChanged;
    this.logger = options.logger.child({ module: "provider-accounts" });
    this.now = options.now ?? Date.now;
    this.renewLockPath = options.renewLockPath;
    this.codexSignInSettings = options.codexSignIn;
    this.checks = options.checks ?? DEFAULT_CHECKS;
  }

  /** 开始定时检查：保活到期的号，读开着轮换的那家各号的额度。 */
  start(): void {
    this.stopped = false;
    this.scheduleCheck(this.checks.firstDelayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = null;
    for (const signIn of this.signIns.values()) signIn.dispose();
  }

  async startSignIn(input: StartSignInInput): Promise<ProviderAccountSignIn> {
    const { provider, accountId } = input;
    if (!this.cliSignIns.allowed()) {
      throw new ProviderAccountRequestError(
        "cli_sign_ins_off",
        "Read CLI sign-ins is off, so accounts can't be added",
      );
    }
    if (provider !== "codex") {
      throw new ProviderAccountRequestError(
        "unsupported_provider",
        "Adding Claude Code accounts isn't available on this daemon yet",
      );
    }
    if (accountId !== undefined && this.store.account(accountId)?.provider !== provider) {
      throw new ProviderAccountRequestError("not_found", "That account isn't in the list anymore");
    }
    // 新开的取代还在等的那次（magpie 也是每家只留一次）。
    this.signIns.get(provider)?.cancel();
    const signIn = await CodexSignIn.start({
      ...this.codexSignInSettings,
      ...(accountId !== undefined ? { accountId } : {}),
      allowed: () => this.cliSignIns.allowed(),
      keep: (tokens) => this.keepCodexLogin({ tokens, accountId }),
      onChange: () => this.onChanged(provider),
    });
    this.signIns.set(provider, signIn);
    this.logger.info({ provider, reSignIn: accountId !== undefined }, "Account sign-in started");
    return signIn.view();
  }

  signIn(signInId: string): ProviderAccountSignIn {
    return this.findSignIn(signInId).view();
  }

  cancelSignIn(signInId: string): ProviderAccountSignIn {
    const signIn = this.findSignIn(signInId);
    signIn.cancel();
    return signIn.view();
  }

  /** 粘贴的回调地址；等这次登录结束再回。 */
  async submitSignIn(input: {
    signInId: string;
    callbackUrl: string;
  }): Promise<ProviderAccountSignIn> {
    const signIn = this.findSignIn(input.signInId);
    await signIn.submit(input.callbackUrl);
    return signIn.view();
  }

  private findSignIn(signInId: string): CodexSignIn {
    for (const signIn of this.signIns.values()) {
      if (signIn.id === signInId) return signIn;
    }
    throw new ProviderAccountRequestError("not_found", "This sign-in isn't running anymore");
  }

  /**
   * 加号拿到的登录存进账号存储，按 id_token 里的账号认重复。CLI 现在登录的就是这个号时不存 token：
   * 它的登录只在 CLI 那里（一个登录只有一个持有者），这次登录拿到的丢掉，只记资料。
   */
  private async keepCodexLogin(input: {
    tokens: CodexTokens;
    accountId: string | undefined;
  }): Promise<SignInKept> {
    if (!this.cliSignIns.allowed()) {
      throw new SignInFailure("cli_sign_ins_off", "Read CLI sign-ins was turned off");
    }
    const profile = codexLoginProfile({ tokens: { id_token: input.tokens.idToken } });
    if (typeof profile === "string") {
      throw new SignInFailure("no_account", "ChatGPT didn't say which account signed in");
    }
    if (input.accountId !== undefined) {
      const target = this.store.account(input.accountId);
      if (!target) throw new SignInFailure("not_found", "That account isn't in the list anymore");
      if (target.identity !== profile.identity) {
        throw new SignInFailure(
          "different_account",
          `This signed in to ${profile.email ?? "another account"}, not ${target.email ?? "that account"}`,
        );
      }
    }
    const cli = await this.readLogin("codex");
    const heldByCli = cli.kind === "signed_in" && cli.identity === profile.identity;
    const kept = await withFileLock(this.renewLockPath, async () =>
      this.saveCodexSignIn({ profile, tokens: input.tokens, heldByCli }),
    );
    // 新登录下的额度要重读：旧的读数可能是失效时读的。
    this.usage.delete(kept.account.id);
    this.logger.info(
      { provider: "codex", alreadyAdded: kept.alreadyAdded, heldByCli },
      "Account signed in",
    );
    this.onChanged("codex");
    return {
      accountId: kept.account.id,
      ...(kept.account.email ? { email: kept.account.email } : {}),
      alreadyAdded: kept.alreadyAdded,
    };
  }

  /** 在锁里写进账号存储：CLI 拿着这个号就只留资料并清掉 Osuna 这边的旧 token，否则存整份登录。 */
  private saveCodexSignIn(input: {
    profile: CodexLoginProfile;
    tokens: CodexTokens;
    heldByCli: boolean;
  }): { account: StoredAccount; alreadyAdded: boolean } {
    const { profile, heldByCli } = input;
    const existing = this.store.findByIdentity("codex", profile.identity);
    const details = {
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.plan ? { plan: profile.plan } : {}),
    };
    // 一个登录只有一个持有者：CLI 拿着的号，Osuna 这边不留 token。
    const saved = heldByCli
      ? { login: undefined, renewedAt: undefined }
      : {
          login: codexLoginFromTokens({
            tokens: input.tokens,
            accountId: profile.identity,
            now: this.now,
          }),
          renewedAt: new Date(this.now()).toISOString(),
        };
    if (existing) {
      const patch = { ...details, ...saved, needsSignIn: undefined };
      const account = this.store.updateAccount(existing.id, patch) ?? existing;
      return { account, alreadyAdded: true };
    }
    const added = this.store.addAccount({
      provider: "codex",
      identity: profile.identity,
      ...details,
      ...(saved.login ? { login: saved.login, renewedAt: saved.renewedAt } : {}),
    });
    return { account: added, alreadyAdded: false };
  }

  /**
   * 续一个存着的 Codex 号（照 magpie）：在跨进程锁里重读，存的 token 已被别人换过就采用新的；
   * force 为假时只在 access token 快到期时续。续期被拒就标「需要重新登录」。返回续完（或不用续）的号。
   */
  private renewCodex(input: { accountId: string; force: boolean }): Promise<StoredAccount | null> {
    const { accountId, force } = input;
    const seen = this.store.account(accountId);
    const seenRefreshToken = seen?.login ? codexLoginTokens(seen.login).refreshToken : undefined;
    const previous = this.renewals.get(accountId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() =>
        withFileLock(this.renewLockPath, () =>
          this.renewCodexLocked({ accountId, force, seenRefreshToken }),
        ),
      );
    this.renewals.set(accountId, run);
    void run
      .finally(() => {
        if (this.renewals.get(accountId) === run) this.renewals.delete(accountId);
      })
      .catch(() => undefined);
    return run;
  }

  private async renewCodexLocked(input: {
    accountId: string;
    force: boolean;
    seenRefreshToken: string | undefined;
  }): Promise<StoredAccount | null> {
    const account = this.store.account(input.accountId);
    if (!account?.login || account.needsSignIn) return account;
    const tokens = codexLoginTokens(account.login);
    // 排队时别人（另一个 daemon、上一次续期、重新登录）已经换过：用新的，不再续。
    if (input.seenRefreshToken !== undefined && tokens.refreshToken !== input.seenRefreshToken) {
      return account;
    }
    const expiring =
      tokens.expiresAt !== undefined && tokens.expiresAt - this.now() <= RENEW_BEFORE_EXPIRY_MS;
    if (!input.force && !expiring) return account;
    if (!this.cliSignIns.allowed()) return account;
    let login: Record<string, unknown>;
    try {
      login = await refreshCodexLogin({
        endpoints: this.codexSignInSettings.endpoints,
        login: account.login,
        now: this.now,
      });
    } catch (error) {
      if (error instanceof CodexTokenRequestError && error.refused) {
        this.logger.warn(
          { provider: "codex", code: error.code },
          "A saved account's sign-in was refused; it needs signing in again",
        );
        const lapsed = this.store.updateAccount(account.id, {
          needsSignIn: {
            reason: error.message,
            ...(error.code ? { code: error.code } : {}),
          },
        });
        this.onChanged("codex");
        return lapsed;
      }
      throw error;
    }
    return this.store.updateAccount(account.id, {
      login,
      renewedAt: new Date(this.now()).toISOString(),
    });
  }

  private scheduleCheck(delayMs: number): void {
    if (this.stopped) return;
    this.checkTimer = setTimeout(() => {
      void this.check()
        .catch((error) => this.logger.warn({ err: error }, "Account check failed"))
        .finally(() => this.scheduleCheck(this.checks.intervalMs));
    }, delayMs);
    this.checkTimer.unref?.();
  }

  /** 定时检查：存着的 Codex 号保活；开着轮换的那家，各存着的号额度过期就重读。 */
  private async check(): Promise<void> {
    if (!this.cliSignIns.allowed()) return;
    for (const account of this.store.accounts("codex")) {
      if (!account.login || account.needsSignIn) continue;
      if (!this.keepAliveDue(account)) continue;
      try {
        await this.renewCodex({ accountId: account.id, force: true });
      } catch (error) {
        this.logger.warn(
          { err: error, provider: "codex" },
          "Keeping a saved account signed in failed",
        );
      }
    }
    for (const provider of ["codex", "claude"] as const) {
      if (!this.store.settings(provider).rotationEnabled) continue;
      for (const account of this.store.accounts(provider)) {
        if (!account.login || account.needsSignIn) continue;
        const known = this.usage.get(account.id);
        if (!known || this.now() - known.at >= USAGE_TTL_MS)
          this.startReading({ account, signedIn: false });
      }
    }
  }

  private keepAliveDue(account: StoredAccount): boolean {
    const tokens = account.login ? codexLoginTokens(account.login) : null;
    const renewedAt = Date.parse(account.renewedAt ?? "");
    const last = Math.max(Number.isFinite(renewedAt) ? renewedAt : 0, tokens?.lastRefresh ?? 0);
    return this.now() - last >= KEEP_ALIVE_MS;
  }

  async list(provider: AccountRotationProvider): Promise<ProviderAccountState> {
    if (!this.cliSignIns.allowed()) {
      return this.state(provider, { blocked: { kind: "cli_sign_ins_off" }, signedIn: null });
    }
    const login = await this.readLogin(provider);
    if (login.kind === "unsupported") {
      return this.state(provider, {
        blocked: { kind: "login_unsupported", code: login.code, reason: login.reason },
        signedIn: null,
      });
    }
    // 开着轮换、列表还空着（打开时 CLI 还没登录，后来登录了）：现在登录的号成为第 1 个号。
    if (this.store.settings(provider).rotationEnabled && login.kind === "signed_in") {
      if (this.store.accounts(provider).length === 0) this.register(provider, login);
    }
    return this.state(provider, { blocked: null, signedIn: login });
  }

  async setRotation(input: SetRotationInput): Promise<ProviderAccountState> {
    const { provider, enabled, acknowledgeRiskNotice } = input;
    if (!enabled) {
      // 关掉不读 CLI 的登录，总开关关着时也能关。
      this.store.updateSettings(provider, { rotationEnabled: false });
      this.onChanged(provider);
      return this.list(provider);
    }
    if (!this.cliSignIns.allowed()) {
      throw new ProviderAccountRequestError(
        "cli_sign_ins_off",
        "Read CLI sign-ins is off, so accounts can't be rotated",
      );
    }
    const settings = this.store.settings(provider);
    if (!settings.riskNoticeSeen && !acknowledgeRiskNotice) {
      throw new ProviderAccountRequestError(
        "risk_notice_required",
        "Confirm the risk notice before turning on account rotation",
      );
    }
    const login = await this.readLogin(provider);
    if (login.kind === "unsupported") {
      throw new ProviderAccountRequestError("login_unsupported", login.reason);
    }
    this.store.updateSettings(provider, { rotationEnabled: true, riskNoticeSeen: true });
    if (login.kind === "signed_in" && this.store.accounts(provider).length === 0) {
      this.register(provider, login);
    }
    this.onChanged(provider);
    return this.state(provider, { blocked: null, signedIn: login });
  }

  private register(
    provider: AccountRotationProvider,
    login: Extract<CliLoginReading, { kind: "signed_in" }>,
  ): void {
    // 只记资料：这个号的登录仍只在 CLI 那里。
    this.store.addAccount({
      provider,
      identity: login.identity,
      ...(login.email ? { email: login.email } : {}),
      ...(login.plan ? { plan: login.plan } : {}),
    });
    this.logger.info({ provider }, "Registered the signed-in CLI account as the first account");
  }

  private state(provider: AccountRotationProvider, input: StateInput): ProviderAccountState {
    const settings = this.store.settings(provider);
    const signedInIdentity = input.signedIn?.kind === "signed_in" ? input.signedIn.identity : null;
    const accounts = this.store.accounts(provider).map((account) =>
      this.project({
        account,
        signedIn: account.identity === signedInIdentity,
        mayRead: input.blocked === null,
      }),
    );
    return {
      settings: {
        rotationEnabled: settings.rotationEnabled === true,
        riskNoticeSeen: settings.riskNoticeSeen === true,
      },
      accounts,
      blocked: input.blocked,
    };
  }

  private project({ account, signedIn, mayRead }: ProjectInput): ProviderAccount {
    // 当前号走套餐用量来源；存着的号用它自己的 token，失效的不读。
    const readable = signedIn || (account.login !== undefined && !account.needsSignIn);
    return {
      id: account.id,
      ...(account.email ? { email: account.email } : {}),
      ...(account.plan ? { plan: account.plan } : {}),
      signedIn,
      usage: this.usageOf({ account, readsNow: readable && mayRead, signedIn }),
      ...(account.needsSignIn ? { needsSignIn: account.needsSignIn } : {}),
    };
  }

  /** 当前号的额度过期或没读过就在后台读，读完广播一次；先给上次读到的（没有就是「读取中」）。 */
  private usageOf(input: {
    account: StoredAccount;
    readsNow: boolean;
    signedIn: boolean;
  }): ProviderAccountUsage {
    const { account, readsNow, signedIn } = input;
    const known = this.usage.get(account.id);
    const stale = !known || this.now() - known.at >= USAGE_TTL_MS;
    if (readsNow && stale) this.startReading({ account, signedIn });
    if (known) return known.usage;
    if (account.usage) return { status: "read", ...account.usage };
    if (readsNow) return { status: "reading" };
    return { status: "failed", code: "not_read_yet", reason: "Usage hasn't been read yet" };
  }

  private startReading(input: { account: StoredAccount; signedIn: boolean }): void {
    const { account, signedIn } = input;
    if (this.reading.has(account.id)) return;
    this.reading.add(account.id);
    void (async () => {
      let usage: ProviderAccountUsage;
      try {
        if (signedIn || !account.login) {
          usage = await this.usageReader.read({
            provider: account.provider,
            identity: account.identity,
          });
        } else {
          usage = await this.readSavedUsage(account.id);
        }
        if (usage.status === "read") {
          this.store.recordUsage(account.id, {
            fetchedAt: usage.fetchedAt,
            windows: usage.windows,
          });
        }
      } catch (error) {
        this.logger.warn(
          { err: error, provider: account.provider },
          "Reading account usage failed",
        );
        usage = {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      } finally {
        this.reading.delete(account.id);
      }
      this.usage.set(account.id, { at: this.now(), usage });
      this.onChanged(account.provider);
    })();
  }

  /** 存着的号的额度：要用时先续（快到期才续），用它自己的 token 读；被拒就强制续一次再读。 */
  private async readSavedUsage(accountId: string): Promise<AccountUsageResult> {
    let account = await this.renewCodex({ accountId, force: false });
    let usage = await this.readWithOwnLogin(account);
    if (usage.status === "failed" && usage.code === "rejected" && account?.login) {
      account = await this.renewCodex({ accountId, force: true });
      usage = await this.readWithOwnLogin(account);
    }
    return usage;
  }

  private async readWithOwnLogin(account: StoredAccount | null): Promise<AccountUsageResult> {
    if (!account) {
      return { status: "failed", code: "not_found", reason: "The account was removed" };
    }
    const tokens = account.login ? codexLoginTokens(account.login) : null;
    if (account.needsSignIn || !tokens?.accessToken) {
      return {
        status: "failed",
        code: "needs_sign_in",
        reason: account.needsSignIn?.reason ?? "The account needs signing in again",
      };
    }
    return this.usageReader.read({
      provider: account.provider,
      identity: account.identity,
      login: {
        accessToken: tokens.accessToken,
        ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
      },
    });
  }
}

/**
 * 定位 CLI 登录的环境与读额度的办法；缺省用 daemon 自己的 process.env、家目录、系统钥匙串与套餐用量来源。
 * 测试换成临时目录、假钥匙串与假额度，绝不碰真实的 ~/.codex、~/.claude 与钥匙串。
 */
export interface ProviderAccountOverrides {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  keychain?: CliKeychain;
  usage?: AccountUsageReader;
  // Codex 加号与续期的登录服务、回调端口、超时。
  codexSignIn?: Partial<CodexSignInSettings>;
  checks?: AccountCheckTiming;
  now?: () => number;
}

// 浏览器测试的 daemon 由 e2e 封条（packages/app/e2e/support/daemon-upgrade-seal.mjs）在这里放回调端口 0，
// 绝不占本机的 1455；登录服务的请求由封条的假外网回答。生产里没有它。
const SEALED_CODEX_CALLBACK_PORT = Symbol.for("paseo.e2e.codexCallbackPort");

function sealedCallbackPort(): number | undefined {
  const port: unknown = Reflect.get(globalThis, SEALED_CODEX_CALLBACK_PORT);
  return typeof port === "number" ? port : undefined;
}

export interface CreateProviderAccountServiceInput {
  paseoHome: string;
  logger: pino.Logger;
  cliSignIns: CliSignInGate;
  planUsage: PlanUsageReports;
  onChanged: (provider: AccountRotationProvider) => void;
  overrides?: ProviderAccountOverrides;
}

export function createProviderAccountService(
  input: CreateProviderAccountServiceInput,
): ProviderAccountService {
  const overrides = input.overrides ?? {};
  const env = overrides.env ?? process.env;
  const homeDir = overrides.homeDir ?? homedir();
  const platform = overrides.platform ?? process.platform;
  const keychain = overrides.keychain ?? createSystemKeychain(platform);
  return new ProviderAccountService({
    store: new ProviderAccountStore({ paseoHome: input.paseoHome, logger: input.logger }),
    cliSignIns: input.cliSignIns,
    // 与终端 hooks、第三方接口同一套规则：CODEX_HOME 优先，缺省 ~/.codex。
    readLogin: (provider) =>
      provider === "codex"
        ? readCodexLogin({ codexHome: env.CODEX_HOME || path.join(homeDir, ".codex"), keychain })
        : readClaudeLogin({
            configDir: env.CLAUDE_CONFIG_DIR || null,
            homeDir,
            user: env.USER,
            platform,
            keychain,
          }),
    usage: overrides.usage ?? createPlanUsageAccountReader(input.planUsage),
    onChanged: input.onChanged,
    logger: input.logger,
    renewLockPath: path.join(input.paseoHome, "accounts", "renew.lock"),
    codexSignIn: {
      endpoints: CODEX_OAUTH_ENDPOINTS,
      callbackPort: sealedCallbackPort() ?? CODEX_CALLBACK_PORT,
      timeoutMs: SIGN_IN_TIMEOUT_MS,
      ...overrides.codexSignIn,
    },
    ...(overrides.checks ? { checks: overrides.checks } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
}
