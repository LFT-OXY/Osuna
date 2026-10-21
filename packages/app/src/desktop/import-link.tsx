import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePathname } from "expo-router";
import { isApiEndpointImportLink } from "@getpaseo/protocol/api-endpoint/import-link";
import { ImportLinkDialog } from "@/api-endpoints/import-link-dialog";
import { importLinkServerId } from "@/api-endpoints/internal/import-link";
import { DesktopBridgeUnavailableError, listenToDesktopEvent } from "@/desktop/electron/events";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
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
  const { t } = useTranslation();
  const reportError = useDesktopIpcErrorReporter();
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
    // 桥一时不通（冷启动时主进程还没装好 IPC）：过一秒再接，同 Agent 链接。
    const retryLater = (error: DesktopBridgeUnavailableError) => {
      console.warn("[import-link] desktop bridge unavailable", error.message);
      if (!disposed) retryTimer = setTimeout(() => void start(), 1_000);
    };
    const connect = async (): Promise<void> => {
      let dispose: () => void;
      try {
        dispose = await listenToDesktopEvent<unknown>("import-link", receive);
      } catch (error) {
        if (!(error instanceof DesktopBridgeUnavailableError)) throw error;
        retryLater(error);
        return;
      }
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
      let pending: string | null;
      try {
        pending = await ready();
      } catch (cause) {
        // ready 只是一次 IPC：它抛的 Error 就是桥不通；别的照常抛出。
        if (!(cause instanceof Error)) throw cause;
        dispose();
        unlisten = null;
        retryLater(
          new DesktopBridgeUnavailableError("Import link inbox is unavailable.", { cause }),
        );
        return;
      }
      if (!disposed && pending) receive(pending);
    };
    // 别的错（如 receive 里的）不重试，交给桌面端的错误报告。
    const start = () =>
      connect().catch((error: unknown) =>
        reportError({
          logLabel: "[import-link] Failed to receive an import link",
          message: t("settings.apiEndpoints.importLink.receiveFailed"),
          error,
        }),
      );
    void start();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unlisten?.();
    };
  }, [receive, reportError, t]);

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
