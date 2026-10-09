import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import {
  createOsunaDaemon,
  type OsunaDaemonConfig,
  type OsunaOpenAIConfig,
  type OsunaSpeechConfig,
} from "../bootstrap.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "./fake-agent-client.js";
import type { PushNotificationSender } from "../push/index.js";
import type { AgentProfile } from "@osuna/protocol/messages";
import { AGENT_PROVIDER_DEFINITIONS } from "@osuna/protocol/provider-manifest";

interface TestOsunaDaemonOptions {
  daemonVersion?: string;
  desktopManaged?: boolean;
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  logger?: Parameters<typeof createOsunaDaemon>[1];
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
  providerOverrides?: OsunaDaemonConfig["providerOverrides"];
  osunaHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  openai?: OsunaOpenAIConfig;
  speech?: OsunaSpeechConfig;
  voiceLlmProvider?: OsunaDaemonConfig["voiceLlmProvider"];
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  auth?: OsunaDaemonConfig["auth"];
  pushNotificationSender?: PushNotificationSender;
  serviceProxy?: OsunaDaemonConfig["serviceProxy"];
  webUi?: OsunaDaemonConfig["webUi"];
  trustedProxies?: OsunaDaemonConfig["trustedProxies"];
  agentProfiles?: AgentProfile[];
  autoArchiveAfterMerge?: boolean;
  pluginsEnabled?: OsunaDaemonConfig["pluginsEnabled"];
  plugins?: OsunaDaemonConfig["plugins"];
  usage?: OsunaDaemonConfig["usage"];
  apiEndpoints?: OsunaDaemonConfig["apiEndpoints"];
  providerVersions?: OsunaDaemonConfig["providerVersions"];
}

export interface TestOsunaDaemon {
  config: OsunaDaemonConfig;
  daemon: Awaited<ReturnType<typeof createOsunaDaemon>>;
  port: number;
  osunaHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createOsunaDaemon>>,
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

export async function createTestOsunaDaemon(
  options: TestOsunaDaemonOptions = {},
): Promise<TestOsunaDaemon> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, osunaHomeRoot, osunaHome, staticDir } = await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createOsunaDaemon(config, logger, {
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
          await Promise.all([
            rm(osunaHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
            rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
          ]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        osunaHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      await Promise.all([
        rm(osunaHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
        rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      ]);

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
  config: OsunaDaemonConfig;
  osunaHomeRoot: string;
  osunaHome: string;
  staticDir: string;
}

async function prepareTestDaemonConfig(
  options: TestOsunaDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const osunaHomeRoot =
    options.osunaHomeRoot ?? (await mkdtemp(path.join(os.tmpdir(), "osuna-home-")));
  const osunaHome = path.join(osunaHomeRoot, ".osuna");
  await mkdir(osunaHome, { recursive: true });
  const staticDir = options.staticDir ?? (await mkdtemp(path.join(os.tmpdir(), "osuna-static-")));
  const listenHost = options.listen ?? "127.0.0.1";
  const agentClients = options.agentClients ?? createTestAgentClients();
  const config: OsunaDaemonConfig = {
    listen: `${listenHost}:0`,
    osunaHome,
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
    agentStoragePath: path.join(osunaHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "osuna-relay.chinhae.cc:443",
    relayUseTls: options.relayUseTls,
    relayPublicUseTls: options.relayPublicUseTls,
    appBaseUrl: "https://osuna-app.chinhae.cc",
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
    plugins: options.plugins,
    // Default to no log roots so a test daemon never scans the developer's
    // real Claude/Codex/Pi/OMP transcripts.
    usage: {
      roots: { claude: [], codex: [], pi: [], omp: [] },
      ...options.usage,
      // No test daemon reaches out for a price table on its own; a suite about
      // the refresh schedule turns it back on.
      pricing: { autoUpdate: false, ...options.usage?.pricing },
    },
    // 第三方接口会改写 CLI 配置文件；测试 daemon 默认指向临时目录，绝不碰真实的 ~/.claude 和 ~/.codex。
    apiEndpoints: options.apiEndpoints ?? {
      env: {
        CLAUDE_CONFIG_DIR: path.join(osunaHomeRoot, "claude-config"),
        CODEX_HOME: path.join(osunaHomeRoot, "codex-home"),
      },
      homeDir: osunaHomeRoot,
    },
    // 测试 daemon 绝不去 npm registry 查最新版本；关心这件事的测试注入自己的桩。
    providerVersions: {
      fetchLatestVersion: async ({ npmPackage }) => {
        throw new Error(`Test daemon does not query npm for ${npmPackage}`);
      },
      ...options.providerVersions,
    },
  };
  return { config, osunaHomeRoot, osunaHome, staticDir };
}

// 测试注入了某个提供方的客户端，就是要用它；默认停用的内置提供方（如 opencode）需要补上 enabled: true。
function enableInjectedProviders(
  agentClients: Partial<Record<AgentProvider, AgentClient>>,
  providerOverrides: OsunaDaemonConfig["providerOverrides"],
): OsunaDaemonConfig["providerOverrides"] {
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
