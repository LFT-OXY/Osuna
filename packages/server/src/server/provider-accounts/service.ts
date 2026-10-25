import { homedir } from "node:os";
import path from "node:path";
import type pino from "pino";
import type {
  AccountRotationProvider,
  ProviderAccount,
  ProviderAccountSwitchWindow,
  ProviderAccountBlock,
  ProviderAccountSettings,
  ProviderAccountSignIn,
  ProviderAccountSwitch,
  ProviderAccountSwitchEnd,
  ProviderAccountSwitchFailure,
  ProviderAccountUsage,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import {
  ACCOUNT_LIMIT_MAX,
  ACCOUNT_LIMIT_MIN,
  isAccountRotationProvider,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import type { SavedAccountLogins } from "../plugins/usage-sources/index.js";
import type { CliLoginReading } from "./cli-login.js";
import { readClaudeLogin } from "./claude-login.js";
import {
  codexLoginProfile,
  readCodexCliLogin,
  readCodexLogin,
  writeCodexCliLogin,
  type CodexCliLogin,
  type CodexLoginLocation,
  type CodexLoginProfile,
} from "./codex-login.js";
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
import { isErrnoException } from "../../utils/errno.js";
import { withFileLock } from "./file-lock.js";
import { createSystemKeychain, type CliKeychain } from "./keychain.js";
import { createPlanUsageAccountReader, type PlanUsageReports } from "./plan-usage-reader.js";
import {
  nextMove,
  pickTarget,
  returningAfter,
  type RotationAccount,
  type SwitchReason,
  type RotationReturning,
} from "./rotation-rules.js";
import { ProviderAccountStore, type StoredAccount } from "./store.js";

/*
 * 「账号」一节背后的服务：读 CLI 现在登录的号、登记第 1 个号、多号自动轮换的开关与风险提示；
 * Codex 加号（codex-sign-in.ts）、存着的 Codex 号的续期与每 24 小时保活、各号的额度。
 * 每次读 CLI 登录、续期、查额度、加号前问「读取 CLI 登录凭证」的同一个闸门；关着时什么都不做，存着的号照留。
 * 「立即使用」换号（照 magpie 的 switchSavedLogin）、移除、排序、换号记录；当前登录的号快到期或读额度被拒时
 * 由 Osuna 续期并写回 CLI，续期被拒且开着轮换时换到下一个号（原因「号失效」）。
 * 定时检查按 rotation-rules.ts 的规则自动换走、换回；「设上限」「固定登录到」。
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
  // Codex 自己存登录的地方：换号与续期当前号时读写整份登录。
  codexLogin: CodexLoginLocation;
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

export interface AccountInput {
  provider: AccountRotationProvider;
  accountId: string;
}

export interface SetOrderInput {
  provider: AccountRotationProvider;
  accountIds: string[];
}

export interface SetLimitsInput {
  provider: AccountRotationProvider;
  accountId: string;
  limits: Record<string, number>;
}

export interface SetKeepSignedInInput {
  provider: AccountRotationProvider;
  // null 是「不固定」。
  accountId: string | null;
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
  standing: ProviderAccount["standing"];
}

export interface ProviderAccountState {
  settings: ProviderAccountSettings;
  accounts: ProviderAccount[];
  blocked: ProviderAccountBlock | null;
  switches?: ProviderAccountSwitch[];
  switchFailure?: ProviderAccountSwitchFailure | null;
}

/** 打开或关掉轮换被拒；code 见 protocol 的 ProviderAccountError。 */
export class ProviderAccountRequestError extends Error {
  constructor(
    readonly code:
      | "risk_notice_required"
      | "cli_sign_ins_off"
      | "login_unsupported"
      | "unsupported_provider"
      | "not_found"
      | "needs_sign_in"
      | "write_failed"
      | "order_mismatch"
      | "invalid_limit",
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
  private readonly codexLogin: CodexLoginLocation;
  private readonly usageReader: AccountUsageReader;
  private readonly onChanged: (provider: AccountRotationProvider) => void;
  private readonly logger: pino.Logger;
  private readonly now: () => number;
  private readonly usage = new Map<string, KnownUsage>();
  // 正在读的号；定时检查等它读完再判断。
  private readonly reading = new Map<string, Promise<ProviderAccountUsage>>();
  private readonly renewLockPath: string;
  private readonly codexSignInSettings: CodexSignInSettings;
  private readonly checks: AccountCheckTiming;
  // 同一个号的续期在这个进程里排队；跨进程靠锁文件。
  private readonly renewals = new Map<string, Promise<unknown>>();
  // 每家同时只有一次登录；查过的登录留着，直到这家开始新的一次。
  private readonly signIns = new Map<AccountRotationProvider, CodexSignIn>();
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  // 正在跑的检查；跑着时又要求检查（立即使用、重新登录、固定之后），跑完再来一次。
  private checking: Promise<void> | null = null;
  private checkAgain = false;

  constructor(options: ProviderAccountServiceOptions) {
    this.store = options.store;
    this.cliSignIns = options.cliSignIns;
    this.readLogin = options.readLogin;
    this.codexLogin = options.codexLogin;
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
    // 「重新登录」修好的号可能该换回去了：不等下一次定时检查。
    if (input.accountId !== undefined) this.requestCheck();
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
      void this.runCheck().finally(() => this.scheduleCheck(this.checks.intervalMs));
    }, delayMs);
    this.checkTimer.unref?.();
  }

  /** 马上检查一次（不改定时检查的节奏）；正在检查时，跑完再来一次。 */
  private requestCheck(): void {
    if (this.stopped) return;
    void this.runCheck();
  }

  private runCheck(): Promise<void> {
    if (this.checking) {
      this.checkAgain = true;
      return this.checking;
    }
    const run = (async () => {
      do {
        this.checkAgain = false;
        try {
          await this.check();
        } catch (error) {
          this.logger.warn({ err: error }, "Account check failed");
        }
      } while (this.checkAgain && !this.stopped);
    })();
    this.checking = run;
    void run.finally(() => {
      if (this.checking === run) this.checking = null;
    });
    return run;
  }

  /** 定时检查：当前登录的 Codex 号快到期就续；存着的 Codex 号保活；开着轮换的那家，各存着的号额度过期就重读。 */
  private async check(): Promise<void> {
    if (!this.cliSignIns.allowed()) return;
    if (this.store.settings("codex").rotationEnabled) {
      await this.renewSignedIn({ force: false });
    }
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
      if (provider === "codex") {
        await this.rotate(provider);
        continue;
      }
      for (const account of this.store.accounts(provider)) {
        if (!account.login || account.needsSignIn) continue;
        const known = this.usage.get(account.id);
        if (!known || this.now() - known.at >= USAGE_TTL_MS)
          void this.readUsage({ account, signedIn: false });
      }
    }
  }

  /**
   * 按 rotation-rules.ts 判断这家该不该换号，该换就换（与「立即使用」同一套步骤与换号记录）。
   * 先把各号的额度读到（过期的重读，等它读完）。Claude Code 的换号在后面的工单里做。
   */
  private async rotate(provider: AccountRotationProvider): Promise<void> {
    if (provider !== "codex" || !this.cliSignIns.allowed()) return;
    const login = await this.readLogin(provider);
    if (login.kind !== "signed_in") return;
    const listed = this.store.accounts(provider);
    const accounts = await Promise.all(
      listed.map((account) =>
        this.rotationAccount({ account, inUse: account.identity === login.identity }),
      ),
    );
    const move = nextMove({
      accounts,
      keepSignedInTo: this.keptAccount(provider),
      returning: this.liveReturning(provider),
      now: this.now(),
    });
    if (!move) return;
    const target = this.store.account(move.to);
    if (!target) return;
    this.logger.info({ provider, reason: move.reason }, "Rotating to another account");
    try {
      await this.switchTo({
        target,
        reason: move.reason,
        ...(move.window ? { window: move.window } : {}),
        onlyFrom: login.identity,
      });
    } catch (error) {
      // 失败已记进 switchFailure 并广播；下一次检查再试。
      this.logger.warn({ err: error, provider }, "Rotating to another account failed");
    }
  }

  /** 给换号规则看的号：读数取这次检查读到的（过期就等它重读）。 */
  private async rotationAccount(input: {
    account: StoredAccount;
    inUse: boolean;
  }): Promise<RotationAccount> {
    const { account, inUse } = input;
    const switchable = !account.needsSignIn && (inUse || account.login !== undefined);
    const usage = switchable ? await this.freshUsage({ account, signedIn: inUse }) : undefined;
    return { id: account.id, inUse, switchable, usage, limits: account.limits ?? {} };
  }

  private async freshUsage(input: {
    account: StoredAccount;
    signedIn: boolean;
  }): Promise<ProviderAccountUsage> {
    const known = this.usage.get(input.account.id);
    if (known && this.now() - known.at < USAGE_TTL_MS) return known.usage;
    return this.readUsage(input);
  }

  /** 「固定登录到」的号；那个号已经不在列表里时当作不固定。 */
  private keptAccount(provider: AccountRotationProvider): string | null {
    const kept = this.store.settings(provider).keepSignedInTo;
    if (kept === undefined) return null;
    return this.store.account(kept)?.provider === provider ? kept : null;
  }

  /** 「等着换回」的记录；被换走的号或换上的号已经不在列表里时不算。 */
  private liveReturning(provider: AccountRotationProvider): RotationReturning | null {
    const returning = this.store.settings(provider).returning;
    if (!returning) return null;
    const live = [returning.back, returning.to].every(
      (id) => this.store.account(id)?.provider === provider,
    );
    return live ? returning : null;
  }

  private keepAliveDue(account: StoredAccount): boolean {
    const tokens = account.login ? codexLoginTokens(account.login) : null;
    const renewedAt = Date.parse(account.renewedAt ?? "");
    const last = Math.max(Number.isFinite(renewedAt) ? renewedAt : 0, tokens?.lastRefresh ?? 0);
    return this.now() - last >= KEEP_ALIVE_MS;
  }

  /**
   * 当前登录的号的额度走套餐用量来源；Codex 开着轮换时读被拒（401 token_expired 等）就由 Osuna 续一次、
   * 写回 CLI，再读一次（照 magpie 3b8bcc36）。
   */
  private async readSignedInUsage(account: StoredAccount): Promise<AccountUsageResult> {
    const query = { provider: account.provider, identity: account.identity };
    const usage = await this.usageReader.read(query);
    const rejected = usage.status === "failed" && usage.code === "rejected";
    if (!rejected || account.provider !== "codex") return usage;
    if (!this.store.settings("codex").rotationEnabled) return usage;
    const renewed = await this.renewSignedIn({ force: true });
    return renewed === "renewed" ? this.usageReader.read(query) : usage;
  }

  /**
   * 续 CLI 现在登录的 Codex 号并写回 CLI 的存储（照 magpie）：在锁里重读，force 为假时只在 access token
   * 离到期 5 分钟内才续。续出的 token 只写进 CLI（一个登录只有一个持有者）。续期被拒就把这个号标
   * 「需要重新登录」，开着轮换时换到下一个号。
   */
  private async renewSignedIn(input: {
    force: boolean;
  }): Promise<"renewed" | "fresh" | "refused" | "skipped"> {
    if (!this.cliSignIns.allowed()) return "skipped";
    const outcome = await withFileLock(this.renewLockPath, async () => {
      const cli = await readCodexCliLogin(this.codexLogin);
      if (cli.kind !== "signed_in") return { kind: "skipped" as const };
      const tokens = codexLoginTokens(cli.login);
      const expiring =
        tokens.expiresAt !== undefined && tokens.expiresAt - this.now() <= RENEW_BEFORE_EXPIRY_MS;
      if (!input.force && !expiring) return { kind: "fresh" as const };
      let login: Record<string, unknown>;
      try {
        login = await refreshCodexLogin({
          endpoints: this.codexSignInSettings.endpoints,
          login: cli.login,
          now: this.now,
        });
      } catch (error) {
        if (error instanceof CodexTokenRequestError && error.refused) {
          return { kind: "refused" as const, cli, error };
        }
        throw error;
      }
      // 续期一旦回来就写回，不再问调用方；写不进（Codex 刚好也改了）只能记下，新 token 留不住。
      await writeCodexCliLogin({
        location: this.codexLogin,
        where: cli.where,
        expected: cli.text,
        login,
      });
      return { kind: "renewed" as const };
    });
    if (outcome.kind !== "refused") return outcome.kind;
    const { cli, error } = outcome;
    this.logger.warn(
      { provider: "codex", code: error.code },
      "The signed-in account's sign-in was refused; it needs signing in again",
    );
    const needsSignIn = { reason: error.message, ...(error.code ? { code: error.code } : {}) };
    const lapsed = this.store.findByIdentity("codex", cli.profile.identity);
    if (lapsed) {
      this.store.updateAccount(lapsed.id, { needsSignIn });
    } else {
      // 不在列表里的号也记下失效：换走时收回的这份登录不能被当成能用的号。
      this.store.addAccount({
        provider: "codex",
        identity: cli.profile.identity,
        ...(cli.profile.email ? { email: cli.profile.email } : {}),
        ...(cli.profile.plan ? { plan: cli.profile.plan } : {}),
        needsSignIn,
      });
    }
    this.onChanged("codex");
    if (this.store.settings("codex").rotationEnabled)
      await this.moveOffLapsed(cli.profile.identity);
    return "refused";
  }

  /**
   * 当前号失效后换到排在最前、有余量的号（选法同自动换号）；没有就在这一节醒目地说明。
   * 「固定登录到」开着时不换。
   */
  private async moveOffLapsed(identity: string): Promise<void> {
    if (this.keptAccount("codex") !== null) return;
    const candidates = await Promise.all(
      this.store
        .accounts("codex")
        .map((account) => this.rotationAccount({ account, inUse: account.identity === identity })),
    );
    const nextId = pickTarget({ accounts: candidates, now: this.now() });
    const next = nextId ? this.store.account(nextId) : null;
    if (!next) {
      this.recordFailure({
        provider: "codex",
        to: undefined,
        code: "no_account",
        message: "The account in use needs signing in again and no other account can take over",
      });
      return;
    }
    try {
      await this.switchTo({ target: next, reason: "lapsed", onlyFrom: identity });
    } catch (error) {
      this.logger.warn({ err: error, provider: "codex" }, "Moving off a lapsed account failed");
    }
  }

  /** 「立即使用」：把 CLI 的登录换成这个号。 */
  async useAccount(input: AccountInput): Promise<ProviderAccountState> {
    const { provider, accountId } = input;
    if (!this.cliSignIns.allowed()) {
      throw new ProviderAccountRequestError(
        "cli_sign_ins_off",
        "Read CLI sign-ins is off, so accounts can't be switched",
      );
    }
    if (provider !== "codex") {
      throw new ProviderAccountRequestError(
        "unsupported_provider",
        "Switching Claude Code accounts isn't available on this daemon yet",
      );
    }
    const target = this.store.account(accountId);
    if (target?.provider !== provider) {
      throw new ProviderAccountRequestError("not_found", "That account isn't in the list anymore");
    }
    await this.switchTo({ target, reason: "use_now" });
    // 换上的号也许已经没有余量：马上按规则检查一次，不等 5 分钟。
    this.requestCheck();
    return this.list(provider);
  }

  /**
   * 换号（照 magpie 的 switchSavedLogin）：要换上的号快到期先续；然后在跨进程锁里重读，把 CLI 里现在的登录
   * （最新一份）收回到它自己的记录，把目标号的登录写进 CLI，再清掉目标号在 Osuna 这边的那份。
   * 写不进 CLI 时把收回的那份撤掉，一个登录始终只有一个持有者。失败记进 switchFailure 并抛出。
   */
  private async switchTo(input: {
    target: StoredAccount;
    reason: SwitchReason;
    window?: ProviderAccountSwitchWindow;
    // 自动换号：只在 CLI 登录的还是判断时的那个号时才换。
    onlyFrom?: string;
  }): Promise<void> {
    const { reason, window, onlyFrom } = input;
    let target: StoredAccount | null = input.target;
    if (target.login && !target.needsSignIn) {
      target = await this.renewCodex({ accountId: target.id, force: false });
    }
    if (!target) {
      throw new ProviderAccountRequestError("not_found", "That account isn't in the list anymore");
    }
    if (target.needsSignIn) {
      throw this.switchFailed({
        target,
        code: "needs_sign_in",
        message: `${target.email ?? "That account"} needs signing in again`,
      });
    }
    const switched = await withFileLock(this.renewLockPath, () =>
      this.switchLocked({
        accountId: target.id,
        reason,
        ...(window ? { window } : {}),
        ...(onlyFrom !== undefined ? { onlyFrom } : {}),
      }),
    );
    if (!switched) return;
    this.usage.delete(target.id);
    if (switched.from) this.usage.delete(switched.from.accountId);
    this.logger.info({ provider: "codex", reason }, "Switched the CLI to another account");
    this.onChanged("codex");
  }

  private async switchLocked(input: {
    accountId: string;
    reason: SwitchReason;
    window?: ProviderAccountSwitchWindow;
    onlyFrom?: string;
  }): Promise<ProviderAccountSwitch | null> {
    const target = this.store.account(input.accountId);
    if (!target) {
      throw new ProviderAccountRequestError("not_found", "That account isn't in the list anymore");
    }
    const cli = await readCodexCliLogin(this.codexLogin);
    if (cli.kind === "unsupported") {
      throw this.switchFailed({ target, code: "login_unsupported", message: cli.reason });
    }
    if (cli.kind === "signed_out" && cli.text !== undefined) {
      // 只用 API key 登录的 Codex：换上去就会盖掉它，Osuna 不动。
      throw this.switchFailed({
        target,
        code: "login_unsupported",
        message: "Codex is signed in with an API key, which Osuna won't replace",
      });
    }
    // 判断之后（读额度要等网络）用户已经「立即使用」换了号：按旧判断换会盖掉用户的选择，这次不换。
    const signedInNow = cli.kind === "signed_in" ? cli.profile.identity : null;
    if (input.onlyFrom !== undefined && signedInNow !== input.onlyFrom) return null;
    if (cli.kind === "signed_in" && cli.profile.identity === target.identity) {
      // 已经在用：CLI 拿着它，Osuna 这边不留第二份。
      if (target.login) this.store.updateAccount(target.id, { login: undefined });
      return null;
    }
    if (!target.login) {
      throw this.switchFailed({
        target,
        code: "needs_sign_in",
        message: `Osuna has no sign-in for ${target.email ?? "that account"}; sign in again`,
      });
    }
    const takenBack = cli.kind === "signed_in" ? this.takeBack(cli) : null;
    try {
      await writeCodexCliLogin({
        location: this.codexLogin,
        where: cli.where,
        expected: cli.kind === "signed_in" ? cli.text : null,
        login: target.login,
      });
    } catch (error) {
      takenBack?.undo();
      this.logger.warn({ err: error, provider: "codex" }, "Writing the CLI's login failed");
      throw this.switchFailed({
        target,
        code: "write_failed",
        message: `Codex's login couldn't be written (${writeFailureCause(error)})`,
      });
    }
    this.store.updateAccount(target.id, { login: undefined });
    return this.recordSwitch({
      from: takenBack?.end,
      target,
      reason: input.reason,
      window: input.window,
    });
  }

  /** 记下一次换成的换号，连同「等着换回」的记录（同在锁里，列表不会读到只记了一半的状态）。 */
  private recordSwitch(input: {
    from: ProviderAccountSwitchEnd | undefined;
    target: StoredAccount;
    reason: SwitchReason;
    window: ProviderAccountSwitchWindow | undefined;
  }): ProviderAccountSwitch {
    const { from, target, reason, window } = input;
    const entry: ProviderAccountSwitch = {
      at: new Date(this.now()).toISOString(),
      ...(from ? { from } : {}),
      to: switchEnd(target),
      reason,
      ...(window ? { window } : {}),
    };
    const returning = from
      ? returningAfter({
          move: { from: from.accountId, to: target.id, reason },
          returning: this.liveReturning("codex"),
          order: this.store.accounts("codex").map((account) => account.id),
        })
      : null;
    this.store.recordSwitch("codex", entry);
    this.store.updateSettings("codex", { returning: returning ?? undefined });
    return entry;
  }

  /** 把 CLI 里现在的登录收回到它自己的记录；不在列表里的号排到最后（照 magpie 的 upsertLogin）。 */
  private takeBack(cli: Extract<CodexCliLogin, { kind: "signed_in" }>): {
    end: ProviderAccountSwitchEnd;
    undo: () => void;
  } {
    const existing = this.store.findByIdentity("codex", cli.profile.identity);
    if (existing) {
      const previous = existing.login;
      this.store.updateAccount(existing.id, { login: cli.login });
      return {
        end: switchEnd(existing),
        undo: () => this.store.updateAccount(existing.id, { login: previous }),
      };
    }
    const added = this.store.addAccount({
      provider: "codex",
      identity: cli.profile.identity,
      ...(cli.profile.email ? { email: cli.profile.email } : {}),
      ...(cli.profile.plan ? { plan: cli.profile.plan } : {}),
      login: cli.login,
    });
    return { end: switchEnd(added), undo: () => this.store.removeAccount(added.id) };
  }

  private switchFailed(input: {
    target: StoredAccount;
    code: "needs_sign_in" | "write_failed" | "login_unsupported";
    message: string;
  }): ProviderAccountRequestError {
    this.recordFailure({
      provider: "codex",
      to: switchEnd(input.target),
      code: input.code,
      message: input.message,
    });
    this.onChanged("codex");
    return new ProviderAccountRequestError(input.code, input.message);
  }

  private recordFailure(input: {
    provider: AccountRotationProvider;
    to: ProviderAccountSwitchEnd | undefined;
    code: string;
    message: string;
  }): void {
    const failure: ProviderAccountSwitchFailure = {
      at: new Date(this.now()).toISOString(),
      ...(input.to ? { to: input.to } : {}),
      code: input.code,
      message: input.message,
    };
    this.store.recordSwitchFailure(input.provider, failure);
  }

  /**
   * 给套餐用量注册表：Agent 启动（at）后 CLI 换过号时，它启动时用的那个号，以及用那个号自己存着的登录读额度的输入。
   * 由换号记录推出：at 之后的第一次换号是从哪个号换走的；那个号后来又被换回来了就是 null。
   */
  readonly savedAccountLogins: SavedAccountLogins = {
    accountAt: ({ provider, at, env }) => {
      if (!isAccountRotationProvider(provider)) return null;
      // 换号记录只记 Osuna 换的这个 CODEX_HOME；用别的目录的 Agent 不在其列。
      if (provider === "codex" && !this.isCodexHome(env)) return null;
      const switches = this.store.settings(provider).switches ?? [];
      const firstAfter = switches.findLast((entry) => Date.parse(entry.at) > at);
      const from = firstAfter?.from;
      if (!from || switches[0]?.to.accountId === from.accountId) return null;
      const account = this.store.account(from.accountId);
      if (!account) return null;
      const label = account.email ?? from.email;
      return { key: account.identity, ...(label ? { label } : {}) };
    },
    usageInput: async ({ provider, key }) => {
      if (provider !== "codex" || !this.cliSignIns.allowed()) return null;
      const saved = this.store.findByIdentity("codex", key);
      if (!saved?.login || saved.needsSignIn) return null;
      const account = await this.renewCodex({ accountId: saved.id, force: false });
      const tokens =
        account?.login && !account.needsSignIn ? codexLoginTokens(account.login) : null;
      if (!tokens?.accessToken) return null;
      return {
        route: {
          store: "token",
          accessToken: tokens.accessToken,
          ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
        },
      };
    },
  };

  private isCodexHome(env: Record<string, string>): boolean {
    const agentHome = env.CODEX_HOME || (env.HOME ? path.join(env.HOME, ".codex") : null);
    return (
      agentHome === null || path.resolve(agentHome) === path.resolve(this.codexLogin.codexHome)
    );
  }

  /** 「移除」：只删 Osuna 存的这个号，CLI 不被登出。 */
  async removeAccount(input: AccountInput): Promise<ProviderAccountState> {
    const { provider, accountId } = input;
    const account = this.store.account(accountId);
    if (account?.provider !== provider || !this.store.removeAccount(accountId)) {
      throw new ProviderAccountRequestError("not_found", "That account isn't in the list anymore");
    }
    if (this.store.settings(provider).keepSignedInTo === accountId) {
      this.store.updateSettings(provider, { keepSignedInTo: undefined });
    }
    this.usage.delete(accountId);
    this.logger.info({ provider }, "Removed an account");
    this.onChanged(provider);
    return this.list(provider);
  }

  async setOrder(input: SetOrderInput): Promise<ProviderAccountState> {
    const { provider, accountIds } = input;
    if (!this.store.reorder(provider, accountIds)) {
      throw new ProviderAccountRequestError(
        "order_mismatch",
        "The accounts changed on the host; the order wasn't saved",
      );
    }
    this.onChanged(provider);
    return this.list(provider);
  }

  /** 「设上限」：整份替换这个号各窗口的上限（1–99 的整数）。 */
  async setLimits(input: SetLimitsInput): Promise<ProviderAccountState> {
    const { provider, accountId, limits } = input;
    const invalid = Object.values(limits).some(
      (value) => !Number.isInteger(value) || value < ACCOUNT_LIMIT_MIN || value > ACCOUNT_LIMIT_MAX,
    );
    if (invalid) {
      throw new ProviderAccountRequestError(
        "invalid_limit",
        `A limit is a whole percent from ${ACCOUNT_LIMIT_MIN} to ${ACCOUNT_LIMIT_MAX}`,
      );
    }
    const account = this.store.account(accountId);
    if (account?.provider !== provider) {
      throw new ProviderAccountRequestError("not_found", "That account isn't in the list anymore");
    }
    const kept = Object.keys(limits).length > 0 ? limits : undefined;
    this.store.updateAccount(accountId, { limits: kept });
    this.logger.info({ provider, windows: Object.keys(limits).length }, "Account limits saved");
    this.onChanged(provider);
    return this.list(provider);
  }

  /** 「固定登录到」：固定后完全不自动换；固定到的不是 CLI 现在登录的号时，马上检查一次、换到它上面。 */
  async setKeepSignedIn(input: SetKeepSignedInInput): Promise<ProviderAccountState> {
    const { provider, accountId } = input;
    if (accountId !== null && this.store.account(accountId)?.provider !== provider) {
      throw new ProviderAccountRequestError("not_found", "That account isn't in the list anymore");
    }
    this.store.updateSettings(provider, {
      keepSignedInTo: accountId ?? undefined,
      returning: undefined,
    });
    this.logger.info({ provider, pinned: accountId !== null }, "Keep signed in to saved");
    this.onChanged(provider);
    this.requestCheck();
    return this.list(provider);
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
    const listed = this.store.accounts(provider);
    const inUseId = listed.find((account) => account.identity === signedInIdentity)?.id;
    // 只在还在换上的号上时才算「等着换回」。
    const returning = this.liveReturning(provider);
    const waiting = returning !== null && returning.to === inUseId ? returning : null;
    const accounts = listed.map((account) =>
      this.project({
        account,
        signedIn: account.identity === signedInIdentity,
        mayRead: input.blocked === null,
        standing: standingOf({ accountId: account.id, returning: waiting }),
      }),
    );
    return {
      settings: {
        rotationEnabled: settings.rotationEnabled === true,
        riskNoticeSeen: settings.riskNoticeSeen === true,
        keepSignedInTo: this.keptAccount(provider),
      },
      accounts,
      blocked: input.blocked,
      switches: settings.switches ?? [],
      switchFailure: settings.switchFailure ?? null,
    };
  }

  private project({ account, signedIn, mayRead, standing }: ProjectInput): ProviderAccount {
    // 当前号走套餐用量来源；存着的号用它自己的 token，失效的不读。
    const readable = signedIn || (account.login !== undefined && !account.needsSignIn);
    return {
      id: account.id,
      ...(account.email ? { email: account.email } : {}),
      ...(account.plan ? { plan: account.plan } : {}),
      signedIn,
      usage: this.usageOf({ account, readsNow: readable && mayRead, signedIn }),
      ...(account.needsSignIn ? { needsSignIn: account.needsSignIn } : {}),
      ...(account.limits ? { limits: account.limits } : {}),
      ...(standing ? { standing } : {}),
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
    if (readsNow && stale) void this.readUsage({ account, signedIn });
    if (known) return known.usage;
    if (account.usage) return { status: "read", ...account.usage };
    if (readsNow) return { status: "reading" };
    return { status: "failed", code: "not_read_yet", reason: "Usage hasn't been read yet" };
  }

  /** 读一个号的额度、记下并广播；同一个号同时只读一次，后来的等前一次。 */
  private readUsage(input: {
    account: StoredAccount;
    signedIn: boolean;
  }): Promise<ProviderAccountUsage> {
    const { account, signedIn } = input;
    const running = this.reading.get(account.id);
    if (running) return running;
    const run = (async () => {
      let usage: ProviderAccountUsage;
      try {
        if (signedIn || !account.login) {
          usage = await this.readSignedInUsage(account);
        } else {
          usage = await this.readSavedUsage(account.id);
        }
        if (usage.status === "read") {
          this.store.recordUsage(account.id, {
            fetchedAt: usage.fetchedAt,
            windows: usage.windows,
            ...(usage.held ? { held: true } : {}),
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
      return usage;
    })();
    this.reading.set(account.id, run);
    return run;
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
  // 与终端 hooks、第三方接口同一套规则：CODEX_HOME 优先，缺省 ~/.codex。
  const codexLogin = { codexHome: env.CODEX_HOME || path.join(homeDir, ".codex"), keychain };
  return new ProviderAccountService({
    store: new ProviderAccountStore({ paseoHome: input.paseoHome, logger: input.logger }),
    cliSignIns: input.cliSignIns,
    readLogin: (provider) =>
      provider === "codex"
        ? readCodexLogin(codexLogin)
        : readClaudeLogin({
            configDir: env.CLAUDE_CONFIG_DIR || null,
            homeDir,
            user: env.USER,
            platform,
            keychain,
          }),
    codexLogin,
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

function switchEnd(account: StoredAccount): ProviderAccountSwitchEnd {
  return { accountId: account.id, ...(account.email ? { email: account.email } : {}) };
}

/** 写不进 CLI 登录的简短原因：系统错误码（EACCES 等）或一句话；完整的错误只进日志（带路径）。 */
function writeFailureCause(error: unknown): string {
  if (isErrnoException(error) && error.code) return error.code;
  return error instanceof Error ? error.message : String(error);
}

function standingOf(input: {
  accountId: string;
  returning: RotationReturning | null;
}): ProviderAccount["standing"] {
  const { accountId, returning } = input;
  if (returning?.back === accountId) return "first_when_room";
  if (returning?.to === accountId) return "temporarily_first";
  return undefined;
}
