/*
 * e2e 测试 daemon 的封条：经 NODE_OPTIONS=--import 预加载进 daemon 及它派生的 Node 进程。
 *
 * 1. 不查 npm registry 的最新版本：设置页就不会出现「Upgrade to …」按钮（版本检查按查不到处理）。
 * 2. 即使有人直接发 provider.upgrade，也不会碰本机的全局安装：brew、各 CLI 的 update / upgrade 子命令、
 *    Codex 的安装脚本与 npm 全局安装，一律换成一个立刻以 1 退出的 node 进程，并记一行到
 *    PASEO_E2E_UPGRADE_RECORD_PATH（设了的话）。
 *
 * 2026-10-18 一条浏览器用例点中了升级按钮，测试 daemon 真的跑了 `brew upgrade --cask claude-code@latest`
 * 又被中途杀掉，弄坏了开发者本机的 Claude Code。
 */
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const UPGRADE_SUBCOMMANDS = new Set(["update", "upgrade"]);

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

/** 会改本机全局安装的命令：升级命令表（provider-upgrade-command.ts）里会出现的全部形状。 */
export function isGlobalInstallCommand(command, args) {
  const name = path.basename(String(command)).toLowerCase();
  const list = Array.isArray(args) ? args.map(String) : [];
  if (name === "brew") return true;
  if (UPGRADE_SUBCOMMANDS.has(list[0])) return true;
  if (list.some((arg) => /install\.(sh|ps1)/.test(arg))) return true;
  if ((name === "npm" || name === "npm.cmd") && list.includes("-g")) return true;
  return false;
}

const realSpawn = childProcess.spawn;
childProcess.spawn = function sealedSpawn(command, args, options) {
  if (!isGlobalInstallCommand(command, args)) {
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
