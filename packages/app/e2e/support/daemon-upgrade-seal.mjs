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
 * 2026-10-18 一条浏览器用例点中了升级按钮，测试 daemon 真的跑了 `brew upgrade --cask claude-code@latest`
 * 又被中途杀掉，弄坏了开发者本机的 Claude Code。
 */
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
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

const realSpawn = childProcess.spawn;
childProcess.spawn = function sealedSpawn(command, args, options) {
  if (!isGlobalInstallCommand(command, args) && !isCodexSignInProbe(command, args)) {
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
