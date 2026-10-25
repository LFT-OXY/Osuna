import { randomUUID } from "node:crypto";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import {
  ACCOUNT_ROTATION_PROVIDERS,
  ProviderAccountNeedsSignInSchema,
  ProviderAccountSwitchFailureSchema,
  ProviderAccountSwitchSchema,
  ProviderAccountWindowSchema,
  type ProviderAccountSwitch,
  type ProviderAccountSwitchFailure,
  type AccountRotationProvider,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import {
  type DataFileSystem,
  LastGoodFile,
  NODE_DATA_FILE_SYSTEM,
} from "../api-endpoints/last-good.js";

/*
 * $PASEO_HOME/accounts/accounts.json（目录 0700、文件 0600、明文，与第三方接口的 keys.json 同样处理）：
 * Codex、Claude Code 的号与每家的多号自动轮换设置。写坏时用上一份好的 .bak（last-good.ts）。
 * 不进 config.json：get_daemon_config 会把配置原样发给客户端。
 * 一个登录只有一个持有者：CLI 现在登录的号在这里只有资料，它的 token 只在 CLI 自己那里；
 * 存着的 Codex 号（加号得来的）的整份登录只在这里的 login；存着的 Claude 号的登录在它的私有配置目录 configDir
 * （$PASEO_HOME/accounts/claude/<随机名>/）里。
 * 写是同步的、整份替换；续期这种「读、发请求、写回」的一段在跨进程锁里做（file-lock.ts），写前重读。
 */

const StoredUsageSchema = z.object({
  fetchedAt: z.string(),
  windows: z.array(ProviderAccountWindowSchema),
  held: z.boolean().optional(),
  onCredits: z.boolean().optional(),
});
export type StoredUsage = z.infer<typeof StoredUsageSchema>;

const StoredAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(ACCOUNT_ROTATION_PROVIDERS),
  // 账号的稳定标识，与 CliLoginReading 的 identity 同一个口径；认重复的号靠它。
  identity: z.string(),
  email: z.string().optional(),
  plan: z.string().optional(),
  // 最近一次读到的额度。
  usage: StoredUsageSchema.optional(),
  // 存着的 Codex 号的整份登录（与 auth.json 同形，含 refresh token）；CLI 现在登录的号没有。
  login: z.record(z.string(), z.unknown()).optional(),
  // 存着的 Claude 号的私有配置目录（绝对路径）：它的登录由 Claude Code 存在这里（macOS 在按目录取后缀的钥匙串项里），
  // 也由 Claude Code 在这里续期。CLI 现在登录的号没有。
  configDir: z.string().optional(),
  // Claude 号的 .claude.json oauthAccount 资料：换上这个号时写进 CLI 的 .claude.json。
  oauthAccount: z.record(z.string(), z.unknown()).optional(),
  // 续期被拒或被吊销：「需要重新登录」，退出轮换。
  needsSignIn: ProviderAccountNeedsSignInSchema.optional(),
  // Osuna 最近一次续这个号（加号、续期、保活）的时间。
  renewedAt: z.string().optional(),
  // 用户给各窗口设的上限：窗口 ID → 1–99。
  limits: z.record(z.string(), z.number()).optional(),
});
export type StoredAccount = z.infer<typeof StoredAccountSchema>;

const StoredSettingsSchema = z.object({
  rotationEnabled: z.boolean().optional(),
  // 这台主机上已经确认过这家的风险提示。
  riskNoticeSeen: z.boolean().optional(),
  // 最近的换号，最新的在前，最多 SWITCH_LOG_LIMIT 条。
  switches: z.array(ProviderAccountSwitchSchema).optional(),
  // 最近一次换号没换成；下一次换成后清掉。
  switchFailure: ProviderAccountSwitchFailureSchema.optional(),
  // 「固定登录到」的号 ID。
  keepSignedInTo: z.string().optional(),
  // Codex 的「只换登录」：不经过中转站换号，只保留第一层。
  switchOnly: z.boolean().optional(),
  // 自动换走后等着换回：back 是被换走的号，to 是现在换上的号（照 magpie 的 login-returns.json）。
  returning: z.object({ back: z.string(), to: z.string() }).optional(),
});
export type StoredSettings = z.infer<typeof StoredSettingsSchema>;

const SWITCH_LOG_LIMIT = 50;

// 号按用户排的顺序存：数组里第一个就是「第一」。
const AccountsFileSchema = z.object({
  accounts: z.array(StoredAccountSchema),
  settings: z.partialRecord(z.enum(ACCOUNT_ROTATION_PROVIDERS), StoredSettingsSchema),
});
type AccountsFile = z.infer<typeof AccountsFileSchema>;

export interface ProviderAccountStoreOptions {
  paseoHome: string;
  logger: pino.Logger;
  // 只给测试换：.bad-<时间> 用的时钟、模拟占用的文件系统。
  now?: () => Date;
  fileSystem?: DataFileSystem;
}

export class ProviderAccountStore {
  private readonly file: LastGoodFile<AccountsFile>;

  constructor(options: ProviderAccountStoreOptions) {
    this.file = new LastGoodFile({
      filePath: path.join(options.paseoHome, "accounts", "accounts.json"),
      parse: (raw) => AccountsFileSchema.parse(raw),
      logger: options.logger,
      now: options.now ?? (() => new Date()),
      fileSystem: options.fileSystem ?? NODE_DATA_FILE_SYSTEM,
    });
  }

  /** 这家的号，按用户排的顺序。 */
  accounts(provider: AccountRotationProvider): StoredAccount[] {
    return this.read().accounts.filter((account) => account.provider === provider);
  }

  settings(provider: AccountRotationProvider): StoredSettings {
    return this.read().settings[provider] ?? {};
  }

  updateSettings(provider: AccountRotationProvider, patch: StoredSettings): void {
    const current = this.read();
    this.file.write({
      ...current,
      settings: { ...current.settings, [provider]: { ...current.settings[provider], ...patch } },
    });
  }

  /** 把号排到这家的最后；已有同一个账号（identity 相同）时只更新资料，返回那个号。 */
  addAccount(input: Omit<StoredAccount, "id" | "usage">): StoredAccount {
    const current = this.read();
    const existing = current.accounts.find(
      (account) => account.provider === input.provider && account.identity === input.identity,
    );
    if (existing) {
      const updated = { ...existing, ...input };
      this.file.write({
        ...current,
        accounts: current.accounts.map((account) => (account === existing ? updated : account)),
      });
      return updated;
    }
    const added: StoredAccount = { id: randomUUID(), ...input };
    this.file.write({ ...current, accounts: [...current.accounts, added] });
    return added;
  }

  account(accountId: string): StoredAccount | null {
    return this.read().accounts.find((account) => account.id === accountId) ?? null;
  }

  findByIdentity(provider: AccountRotationProvider, identity: string): StoredAccount | null {
    return (
      this.read().accounts.find(
        (account) => account.provider === provider && account.identity === identity,
      ) ?? null
    );
  }

  /** 改一个号；值为 undefined 的键被去掉。号已被移除时返回 null。 */
  updateAccount(
    accountId: string,
    patch: Partial<Omit<StoredAccount, "id" | "provider">>,
  ): StoredAccount | null {
    const current = this.read();
    const existing = current.accounts.find((account) => account.id === accountId);
    if (!existing) return null;
    const updated = StoredAccountSchema.parse(
      JSON.parse(JSON.stringify({ ...existing, ...patch })),
    );
    this.file.write({
      ...current,
      accounts: current.accounts.map((account) => (account === existing ? updated : account)),
    });
    return updated;
  }

  /** 记下这个号最近一次读到的额度；号已被移除时什么都不做。 */
  recordUsage(accountId: string, usage: StoredUsage): void {
    const current = this.read();
    const index = current.accounts.findIndex((account) => account.id === accountId);
    if (index === -1) return;
    const accounts = [...current.accounts];
    const account = current.accounts[index];
    if (!account) return;
    accounts[index] = { ...account, usage };
    this.file.write({ ...current, accounts });
  }

  /** 删掉一个号（连同它存着的登录）；号已经不在时返回 false。 */
  removeAccount(accountId: string): boolean {
    const current = this.read();
    const accounts = current.accounts.filter((account) => account.id !== accountId);
    if (accounts.length === current.accounts.length) return false;
    this.file.write({ ...current, accounts });
    return true;
  }

  /** 这家的号按 accountIds 重排；别家的号留在原来的位置上。ids 与这家的号对不上时返回 false。 */
  reorder(provider: AccountRotationProvider, accountIds: string[]): boolean {
    const current = this.read();
    const mine = current.accounts.filter((account) => account.provider === provider);
    const byId = new Map(mine.map((account) => [account.id, account]));
    if (accountIds.length !== mine.length || new Set(accountIds).size !== mine.length) return false;
    const ordered = accountIds.map((id) => byId.get(id));
    if (ordered.some((account) => account === undefined)) return false;
    const queue = ordered.filter((account): account is StoredAccount => account !== undefined);
    const accounts = current.accounts.map((account) =>
      account.provider === provider ? (queue.shift() ?? account) : account,
    );
    this.file.write({ ...current, accounts });
    return true;
  }

  /** 记一次换号（排在最前），清掉上一次的失败。 */
  recordSwitch(provider: AccountRotationProvider, entry: ProviderAccountSwitch): void {
    const settings = this.settings(provider);
    const switches = [entry, ...(settings.switches ?? [])].slice(0, SWITCH_LOG_LIMIT);
    this.updateSettings(provider, { switches, switchFailure: undefined });
  }

  recordSwitchFailure(
    provider: AccountRotationProvider,
    failure: ProviderAccountSwitchFailure,
  ): void {
    this.updateSettings(provider, { switchFailure: failure });
  }

  private read(): AccountsFile {
    return this.file.read() ?? { accounts: [], settings: {} };
  }
}
