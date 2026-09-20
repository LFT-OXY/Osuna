import type { Logger } from "pino";

import { createConnectionOfferV2, encodeOfferToFragmentUrl } from "./connection-offer.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { renderPairingQr } from "./pairing-qr.js";
import { getOrCreateServerId } from "./server-id.js";

/**
 * 没有出配对链接时，缺的是哪一项配置。本 fork 不托管 relay 与 web app，两者都要求
 * 显式配置，所以「没有链接」是常态而不是异常，调用方需要凭这个值给出可操作的提示。
 */
export type PairingOfferUnavailableReason =
  | "relay_disabled"
  | "relay_endpoint_unset"
  | "app_base_url_unset";

export interface LocalPairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
  unavailableReason: PairingOfferUnavailableReason | null;
}

export async function generateLocalPairingOffer(args: {
  osunaHome: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  appBaseUrl?: string;
  includeQr?: boolean;
  logger?: Logger;
}): Promise<LocalPairingOffer> {
  const relayEnabled = args.relayEnabled ?? true;
  if (!relayEnabled) {
    return {
      relayEnabled: false,
      url: null,
      qr: null,
      unavailableReason: "relay_disabled",
    };
  }

  // 没有托管的 relay 与 web app，这两个地址无处可回退：缺任何一个都只能不出链接，
  // 而不是拼出一个指向上游或不存在域名的 URL。
  const relayEndpoint = args.relayEndpoint;
  const appBaseUrl = args.appBaseUrl;
  if (!relayEndpoint) {
    return { relayEnabled: true, url: null, qr: null, unavailableReason: "relay_endpoint_unset" };
  }
  if (!appBaseUrl) {
    return { relayEnabled: true, url: null, qr: null, unavailableReason: "app_base_url_unset" };
  }

  const relayPublicEndpoint = args.relayPublicEndpoint ?? relayEndpoint;
  const relayUseTls = args.relayUseTls ?? false;
  const relayPublicUseTls = args.relayPublicUseTls ?? relayUseTls;
  const serverId = getOrCreateServerId(args.osunaHome, { logger: args.logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(args.osunaHome, args.logger);
  const offer = await createConnectionOfferV2({
    serverId,
    daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
    relay: { endpoint: relayPublicEndpoint, useTls: relayPublicUseTls },
  });
  const url = encodeOfferToFragmentUrl({ offer, appBaseUrl });

  if (args.includeQr === false) {
    return {
      relayEnabled: true,
      url,
      qr: null,
      unavailableReason: null,
    };
  }

  let qr: string | null = null;
  try {
    qr = await renderPairingQr(url);
  } catch (error) {
    args.logger?.debug({ error }, "Failed to render pairing QR");
  }

  return {
    relayEnabled: true,
    url,
    qr,
    unavailableReason: null,
  };
}
