import React, { useCallback, useMemo } from "react";
import { usePathname, useRouter } from "expo-router";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import { normalizeHostLabel } from "@/types/host-connection";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { EndpointIconHostProvider } from "./endpoint-icon";
import { ImportLinkSheet, type ImportLinkView } from "./import-link-sheet";
import { useImportLink } from "./use-import-link";

/*
 * 运行时接线：导入链接加到哪台主机、主机够不够新、读链接与添加。确认框本身是纯 props（import-link-sheet.tsx）。
 */

const NO_OP = () => {};
const NO_HOST_VIEW: ImportLinkView = { kind: "noHost" };
const OFFLINE_VIEW: ImportLinkView = { kind: "offline" };
const UPDATE_HOST_VIEW: ImportLinkView = { kind: "updateHost" };

function useHostLabel(serverId: string): string {
  const host = useHosts().find((candidate) => candidate.serverId === serverId);
  return normalizeHostLabel(host?.label, serverId);
}

/** 导入链接的确认框：serverId 是这个窗口当前所在的主机，没有主机为 null。 */
export function ImportLinkDialog({
  serverId,
  link,
  onClose,
}: {
  serverId: string | null;
  link: string;
  onClose: () => void;
}) {
  if (serverId === null) {
    return (
      <ImportLinkSheet
        view={NO_HOST_VIEW}
        hostLabel={null}
        onRetry={NO_OP}
        onAdd={noHostAdd}
        onAdded={NO_OP}
        onClose={onClose}
      />
    );
  }
  return <HostImportLinkDialog serverId={serverId} link={link} onClose={onClose} />;
}

async function noHostAdd(): Promise<{ status: "failed"; message: string }> {
  return { status: "failed", message: "" };
}

function HostImportLinkDialog({
  serverId,
  link,
  onClose,
}: {
  serverId: string;
  link: string;
  onClose: () => void;
}) {
  const hostLabel = useHostLabel(serverId);
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机不认导入链接，请用户更新主机。
  const supported = useHostFeatureAvailability(serverId, "apiEndpointManagement");
  if (supported !== true) {
    // 还没收到主机的 server_info 是没连上，不是太旧。
    const view = supported === null ? OFFLINE_VIEW : UPDATE_HOST_VIEW;
    return (
      <ImportLinkSheet
        view={view}
        hostLabel={hostLabel}
        onRetry={NO_OP}
        onAdd={noHostAdd}
        onAdded={NO_OP}
        onClose={onClose}
      />
    );
  }
  return (
    <EndpointIconHostProvider serverId={serverId}>
      <ImportLinkPreviewDialog
        serverId={serverId}
        link={link}
        hostLabel={hostLabel}
        onClose={onClose}
      />
    </EndpointIconHostProvider>
  );
}

function ImportLinkPreviewDialog({
  serverId,
  link,
  hostLabel,
  onClose,
}: {
  serverId: string;
  link: string;
  hostLabel: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { preview, retry, add } = useImportLink({ serverId, link });
  const view = useMemo<ImportLinkView>(() => ({ kind: "preview", preview }), [preview]);
  // 加好后关上，到那台主机的「第三方接口」页看它（magpie 加好后回到列表）；已经在那一页就不再压一层。
  const handleAdded = useCallback(() => {
    onClose();
    const listRoute = buildSettingsHostSectionRoute(serverId, "api-endpoints");
    if (pathname !== listRoute) router.push(listRoute);
  }, [onClose, pathname, router, serverId]);
  return (
    <ImportLinkSheet
      view={view}
      hostLabel={hostLabel}
      onRetry={retry}
      onAdd={add}
      onAdded={handleAdded}
      onClose={onClose}
    />
  );
}
