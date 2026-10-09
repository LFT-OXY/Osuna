// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import type { Command } from "commander";
import { findRunningLegacyDaemon, type LegacyDaemon } from "@osuna/server";
import { selectDaemonTarget } from "./daemon-target.js";

// 顶层的 status 是 daemon status 的快捷方式；顶层的 stop 停的是 Agent，不在这里。
const LEGACY_DAEMON_COMMANDS = new Set(["daemon status", "status", "daemon stop"]);

// 用户显式选定的 home：--home 或 OSUNA_HOME 的值，两者都没给时是 undefined。
export function explicitHomeOf(command: Command): string | undefined {
  return command.optsWithGlobals().home ?? process.env.OSUNA_HOME;
}

// status 与 stop 自己处理仍在运行的 0.14.x daemon。指向别的主机时它们和其余命令一样要连出去、
// 往默认 home 写 client id，所以只在目标是本机时放行。
export function managesLegacyDaemon(command: Command): boolean {
  const names: string[] = [];
  for (let current = command; current.parent; current = current.parent) {
    names.unshift(current.name());
  }
  if (!LEGACY_DAEMON_COMMANDS.has(names.join(" "))) return false;
  return selectDaemonTarget(command.optsWithGlobals()).kind === "instance";
}

export function findLegacyDaemonFor(command: Command): Promise<LegacyDaemon | null> {
  return findRunningLegacyDaemon({ explicitHome: explicitHomeOf(command) });
}
