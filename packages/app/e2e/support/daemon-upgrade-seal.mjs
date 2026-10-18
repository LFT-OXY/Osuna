/*
 * e2e 测试 daemon 的封条：经 NODE_OPTIONS=--import 预加载进 daemon 及它派生的 Node 进程。
 *
 * 1. 不查 npm registry 的最新版本：设置页就不会出现「Upgrade to …」按钮（版本检查按查不到处理）。
 * 2. 即使有人直接发 provider.upgrade，也不会碰本机的 CLI 安装：Agent CLI 的 update / upgrade 子命令、
 *    brew 的安装与升级、包管理器的全局安装、官方安装脚本，一律换成一个立刻以 1 退出的 node 进程，并记一行到
 *    PASEO_E2E_UPGRADE_RECORD_PATH（设了的话）。
 *
 * 3. 不起真的 Codex 判断登录方式：第三方接口打开 Codex 开关、读状态时会起一个临时 app-server 问 account/read
 *    （带 `-c model_provider="openai"`），同样换成立刻以 1 退出的进程，daemon 按「判断不出」保持现在的接法。
 *
 * 4. 不起开发者真实的登录 shell：查 Claude Code 云平台开关时问登录 shell 的进程（带 PASEO_SHELL_PROBE=1）
 *    同样换掉，daemon 按没问到处理。
 *
 * 5. 不读本机真实的进程表、进程的环境，不找、不跑真的 codex：第三方接口「改完提示要重开谁」的「进程与命令」适配器
 *    （host-processes.ts）换成这里装上的假的：进程表读 PASEO_E2E_PROCESS_TABLE_PATH 文件（ps 的格式，没设就是空的），
 *    CODEX_HOME 一律读不到，codex 就叫 codex，执行的命令只记一行到 PASEO_E2E_UPGRADE_RECORD_PATH、以 0 结束。
 *
 * 2026-10-18 一条浏览器用例点中了升级按钮，测试 daemon 真的跑了 `brew upgrade --cask claude-code@latest`
 * 又被中途杀掉，弄坏了开发者本机的 Claude Code。
 */
import childProcess from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const NPM_REGISTRY = "https://registry.npmjs.org/";
// 带自升级子命令的 Agent CLI（provider-upgrade-command.ts 的表，外加 Codex）。
const AGENT_CLIS = new Set(["claude", "codex", "copilot", "opencode", "pi", "omp"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const INSTALL_VERBS = new Set(["install", "i", "add", "update", "upgrade", "reinstall"]);

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (url.startsWith(NPM_REGISTRY)) {
      return Promise.resolve(new Response("sealed by the e2e harness", { status: 404 }));
    }
    return realFetch(input, init);
  };
}

function commandName(command) {
  return path
    .basename(String(command))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/**
 * Agent CLI 的可执行文件：升级时用它实际启动的那个，可能是解析过符号链接的真实路径
 * （~/.local/share/claude/versions/2.1.x、Caskroom/claude-code@latest/…），所以看路径里的每一段。
 */
function isAgentCli(command) {
  const segments = String(command).toLowerCase().split(/[\\/]/);
  return segments.some((segment) => {
    const name = segment.replace(/\.(exe|cmd|bat|ps1)$/, "");
    return [...AGENT_CLIS].some(
      (cli) => name === cli || name.startsWith(`${cli}-`) || name.startsWith(`${cli}@`),
    );
  });
}

/** 会改本机 CLI 安装的命令：Agent CLI 的 update / upgrade、brew 装与升级、包管理器的全局安装、官方安装脚本。 */
export function isGlobalInstallCommand(command, args) {
  const name = commandName(command);
  const list = Array.isArray(args) ? args.map(String) : [];
  if (isAgentCli(command)) return list[0] === "update" || list[0] === "upgrade";
  if (name === "brew") return list.some((arg) => INSTALL_VERBS.has(arg));
  if (PACKAGE_MANAGERS.has(name)) {
    const isGlobal = list.includes("-g") || list.includes("--global") || list[0] === "global";
    return isGlobal && list.some((arg) => INSTALL_VERBS.has(arg));
  }
  return list.some((arg) => /chatgpt\.com\/codex\/install\.(sh|ps1)/.test(arg));
}

/**
 * 第三方接口判断 Codex 登录方式时起的临时 app-server（codex-sign-in.ts）。只看参数：
 * Codex 也可能经 node 跑 npm 包里的脚本，可执行文件不一定叫 codex。
 */
export function isCodexSignInProbe(_command, args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  return list.includes("app-server") && list.includes('model_provider="openai"');
}

/** 查 Claude Code 云平台开关时问登录 shell 的进程（login-shell-env.ts 带 PASEO_SHELL_PROBE=1）。 */
export function isLoginShellProbe(options) {
  return options?.env?.PASEO_SHELL_PROBE === "1";
}

/** ps 的 etime（[[dd-]hh:]mm:ss）换成秒；读不出为 null。 */
function elapsedSeconds(text) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    ((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes)) * 60 + Number(seconds)
  );
}

/** PASEO_E2E_PROCESS_TABLE_PATH 里「pid 父 pid 已运行时间 命令行」的假进程表。 */
function readFakeProcessTable() {
  const file = process.env.PASEO_E2E_PROCESS_TABLE_PATH;
  if (!file || !existsSync(file)) return [];
  const now = Date.now();
  const processes = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    const elapsed = match ? elapsedSeconds(match[3]) : null;
    if (elapsed === null) continue;
    processes.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      startedAt: new Date(now - elapsed * 1000),
      commandLine: match[4].trim(),
    });
  }
  return processes;
}

globalThis[Symbol.for("paseo.e2e.hostProcesses")] = {
  reportsStartTimes: true,
  list: async () => readFakeProcessTable(),
  readCodexHome: async () => null,
  findCodex: async ({ env }) => ({ command: "codex", args: [], env: { ...process.env, ...env } }),
  run: async (command) => {
    const record = process.env.PASEO_E2E_UPGRADE_RECORD_PATH;
    if (record) {
      const entry = { command: command.command, args: command.args, at: Date.now() };
      appendFileSync(record, `${JSON.stringify(entry)}\n`);
    }
    return { exitCode: 0, output: "" };
  },
};

const realSpawn = childProcess.spawn;
childProcess.spawn = function sealedSpawn(command, args, options) {
  const spawnOptionsOf = Array.isArray(args) ? options : args;
  const isSealed =
    isGlobalInstallCommand(command, args) ||
    isCodexSignInProbe(command, args) ||
    isLoginShellProbe(spawnOptionsOf);
  if (!isSealed) {
    return realSpawn.apply(this, arguments);
  }
  const record = process.env.PASEO_E2E_UPGRADE_RECORD_PATH;
  if (record) {
    appendFileSync(record, `${JSON.stringify({ command, args, at: Date.now() })}\n`);
  }
  const spawnOptions = Array.isArray(args) ? options : args;
  return realSpawn(
    process.execPath,
    ["-e", "process.stderr.write('blocked by the e2e upgrade seal\\n'); process.exit(1)"],
    { ...spawnOptions, shell: false },
  );
};
syncBuiltinESMExports();
