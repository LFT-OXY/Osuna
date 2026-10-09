import type { Command } from "commander";
import { migrateLegacyHomeIfDefault } from "@osuna/server";
import { selectDaemonTarget } from "./daemon-target.js";

const JSON_OPTION_DESCRIPTION = "Output in JSON format";
const DAEMON_HOST_OPTION_DESCRIPTION =
  "Explicit daemon endpoint: host:port, TCP, socket, SSH, or pairing URL (default: local home)";

const localCommands = new WeakSet<Command>();

export function addLocalDaemonOptions<T extends Command>(command: T): T {
  localCommands.add(command);
  command.option("--home <path>", "Local daemon home (default: ~/.osuna)");
  return command;
}

export function collectMultiple(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function addJsonOption<T extends Command>(command: T): T {
  command.option("--json", JSON_OPTION_DESCRIPTION);
  return command;
}

export function addDaemonHostOption<T extends Command>(command: T): T {
  command.option("--host <host>", DAEMON_HOST_OPTION_DESCRIPTION);
  if (!command.options.some((option) => option.long === "--home"))
    command.option("--home <path>", "Select a local daemon home (default: ~/.osuna)");
  return command;
}

export function addJsonAndDaemonHostOptions<T extends Command>(command: T): T {
  return addDaemonHostOption(addJsonOption(command));
}

export function withGlobalOptions<Args extends unknown[], Result>(
  handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const command = args.at(-1) as Command;
    const mergedArgs = [...args];
    const options = command.optsWithGlobals();
    const selectors = { home: new Set<string>(), host: new Set<string>() };
    for (let current: Command | null = command; current; current = current.parent) {
      for (const key of ["home", "host"] as const) {
        const value = current.opts()[key];
        if (typeof value === "string") selectors[key].add(value);
      }
    }
    if (selectors.home.size > 1 || selectors.host.size > 1)
      throw { code: "TARGET_AMBIGUOUS", message: "Conflicting duplicate daemon selectors." };
    const localOnly = localCommands.has(command);
    options.daemonTarget = selectDaemonTarget(options, process.env, localOnly);
    // COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
    // 本地命令直接读写 home（改配置、拉起 daemon），所以紧跟 home 解析、赶在它们动手之前搬。
    if (localOnly) {
      await migrateLegacyHomeIfDefault({
        env: { OSUNA_HOME: options.home ?? process.env.OSUNA_HOME },
      });
    }
    mergedArgs[mergedArgs.length - 2] = options;
    return handler(...(mergedArgs as Args));
  };
}
