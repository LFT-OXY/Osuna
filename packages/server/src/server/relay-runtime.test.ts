import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { generateKeyPair } from "@osuna/relay";
import { createRelayRuntime } from "./relay-runtime.js";
import { startRelayTransport, type RelayTransportController } from "./relay-transport.js";

describe("RelayRuntime", () => {
  test("starts and stops transport as enabled state changes", async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const starts: string[] = [];
    const startTransport: typeof startRelayTransport = (options) => {
      starts.push(options.relayEndpoint);
      const stop = vi.fn(async () => undefined);
      stops.push(stop);
      return { stop } satisfies RelayTransportController;
    };
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "relay.example.test:443",
        publicEndpoint: "relay.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport,
    });

    expect(starts).toEqual([]);
    runtime.setEnabled(true);
    runtime.setEnabled(true);
    expect(starts).toEqual(["relay.example.test:443"]);
    expect(runtime.getConfig().enabled).toBe(true);

    runtime.setEnabled(false);
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalledOnce());
    expect(runtime.getConfig().enabled).toBe(false);
  });

  test("keeps relay disabled when transport startup fails", () => {
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "invalid-endpoint",
        publicEndpoint: "invalid-endpoint",
        useTls: false,
        publicUseTls: false,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport: () => {
        throw new Error("Invalid relay endpoint");
      },
    });

    expect(() => runtime.setEnabled(true)).toThrow("Invalid relay endpoint");
    expect(runtime.getConfig().enabled).toBe(false);
  });

  // 旧配置省略了 relay.enabled，按 COMPAT 规则会解析成启用；此时若抛错，daemon 根本起不来。
  test("stays offline and says what to configure when enabled without an endpoint", () => {
    const starts: string[] = [];
    const warnings: string[] = [];
    const logger = pino({ level: "silent" });
    logger.warn = ((message: string) => {
      warnings.push(message);
    }) as typeof logger.warn;

    const runtime = createRelayRuntime({
      config: {
        enabled: true,
        endpoint: undefined,
        publicEndpoint: undefined,
        useTls: false,
        publicUseTls: false,
      },
      logger,
      attachSocket: async () => undefined,
      serverId: "relay-runtime-no-endpoint",
      daemonKeyPair: generateKeyPair(),
      startTransport: (options) => {
        starts.push(options.relayEndpoint);
        return { stop: async () => undefined } satisfies RelayTransportController;
      },
    });

    expect(starts).toEqual([]);
    expect(warnings).toEqual([
      "Relay is enabled but no endpoint is configured; staying offline. Set OSUNA_RELAY_ENDPOINT or daemon.relay.endpoint.",
    ]);
    expect(runtime.getConfig().enabled).toBe(true);
  });
});
