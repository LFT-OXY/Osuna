import {
  API_ENDPOINT_IMPORT_LINK_REFUSALS,
  type ApiEndpointError,
  type ApiEndpointImportLinkRefusal,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { parseServerIdFromPathname } from "@/utils/host-routes";
import { orderHostsLocalFirst, resolveActiveHostServerId } from "@/types/host-connection";

/*
 * 导入链接（ADR 0013）的纯逻辑：加到哪台主机、daemon 拒收的原因。界面在 import-link-sheet.tsx。
 */

const SETTINGS_HOST_PATH = /^\/settings\/hosts\/([^/?#]+)/;

/**
 * 导入链接加到这个窗口当前所在的主机：窗口正看着的主机（/h/… 或设置里的那台主机），
 * 否则上次打开的工作区所在的主机，否则本机 daemon，否则第一台。没有主机为 null。
 */
export function importLinkServerId(input: {
  pathname: string;
  lastSelectedServerId: string | null;
  localServerId: string | null;
  hosts: readonly { serverId: string }[];
}): string | null {
  const { hosts } = input;
  const routed = parseServerIdFromPathname(input.pathname) ?? settingsHostServerId(input.pathname);
  const isKnownRoute = routed !== null && hosts.some((host) => host.serverId === routed);
  if (isKnownRoute) return routed;
  return resolveActiveHostServerId({
    selectedServerId: input.lastSelectedServerId,
    localServerId: input.localServerId,
    hosts,
    orderedHosts: orderHostsLocalFirst([...hosts], input.localServerId),
  });
}

function settingsHostServerId(pathname: string): string | null {
  const match = SETTINGS_HOST_PATH.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    // 路径里的 % 编码坏了：当作不在哪台主机上。
    if (error instanceof URIError) return null;
    throw error;
  }
}

/** daemon 拒收导入链接的原因：认得的那几种之一，认不出的为 unknown；不是拒收为 null。 */
export function importLinkRefusalOf(
  error: ApiEndpointError,
): ApiEndpointImportLinkRefusal | "unknown" | null {
  if (error.code !== "import_link_refused") return null;
  const reason = API_ENDPOINT_IMPORT_LINK_REFUSALS.find((known) => known === error.params?.reason);
  return reason ?? "unknown";
}
