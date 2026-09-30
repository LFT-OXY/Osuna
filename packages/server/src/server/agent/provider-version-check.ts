import type { Logger } from "pino";
import { z } from "zod";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderVersionCheckResult } from "@getpaseo/protocol/messages";

/*
 * 内置提供方的"有没有新版本"：已装版本取自提供方快照，最新版本查 npm registry 的 latest。
 * 只在收到 provider.version.check.request 时联网；结果在内存里缓存 1 小时，失败不缓存。
 */

const LATEST_VERSION_TTL_MS = 60 * 60 * 1000;
const NPM_REQUEST_TIMEOUT_MS = 15_000;
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const NpmDistTagsSchema = z.object({ latest: z.string() });

/** 查一个 npm 包 latest 标签对应的版本号；失败时抛错。测试里换成桩，不真的联网。 */
export type FetchLatestVersion = (input: FetchLatestVersionInput) => Promise<string>;

/** 测试 daemon 在配置边界注入的版本相关依赖：查 npm 的联网函数与升级命令的超时。 */
export interface ProviderVersionsConfig {
  // 缺省查 npm registry；测试换成桩。
  fetchLatestVersion?: FetchLatestVersion;
  // 缺省 10 分钟；测试用短超时走超时路径。
  upgradeTimeoutMs?: number;
}

export interface FetchLatestVersionInput {
  npmPackage: string;
  signal: AbortSignal;
}

interface ParsedVersion {
  core: [number, number, number];
  prerelease: boolean;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined,
  };
}

/** latest 是否比已装的新；任一边解析不了都视为没有更新。 */
export function isNewerVersion({
  installed,
  latest,
}: {
  installed: string;
  latest: string;
}): boolean {
  const from = parseVersion(installed);
  const to = parseVersion(latest);
  if (!from || !to) return false;
  const differences = [
    to.core[0] - from.core[0],
    to.core[1] - from.core[1],
    to.core[2] - from.core[2],
  ];
  const firstDifference = differences.find((difference) => difference !== 0);
  if (firstDifference !== undefined) return firstDifference > 0;
  // 同一个 x.y.z：正式版比预发布新。
  return from.prerelease && !to.prerelease;
}

export const fetchNpmLatestVersion: FetchLatestVersion = async ({ npmPackage, signal }) => {
  const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(npmPackage)}/dist-tags`;
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(NPM_REQUEST_TIMEOUT_MS)]),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry answered ${response.status} for ${npmPackage}`);
  }
  const tags = NpmDistTagsSchema.safeParse(await response.json());
  if (!tags.success) {
    throw new Error(`npm registry has no latest tag for ${npmPackage}`);
  }
  return tags.data.latest;
};

const NPM_PACKAGES: ReadonlyMap<string, string> = new Map(
  AGENT_PROVIDER_DEFINITIONS.flatMap((definition) =>
    definition.npmPackage ? [[definition.id, definition.npmPackage] as const] : [],
  ),
);

export interface ProviderVersionCheckServiceOptions {
  /** 设置页那份快照；会等还在探测的提供方探测完，拿到已装版本。 */
  listProviders: () => Promise<ProviderSnapshotEntry[]>;
  // 缺省查 npm registry；测试注入桩。
  fetchLatestVersion?: FetchLatestVersion;
  logger: Logger;
  now?: () => number;
}

export interface ProviderVersionCheckInput {
  providers?: readonly string[];
  force?: boolean;
}

interface CachedLatestVersion {
  version: string;
  fetchedAt: number;
}

export class ProviderVersionCheckService {
  private readonly listProviders: () => Promise<ProviderSnapshotEntry[]>;
  private readonly fetchLatestVersion: FetchLatestVersion;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly cache = new Map<string, CachedLatestVersion>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly abort = new AbortController();

  constructor(options: ProviderVersionCheckServiceOptions) {
    this.listProviders = options.listProviders;
    this.fetchLatestVersion = options.fetchLatestVersion ?? fetchNpmLatestVersion;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
  }

  async check(input: ProviderVersionCheckInput = {}): Promise<ProviderVersionCheckResult[]> {
    const requested = input.providers ? new Set(input.providers) : null;
    const force = input.force === true;
    const checks = (await this.listProviders()).flatMap((entry) => {
      const npmPackage = NPM_PACKAGES.get(entry.provider);
      if (entry.source !== "builtin" || !npmPackage) return [];
      if (requested && !requested.has(entry.provider)) return [];
      return [this.checkEntry({ entry, npmPackage, force })];
    });
    return Promise.all(checks);
  }

  /** 升级之后调用：下一次检查重新查 npm。 */
  forget(provider: string): void {
    this.cache.delete(provider);
  }

  dispose(): void {
    this.abort.abort();
  }

  private async checkEntry({
    entry,
    npmPackage,
    force,
  }: {
    entry: ProviderSnapshotEntry;
    npmPackage: string;
    force: boolean;
  }): Promise<ProviderVersionCheckResult> {
    const installedVersion = entry.version;
    // 没装、停用或读不出已装版本的，没有可比的对象，也就不联网。
    if (!installedVersion) return { provider: entry.provider, updateAvailable: false };
    try {
      const latestVersion = await this.resolveLatestVersion({
        provider: entry.provider,
        npmPackage,
        force,
      });
      return {
        provider: entry.provider,
        installedVersion,
        latestVersion,
        updateAvailable: isNewerVersion({ installed: installedVersion, latest: latestVersion }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: error, provider: entry.provider }, "Latest CLI version check failed");
      return { provider: entry.provider, installedVersion, updateAvailable: false, error: message };
    }
  }

  private resolveLatestVersion({
    provider,
    npmPackage,
    force,
  }: {
    provider: string;
    npmPackage: string;
    force: boolean;
  }): Promise<string> {
    const cached = this.cache.get(provider);
    if (!force && cached && this.now() - cached.fetchedAt < LATEST_VERSION_TTL_MS) {
      return Promise.resolve(cached.version);
    }
    // 同一个提供方同时发起的查询共用一次请求，force 也加入正在进行的那次。
    const pending = this.inFlight.get(provider);
    if (pending) return pending;
    const request = this.fetchLatestVersion({ npmPackage, signal: this.abort.signal })
      .then((version) => {
        this.cache.set(provider, { version, fetchedAt: this.now() });
        return version;
      })
      .finally(() => {
        this.inFlight.delete(provider);
      });
    this.inFlight.set(provider, request);
    return request;
  }
}
