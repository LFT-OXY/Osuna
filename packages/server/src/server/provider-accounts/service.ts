import { homedir } from "node:os";
import path from "node:path";
import type pino from "pino";
import type {
  AccountRotationProvider,
  ProviderAccount,
  ProviderAccountBlock,
  ProviderAccountSettings,
  ProviderAccountUsage,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import type { CliLoginReading } from "./cli-login.js";
import { readClaudeLogin } from "./claude-login.js";
import { readCodexLogin } from "./codex-login.js";
import { createSystemKeychain, type CliKeychain } from "./keychain.js";
import { createPlanUsageAccountReader, type PlanUsageReports } from "./plan-usage-reader.js";
import { ProviderAccountStore, type StoredAccount } from "./store.js";

/*
 * 「账号」一节背后的服务：读 CLI 现在登录的号、登记第 1 个号、多号自动轮换的开关与风险提示。
 * 每次读 CLI 登录前问「读取 CLI 登录凭证」的同一个闸门；关着时什么都不读，存着的号照留。
 * 换号、加号在后面的工单里加在这里。
 */

/** 一个号的额度读完的结果：读到了或读不到，形状同 protocol 的 ProviderAccountUsage。 */
export type AccountUsageResult = Exclude<ProviderAccountUsage, { status: "reading" }>;

/** 要读额度的那个号。 */
export interface AccountUsageQuery {
  provider: AccountRotationProvider;
  identity: string;
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
    readonly code: "risk_notice_required" | "cli_sign_ins_off" | "login_unsupported",
    message: string,
  ) {
    super(message);
    this.name = "ProviderAccountRequestError";
  }
}

// 与套餐用量注册表的缓存同长：5 分钟内不再读同一个号。
const USAGE_TTL_MS = 300_000;

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

  constructor(options: ProviderAccountServiceOptions) {
    this.store = options.store;
    this.cliSignIns = options.cliSignIns;
    this.readLogin = options.readLogin;
    this.usageReader = options.usage;
    this.onChanged = options.onChanged;
    this.logger = options.logger.child({ module: "provider-accounts" });
    this.now = options.now ?? Date.now;
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
    return {
      id: account.id,
      ...(account.email ? { email: account.email } : {}),
      ...(account.plan ? { plan: account.plan } : {}),
      signedIn,
      // 现在只读当前号的额度；存着的号的读法在加号的工单里加。
      usage: this.usageOf({ account, readsNow: signedIn && mayRead }),
    };
  }

  /** 当前号的额度过期或没读过就在后台读，读完广播一次；先给上次读到的（没有就是「读取中」）。 */
  private usageOf(input: { account: StoredAccount; readsNow: boolean }): ProviderAccountUsage {
    const { account, readsNow } = input;
    const known = this.usage.get(account.id);
    const stale = !known || this.now() - known.at >= USAGE_TTL_MS;
    if (readsNow && stale) this.startReading(account);
    if (known) return known.usage;
    if (account.usage) return { status: "read", ...account.usage };
    if (readsNow) return { status: "reading" };
    return { status: "failed", code: "not_read_yet", reason: "Usage hasn't been read yet" };
  }

  private startReading(account: StoredAccount): void {
    if (this.reading.has(account.id)) return;
    this.reading.add(account.id);
    void (async () => {
      let usage: ProviderAccountUsage;
      try {
        usage = await this.usageReader.read({
          provider: account.provider,
          identity: account.identity,
        });
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
  });
}
