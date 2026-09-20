import type { PairingOfferUnavailableReason } from "@osuna/server";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

interface PairingInstructions {
  url: string;
  qr: string | null;
  columns?: number;
}

function visibleWidth(value: string): number {
  return Math.max(
    ...value
      .replace(ANSI_PATTERN, "")
      .split("\n")
      .map((line) => line.length),
  );
}

function formatQr(qr: string | null, columns: number | undefined): string {
  if (!qr) {
    return "QR code is unavailable. Use the pairing link below.";
  }

  if (columns === undefined) {
    return "QR code not shown because terminal width could not be detected.";
  }

  const width = visibleWidth(qr);
  if (columns <= width) {
    return `QR code not shown. Resize the terminal to at least ${width + 1} columns, then run this command again.`;
  }

  return qr;
}

export function formatPairingInstructions({ url, qr, columns }: PairingInstructions): string {
  return `\nScan to pair:\n${formatQr(qr, columns)}\n\nPairing link:\n${url}\n\nTreat this pairing link like a password. Anyone with it can access this daemon.\n`;
}

/**
 * 除了 daemon 报上来的三种缺配置，CLI 自己还能判出两种状态：本机 daemon 的持久化配置
 * 已经配齐、缺的只是一次重启（`config_not_applied`）；以及远端 daemon 只回 `url` 与
 * `relayEnabled`、缺哪一项无从得知（`unknown`）。
 */
export type PairingUnavailableReason =
  | PairingOfferUnavailableReason
  | "config_not_applied"
  | "unknown";

/** `--json` 的对外错误码，写错码名要在编译期拦住。 */
export type PairingUnavailableCode =
  | "RELAY_DISABLED"
  | "RELAY_ENDPOINT_UNSET"
  | "APP_BASE_URL_UNSET"
  | "DAEMON_RESTART_REQUIRED"
  | "PAIRING_LINK_UNAVAILABLE";

export interface PairingUnavailableNotice {
  code: PairingUnavailableCode;
  message: string;
  action: string;
}

/**
 * 文案一律先给 `osuna daemon config set`：离线配对解析配置时显式屏蔽了进程环境
 * （见 `resolveLocalPairingOffer`），只提环境变量在这条路径上照做也没用。
 */
export function describePairingUnavailable(
  reason: PairingUnavailableReason,
): PairingUnavailableNotice {
  switch (reason) {
    case "relay_disabled":
      return {
        code: "RELAY_DISABLED",
        message: "Relay pairing is disabled for this daemon.",
        action: "Run osuna daemon pair --relay to enable it.",
      };
    case "relay_endpoint_unset":
      return {
        code: "RELAY_ENDPOINT_UNSET",
        message: "Relay is on, but this daemon has no relay endpoint, so it has no pairing link.",
        action:
          "Run osuna daemon config set daemon.relay.endpoint <host:port> (or set OSUNA_RELAY_ENDPOINT before starting the daemon), then pair again.",
      };
    case "app_base_url_unset":
      return {
        code: "APP_BASE_URL_UNSET",
        message: "Relay is on, but this daemon has no app base URL, so it has no pairing link.",
        action:
          "Run osuna daemon config set app.baseUrl <url> with where your Osuna app is served (or set OSUNA_APP_BASE_URL before starting the daemon), then pair again.",
      };
    case "config_not_applied":
      return {
        code: "DAEMON_RESTART_REQUIRED",
        message:
          "The pairing settings are saved, but the running daemon has not picked them up, so it has no pairing link.",
        action: "Run osuna daemon restart, then pair again.",
      };
    case "unknown":
      return {
        code: "PAIRING_LINK_UNAVAILABLE",
        message: "Relay is on, but the daemon returned no pairing link.",
        action:
          "On the daemon host, set app.baseUrl and daemon.relay.endpoint with osuna daemon config set, then pair again.",
      };
  }
}
