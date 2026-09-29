import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import {
  createDesktopAppUpdater,
  startAutomaticUpdateChecks,
  systemIntervalTimer,
  type DesktopAppUpdater,
} from "@/desktop/updates/desktop-app-updater";
import {
  cancelDesktopAppUpdateDownload,
  checkDesktopAppUpdate,
  downloadDesktopAppUpdate,
  installDesktopAppUpdate,
  shouldShowDesktopUpdateSection,
  subscribeToDesktopAppUpdateState,
} from "@/desktop/updates/desktop-updates";
import { useStableEvent } from "@/hooks/use-stable-event";

interface SharedDesktopAppUpdater {
  updater: DesktopAppUpdater;
  isDesktopApp: boolean;
}

const DesktopAppUpdaterContext = createContext<SharedDesktopAppUpdater | null>(null);

// 每个窗口只有这一份更新状态机，侧栏卡片和设置 → 关于共用它。
export function DesktopAppUpdaterProvider({ children }: { children: ReactNode }) {
  const isDesktopApp = shouldShowDesktopUpdateSection();
  const reportError = useStableEvent(useDesktopIpcErrorReporter());
  const [updater] = useState(() =>
    createDesktopAppUpdater({
      port: {
        checkDesktopAppUpdate,
        downloadDesktopAppUpdate,
        cancelDesktopAppUpdateDownload,
        installDesktopAppUpdate,
        subscribeToDesktopAppUpdateState,
      },
      now: () => Date.now(),
      reportError,
    }),
  );

  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    return updater.connect();
  }, [isDesktopApp, updater]);

  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    return startAutomaticUpdateChecks({ updater, timer: systemIntervalTimer });
  }, [isDesktopApp, updater]);

  const shared = useMemo(() => ({ updater, isDesktopApp }), [isDesktopApp, updater]);

  return (
    <DesktopAppUpdaterContext.Provider value={shared}>{children}</DesktopAppUpdaterContext.Provider>
  );
}

export function useSharedDesktopAppUpdater(): SharedDesktopAppUpdater {
  const shared = useContext(DesktopAppUpdaterContext);
  if (!shared) {
    throw new Error("useSharedDesktopAppUpdater must be used within DesktopAppUpdaterProvider");
  }
  return shared;
}
