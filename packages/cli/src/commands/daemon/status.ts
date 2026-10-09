import { Command } from "commander";
import { DaemonConnectionError } from "@osuna/client/internal/daemon-client";
import {
  legacyDaemonStopCommand,
  readDaemonInstance,
  readPersistedConfig,
  resolveConfigFromPersisted,
  daemonLogPath,
  isSameDaemonInstance,
  DaemonInstanceError,
} from "@osuna/server";
import { connectToDaemon, buildDaemonConnectionCommandError } from "../../utils/client.js";
import { withOutput, toCommandError, type CommandOptions } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { describeDaemonTarget, type DaemonTarget } from "../../utils/daemon-target.js";
import { findLegacyDaemonFor } from "../../utils/legacy-daemon.js";

export function daemonStatusCommand(): Command {
  return addJsonAndDaemonHostOptions(
    new Command("status").description("Observe the selected daemon and its published endpoint"),
  ).action(withOutput(runStatusCommand));
}

export async function runStatusCommand(options: CommandOptions, command: Command) {
  const target = options.daemonTarget;
  // COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
  // 握手会拒绝 0.14.x，所以不去连它，只报锁文件里记的那些；也不读新 home，免得把它建出来。
  const legacyDaemon = target.kind === "instance" ? await findLegacyDaemonFor(command) : null;
  if (legacyDaemon) {
    return statusResult({
      home: legacyDaemon.home,
      pid: legacyDaemon.pid,
      startedAt: legacyDaemon.startedAt,
      listen: legacyDaemon.listen,
      localDaemon: "legacy_running",
      desktopManaged: legacyDaemon.desktopManaged,
      connectedDaemon: "not_probed",
      note: `A 0.14.x daemon is still running. Osuna 1.0.0 cannot connect to it or use its data until it stops. Stop it with: ${legacyDaemonStopCommand(legacyDaemon)}`,
    });
  }

  const instance = target.kind === "instance" ? await readDaemonInstance(target.home) : null;
  const local =
    target.kind === "instance"
      ? localStatus(target.home, instance)
      : { host: describeDaemonTarget(target) };
  const observed =
    target.kind === "endpoint" || instance?.listen
      ? await probeDaemonStatus(target, instance, local)
      : { connectedDaemon: "not_probed" };
  return statusResult({ ...local, ...observed });
}

function statusResult(data: Record<string, unknown>) {
  return {
    type: "single" as const,
    data,
    schema: {
      idField: () => "daemon",
      columns: [],
      renderHuman: () =>
        Object.entries(data)
          .filter(([, value]) => value !== undefined)
          .map(
            ([key, value]) =>
              `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`,
          )
          .join("\n"),
    },
  };
}

async function probeDaemonStatus(
  target: DaemonTarget,
  instance: Awaited<ReturnType<typeof readDaemonInstance>>,
  local: Record<string, unknown>,
) {
  let connectedDaemon = "unreachable";
  let note: string | undefined;
  let live: Record<string, unknown> = {};
  let client: Awaited<ReturnType<typeof connectToDaemon>> | undefined;
  try {
    client = await connectToDaemon({ target, instance: instance ?? undefined, timeout: 1_500 });
  } catch (error) {
    const failure = buildDaemonConnectionCommandError({ target, error });
    if (target.kind === "endpoint") throw failure;
    connectedDaemon = "unreachable";
    if (failure.code === "AUTH_REQUIRED") connectedDaemon = "auth_required";
    if (failure.code === "AUTH_FAILED") connectedDaemon = "auth_failed";
    note = failure.message;
  }
  if (!client) return { connectedDaemon, note };
  try {
    let requestError: unknown;
    const status = await client.getDaemonStatus({ timeout: 1_500 }).catch((error: unknown) => {
      requestError = error;
      return null;
    });
    // Recheck even when the RPC times out before combining local and live observations.
    const current = target.kind === "instance" ? await readDaemonInstance(target.home) : null;
    if (instance && (!current || !isSameDaemonInstance(instance, current)))
      throw new DaemonInstanceError(
        "DAEMON_REPLACED",
        "Supervisor exited or was replaced during status observation.",
      );
    const info = client.getLastServerInfoMessage();
    live = { serverId: info?.serverId, daemonVersion: info?.version };
    connectedDaemon = client.isConnected ? "reachable" : "unreachable";
    if (!status) {
      const failure = toCommandError(requestError);
      note = `Status details unavailable (${failure.code}): ${failure.message}`;
      if (
        target.kind === "endpoint" ||
        !client.isConnected ||
        !(requestError instanceof DaemonConnectionError) ||
        requestError.code !== "DAEMON_REQUEST_TIMEOUT"
      ) {
        throw { ...failure, message: note, details: { ...local, ...live, connectedDaemon } };
      }
    } else {
      live = {
        ...live,
        daemonVersion: status.version,
        workerPid: status.pid,
        daemonNode: status.nodePath,
        providers: status.providers,
        relay: status.relay,
      };
    }
  } finally {
    await client.close();
  }
  return { ...live, connectedDaemon, note };
}

function localStatus(home: string, instance: Awaited<ReturnType<typeof readDaemonInstance>>) {
  const config = resolveConfigFromPersisted(
    home,
    readPersistedConfig(home, { defaultsIfMissing: true }),
    { env: {} },
  );
  let localDaemon = "stopped";
  if (instance) localDaemon = instance.listen ? "running" : "not_ready";
  return {
    home,
    pid: instance?.pid ?? null,
    startedAt: instance?.startedAt ?? null,
    listen: instance?.listen ?? null,
    hostname: instance?.hostname ?? null,
    configuredListen: config.listen,
    localDaemon,
    desktopManaged: instance?.desktopManaged === true,
    logPath: daemonLogPath(home),
  };
}
