import { useCallback, useSyncExternalStore } from "react";
import {
  formatVersionWithPrefix,
  type DesktopAppUpdateCheckResult,
  type DesktopAppUpdateCheckIntent,
  type DesktopAppUpdateInstallResult,
  type DesktopAppUpdateState,
} from "@/desktop/updates/desktop-updates";
import {
  formatStatusText,
  type DesktopAppUpdateStatus,
} from "@/desktop/updates/desktop-app-updater";
import { useSharedDesktopAppUpdater } from "@/desktop/updates/desktop-app-updater-provider";
import { formatMessageTimestamp } from "@/utils/time";

export type { DesktopAppUpdateStatus };

export interface UseDesktopAppUpdaterReturn {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  statusText: string;
  targetVersion: string | null;
  installsOnQuit: boolean;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  isHidden: boolean;
  checkForUpdates: (options?: {
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }) => Promise<DesktopAppUpdateCheckResult | null>;
  downloadUpdate: () => Promise<DesktopAppUpdateState | null>;
  installUpdate: () => Promise<DesktopAppUpdateInstallResult | null>;
  hide: () => void;
}

export function useDesktopAppUpdater(): UseDesktopAppUpdaterReturn {
  const { updater, releaseChannel, isDesktopApp } = useSharedDesktopAppUpdater();

  const snapshot = useSyncExternalStore(
    updater.subscribe,
    updater.getSnapshot,
    updater.getSnapshot,
  );

  const checkForUpdates = useCallback(
    async (options: { intent?: DesktopAppUpdateCheckIntent; silent?: boolean } = {}) => {
      if (!isDesktopApp) {
        return null;
      }
      return updater.checkForUpdates({
        releaseChannel,
        intent: options.intent ?? "manual",
        silent: options.silent,
      });
    },
    [isDesktopApp, releaseChannel, updater],
  );

  const downloadUpdate = useCallback(async () => {
    if (!isDesktopApp) {
      return null;
    }
    return updater.downloadUpdate();
  }, [isDesktopApp, updater]);

  const installUpdate = useCallback(async () => {
    if (!isDesktopApp) {
      return null;
    }
    return updater.installUpdate();
  }, [isDesktopApp, updater]);

  return {
    isDesktopApp,
    status: snapshot.status,
    statusText: formatStatusText({
      status: snapshot.status,
      targetVersion: snapshot.targetVersion,
      lastCheckedAt: snapshot.lastCheckedAt,
      formatVersion: formatVersionWithPrefix,
      formatLastCheckedAt: (timestamp) => formatMessageTimestamp(new Date(timestamp)),
    }),
    targetVersion: snapshot.targetVersion,
    installsOnQuit: snapshot.installsOnQuit,
    errorMessage: snapshot.errorMessage,
    lastCheckedAt: snapshot.lastCheckedAt,
    isHidden: snapshot.isHidden,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    hide: updater.hide,
  };
}
