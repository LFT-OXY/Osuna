import { readFile } from "node:fs/promises";
import path from "node:path";
import { createTestOsunaDaemon } from "./osuna-daemon.js";

async function main(): Promise<void> {
  const metroPort = process.env.E2E_METRO_PORT;
  if (!metroPort) {
    throw new Error("E2E_METRO_PORT is not set");
  }

  const daemon = await createTestOsunaDaemon({
    corsAllowedOrigins: [`http://localhost:${metroPort}`],
    // 默认值与任何发布版本都不相同，但仍在 1.0.0 协议下限之上：客户端连得上，又会看到版本不一致。
    daemonVersion: process.env.E2E_DAEMON_VERSION ?? "1.0.0-alpha.0",
    desktopManaged: process.env.E2E_DESKTOP_MANAGED === "1",
    daemonStatusRpcCapability: process.env.E2E_DAEMON_STATUS_RPC_CAPABILITY !== "0",
    relayConfigCapability: process.env.E2E_RELAY_CONFIG_CAPABILITY !== "0",
  });
  const serverId = (await readFile(path.join(daemon.osunaHome, "server-id"), "utf8")).trim();

  process.send?.({
    type: "ready",
    endpoint: `127.0.0.1:${daemon.port}`,
    serverId,
  });

  const shutdown = async () => {
    await daemon.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  process.send?.({
    type: "error",
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exit(1);
});
