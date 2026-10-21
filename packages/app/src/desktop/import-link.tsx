import { useCallback, useEffect, useState } from "react";
import { usePathname } from "expo-router";
import { isApiEndpointImportLink } from "@getpaseo/protocol/api-endpoint/import-link";
import { ImportLinkDialog } from "@/api-endpoints/import-link-dialog";
import { importLinkServerId } from "@/api-endpoints/internal/import-link";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { getDesktopHost } from "@/desktop/host";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHosts } from "@/runtime/host-runtime";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";

/** 收到的一条导入链接与它要加到的主机；seq 让同一条链接再点一次时确认框重新打开。 */
interface ReceivedImportLink {
  link: string;
  serverId: string | null;
  seq: number;
}

/**
 * 桌面端收到的导入链接（paseo://import，ADR 0013）：主进程交给这个窗口，这里打开确认框，加到窗口当前所在的主机。
 * 只有桌面端有这条路；链接从不自己保存什么。
 */
export function ImportLinkListener() {
  const [received, setReceived] = useState<ReceivedImportLink | null>(null);
  const pathname = usePathname();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const lastWorkspace = useLastWorkspaceSelection();
  const receive = useStableEvent((payload: unknown) => {
    if (typeof payload !== "string" || !isApiEndpointImportLink(payload)) return;
    const serverId = importLinkServerId({
      pathname,
      lastSelectedServerId: lastWorkspace?.serverId ?? null,
      localServerId,
      hosts,
    });
    setReceived((current) => ({
      link: payload.trim(),
      serverId,
      seq: (current?.seq ?? 0) + 1,
    }));
  });

  useEffect(() => {
    const host = getDesktopHost();
    const ready = host?.importLinks?.ready;
    if (typeof host?.events?.on !== "function" || typeof ready !== "function") {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      let dispose: (() => void) | null = null;
      try {
        dispose = await listenToDesktopEvent<unknown>("import-link", receive);
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        const pending = await ready();
        if (!disposed && pending) receive(pending);
      } catch (error) {
        // 桌面端的桥一时不通：过一秒再接（同 Agent 链接）。
        console.warn("[import-link] desktop bridge unavailable", error);
        dispose?.();
        if (unlisten === dispose) unlisten = null;
        if (!disposed) retryTimer = setTimeout(() => void connect(), 1_000);
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unlisten?.();
    };
  }, [receive]);

  const close = useCallback(() => setReceived(null), []);
  if (received === null) return null;
  return (
    <ImportLinkDialog
      key={received.seq}
      serverId={received.serverId}
      link={received.link}
      onClose={close}
    />
  );
}
