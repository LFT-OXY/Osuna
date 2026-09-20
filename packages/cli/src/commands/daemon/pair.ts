import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import chalk from "chalk";
import {
  generateLocalPairingOffer,
  readDaemonInstance,
  readPersistedConfig,
  editPersistedConfig,
  resolveConfigFromPersisted,
} from "@osuna/server";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { addJsonAndDaemonHostOptions, withGlobalOptions } from "../../utils/command-options.js";
import {
  describePairingUnavailable,
  formatPairingInstructions,
  type PairingUnavailableReason,
} from "../../output/pairing.js";

interface PairOptions {
  daemonTarget: DaemonTarget;
  home?: string;
  json?: boolean;
  relay?: boolean;
}

export interface PairCommandOutput {
  columns: number | undefined;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  setExitCode(code: number): void;
  success(message: string): void;
}

export interface PairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
  /** 远端 daemon 不回这个值，此时为 null，输出层退到「不知道缺哪个」的兜底文案。 */
  unavailableReason: PairingUnavailableReason | null;
}

const PAIRING_DAEMON_RPC_TIMEOUT_MS = 1500;
const RELAY_DOCS_URL = "https://paseo.sh/docs/security";

function createProcessOutput(): PairCommandOutput {
  return {
    columns: process.stdout.columns,
    writeStdout(message) {
      process.stdout.write(message);
    },
    writeStderr(message) {
      process.stderr.write(message);
    },
    setExitCode(code) {
      process.exitCode = code;
    },
    success(message) {
      log.success(message);
    },
  };
}

export function pairCommand(): Command {
  return addJsonAndDaemonHostOptions(
    new Command("pair").description("Print the daemon pairing QR code and link"),
  )
    .option("--relay", "Enable relay without prompting")
    .action(
      withGlobalOptions((options: PairOptions, _command: Command) => runPairCommand(options)),
    );
}

export async function resolveLocalPairingOffer(options: {
  paseoHome: string;
  enableRelay?: boolean;
}): Promise<PairingOffer> {
  const instance = await readDaemonInstance(options.paseoHome);
  if (instance)
    return resolveDaemonPairingOffer(
      { kind: "instance", home: options.paseoHome },
      options.enableRelay,
    );
  if (options.enableRelay)
    editPersistedConfig(options.paseoHome, "daemon.relay.enabled", { value: true });
  const config = resolveConfigFromPersisted(
    options.paseoHome,
    readPersistedConfig(options.paseoHome, { defaultsIfMissing: true }),
    { env: {} },
  );

  return generateLocalPairingOffer({
    paseoHome: options.paseoHome,
    relayEnabled: config.relayEnabled,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: true,
  });
}

async function resolveDaemonPairingOffer(
  target: DaemonTarget,
  enableRelay: boolean | undefined,
): Promise<PairingOffer> {
  const client = await connectToDaemon({
    target,
    timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
  });

  try {
    const serverInfo = client.getLastServerInfoMessage();
    if (serverInfo?.features?.daemonStatusRpc !== true) {
      throw new Error("Update the Osuna daemon before pairing from this command.");
    }

    let offer = await client.getDaemonPairingOffer({
      timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
    });
    if (!offer.relayEnabled && enableRelay) {
      if (serverInfo.features.relayConfig !== true) {
        throw new Error("Update the Osuna daemon before enabling relay from this command.");
      }
      await client.patchDaemonConfig({ relay: { enabled: true } });
      try {
        offer = await client.getDaemonPairingOffer({ timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS });
      } catch (error) {
        throw new Error(
          `Relay configuration was saved, but fetching the pairing offer failed: ${String(error)}`,
          { cause: error },
        );
      }
    }
    return {
      relayEnabled: offer.relayEnabled,
      url: offer.url || null,
      qr: offer.qr ?? null,
      unavailableReason: resolveDaemonUnavailableReason(target, offer),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * RPC 不回「缺哪一项配置」。本机 daemon 读的是同一个 home，这里按它的持久化配置补判；
 * 配置已配齐却仍没有链接，说明 daemon 还没吃到这份配置（`daemon.relay.endpoint`
 * 明确要求重启）。真正的远端 daemon 落回 null，由输出层给兜底文案。
 */
function resolveDaemonUnavailableReason(
  target: DaemonTarget,
  offer: { relayEnabled: boolean; url: string },
): PairingUnavailableReason | null {
  if (!offer.relayEnabled) return "relay_disabled";
  if (offer.url) return null;
  if (target.kind !== "instance") return null;
  const config = resolveConfigFromPersisted(
    target.home,
    readPersistedConfig(target.home, { defaultsIfMissing: true }),
    { env: {} },
  );
  if (!config.relayEndpoint) return "relay_endpoint_unset";
  if (!config.appBaseUrl) return "app_base_url_unset";
  return "config_not_applied";
}

export async function confirmRelayPairing(): Promise<boolean> {
  log.message("Your connection is end-to-end encrypted. Osuna cannot read your code or messages.");
  log.message(`Learn how it works: ${RELAY_DOCS_URL}`);
  const answer = await confirm({
    message: "Enable relay to pair a device?",
    initialValue: false,
  });
  return !isCancel(answer) && answer;
}

export function printDirectConnectionGuidance(): void {
  console.log("Daemon is running with relay off.");
  console.log(
    "To connect another device directly, use the daemon's TCP address over your LAN, Tailscale, or another VPN.",
  );
  console.log(`Learn more: ${RELAY_DOCS_URL}#direct-connections`);
}

export async function runPairCommand(options: PairOptions): Promise<void> {
  const output = createProcessOutput();
  const target = options.daemonTarget;
  const resolveOffer = (enableRelay: boolean) =>
    target.kind === "instance"
      ? resolveLocalPairingOffer({ paseoHome: target.home, enableRelay })
      : resolveDaemonPairingOffer(target, enableRelay);
  const offline = target.kind === "instance" && !(await readDaemonInstance(target.home));
  const pairing = await resolveOffer(options.relay === true);

  if (offline)
    output.writeStderr(
      `Offline pairing offer. Start with: osuna daemon start --home ${JSON.stringify(target.kind === "instance" ? target.home : "")}\n`,
    );

  outputPairingResult(pairing, options, output);
}

export function outputPairingResult(
  pairing: PairingOffer,
  options: PairOptions,
  output: PairCommandOutput,
): void {
  if (!pairing.relayEnabled || !pairing.url) {
    const notice = describePairingUnavailable(pairing.unavailableReason ?? "unknown");
    if (options.json) {
      output.writeStderr(`${JSON.stringify(notice)}\n`);
    } else {
      output.writeStderr(`${chalk.red(notice.message)}\n`);
      output.writeStderr(`${chalk.yellow(notice.action)}\n`);
    }
    output.setExitCode(1);
    return;
  }

  if (options.json) {
    output.writeStdout(
      `${JSON.stringify(
        { relayEnabled: pairing.relayEnabled, url: pairing.url, qr: pairing.qr },
        null,
        2,
      )}\n`,
    );
    return;
  }

  output.writeStdout(
    formatPairingInstructions({
      url: pairing.url,
      qr: pairing.qr,
      columns: output.columns,
    }),
  );
}
