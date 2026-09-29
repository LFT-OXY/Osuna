import { useCallback, useSyncExternalStore } from "react";
import {
  formatVersionWithPrefix,
  type DesktopAppUpdateCheckResult,
  type DesktopAppUpdateDownloadProgress,
  type DesktopAppUpdateInstallResult,
  type DesktopAppUpdateState,
} from "@/desktop/updates/desktop-updates";
import {
  formatStatusText,
  type DesktopAppUpdateCheckOptions,
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
  downloadProgress: DesktopAppUpdateDownloadProgress | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  isHidden: boolean;
  isCancellingDownload: boolean;
  checkForUpdates: (
    options?: DesktopAppUpdateCheckOptions,
  ) => Promise<DesktopAppUpdateCheckResult | null>;
  downloadUpdate: () => Promise<DesktopAppUpdateState | null>;
  cancelDownload: () => Promise<DesktopAppUpdateState | null>;
  installUpdate: () => Promise<DesktopAppUpdateInstallResult | null>;
  retry: () => Promise<void>;
  hide: () => void;
}

export function useDesktopAppUpdater(): UseDesktopAppUpdaterReturn {
  const { updater, isDesktopApp } = useSharedDesktopAppUpdater();

  const snapshot = useSyncExternalStore(
    updater.subscribe,
    updater.getSnapshot,
    updater.getSnapshot,
  );

  const checkForUpdates = useCallback(
    async (options: DesktopAppUpdateCheckOptions = {}) => {
      if (!isDesktopApp) {
        return null;
      }
      return updater.checkForUpdates(options);
    },
    [isDesktopApp, updater],
  );

  const downloadUpdate = useCallback(async () => {
    if (!isDesktopApp) {
      return null;
    }
    return updater.downloadUpdate();
  }, [isDesktopApp, updater]);

  const cancelDownload = useCallback(async () => {
    if (!isDesktopApp) {
      return null;
    }
    return updater.cancelDownload();
  }, [isDesktopApp, updater]);

  const installUpdate = useCallback(async () => {
    if (!isDesktopApp) {
      return null;
    }
    return updater.installUpdate();
  }, [isDesktopApp, updater]);

  const retry = useCallback(async () => {
    if (!isDesktopApp) {
      return;
    }
    await updater.retry();
  }, [isDesktopApp, updater]);

  return {
    isDesktopApp,
    status: snapshot.status,
    statusText: formatStatusText({
      status: snapshot.status,
      targetVersion: snapshot.targetVersion,
      lastCheckedAt: snapshot.lastCheckedAt,
      downloadProgress: snapshot.downloadProgress,
      formatVersion: formatVersionWithPrefix,
      formatLastCheckedAt: (timestamp) => formatMessageTimestamp(new Date(timestamp)),
    }),
    targetVersion: snapshot.targetVersion,
    installsOnQuit: snapshot.installsOnQuit,
    downloadProgress: snapshot.downloadProgress,
    errorMessage: snapshot.errorMessage,
    lastCheckedAt: snapshot.lastCheckedAt,
    isHidden: snapshot.isHidden,
    isCancellingDownload: snapshot.isCancellingDownload,
    checkForUpdates,
    downloadUpdate,
    cancelDownload,
    installUpdate,
    retry,
    hide: updater.hide,
  };
}
