// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { readDaemonInstance, startDaemonInstance } from "../daemon-instance.js";
import {
  createDaemonTestContext,
  DaemonClient,
  type DaemonTestContext,
} from "../test-utils/index.js";

const SERVER_ROOT = path.resolve(import.meta.dirname, "../../..");
const SUPERVISOR_ENTRYPOINT = path.join(SERVER_ROOT, "scripts/supervisor-entrypoint.ts");
const MOVED_LOG_LINE = "Moved the Paseo data directory to the Osuna home";

const cleanupContexts = new Set<DaemonTestContext>();
const cleanupClients = new Set<DaemonClient>();
const cleanupSupervisors = new Set<ChildProcess>();
const cleanupPaths = new Set<string>();

afterEach(async () => {
  await Promise.all(Array.from(cleanupClients, (client) => client.close().catch(() => undefined)));
  cleanupClients.clear();
  await Promise.all(Array.from(cleanupSupervisors, stopSupervisor));
  cleanupSupervisors.clear();
  await Promise.all(Array.from(cleanupContexts, (ctx) => ctx.cleanup().catch(() => undefined)));
  cleanupContexts.clear();
  await Promise.all(
    Array.from(cleanupPaths, (target) =>
      rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
    ),
  );
  cleanupPaths.clear();
}, 60_000);

function tempDir(prefix: string): string {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  cleanupPaths.add(directory);
  return directory;
}

async function startDaemon(osunaHomeRoot: string): Promise<DaemonTestContext> {
  const ctx = await createDaemonTestContext({ osunaHomeRoot, cleanup: false });
  cleanupContexts.add(ctx);
  return ctx;
}

async function stopDaemon(ctx: DaemonTestContext): Promise<void> {
  cleanupContexts.delete(ctx);
  await ctx.cleanup();
}

async function getAvailablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// 不带 OSUNA_HOME 的环境：daemon 自己把 home 解析成用户目录下的默认位置，迁移才会触发。
function defaultHomeEnvironment(userHome: string, port: number): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith("OSUNA_"));
  return {
    ...Object.fromEntries(inherited),
    HOME: userHome,
    USERPROFILE: userHome,
    OSUNA_LISTEN: `127.0.0.1:${port}`,
    OSUNA_DICTATION_ENABLED: "0",
    OSUNA_VOICE_MODE_ENABLED: "0",
    OSUNA_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
  };
}

// 这次启动走的是真实的默认 home。先问一个同环境的子进程它的用户目录在哪，
// 不在测试目录里就不启动：迁移绝不能落到运行测试的这台机器的真实数据上。
function assertUserHomeIsIsolated(env: NodeJS.ProcessEnv, userHome: string): void {
  const probe = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require('node:os').homedir())"],
    { env, encoding: "utf8" },
  );
  expect(probe.stdout).toBe(userHome);
}

async function stopSupervisor(supervisor: ChildProcess): Promise<void> {
  if (supervisor.exitCode !== null || supervisor.signalCode !== null) return;
  const exited = once(supervisor, "exit");
  supervisor.kill("SIGTERM");
  await exited;
}

// 真实的拉起路径：supervisor 入口自己解析 home、迁移、再起 worker。
interface LaunchedSupervisor {
  port: number;
  stop(): Promise<void>;
}

async function launchSupervisorOnDefaultHome(userHome: string): Promise<LaunchedSupervisor> {
  const port = await getAvailablePort();
  const env = defaultHomeEnvironment(userHome, port);
  assertUserHomeIsIsolated(env, userHome);

  const output: string[] = [];
  const supervisor = spawn(
    process.execPath,
    ["--import", "tsx", SUPERVISOR_ENTRYPOINT, "--dev", "--no-relay"],
    { cwd: SERVER_ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  cleanupSupervisors.add(supervisor);
  supervisor.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  supervisor.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));

  const home = path.join(userHome, ".osuna");
  await expect
    .poll(
      async () => {
        if (supervisor.exitCode !== null) {
          throw new Error(`Supervisor exited with ${supervisor.exitCode}:\n${output.join("")}`);
        }
        return (await readDaemonInstance(home).catch(() => null))?.listen ?? null;
      },
      { timeout: 90_000, interval: 200 },
    )
    .toBe(`127.0.0.1:${port}`);
  return {
    port,
    stop: async () => {
      cleanupSupervisors.delete(supervisor);
      await stopSupervisor(supervisor);
    },
  };
}

test.skipIf(process.platform === "win32")(
  "a daemon started on the default home moves the 0.14.x data and serves it from there",
  async () => {
    const userHome = tempDir("legacy-home-e2e-");
    const legacyHome = path.join(userHome, ".paseo");
    const home = path.join(userHome, ".osuna");
    const cwd = path.join(legacyHome, "worktrees", "repo", "feature");
    mkdirSync(cwd, { recursive: true });

    // 0.14.x 把数据写在 .paseo 下。测试 daemon 的 home 固定叫 .osuna，所以播种时借一个指向旧目录的链接。
    const seedRoot = tempDir("legacy-home-e2e-seed-");
    symlinkSync(legacyHome, path.join(seedRoot, ".osuna"), "dir");
    const legacy = await startDaemon(seedRoot);
    const agent = await legacy.client.createAgent({
      provider: "codex",
      cwd,
      title: "Written before the move",
      modeId: "full-access",
    });
    await legacy.client.sendMessage(agent.id, "Respond with exactly: still here");
    expect((await legacy.client.waitForFinish(agent.id, 5_000)).status).toBe("idle");
    const workspacesBefore = await legacy.client.fetchWorkspaces();
    await stopDaemon(legacy);
    expect(workspacesBefore.entries).toHaveLength(1);
    expect(lstatSync(legacyHome).isDirectory()).toBe(true);

    const supervisor = await launchSupervisorOnDefaultHome(userHome);

    expect(lstatSync(legacyHome).isSymbolicLink()).toBe(true);
    expect(realpathSync(legacyHome)).toBe(home);
    const daemonLog = readFileSync(path.join(home, "daemon.log"), "utf8");
    expect(daemonLog.split(MOVED_LOG_LINE)).toHaveLength(2);

    const client = new DaemonClient({ url: `ws://127.0.0.1:${supervisor.port}/ws` });
    cleanupClients.add(client);
    await client.connect();

    const agents = await client.fetchAgents();
    expect(agents.entries.map((entry) => entry.agent)).toEqual([
      expect.objectContaining({ id: agent.id, cwd, title: "Written before the move" }),
    ]);

    const workspaces = await client.fetchWorkspaces();
    expect(workspaces.entries.map((entry) => entry.id)).toEqual(
      workspacesBefore.entries.map((entry) => entry.id),
    );
    expect(workspaces.entries.map((entry) => entry.workspaceDirectory)).toEqual([cwd]);

    await client.close();
    await supervisor.stop();

    // 历史要由 provider 重放。真实 daemon 里没有播种时用的那个测试 provider，
    // 所以换回带它的进程内 daemon，在搬过来的 home 上读同一个 Agent 的时间线。
    const migrated = await startDaemon(userHome);
    expect(migrated.daemon.osunaHome).toBe(home);
    const timeline = await migrated.client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 0,
    });
    const assistantText = timeline.entries
      .map((entry) => entry.item)
      .filter((item) => item.type === "assistant_message")
      .map((item) => item.text)
      .join("");
    expect(assistantText).toBe("still here");
  },
  180_000,
);

// 0.14.x 的 daemon 把自己的 pid 写在旧名字的锁文件里。用这个测试进程的 pid 代替一个还活着的旧 daemon。
const LEGACY_STARTED_AT = new Date().toISOString();

function writeLiveLegacyLock(directory: string): string {
  const lock = JSON.stringify({
    pid: process.pid,
    startedAt: LEGACY_STARTED_AT,
    hostname: "current-host",
    uid: process.getuid?.() ?? 0,
    listen: "127.0.0.1:6767",
    desktopManaged: true,
    heartbeat: true,
  });
  writeFileSync(path.join(directory, "paseo.pid"), lock);
  return lock;
}

test.skipIf(process.platform === "win32")(
  "a daemon started directly on the default home refuses while a 0.14.x daemon still runs there",
  async () => {
    const userHome = tempDir("legacy-daemon-direct-");
    const legacyHome = path.join(userHome, ".paseo");
    mkdirSync(legacyHome);
    const lock = writeLiveLegacyLock(legacyHome);
    const env = defaultHomeEnvironment(userHome, await getAvailablePort());
    assertUserHomeIsIsolated(env, userHome);

    const supervisor = spawn(
      process.execPath,
      ["--import", "tsx", SUPERVISOR_ENTRYPOINT, "--no-relay"],
      { cwd: SERVER_ROOT, env, stdio: ["ignore", "ignore", "pipe"] },
    );
    cleanupSupervisors.add(supervisor);
    const stderr: string[] = [];
    supervisor.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
    const [exitCode] = await once(supervisor, "exit");

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toBe(
      [
        `A 0.14.x daemon is still running from ${legacyHome} (PID ${process.pid}, started ${LEGACY_STARTED_AT}).`,
        "Osuna 1.0.0 will not move or share its data while it runs. Stop it, then try again:",
        `  osuna daemon stop --home "${legacyHome}"`,
        "",
      ].join("\n"),
    );
    expect(readdirSync(userHome)).toEqual([".paseo"]);
    expect(readdirSync(legacyHome)).toEqual(["paseo.pid"]);
    expect(readFileSync(path.join(legacyHome, "paseo.pid"), "utf8")).toBe(lock);
  },
  60_000,
);

test.skipIf(process.platform === "win32")(
  "a daemon launched in the background reports why it refused to start",
  async () => {
    const home = tempDir("legacy-daemon-background-");
    writeLiveLegacyLock(home);
    const env = defaultHomeEnvironment(path.dirname(home), await getAvailablePort());

    const failure = await startDaemonInstance({
      home,
      command: process.execPath,
      args: ["--import", "tsx", SUPERVISOR_ENTRYPOINT, "--no-relay"],
      env,
      mode: "managed",
      timeoutMs: 30_000,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "DAEMON_START_FAILED" });
    expect((failure as Error).message.split("\n")[0]).toBe(
      `Daemon failed to start: A 0.14.x daemon is still running in ${home} (PID ${process.pid}, started ${LEGACY_STARTED_AT}). Stop it first: osuna daemon stop --home "${home}"`,
    );
    expect(await readDaemonInstance(home)).toBeNull();
  },
  60_000,
);
