import type pino from "pino";
import type { KeyPair } from "@osuna/relay/e2ee";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import {
  startRelayTransport,
  type RelaySocketLike,
  type RelayTransportController,
} from "./relay-transport.js";

export interface RelayRuntimeConfig {
  enabled: boolean;
  endpoint: string | undefined;
  publicEndpoint: string | undefined;
  useTls: boolean;
  publicUseTls: boolean;
}

interface RelayRuntimeOptions {
  config: RelayRuntimeConfig;
  logger: pino.Logger;
  attachSocket(ws: RelaySocketLike, metadata?: ExternalSocketMetadata): Promise<void>;
  serverId: string;
  daemonKeyPair: KeyPair;
  startTransport?: typeof startRelayTransport;
}

export interface RelayRuntime {
  getConfig(): RelayRuntimeConfig;
  setEnabled(enabled: boolean): void;
  stop(): Promise<void>;
}

export function createRelayRuntime(options: RelayRuntimeOptions): RelayRuntime {
  const startTransport = options.startTransport ?? startRelayTransport;
  let config = options.config;
  let transport: RelayTransportController | null = null;

  function start(): void {
    if (transport) return;
    const relayEndpoint = config.endpoint;
    // 没有托管 relay 可回退。端点缺失时保持不连接并说清该配什么：连一个不存在的
    // 地址更难排查，而在启动路径上抛错会让省略了 relay.enabled 的旧配置起不来。
    if (!relayEndpoint) {
      options.logger.warn(
        "Relay is enabled but no endpoint is configured; staying offline. Set OSUNA_RELAY_ENDPOINT or daemon.relay.endpoint.",
      );
      return;
    }
    transport = startTransport({
      logger: options.logger,
      attachSocket: options.attachSocket,
      relayEndpoint,
      relayUseTls: config.useTls,
      serverId: options.serverId,
      daemonKeyPair: options.daemonKeyPair,
    });
  }

  function setEnabled(enabled: boolean): void {
    if (config.enabled === enabled) return;
    if (enabled) {
      start();
      config = { ...config, enabled: true };
      return;
    }
    config = { ...config, enabled: false };
    const current = transport;
    transport = null;
    void current?.stop().catch((error) => {
      options.logger.warn({ err: error }, "Failed to stop relay transport");
    });
  }

  async function stop(): Promise<void> {
    const current = transport;
    transport = null;
    await current?.stop();
  }

  if (config.enabled) start();

  return {
    getConfig: () => config,
    setEnabled,
    stop,
  };
}
