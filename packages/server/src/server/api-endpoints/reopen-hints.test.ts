// 用例取自 magpie（https://github.com/yetone/magpie，internal/provider/codex_daemon_test.go 的 TestIsManagedDaemon、
// TestParsePIDFile、TestFindCodexDaemon、TestIsCodexClient、TestKeepCodexDaemonCurrent 与
// TestKeepCodexDaemonCurrentListsOnlyWhenBehind，internal/agent/connect_stale_test.go 的
// TestCodexStaleOnlyForMagpiesChange、TestCodexStaleCopiesSayWhichIsLeft 与 TestCodexDaemonHelperIsNoStaleCopy）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FAKE_CODEX_PATH, FakeHostProcesses } from "../test-utils/fake-host-processes.js";
import { HostProcessesError, type HostProcess } from "./host-processes.js";
import {
  CliReopenHints,
  cliChangedAt,
  findStaleCopies,
  isCodexClient,
  isManagedDaemon,
  keepCodexAppServerCurrent,
  parsePidFile,
  REOPEN_CHECK_EVERY_MS,
  type ReopenHintsSubjects,
} from "./reopen-hints.js";

const NOW = new Date("2026-10-19T10:00:00.000Z");
const OWN_PID = 4000;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function proc(input: { pid: number; startedAt: Date; commandLine: string }): HostProcess {
  return { parentPid: 1, ...input };
}

describe("isManagedDaemon", () => {
  test.each([
    [
      "/Users/me/.codex/packages/standalone/current/bin/codex app-server --managed-daemon --listen unix://",
      true,
    ],
    ["C:\\Users\\me\\.codex\\bin\\codex.exe app-server --managed-daemon=true", true],
    ["codex -c features.x=true app-server --managed-daemon", true],
    [
      "/Applications/ChatGPT.app/Contents/Resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled",
      false,
    ],
    [
      "/Users/me/Library/Application Support/Cindy/codex-package/0.156.0/bin/codex app-server --disable plugins",
      false,
    ],
    [
      "/Users/me/.codex/packages/standalone/current/bin/codex app-server daemon pid-update-loop",
      false,
    ],
    ["codex app-server daemon restart", false],
    ["codex --managed-daemon", false],
    ["codex --managed-daemon app-server", false],
    ["app-server --managed-daemon", false],
    ["node /x/server.js app-server --managed-daemon", false],
    ["/x/codex-helper app-server --managed-daemon", false],
    ["", false],
  ])("%s → %s", (commandLine, expected) => {
    expect(isManagedDaemon(commandLine)).toBe(expected);
  });
});

describe("parsePidFile", () => {
  test.each([
    ["4242\n", 4242],
    [
      '{"pid":812,"processStartTime":123,"processIdentity":"x","executableIdentity":{"digest":"d"}}',
      812,
    ],
    ["", null],
    ["{}", null],
    ["not a pid", null],
    ['{"pid":-3}', null],
    ["-1", null],
  ])("%s → %s", (text, expected) => {
    expect(parsePidFile(text)).toBe(expected);
  });
});

describe("isCodexClient", () => {
  test.each([
    ["codex", true],
    ["/opt/homebrew/bin/codex -m gpt-6", true],
    ["codex exec hello", true],
    ["codex resume --last", true],
    ["codex app-server proxy", true],
    ['"C:\\Program Files\\Codex\\codex.exe"', true],
    [
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe",
      true,
    ],
    [
      "/Users/me/.codex/packages/app-server-daemon/releases/0.162.0-aarch64-apple-darwin/bin/codex app-server --listen unix:///x --managed-daemon",
      false,
    ],
    ["codex app-server daemon pid-update-loop", false],
    ["codex app-server daemon restart", false],
    [
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex -c features.code_mode_host=true app-server",
      false,
    ],
    [
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex exec-server --remote x",
      false,
    ],
    ["/Users/me/.vscode/extensions/openai.chatgpt-1.0/bin/darwin-aarch64/codex app-server", false],
    ["codex mcp-server", false],
    [
      '"C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0\\app\\resources\\codex.exe" app-server',
      false,
    ],
    ["/Users/me/.codex/plugins/cache/chrome/extension-host ChatGPT for Chrome", false],
    [
      "/Users/me/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
      false,
    ],
    ["codex-code-mode-host", false],
    ["node /x/codex.js", false],
    ["", false],
  ])("%s → %s", (commandLine, expected) => {
    expect(isCodexClient(commandLine)).toBe(expected);
  });
});

describe("findStaleCopies", () => {
  const home = "/Users/me";
  const codexDir = `${home}/.codex`;
  const app =
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";

  test("tells each kind of Codex copy started before the rewrite apart, one app being one copy", () => {
    const processes = [
      proc({
        pid: 10,
        startedAt: hoursAgo(72),
        commandLine: `${app} -c x=true app-server --analytics-default-enabled`,
      }),
      proc({
        pid: 11,
        startedAt: new Date(hoursAgo(72).getTime() + 10_000),
        commandLine: `${app} exec-server --remote https://x`,
      }),
      proc({
        pid: 12,
        startedAt: hoursAgo(5),
        commandLine: `${home}/.vscode/extensions/openai.chatgpt-26.1003.0-darwin-arm64/bin/macos-aarch64/codex app-server --analytics-default-enabled`,
      }),
      // 后台 app-server 与它的帮手另外判断，不在这里列。
      proc({
        pid: 13,
        startedAt: hoursAgo(4),
        commandLine: `${codexDir}/packages/app-server-daemon/releases/0.160.0/bin/codex app-server --listen unix:// --managed-daemon`,
      }),
      proc({
        pid: 14,
        startedAt: hoursAgo(4),
        commandLine: `${codexDir}/bin/codex app-server daemon pid-update-loop`,
      }),
      proc({
        pid: 15,
        startedAt: hoursAgo(20),
        commandLine: `${home}/Library/Application Support/Agents Anywhere/connector/.venv/bin/codex app-server --listen stdio://`,
      }),
      proc({
        pid: 16,
        startedAt: hoursAgo(20),
        commandLine: `${home}/Library/Application Support/fnm/node-versions/v24.1.0/installation/bin/codex`,
      }),
      proc({ pid: 17, startedAt: hoursAgo(3), commandLine: "/opt/homebrew/bin/codex" }),
      // 改写之后启动的、别的 CODEX_HOME 的、不是 codex 的：都不算。
      proc({ pid: 18, startedAt: hoursAgo(1), commandLine: "/opt/homebrew/bin/codex" }),
      proc({
        pid: 19,
        startedAt: hoursAgo(9),
        commandLine:
          "/tmp/sb/.codex/packages/app-server-daemon/releases/0.160.0/bin/codex app-server --listen unix://",
      }),
      proc({ pid: 20, startedAt: hoursAgo(9), commandLine: "/bin/zsh -l" }),
    ];
    expect(
      findStaleCopies({
        provider: "codex",
        processes,
        changedAt: hoursAgo(2),
        cliDir: codexDir,
        ownPid: OWN_PID,
      }),
    ).toEqual([
      { kind: "app", app: "ChatGPT", count: 1, since: hoursAgo(72) },
      { kind: "ide", app: null, count: 1, since: hoursAgo(5) },
      { kind: "embedded", app: "Agents Anywhere", count: 1, since: hoursAgo(20) },
      { kind: "cli", app: null, count: 2, since: hoursAgo(20) },
    ]);
  });

  test("one row per desktop app: the ChatGPT app and the Codex app are reopened apart", () => {
    const processes = [
      proc({
        pid: 60,
        startedAt: hoursAgo(30),
        commandLine: `${app} -c x=true app-server --analytics-default-enabled`,
      }),
      proc({
        pid: 61,
        startedAt: hoursAgo(8),
        commandLine:
          "/Applications/Codex.app/Contents/Resources/codex app-server --listen stdio://",
      }),
      proc({
        pid: 62,
        startedAt: hoursAgo(9),
        commandLine: "/Applications/Codex.app/Contents/Resources/codex exec-server --remote x",
      }),
    ];
    expect(
      findStaleCopies({
        provider: "codex",
        processes,
        changedAt: hoursAgo(2),
        cliDir: codexDir,
        ownPid: OWN_PID,
      }),
    ).toEqual([
      { kind: "app", app: "ChatGPT", count: 1, since: hoursAgo(30) },
      { kind: "app", app: "Codex", count: 1, since: hoursAgo(9) },
    ]);
  });

  test("leaves out Osuna's own sessions, the ones it started itself", () => {
    const processes = [
      {
        pid: 30,
        parentPid: OWN_PID,
        startedAt: hoursAgo(5),
        commandLine: "/opt/homebrew/bin/codex app-server",
      },
      { pid: 31, parentPid: 77, startedAt: hoursAgo(5), commandLine: "/opt/homebrew/bin/codex" },
    ];
    expect(
      findStaleCopies({
        provider: "codex",
        processes,
        changedAt: hoursAgo(2),
        cliDir: codexDir,
        ownPid: OWN_PID,
      }),
    ).toEqual([{ kind: "cli", app: null, count: 1, since: hoursAgo(5) }]);
  });

  test("a copy started within a second of the rewrite, or with no start time, isn't counted", () => {
    const processes = [
      proc({ pid: 40, startedAt: new Date(hoursAgo(2).getTime() - 500), commandLine: "claude" }),
      { pid: 41, parentPid: 1, startedAt: null, commandLine: "claude" },
    ];
    expect(
      findStaleCopies({
        provider: "claude",
        processes,
        changedAt: hoursAgo(2),
        cliDir: `${home}/.claude`,
        ownPid: OWN_PID,
      }),
    ).toEqual([]);
  });

  test("Pi in a terminal, but not Osuna's own Pi sessions", () => {
    const processes = [
      proc({ pid: 70, startedAt: hoursAgo(6), commandLine: "node /opt/homebrew/bin/pi" }),
      proc({ pid: 71, startedAt: hoursAgo(3), commandLine: `${home}/.local/bin/pi --continue` }),
      {
        pid: 72,
        parentPid: OWN_PID,
        startedAt: hoursAgo(5),
        commandLine: "node /opt/homebrew/bin/pi --mode rpc",
      },
      proc({ pid: 73, startedAt: hoursAgo(4), commandLine: "/opt/homebrew/bin/pip install x" }),
    ];
    expect(
      findStaleCopies({
        provider: "pi",
        processes,
        changedAt: hoursAgo(2),
        cliDir: `${home}/.pi/agent`,
        ownPid: OWN_PID,
      }),
    ).toEqual([{ kind: "cli", app: null, count: 2, since: hoursAgo(6) }]);
  });

  test("OMP in a terminal, compiled or run by bun from its npm package", () => {
    const processes = [
      proc({ pid: 80, startedAt: hoursAgo(6), commandLine: `${home}/.bun/bin/omp` }),
      proc({
        pid: 81,
        startedAt: hoursAgo(3),
        commandLine: `bun ${home}/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`,
      }),
      proc({ pid: 82, startedAt: hoursAgo(4), commandLine: "/usr/bin/ompx --help" }),
      proc({ pid: 83, startedAt: hoursAgo(1), commandLine: "omp --continue" }),
    ];
    expect(
      findStaleCopies({
        provider: "omp",
        processes,
        changedAt: hoursAgo(2),
        cliDir: `${home}/.omp/agent`,
        ownPid: OWN_PID,
      }),
    ).toEqual([{ kind: "cli", app: null, count: 2, since: hoursAgo(6) }]);
  });

  test("Claude Code in a terminal and in an editor", () => {
    const processes = [
      proc({ pid: 50, startedAt: hoursAgo(6), commandLine: "claude --resume" }),
      proc({ pid: 51, startedAt: hoursAgo(3), commandLine: "/Users/me/.local/bin/claude" }),
      proc({
        pid: 52,
        startedAt: hoursAgo(4),
        commandLine: `${home}/.vscode/extensions/anthropic.claude-code-2.1.0/resources/native-binary/claude --output-format stream-json`,
      }),
      proc({
        pid: 53,
        startedAt: hoursAgo(4),
        commandLine: "/Applications/Claude.app/Contents/MacOS/Claude",
      }),
      proc({ pid: 54, startedAt: hoursAgo(4), commandLine: "/opt/homebrew/bin/codex" }),
    ];
    expect(
      findStaleCopies({
        provider: "claude",
        processes,
        changedAt: hoursAgo(2),
        cliDir: `${home}/.claude`,
        ownPid: OWN_PID,
      }),
    ).toEqual([
      { kind: "cli", app: null, count: 2, since: hoursAgo(6) },
      { kind: "ide", app: null, count: 1, since: hoursAgo(4) },
    ]);
  });
});

describe("keepCodexAppServerCurrent", () => {
  let codexHome: string;
  let fake: FakeHostProcesses;
  let restarts: number;
  let restartError: HostProcessesError | null;
  const started = hoursAgo(1);

  function writePidFile(input: { name: string; body: string; at: Date }): string {
    const file = path.join(codexHome, "app-server-daemon", input.name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, input.body);
    utimesSync(file, input.at, input.at);
    return file;
  }

  function daemon(pid: number): HostProcess {
    return proc({
      pid,
      startedAt: started,
      commandLine: `${codexHome}/packages/app-server-daemon/releases/0.162.0/bin/codex app-server --listen unix:///x --managed-daemon`,
    });
  }

  function check(changedAt: Date) {
    return keepCodexAppServerCurrent({
      codexHome,
      changedAt,
      readCodexHome: (pid) => fake.readCodexHome(pid),
      listProcesses: () => fake.list(),
      restart: async () => {
        restarts += 1;
        if (restartError !== null) throw restartError;
      },
    });
  }

  beforeEach(() => {
    codexHome = mkdtempSync(path.join(os.tmpdir(), "reopen-hints-"));
    fake = new FakeHostProcesses();
    restarts = 0;
    restartError = null;
  });

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true });
  });

  test("started before the rewrite with no session on it: restarted", async () => {
    writePidFile({
      name: "app-server.pid",
      body: '{"pid":50,"processStartTime":"x"}',
      at: started,
    });
    fake.processes = [
      daemon(50),
      proc({ pid: 7, startedAt: started, commandLine: "codex app-server" }),
    ];
    expect(await check(NOW)).toEqual({ kind: "restarted", since: started });
    expect(restarts).toBe(1);
  });

  test("a codex session on it: left to the user, with how many", async () => {
    writePidFile({ name: "app-server.pid", body: "50", at: started });
    fake.processes = [daemon(50), proc({ pid: 100, startedAt: started, commandLine: "codex" })];
    expect(await check(NOW)).toEqual({ kind: "attached", since: started, clients: 1 });
    expect(restarts).toBe(0);
  });

  test("a restart that fails is said, not taken for one done", async () => {
    writePidFile({ name: "daemon.pid", body: "50", at: started });
    fake.processes = [daemon(50)];
    restartError = new HostProcessesError({
      message: "codex app-server daemon restart: no daemon",
    });
    expect(await check(NOW)).toEqual({
      kind: "restart_failed",
      since: started,
      reason: "codex app-server daemon restart: no daemon",
    });
  });

  test("started after the rewrite, a pid file of another process, no pid file, no daemon: current", async () => {
    writePidFile({ name: "app-server.pid", body: "50", at: started });
    fake.processes = [daemon(50)];
    expect(await check(new Date(started.getTime() - 60_000))).toEqual({ kind: "current" });
    const other = writePidFile({ name: "app-server.pid", body: '{"pid":51}', at: started });
    expect(await check(NOW)).toEqual({ kind: "current" });
    rmSync(other);
    expect(await check(NOW)).toEqual({ kind: "current" });
    writePidFile({ name: "app-server.pid", body: "50", at: started });
    fake.processes = [];
    expect(await check(NOW)).toEqual({ kind: "current" });
    expect(restarts).toBe(0);
  });

  test("lists the processes only when a pid file says a daemon started before the rewrite", async () => {
    await check(NOW);
    writePidFile({ name: "app-server.pid", body: "50", at: started });
    await check(new Date(started.getTime() - 60_000));
    expect(fake.lists).toBe(0);
    await check(NOW);
    expect(fake.lists).toBe(1);
  });

  test("processes that can't be listed: current", async () => {
    writePidFile({ name: "app-server.pid", body: "50", at: started });
    fake.listError = new HostProcessesError({ message: "no ps" });
    expect(await check(NOW)).toEqual({ kind: "current" });
  });

  test("a daemon or a client of another CODEX_HOME, where that can be read, is left out", async () => {
    writePidFile({ name: "app-server.pid", body: "50", at: started });
    fake.processes = [
      daemon(50),
      daemon(51),
      proc({ pid: 100, startedAt: started, commandLine: "codex" }),
    ];
    fake.codexHomes.set(50, "/elsewhere/.codex");
    fake.codexHomes.set(100, "/elsewhere/.codex");
    fake.codexHomes.set(51, codexHome);
    // 进程记录文件点名的 50 是别的 home 的：取这个 home 的 51，它没有进程记录文件，不知道何时启动。
    expect(await check(NOW)).toEqual({ kind: "current" });
    fake.codexHomes.set(50, codexHome);
    expect(await check(NOW)).toEqual({ kind: "restarted", since: started });
    expect(restarts).toBe(1);
  });

  test("picks the daemon the pid file names when several run", async () => {
    writePidFile({ name: "app-server.pid", body: '{"pid":30}', at: started });
    fake.processes = [daemon(20), daemon(30)];
    expect(await check(NOW)).toEqual({ kind: "restarted", since: started });
    fake.processes = [daemon(20)];
    expect(await check(NOW)).toEqual({ kind: "current" });
  });
});

describe("cliChangedAt", () => {
  let dir: string;
  let file: string;
  const written = hoursAgo(5);

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "reopen-changed-"));
    file = path.join(dir, "config.toml");
    writeFileSync(file, "x");
    utimesSync(file, written, written);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a digest first seen is put at the files' latest write, and remembered", () => {
    expect(cliChangedAt({ startup: { files: [file], reads: "a" }, stored: null })).toEqual({
      changedAt: written,
      remember: { digest: expect.stringMatching(/^[0-9a-f]{16}$/), at: written },
    });
  });

  test("the same digest keeps the time it was first seen, whatever the files' times say", () => {
    const first = cliChangedAt({ startup: { files: [file], reads: "a" }, stored: null });
    utimesSync(file, NOW, NOW);
    expect(
      cliChangedAt({ startup: { files: [file], reads: "a" }, stored: first.remember }),
    ).toEqual({ changedAt: written, remember: null });
    expect(
      cliChangedAt({ startup: { files: [file], reads: "b" }, stored: first.remember }),
    ).toEqual({
      changedAt: NOW,
      remember: { digest: expect.stringMatching(/^[0-9a-f]{16}$/), at: NOW },
    });
  });

  test("no file there: nothing changed", () => {
    expect(
      cliChangedAt({ startup: { files: [path.join(dir, "missing")], reads: "a" }, stored: null }),
    ).toEqual({ changedAt: null, remember: null });
  });
});

describe("CliReopenHints", () => {
  let codexHome: string;
  let fake: FakeHostProcesses;
  let subjects: ReopenHintsSubjects;
  let ticks: (() => void)[];
  let cancelled: number;
  const started = hoursAgo(3);
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

  function writePidFile(input: { pid: number; at: Date }): void {
    const file = path.join(codexHome, "app-server-daemon", "app-server.pid");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, String(input.pid));
    utimesSync(file, input.at, input.at);
  }

  function daemon(pid: number): HostProcess {
    return proc({
      pid,
      startedAt: started,
      commandLine: `${codexHome}/packages/app-server-daemon/releases/0.163.0/bin/codex app-server --managed-daemon`,
    });
  }

  function hints(): CliReopenHints {
    return new CliReopenHints({
      hostProcesses: () => fake,
      subjects: () => subjects,
      timers: {
        schedule: (handler, ms) => {
          expect(ms).toBe(REOPEN_CHECK_EVERY_MS);
          ticks.push(handler);
          return () => {
            cancelled += 1;
          };
        },
      },
      now: () => NOW,
      logger,
      ownPid: OWN_PID,
    });
  }

  /** 触发排着的那次查看，等它看完、排好下一次。 */
  async function tick(): Promise<void> {
    const handler = ticks.shift();
    if (handler === undefined) throw new Error("No look scheduled");
    const before = ticks.length;
    handler();
    await expect.poll(() => ticks.length).toBe(before + 1);
  }

  beforeEach(() => {
    codexHome = mkdtempSync(path.join(os.tmpdir(), "reopen-class-"));
    fake = new FakeHostProcesses();
    ticks = [];
    cancelled = 0;
    subjects = {
      claude: { cliDir: "/Users/me/.claude", changedAt: null, osunaSessions: 0 },
      codex: { cliDir: codexHome, changedAt: hoursAgo(2), osunaSessions: 0 },
      pi: { cliDir: "/Users/me/.pi/agent", changedAt: null, osunaSessions: 0 },
      omp: { cliDir: "/Users/me/.omp/agent", changedAt: null, osunaSessions: 0 },
    };
  });

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true });
  });

  test("restarts the app-server on a later look, once its last client is gone (magpie codexDaemonEvery)", async () => {
    writePidFile({ pid: 50, at: started });
    fake.processes = [daemon(50), proc({ pid: 100, startedAt: hoursAgo(1), commandLine: "codex" })];
    const reopen = hints();
    reopen.start();
    expect(await reopen.read()).toEqual({
      claude: [],
      pi: [],
      omp: [],
      codex: [
        {
          kind: "app_server",
          since: started.toISOString(),
          command: "codex app-server daemon restart",
          message:
            "Background app-server (started 3 hours ago): restart it with codex app-server daemon restart",
        },
      ],
    });
    expect(fake.runs).toEqual([]);

    fake.processes = [daemon(50)];
    await tick();
    expect(fake.runs).toEqual([
      {
        command: FAKE_CODEX_PATH,
        args: ["app-server", "daemon", "restart"],
        env: { CODEX_HOME: codexHome },
        timeoutMs: 90_000,
      },
    ]);
    expect(await reopen.read()).toEqual({
      claude: [],
      pi: [],
      omp: [],
      codex: [
        {
          kind: "app_server_restarted",
          since: started.toISOString(),
          message:
            "Osuna restarted the background app-server codex sessions share, which none was on, so new codex sessions have the new settings; restart the Codex app, if it is open, to see them there.",
        },
      ],
    });
    reopen.dispose();
    expect(cancelled).toBe(1);
  });

  test("a periodic look reads only the app-server's pid record, and lists no processes while it is current", async () => {
    // 后台 app-server 在改动之后才起来：进程记录文件说它没落后。
    writePidFile({ pid: 50, at: hoursAgo(1) });
    fake.processes = [daemon(50), proc({ pid: 10, startedAt: hoursAgo(5), commandLine: "codex" })];
    const reopen = hints();
    reopen.start();
    await reopen.read();
    expect(fake.lists).toBe(1);
    await tick();
    await tick();
    expect(fake.lists).toBe(1);
    expect(fake.runs).toEqual([]);
    // 没写过进程记录文件也一样。
    rmSync(path.join(codexHome, "app-server-daemon"), { recursive: true });
    await tick();
    expect(fake.lists).toBe(1);
    reopen.dispose();
  });

  test("reading again for the same change uses what was last seen, without listing the processes", async () => {
    writePidFile({ pid: 50, at: started });
    fake.processes = [daemon(50), proc({ pid: 100, startedAt: hoursAgo(1), commandLine: "codex" })];
    const reopen = hints();
    await reopen.read();
    const lists = fake.lists;
    await reopen.read();
    expect(fake.lists).toBe(lists);
  });

  test("Claude Code's hints end with what its running sessions take at once", async () => {
    subjects.claude = { cliDir: "/Users/me/.claude", changedAt: hoursAgo(2), osunaSessions: 2 };
    subjects.codex = { cliDir: codexHome, changedAt: null, osunaSessions: 0 };
    fake.processes = [
      proc({ pid: 10, startedAt: hoursAgo(26), commandLine: "/Users/me/.local/bin/claude" }),
    ];
    expect((await hints().read()).claude).toEqual([
      {
        kind: "osuna_sessions",
        count: 2,
        message:
          "2 Claude Code agent(s) in Osuna: reload each one (Reload agent in its tab's menu).",
      },
      {
        kind: "cli",
        count: 1,
        since: hoursAgo(26).toISOString(),
        message: "1 × Claude Code in a terminal, started yesterday: quit it and start it again.",
      },
      {
        kind: "claude_live_env",
        message:
          "Claude Code picks up newly written environment variables right away; removed variables, the model and the thinking level take effect only once a session is reopened.",
      },
    ]);
  });

  test("Pi's hints list its Osuna agents and terminal copies started before the change", async () => {
    subjects.codex = { cliDir: codexHome, changedAt: null, osunaSessions: 0 };
    subjects.pi = { cliDir: "/Users/me/.pi/agent", changedAt: hoursAgo(2), osunaSessions: 1 };
    fake.processes = [
      proc({ pid: 10, startedAt: hoursAgo(3), commandLine: "node /usr/local/bin/pi" }),
    ];
    expect((await hints().read()).pi).toEqual([
      {
        kind: "osuna_sessions",
        count: 1,
        message: "1 Pi agent(s) in Osuna: reload each one (Reload agent in its tab's menu).",
      },
      {
        kind: "cli",
        count: 1,
        since: hoursAgo(3).toISOString(),
        message: "1 × Pi in a terminal, started 3 hours ago: quit it and start it again.",
      },
    ]);
  });
});
