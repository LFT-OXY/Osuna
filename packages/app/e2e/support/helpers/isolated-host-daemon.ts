import type { ChildProcess, SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { withDisabledE2ESpeechEnv } from "./speech-env";
import { killProcessTree, spawnTsx } from "./spawn-node";

export interface IsolatedHostDaemon {
  serverId: string;
  port: number;
  osunaHome: string;
  getPid(): number | undefined;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface IsolatedHostDaemonOptions {
  environment?: Record<string, string | undefined>;
  mutableRelay?: {
    enabled: boolean;
    endpoint?: string;
  };
  osunaHome?: string;
  preserveHome?: boolean;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire an isolated daemon port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Isolated host daemon exited before listening (code ${String(child.exitCode)}, signal ${String(child.signalCode)})`,
      );
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.end();
          resolve();
        });
        socket.setTimeout(1_000, () => {
          socket.destroy();
          reject(new Error(`Connection timed out to isolated daemon port ${port}`));
        });
        socket.on("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(
    `Isolated host daemon did not listen on ${port}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

// OpenCode 默认停用，而 createIdleAgent 和 OpenCode 的 real spec 都要用它。spec 自己写了 enabled 的不动。
async function enableOpenCode(osunaHome: string): Promise<void> {
  const configPath = path.join(osunaHome, "config.json");
  const existing = existsSync(configPath)
    ? JSON.parse(await readFile(configPath, "utf8"))
    : { version: 1 };
  const openCode = existing.agents?.providers?.opencode;
  if (openCode?.enabled !== undefined) return;
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...existing,
        agents: {
          ...existing.agents,
          providers: { ...existing.agents?.providers, opencode: { ...openCode, enabled: true } },
        },
      },
      null,
      2,
    )}\n`,
  );
}

export async function startIsolatedHostDaemon(
  serverId: string,
  options: IsolatedHostDaemonOptions = {},
): Promise<IsolatedHostDaemon> {
  const primaryPort = Number(process.env.E2E_DAEMON_PORT ?? 0);
  let port = await getAvailablePort();
  while (port === 6767 || port === 6768 || port === primaryPort) port = await getAvailablePort();

  const metroPort = process.env.E2E_METRO_PORT;
  if (!metroPort) throw new Error("E2E_METRO_PORT is required to start an isolated host daemon");

  const osunaHome =
    options.osunaHome ?? (await mkdtemp(path.join(tmpdir(), "osuna-e2e-secondary-host-")));
  if (options.mutableRelay) {
    const endpoint =
      options.mutableRelay.endpoint ??
      (process.env.E2E_RELAY_PORT ? `127.0.0.1:${process.env.E2E_RELAY_PORT}` : "127.0.0.1:9");
    await writeFile(
      path.join(osunaHome, "config.json"),
      `${JSON.stringify({
        version: 1,
        daemon: {
          relay: {
            enabled: options.mutableRelay.enabled,
            endpoint,
            publicEndpoint: endpoint,
            useTls: false,
            publicUseTls: false,
          },
        },
      })}\n`,
    );
  }
  await enableOpenCode(osunaHome);
  const serverDir = path.resolve(__dirname, "../../../../server");
  const spawnDaemon = async (): Promise<ChildProcess> => {
    const spawnOptions: SpawnOptions = {
      cwd: serverDir,
      env: withDisabledE2ESpeechEnv({
        ...process.env,
        ...options.environment,
        OSUNA_HOME: osunaHome,
        OSUNA_SERVER_ID: serverId,
        OSUNA_LISTEN: `127.0.0.1:${port}`,
        OSUNA_CORS_ORIGINS: `http://localhost:${metroPort}`,
        OSUNA_RELAY_ENABLED: options.mutableRelay ? undefined : "0",
        OSUNA_NODE_ENV: "development",
        NODE_ENV: "development",
      }),
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    };
    const child = spawnTsx("scripts/supervisor-entrypoint.ts", ["--dev"], spawnOptions);

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      stderr = stderr.split("\n").slice(-40).join("\n");
    });

    try {
      await waitForServer(port, child);
      return child;
    } catch (error) {
      await killProcessTree(child);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nDaemon stderr:\n${stderr}`,
        { cause: error },
      );
    }
  };

  let child: ChildProcess;
  try {
    child = await spawnDaemon();
  } catch (error) {
    if (!options.preserveHome) {
      await rm(osunaHome, { recursive: true, force: true });
    }
    throw error;
  }
  let closed = false;

  return {
    serverId,
    port,
    osunaHome,
    getPid: () => child.pid,
    restart: async () => {
      if (closed) throw new Error(`Cannot restart closed isolated daemon ${serverId}`);
      await killProcessTree(child);
      child = await spawnDaemon();
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await killProcessTree(child);
      if (!options.preserveHome) {
        await rm(osunaHome, { recursive: true, force: true });
      }
    },
  };
}
