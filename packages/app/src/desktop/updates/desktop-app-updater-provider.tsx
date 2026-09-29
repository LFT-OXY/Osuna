import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import {
  createDesktopAppUpdater,
  startAutomaticUpdateChecks,
  systemIntervalTimer,
  type DesktopAppUpdater,
} from "@/desktop/updates/desktop-app-updater";
import {
  checkDesktopAppUpdate,
  installDesktopAppUpdate,
  shouldShowDesktopUpdateSection,
  type DesktopReleaseChannel,
} from "@/desktop/updates/desktop-updates";
import { useStableEvent } from "@/hooks/use-stable-event";

interface SharedDesktopAppUpdater {
  updater: DesktopAppUpdater;
  releaseChannel: DesktopReleaseChannel;
  isDesktopApp: boolean;
}

const DesktopAppUpdaterContext = createContext<SharedDesktopAppUpdater | null>(null);

// 每个窗口只有这一份更新状态机，侧栏卡片和设置 → 关于共用它。
export function DesktopAppUpdaterProvider({ children }: { children: ReactNode }) {
  const isDesktopApp = shouldShowDesktopUpdateSection();
  const { settings, isLoading } = useDesktopSettings();
  const releaseChannel = settings.releaseChannel;
  const reportInstallError = useStableEvent(useDesktopIpcErrorReporter());
  const [updater] = useState(() =>
    createDesktopAppUpdater({
      port: { checkDesktopAppUpdate, installDesktopAppUpdate },
      now: () => Date.now(),
      reportInstallError,
    }),
  );

  // 等设置加载完再检查，避免先用默认通道检查一次、再用真实通道检查一次。
  useEffect(() => {
    if (!isDesktopApp || isLoading) {
      return undefined;
    }
    return startAutomaticUpdateChecks({ updater, releaseChannel, timer: systemIntervalTimer });
  }, [isDesktopApp, isLoading, releaseChannel, updater]);

  const shared = useMemo(
    () => ({ updater, releaseChannel, isDesktopApp }),
    [isDesktopApp, releaseChannel, updater],
  );

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
