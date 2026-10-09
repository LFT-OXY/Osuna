import { Command } from "commander";
import { stopDaemonInstance, stopLegacyDaemon, type DaemonInstance } from "@osuna/server";
import { connectToDaemon } from "../../utils/client.js";
import { withOutput, type CommandOptions } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { describeDaemonTarget } from "../../utils/daemon-target.js";
import { findLegacyDaemonFor } from "../../utils/legacy-daemon.js";
import { parseTimeoutMs } from "./local-daemon.js";

export function daemonStopCommand(): Command {
  return addJsonAndDaemonHostOptions(new Command("stop").description("Stop the selected daemon"))
    .option("--timeout <seconds>", "Graceful exit deadline (default: 15)")
    .option("--force", "Permit forced local process cleanup")
    .option("--kill-timeout <seconds>", "Forced exit deadline (default: 3)")
    .action(withOutput(runStopCommand));
}

export async function runStopCommand(options: CommandOptions, command: Command) {
  const target = options.daemonTarget;
  const timeoutMs = parseTimeoutMs(options.timeout, 15_000);
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const requestShutdown = async (instance?: DaemonInstance) => {
    const client = await connectToDaemon({ target, timeout: remaining(), instance });
    try {
      await client.shutdownServer({ timeout: remaining() });
    } finally {
      await client.close();
    }
  };
  if (target.kind === "endpoint" && options.force)
    throw {
      code: "INVALID_OPTIONS",
      message: "--force requires a local --home; an endpoint gives no remote process authority.",
    };
  const killTimeoutMs = parseTimeoutMs(options.killTimeout, 3_000);
  // COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
  // 握手会拒绝 0.14.x，关停请求发不过去，所以按锁文件里的 pid 停。停掉之后不搬数据，下一次启动再搬。
  const legacyDaemon = target.kind === "instance" ? await findLegacyDaemonFor(command) : null;
  async function stopLocalDaemon(home: string) {
    if (legacyDaemon) {
      const stopped = await stopLegacyDaemon(legacyDaemon, {
        force: options.force === true,
        timeoutMs,
        killTimeoutMs,
      });
      return {
        action: "stopped",
        ...stopped,
        usedLifecycleRpc: false,
        home: legacyDaemon.home,
      };
    }
    const stopped = await stopDaemonInstance(home, {
      force: options.force === true,
      timeoutMs,
      killTimeoutMs,
      requestShutdown,
    });
    return { ...stopped, home };
  }
  const result: {
    action: string;
    home?: string;
    host?: string;
    pid?: number | null;
    forced?: boolean;
    usedLifecycleRpc?: boolean;
  } =
    target.kind === "instance"
      ? await stopLocalDaemon(target.home)
      : (await requestShutdown(),
        { action: "shutdown_requested", host: describeDaemonTarget(target) });
  return {
    type: "single" as const,
    data: result,
    schema: {
      idField: "action" as const,
      columns: [],
      renderHuman: () =>
        target.kind === "endpoint"
          ? "Shutdown requested; remote process exit was not verified."
          : `${result.action.replaceAll("_", " ")}: ${result.home}`,
    },
  };
}
