import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { HostProcessesError, type HostProcess } from "../api-endpoints/host-processes.js";
import { FakeHostProcesses } from "../test-utils/fake-host-processes.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 改完提示要重开谁（PRD 第 36 条）：最近一次改写之前启动的终端 CLI、Osuna 自己的会话、Codex 共用的后台 app-server。
 * 进程表与 `codex app-server daemon restart` 一律经假的「进程与命令」，什么都不真的读、真的跑。
 */

const FAKE_CODEX = "/fake/bin/codex";
const RESTART_ARGS = ["app-server", "daemon", "restart"];

async function connect(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.12.1",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return client;
}

describe.skipIf(process.platform === "win32")("who to reopen after a rewrite", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let root: string;
  let codexHome: string;
  let claudeDir: string;
  let fake: FakeHostProcesses;
  // 接口服务的时钟，比真的时钟晚一小时：Osuna 会话按真的时钟记启动时间，都早于改写。
  let clock: Date;
  const start = new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000);

  function after(seconds: number): Date {
    return new Date(start.getTime() + seconds * 1000);
  }

  beforeEach(async () => {
    clock = start;
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-reopen-"));
    codexHome = path.join(root, "codex-home");
    claudeDir = path.join(root, "claude");
    await mkdir(codexHome, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.1-codex"\n');
    await writeFile(path.join(claudeDir, "settings.json"), "{}\n");
    fake = new FakeHostProcesses();
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeDir },
        homeDir: root,
        now: () => clock,
        hostProcesses: fake,
        findCodexCommand: async ({ env }) => ({ command: FAKE_CODEX, args: [], env }),
      },
    });
    client = await connect(daemon);
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await rm(root, { recursive: true, force: true });
  });

  async function switchOnAt(input: {
    provider: "claude" | "codex";
    seconds: number;
  }): Promise<void> {
    const saved = await client.apiEndpointSave({
      provider: input.provider,
      name: `Relay ${input.provider}`,
      baseUrl: "https://relay.example/v1",
      apiKey: "sk-relay",
      models: [{ id: `relay-${input.provider}` }],
      defaultModelId: `relay-${input.provider}`,
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    clock = after(input.seconds);
    await client.apiEndpointSetActive(input.provider, saved.endpoint.id);
  }

  function running(input: { pid: number; seconds: number; commandLine: string }): HostProcess {
    return {
      pid: input.pid,
      parentPid: 1,
      startedAt: after(input.seconds),
      commandLine: input.commandLine,
    };
  }

  /** Codex 给后台 app-server 记的进程记录文件，修改时间就是它的启动时间。 */
  function writePidFile(input: { pid: number; seconds: number }): void {
    const file = path.join(codexHome, "app-server-daemon", "app-server.pid");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ pid: input.pid }));
    utimesSync(file, after(input.seconds), after(input.seconds));
  }

  function appServer(pid: number): HostProcess {
    return running({
      pid,
      seconds: -500,
      commandLine: `${codexHome}/packages/app-server-daemon/releases/0.163.0/bin/codex app-server --listen unix:///x --managed-daemon`,
    });
  }

  async function reopenHints(): Promise<unknown> {
    clock = after(100);
    return (await client.apiEndpointList("codex")).reopenHints;
  }

  test("terminal Claude Code and Codex started before the rewrite are listed, ones started after aren't", async () => {
    fake.processes = [
      running({ pid: 10, seconds: -60, commandLine: "/Users/me/.local/bin/claude" }),
      running({ pid: 11, seconds: 50, commandLine: "/Users/me/.local/bin/claude --resume" }),
      running({ pid: 20, seconds: -120, commandLine: "/opt/homebrew/bin/codex -m gpt-6" }),
      running({ pid: 21, seconds: 50, commandLine: "/opt/homebrew/bin/codex" }),
      // Osuna 自己起的不算终端里的。
      {
        pid: 30,
        parentPid: process.pid,
        startedAt: after(-60),
        commandLine: "/opt/homebrew/bin/codex app-server",
      },
    ];
    await switchOnAt({ provider: "claude", seconds: 10 });
    await switchOnAt({ provider: "codex", seconds: 10 });
    expect(await reopenHints()).toEqual({
      claude: [
        {
          kind: "cli",
          count: 1,
          since: after(-60).toISOString(),
          message: expect.stringContaining("Claude Code in a terminal, started"),
        },
      ],
      codex: [
        {
          kind: "cli",
          count: 1,
          since: after(-120).toISOString(),
          message: expect.stringContaining("Codex in a terminal, started"),
        },
      ],
    });
    expect(fake.runs).toEqual([]);
  });

  test("nothing to reopen before anything is rewritten, and no process is listed", async () => {
    fake.processes = [running({ pid: 10, seconds: -60, commandLine: "claude" })];
    expect(await reopenHints()).toEqual({ claude: [], codex: [] });
    expect(fake.lists).toBe(0);
  });

  test("Osuna's own running sessions are counted per provider", async () => {
    await client.createAgent({ provider: "claude", cwd: root, title: "c1" });
    await client.createAgent({ provider: "claude", cwd: root, title: "c2" });
    await client.createAgent({ provider: "codex", cwd: root, title: "x1" });
    await switchOnAt({ provider: "claude", seconds: 10 });
    await switchOnAt({ provider: "codex", seconds: 10 });
    expect(await reopenHints()).toEqual({
      claude: [
        {
          kind: "osuna_sessions",
          count: 2,
          message:
            "2 Claude Code session(s) in Osuna started before Osuna last changed Claude Code's settings: reload each (Reload agent in its tab's menu) to use the new ones.",
        },
      ],
      codex: [
        {
          kind: "osuna_sessions",
          count: 1,
          message:
            "1 Codex session(s) in Osuna started before Osuna last changed Codex's settings: reload each (Reload agent in its tab's menu) to use the new ones.",
        },
      ],
    });
  });

  test("the app-server, started before the rewrite with no client on it, is restarted with this CODEX_HOME", async () => {
    writePidFile({ pid: 500, seconds: -500 });
    fake.processes = [appServer(500)];
    // 重启后 Codex 改写进程记录文件。
    fake.onRun = () => writePidFile({ pid: 501, seconds: 20 });
    await switchOnAt({ provider: "codex", seconds: 10 });
    expect(await reopenHints()).toEqual({
      claude: [],
      codex: [
        {
          kind: "app_server_restarted",
          since: after(-500).toISOString(),
          message:
            "Osuna restarted the app-server codex sessions share, which none was on, so new codex sessions have the new settings; restart the Codex app, if it is open, to see them there.",
        },
      ],
    });
    expect(fake.runs).toEqual([
      {
        command: FAKE_CODEX,
        args: RESTART_ARGS,
        env: expect.objectContaining({ CODEX_HOME: codexHome }),
        timeoutMs: 90_000,
      },
    ]);
  });

  test("with a client on the app-server, it isn't restarted and the hint gives the command", async () => {
    writePidFile({ pid: 500, seconds: -500 });
    fake.processes = [appServer(500), running({ pid: 600, seconds: 30, commandLine: "codex" })];
    await switchOnAt({ provider: "codex", seconds: 10 });
    const hints = await reopenHints();
    expect(hints).toEqual({
      claude: [],
      codex: [
        {
          kind: "app_server",
          since: after(-500).toISOString(),
          command: "codex app-server daemon restart",
          message: expect.stringContaining("restart it with codex app-server daemon restart"),
        },
      ],
    });
    expect(fake.runs).toEqual([]);
  });

  test("a restart that fails leaves the command to the user", async () => {
    writePidFile({ pid: 500, seconds: -500 });
    fake.processes = [appServer(500)];
    fake.runResult = { exitCode: 1, output: "Error: no daemon to restart\n" };
    await switchOnAt({ provider: "codex", seconds: 10 });
    expect(await reopenHints()).toEqual({
      claude: [],
      codex: [
        {
          kind: "app_server",
          since: after(-500).toISOString(),
          command: "codex app-server daemon restart",
          message: expect.stringContaining("restart it with codex app-server daemon restart"),
        },
      ],
    });
  });

  test("processes that can't be listed block neither the list nor the other hints", async () => {
    await client.createAgent({ provider: "codex", cwd: root, title: "x1" });
    writePidFile({ pid: 500, seconds: -500 });
    fake.listError = new HostProcessesError("ps didn't start");
    await switchOnAt({ provider: "codex", seconds: 10 });
    const listed = await client.apiEndpointList("codex");
    expect(listed.error).toBeNull();
    expect(listed.reopenHints).toEqual({
      claude: [],
      codex: [
        {
          kind: "osuna_sessions",
          count: 1,
          message: expect.stringContaining("1 Codex session(s)"),
        },
      ],
    });
    expect(fake.runs).toEqual([]);
  });
});
