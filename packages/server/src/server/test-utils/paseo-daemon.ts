import { BuiltinPluginLoader } from "../plugins/builtin/index.js";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import {
  createPaseoDaemon,
  type PaseoDaemonConfig,
  type PaseoOpenAIConfig,
  type PaseoSpeechConfig,
} from "../bootstrap.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "./fake-agent-client.js";
import type { PushNotificationSender } from "../push/index.js";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { FakeHostProcesses } from "./fake-host-processes.js";
import { BALANCE_VENDOR_URLS } from "../api-endpoints/balance.js";
import { loadConfig } from "../config.js";
import { FakeCliKeychain } from "./fake-cli-keychain.js";

interface TestPaseoDaemonOptions {
  daemonVersion?: string;
  desktopManaged?: boolean;
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  listenPort?: number;
  logger?: Parameters<typeof createPaseoDaemon>[1];
  mcpEnabled?: boolean;
  mcpInjectIntoAgents?: boolean;
  mcpDebug?: boolean;
  isDev?: boolean;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  daemonStatusRpcCapability?: boolean;
  relayConfigCapability?: boolean;
  agentClients?: Partial<Record<AgentProvider, AgentClient>>;
  providerOverrides?: PaseoDaemonConfig["providerOverrides"];
  paseoHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  openai?: PaseoOpenAIConfig;
  speech?: PaseoSpeechConfig;
  voiceLlmProvider?: PaseoDaemonConfig["voiceLlmProvider"];
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  auth?: PaseoDaemonConfig["auth"];
  pushNotificationSender?: PushNotificationSender;
  serviceProxy?: PaseoDaemonConfig["serviceProxy"];
  webUi?: PaseoDaemonConfig["webUi"];
  trustedProxies?: PaseoDaemonConfig["trustedProxies"];
  agentProfiles?: AgentProfile[];
  autoArchiveAfterMerge?: boolean;
  pluginsEnabled?: PaseoDaemonConfig["pluginsEnabled"];
  /**
   * 照真实启动解析「读取 CLI 登录凭证」：读这个 home 的 config.json 加这份环境变量（如 PASEO_NO_CLI_SIGN_INS）。
   * 不传时开关为开、没有环境变量。
   */
  cliSignInsLaunchEnv?: NodeJS.ProcessEnv;
  builtinPlugins?: BuiltinPluginLoader;
  plugins?: PaseoDaemonConfig["plugins"];
  usage?: PaseoDaemonConfig["usage"];
  apiEndpoints?: PaseoDaemonConfig["apiEndpoints"];
  providerVersions?: PaseoDaemonConfig["providerVersions"];
  providerAccounts?: PaseoDaemonConfig["providerAccounts"];
}

export interface TestPaseoDaemon {
  config: PaseoDaemonConfig;
  daemon: Awaited<ReturnType<typeof createPaseoDaemon>>;
  port: number;
  paseoHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createPaseoDaemon>>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(
        `Timed out starting test daemon after ${timeoutMs}ms`,
      ) as Error & { code?: string };
      timeoutError.code = "TEST_DAEMON_START_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);

    daemon.start().then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
        return;
      },
      (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

export async function createTestPaseoDaemon(
  options: TestPaseoDaemonOptions = {},
): Promise<TestPaseoDaemon> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, paseoHomeRoot, paseoHome, staticDir, createdDirs } =
      await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createPaseoDaemon(config, logger, {
      builtinPlugins: options.builtinPlugins ?? new BuiltinPluginLoader(undefined, []),
      serverFeatureOverrides: {
        daemonStatusRpc: options.daemonStatusRpcCapability,
        relayConfig: options.relayConfigCapability,
      },
    });
    try {
      await startDaemonWithTimeout(daemon, TEST_DAEMON_START_TIMEOUT_MS);
      const listenTarget = daemon.getListenTarget();
      if (!listenTarget || listenTarget.type !== "tcp") {
        throw new Error("Test daemon did not expose a bound TCP listen target");
      }

      const close = async (): Promise<void> => {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        if (options.cleanup ?? true) {
          await new Promise((r) => setTimeout(r, 50));
          await removeDirs([paseoHomeRoot, staticDir]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        paseoHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      // A failed attempt removes only what it created: a caller-supplied home keeps its serverId.
      await removeDirs(createdDirs);

      if (
        (!isAddressInUseError(error) && !isStartupTimeoutError(error)) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to start test daemon");
}

interface PreparedTestDaemonConfig {
  config: PaseoDaemonConfig;
  paseoHomeRoot: string;
  paseoHome: string;
  staticDir: string;
  createdDirs: string[];
}

async function removeDirs(dirs: string[]): Promise<void> {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
}

async function createTempDir(prefix: string, createdDirs: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function prepareTestDaemonConfig(
  options: TestPaseoDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const createdDirs: string[] = [];
  const paseoHomeRoot = options.paseoHomeRoot ?? (await createTempDir("paseo-home-", createdDirs));
  const paseoHome = path.join(paseoHomeRoot, ".paseo");
  await mkdir(paseoHome, { recursive: true });
  const staticDir = options.staticDir ?? (await createTempDir("paseo-static-", createdDirs));
  const listenHost = options.listen ?? "127.0.0.1";
  const agentClients = options.agentClients ?? createTestAgentClients();
  const listenPort = options.listenPort ?? 0;
  const config: PaseoDaemonConfig = {
    listen: `${listenHost}:${listenPort}`,
    paseoHome,
    daemonVersion: options.daemonVersion,
    desktopManaged: options.desktopManaged,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    hostnames: true,
    mcpEnabled: options.mcpEnabled ?? true,
    mcpInjectIntoAgents: options.mcpInjectIntoAgents,
    staticDir,
    mcpDebug: options.mcpDebug ?? false,
    isDev: options.isDev,
    agentClients,
    providerOverrides: enableInjectedProviders(agentClients, options.providerOverrides),
    agentStoragePath: path.join(paseoHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "relay.paseo.sh:443",
    relayUseTls: options.relayUseTls,
    relayPublicUseTls: options.relayPublicUseTls,
    appBaseUrl: "https://app.paseo.sh",
    auth: options.auth,
    pushNotificationSender: options.pushNotificationSender,
    serviceProxy: options.serviceProxy,
    webUi: options.webUi,
    trustedProxies: options.trustedProxies,
    openai: options.openai,
    speech: options.speech,
    voiceLlmProvider: options.voiceLlmProvider ?? null,
    voiceLlmProviderExplicit: options.voiceLlmProviderExplicit ?? false,
    voiceLlmModel: options.voiceLlmModel ?? null,
    dictationFinalTimeoutMs: options.dictationFinalTimeoutMs,
    downloadTokenTtlMs: options.downloadTokenTtlMs,
    agentProfiles: options.agentProfiles,
    autoArchiveAfterMerge: options.autoArchiveAfterMerge,
    pluginsEnabled: options.pluginsEnabled,
    ...resolveCliSignInsAtLaunch(paseoHome, options.cliSignInsLaunchEnv),
    plugins: options.plugins,
    // Default to no log roots so a test daemon never scans the developer's
    // real Claude/Codex/Pi/OMP transcripts.
    usage: {
      roots: { claude: [], codex: [], pi: [], omp: [] },
      ...options.usage,
      // No test daemon reaches out for a price table on its own; a suite about
      // the refresh schedule turns it back on.
      pricing: { autoUpdate: false, ...options.usage?.pricing },
      // 绝不上网取汇率：关心汇率的用例自己传本机假汇率服务与真的 fetch。
      exchangeRate: {
        fetch: async (input) => {
          throw new Error(
            `The test daemon never fetches ${String(input)}: pass usage.exchangeRate`,
          );
        },
        ...options.usage?.exchangeRate,
      },
    },
    // 第三方接口会改写 CLI 配置文件；测试 daemon 默认指向临时目录，绝不碰真实的 ~/.claude 和 ~/.codex。
    apiEndpoints: {
      // 判断 Codex 登录方式的生产实现会起真的 Codex app-server：测试 daemon 一律换成固定答案（未登录），
      // 关心登录方式的用例自己传 readCodexSignIn。
      readCodexSignIn: async () => "signed_out" as const,
      // 绝不跑真的 omp --version：缺省按版本不知道算，关心版本的用例自己传 readOmpCliVersion。
      readOmpCliVersion: async () => null,
      // Claude Code 的托管设置：放在用例自己的 apiEndpoints 之前，传了 env 的用例也不会读到真实的系统目录。
      claudeManagedSettingsDir: path.join(paseoHomeRoot, "claude-managed"),
      // 绝不起开发者真实的登录 shell：缺省答「什么都没设」，关心它的用例自己传假的。
      readLoginShellEnv: async () => ({}),
      // 绝不带上开发者自己的代理变量，也绝不经代理发请求：关心代理的用例自己传本机假代理与真的探测。
      proxyEnv: {},
      probeThroughProxy: async () => {
        throw new Error("The test daemon never probes a proxy: pass probeThroughProxy");
      },
      // 绝不上网取网站图标：关心「从网站取图标」的用例自己传本机假站点。
      fetchSite: async ({ url }) => {
        throw new Error(`The test daemon never fetches ${url}: pass fetchSite`);
      },
      // daemon 自己拉清单（保存后当场、每天刷新）只去本机的假上游，绝不上网（真实厂商地址、relay.example 都跳过）。
      reachesUnasked: (baseUrl) => isLoopbackUrl(baseUrl),
      // 绝不读真实的进程表、不跑真的 codex：缺省一个什么都没在跑的假适配器，关心它的用例自己传。
      hostProcesses: new FakeHostProcesses(),
      ...(options.apiEndpoints ?? {
        env: {
          CLAUDE_CONFIG_DIR: path.join(paseoHomeRoot, "claude-config"),
          CODEX_HOME: path.join(paseoHomeRoot, "codex-home"),
        },
        homeDir: paseoHomeRoot,
      }),
      // 厂商状态页一律指到本机一个没人听的端口：开着自动更新的用例也绝不读真的状态页。
      // 关心它的用例指到本机假页面；只换了一家时，其余几家照样留在本机。
      vendorStatusUrls: {
        anthropic: "http://127.0.0.1:9/anthropic/api/v2/summary.json",
        openai: "http://127.0.0.1:9/openai/api/v2/summary.json",
        moonshot: "http://127.0.0.1:9/moonshot/api/v2/summary.json",
        ...options.apiEndpoints?.vendorStatusUrls,
      },
      // 厂商余额接口一律指到本机一个没人听的端口：绝不带着 key 去问真的厂商。关心它的用例指到本机假服务。
      balanceUrls: {
        ...Object.fromEntries(
          Object.keys(BALANCE_VENDOR_URLS).map((vendor) => [
            vendor,
            `http://127.0.0.1:9/${vendor}/balance`,
          ]),
        ),
        ...options.apiEndpoints?.balanceUrls,
      },
      // 从别的软件导入：CC Switch、Alma、OpenCode 一律读临时目录（多半不存在），绝不读开发者真实的配置；
      // Claude Code、Codex 跟着上面的 env 与 homeDir。关心导入的用例自己放假配置。
      importSourcePaths: {
        ccSwitchDir: path.join(paseoHomeRoot, "import-sources", "cc-switch"),
        almaDatabase: path.join(paseoHomeRoot, "import-sources", "alma", "chat_threads.db"),
        openCodeAuth: path.join(paseoHomeRoot, "import-sources", "opencode", "auth.json"),
        ...options.apiEndpoints?.importSourcePaths,
      },
    },
    // 多号自动轮换读 CLI 登录：测试 daemon 默认指向临时目录与空的假钥匙串，额度一律读不到，加号连不上，
    // 绝不碰真实的 ~/.codex、~/.claude 与钥匙串。关心它的用例自己传。
    providerAccounts: {
      env: {
        CLAUDE_CONFIG_DIR: path.join(paseoHomeRoot, "claude-config"),
        CODEX_HOME: path.join(paseoHomeRoot, "codex-home"),
      },
      homeDir: paseoHomeRoot,
      keychain: new FakeCliKeychain(),
      // 加号与续期绝不连 OpenAI，也不占本机的 1455：关心它的用例指向自己的假登录服务。
      codexSignIn: {
        endpoints: {
          authorizeUrl: "http://127.0.0.1:9/oauth/authorize",
          tokenUrl: "http://127.0.0.1:9/oauth/token",
        },
        callbackPort: 0,
      },
      // 绝不运行真的 Claude Code：关心加号与读额度的用例给自己的假 claude。
      claude: { command: path.join(paseoHomeRoot, "no-claude-in-tests") },
      usage: {
        read: async () => ({
          status: "failed",
          reason: "The test daemon never reads plan usage: pass providerAccounts.usage",
        }),
      },
      ...options.providerAccounts,
    },
    // 测试 daemon 绝不去 npm registry 查最新版本；关心这件事的测试注入自己的桩。
    providerVersions: {
      fetchLatestVersion: async ({ npmPackage }) => {
        throw new Error(`Test daemon does not query npm for ${npmPackage}`);
      },
      ...options.providerVersions,
    },
  };
  return { config, paseoHomeRoot, paseoHome, staticDir, createdDirs };
}

// 测试注入了某个提供方的客户端，就是要用它；默认停用的内置提供方（如 opencode）需要补上 enabled: true。
function enableInjectedProviders(
  agentClients: Partial<Record<AgentProvider, AgentClient>>,
  providerOverrides: PaseoDaemonConfig["providerOverrides"],
): PaseoDaemonConfig["providerOverrides"] {
  const overrides = { ...providerOverrides };
  for (const definition of AGENT_PROVIDER_DEFINITIONS) {
    const offByDefault = definition.enabledByDefault === false;
    const injected = Boolean(agentClients[definition.id]);
    const setByTest = overrides[definition.id]?.enabled !== undefined;
    if (!offByDefault || !injected || setByTest) continue;
    overrides[definition.id] = { ...overrides[definition.id], enabled: true };
  }
  return overrides;
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "EADDRINUSE";
}

function isStartupTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "TEST_DAEMON_START_TIMEOUT";
}

/** 本机地址：127.0.0.1、::1 与 localhost。 */
function isLoopbackUrl(baseUrl: string): boolean {
  if (!URL.canParse(baseUrl)) return false;
  const host = new URL(baseUrl).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function resolveCliSignInsAtLaunch(
  paseoHome: string,
  env: NodeJS.ProcessEnv | undefined,
): Pick<PaseoDaemonConfig, "readCliSignIns" | "readCliSignInsForcedOff"> {
  if (!env) return {};
  const launched = loadConfig(paseoHome, { env });
  return {
    readCliSignIns: launched.readCliSignIns,
    readCliSignInsForcedOff: launched.readCliSignInsForcedOff,
  };
}
