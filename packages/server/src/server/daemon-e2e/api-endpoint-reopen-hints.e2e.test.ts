import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { HostProcessesError, type HostProcess } from "../api-endpoints/host-processes.js";
import { FAKE_CODEX_PATH, FakeHostProcesses } from "../test-utils/fake-host-processes.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 改完提示要重开谁（PRD 第 36 条）：最近一次改写之前启动的终端 CLI、Osuna 自己的会话、Codex 共用的后台 app-server。
 * 进程表与 `codex app-server daemon restart` 一律经假的「进程与命令」，什么都不真的读、真的跑。
 */

const CliStartReadsSchema = z.object({ codex: z.object({ digest: z.string(), at: z.string() }) });
const CliStartReadsClaudeSchema = z.object({
  claude: z.object({ digest: z.string(), at: z.string() }),
});
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
  // 改动时刻取 CLI 配置文件的修改时刻（真的时钟）：进程的启动时间都相对现在说。
  let now: number;

  function ago(seconds: number): Date {
    return new Date(now - seconds * 1000);
  }

  beforeEach(async () => {
    now = Date.now();
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
        hostProcesses: fake,
      },
    });
    client = await connect(daemon);
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await rm(root, { recursive: true, force: true });
  });

  async function switchOn(provider: "claude" | "codex"): Promise<void> {
    const saved = await client.apiEndpointSave({
      provider,
      name: `Relay ${provider}`,
      baseUrl: "https://relay.example/v1",
      apiKey: "sk-relay",
      models: [{ id: `relay-${provider}` }],
      defaultModelId: `relay-${provider}`,
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    await client.apiEndpointSetActive(provider, saved.endpoint.id);
  }

  function running(input: { pid: number; startedAt: Date; commandLine: string }): HostProcess {
    return { parentPid: 1, ...input };
  }

  /** Codex 给后台 app-server 记的进程记录文件，修改时间就是它的启动时间。 */
  function writePidFile(input: { pid: number; at: Date }): void {
    const file = path.join(codexHome, "app-server-daemon", "app-server.pid");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ pid: input.pid }));
    utimesSync(file, input.at, input.at);
  }

  function appServer(pid: number): HostProcess {
    return running({
      pid,
      startedAt: ago(500),
      commandLine: `${codexHome}/packages/app-server-daemon/releases/0.163.0/bin/codex app-server --listen unix:///x --managed-daemon`,
    });
  }

  const CLAUDE_LIVE_ENV = {
    kind: "claude_live_env",
    message:
      "Claude Code picks up newly written environment variables right away; removed variables, the model and the thinking level take effect only once a session is reopened.",
  };

  const APP_SERVER_LEFT = () => ({
    kind: "app_server",
    since: ago(500).toISOString(),
    command: "codex app-server daemon restart",
    message:
      "Background app-server (started 8 minutes ago): restart it with codex app-server daemon restart",
  });

  /** Claude Code 与 Codex 的提示；这里没打开的 Pi、OMP 一律没有要重开的。 */
  async function reopenHints(): Promise<unknown> {
    const hints = (await client.apiEndpointList("codex")).reopenHints;
    if (!hints) return hints;
    const { pi, omp, ...rest } = hints;
    expect({ pi, omp }).toEqual({ pi: [], omp: [] });
    return rest;
  }

  test("terminal Claude Code and Codex started before the rewrite are listed, ones started after aren't", async () => {
    fake.processes = [
      running({ pid: 10, startedAt: ago(3_600), commandLine: "/Users/me/.local/bin/claude" }),
      running({
        pid: 11,
        startedAt: ago(-60),
        commandLine: "/Users/me/.local/bin/claude --resume",
      }),
      running({ pid: 20, startedAt: ago(7_200), commandLine: "/opt/homebrew/bin/codex -m gpt-6" }),
      running({ pid: 21, startedAt: ago(-60), commandLine: "/opt/homebrew/bin/codex" }),
      // Osuna 自己起的不算终端里的。
      {
        pid: 30,
        parentPid: process.pid,
        startedAt: ago(3_600),
        commandLine: "/opt/homebrew/bin/codex app-server",
      },
    ];
    await switchOn("claude");
    await switchOn("codex");
    expect(await reopenHints()).toEqual({
      claude: [
        {
          kind: "cli",
          count: 1,
          since: ago(3_600).toISOString(),
          message: "1 × Claude Code in a terminal, started 1 hour ago: quit it and start it again.",
        },
        CLAUDE_LIVE_ENV,
      ],
      codex: [
        {
          kind: "cli",
          count: 1,
          since: ago(7_200).toISOString(),
          message: "1 × Codex in a terminal, started 2 hours ago: quit it and start it again.",
        },
      ],
    });
    expect(fake.runs).toEqual([]);
  });

  test("nothing to reopen before anything is rewritten, and no process is listed", async () => {
    fake.processes = [running({ pid: 10, startedAt: ago(60), commandLine: "claude" })];
    expect(await reopenHints()).toEqual({ claude: [], codex: [] });
    expect(fake.lists).toBe(0);
  });

  test("Osuna's own running sessions are counted per provider", async () => {
    await client.createAgent({ provider: "claude", cwd: root, title: "c1" });
    await client.createAgent({ provider: "claude", cwd: root, title: "c2" });
    await client.createAgent({ provider: "codex", cwd: root, title: "x1" });
    await switchOn("claude");
    await switchOn("codex");
    expect(await reopenHints()).toEqual({
      claude: [
        {
          kind: "osuna_sessions",
          count: 2,
          message:
            "2 Claude Code agent(s) in Osuna: reload each one (Reload agent in its tab's menu).",
        },
        CLAUDE_LIVE_ENV,
      ],
      codex: [
        {
          kind: "osuna_sessions",
          count: 1,
          message: "1 Codex agent(s) in Osuna: reload each one (Reload agent in its tab's menu).",
        },
      ],
    });
  });

  test("the app-server, started before the rewrite with no client on it, is restarted with this CODEX_HOME", async () => {
    writePidFile({ pid: 500, at: ago(500) });
    fake.processes = [appServer(500)];
    // 重启后 Codex 改写进程记录文件。
    fake.onRun = () => writePidFile({ pid: 501, at: ago(-20) });
    await switchOn("codex");
    expect(await reopenHints()).toEqual({
      claude: [],
      codex: [
        {
          kind: "app_server_restarted",
          since: ago(500).toISOString(),
          message:
            "Osuna restarted the background app-server codex sessions share, which none was on, so new codex sessions have the new settings; restart the Codex app, if it is open, to see them there.",
        },
      ],
    });
    expect(fake.runs).toEqual([
      {
        command: FAKE_CODEX_PATH,
        args: RESTART_ARGS,
        env: { CODEX_HOME: codexHome },
        timeoutMs: 90_000,
      },
    ]);
  });

  test("with a client on the app-server, it isn't restarted and the hint gives the command", async () => {
    writePidFile({ pid: 500, at: ago(500) });
    fake.processes = [
      appServer(500),
      running({ pid: 600, startedAt: ago(-30), commandLine: "codex" }),
    ];
    await switchOn("codex");
    expect(await reopenHints()).toEqual({ claude: [], codex: [APP_SERVER_LEFT()] });
    expect(fake.runs).toEqual([]);
  });

  test("a restart that fails leaves the command to the user", async () => {
    writePidFile({ pid: 500, at: ago(500) });
    fake.processes = [appServer(500)];
    fake.runResult = { exitCode: 1, output: "Error: no daemon to restart\n" };
    await switchOn("codex");
    expect(await reopenHints()).toEqual({ claude: [], codex: [APP_SERVER_LEFT()] });
  });

  test("a Re-apply that changes nothing doesn't move the change time", async () => {
    fake.processes = [
      running({ pid: 20, startedAt: ago(1_800), commandLine: "/opt/homebrew/bin/codex" }),
    ];
    await switchOn("codex");
    await reopenHints();
    // 把记下的改动时刻挪到一小时前：半小时前启动的终端 Codex 就不算旧副本。
    const file = path.join(daemon.paseoHome, "api-endpoints", "cli-start-reads.json");
    const stored = CliStartReadsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(
      file,
      JSON.stringify({ codex: { ...stored.codex, at: ago(3_600).toISOString() } }),
    );
    expect(await reopenHints()).toEqual({ claude: [], codex: [] });
    // 「重新应用」照样改写一遍文件，内容没变：改动时刻不动，它照样不算。
    const reapplied = await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.error).toBeNull();
    expect(await reopenHints()).toEqual({ claude: [], codex: [] });
  });

  // 接口管理好用性工单 13：改了模型设置，Codex 读的模型清单变了，之前启动的要重开（prd 第 24 条）。
  test("a model setting that changes Codex's model list moves the change time", async () => {
    fake.processes = [
      running({ pid: 20, startedAt: ago(1_800), commandLine: "/opt/homebrew/bin/codex" }),
    ];
    await switchOn("codex");
    await reopenHints();
    const file = path.join(daemon.paseoHome, "api-endpoints", "cli-start-reads.json");
    const stored = CliStartReadsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(
      file,
      JSON.stringify({ codex: { ...stored.codex, at: ago(3_600).toISOString() } }),
    );
    expect(await reopenHints()).toEqual({ claude: [], codex: [] });

    const [endpoint] = (await client.apiEndpointList("codex")).endpoints;
    const saved = await client.apiEndpointSave({
      provider: "codex",
      endpointId: endpoint?.id,
      name: "Relay codex",
      baseUrls: endpoint?.baseUrls ?? [],
      models: [{ id: "relay-codex" }],
      modelSettings: { models: { "relay-codex": { context: 64_000 } } },
    });
    expect(saved.error).toBeNull();
    expect(await reopenHints()).toMatchObject({ codex: [{ kind: "cli", count: 1 }] });
  });

  // Claude Code 没有看图的设置：只改看图不让 Claude Code 的副本要重开。
  test("a model's image answer alone doesn't send Claude Code to reopen", async () => {
    fake.processes = [
      running({ pid: 10, startedAt: ago(1_800), commandLine: "/Users/me/.local/bin/claude" }),
    ];
    await switchOn("claude");
    await reopenHints();
    const file = path.join(daemon.paseoHome, "api-endpoints", "cli-start-reads.json");
    const stored = CliStartReadsClaudeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(
      file,
      JSON.stringify({ claude: { ...stored.claude, at: ago(3_600).toISOString() } }),
    );
    expect(await reopenHints()).toEqual({ claude: [], codex: [] });

    const [endpoint] = (await client.apiEndpointList("claude")).endpoints;
    const saved = await client.apiEndpointSave({
      provider: "claude",
      endpointId: endpoint?.id,
      name: "Relay claude",
      baseUrls: endpoint?.baseUrls ?? [],
      models: [{ id: "relay-claude" }],
      modelSettings: { models: { "relay-claude": { images: true } } },
    });
    expect(saved.error).toBeNull();
    expect(saved.endpoint?.modelSettings).toEqual({ models: { "relay-claude": { images: true } } });
    expect(await reopenHints()).toEqual({ claude: [], codex: [] });
  });

  test("processes that can't be listed block neither the list nor the other hints", async () => {
    await client.createAgent({ provider: "codex", cwd: root, title: "x1" });
    writePidFile({ pid: 500, at: ago(500) });
    fake.listError = new HostProcessesError({ message: "ps didn't start" });
    await switchOn("codex");
    const listed = await client.apiEndpointList("codex");
    expect(listed.error).toBeNull();
    expect(listed.reopenHints).toEqual({
      claude: [],
      codex: [
        {
          kind: "osuna_sessions",
          count: 1,
          message: "1 Codex agent(s) in Osuna: reload each one (Reload agent in its tab's menu).",
        },
      ],
      pi: [],
      omp: [],
    });
    expect(fake.runs).toEqual([]);
  });

  test("a model list Osuna can't read (a folder in its place) doesn't fail the list", async () => {
    await switchOn("codex");
    const catalogPath = path.join(daemon.paseoHome, "api-endpoints", "codex-models.json");
    await rm(catalogPath);
    await mkdir(path.join(catalogPath, "held"), { recursive: true });
    const listed = await client.apiEndpointList("codex");
    expect(listed.error).toBeNull();
    expect(listed.reopenHints).toEqual({ claude: [], codex: [], pi: [], omp: [] });
  });
});
