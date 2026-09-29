import type { DesktopAppUpdateDownloadProgress } from "@/desktop/updates/desktop-updates";
import {
  offersManualDownload,
  toWholeDownloadPercent,
} from "@/desktop/updates/desktop-app-updater";
import type { DesktopAppUpdateStatus } from "@/desktop/updates/use-desktop-app-updater";
import { i18n } from "@/i18n/i18next";

// fraction 是 0–1，给进度条用；label 形如「42% · 41.4 / 98.6 MB · 3.2 MB/s」。
export interface UpdateCalloutProgress {
  fraction: number;
  percent: number;
  label: string;
}

export type UpdateCalloutBody =
  | { kind: "available"; versionLabel: string | null }
  | { kind: "downloading"; progress: UpdateCalloutProgress | null }
  | { kind: "downloaded"; versionLabel: string | null; installsOnQuit: boolean }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export type UpdateCalloutActionRole =
  | "later"
  | "update"
  | "cancel"
  | "install"
  | "retry"
  | "manualDownload";

export interface UpdateCalloutActionDescriptor {
  role: UpdateCalloutActionRole;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export interface UpdateCalloutDescriptor {
  id: "desktop-update";
  priority: number;
  title: string;
  body: UpdateCalloutBody;
  showGiftIcon: boolean;
  variant: "default" | "error";
  actions: UpdateCalloutActionDescriptor[];
  dismissible: boolean;
  testID: "update-callout";
}

export interface ResolveUpdateCalloutInput {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  targetVersion: string | null;
  installsOnQuit: boolean;
  downloadProgress: DesktopAppUpdateDownloadProgress | null;
  errorMessage: string | null;
  isHidden: boolean;
  isCancellingDownload: boolean;
}

type UpdateCalloutContent = Pick<
  UpdateCalloutDescriptor,
  "title" | "body" | "showGiftIcon" | "variant" | "actions" | "dismissible"
>;

function formatVersionLabel(version: string | null): string | null {
  if (!version) return null;
  return `v${version.replace(/^v/i, "")}`;
}

const BYTES_PER_MB = 1024 * 1024;

function formatMegabytes(bytes: number): string {
  return (bytes / BYTES_PER_MB).toFixed(1);
}

function resolveProgress(
  progress: DesktopAppUpdateDownloadProgress | null,
): UpdateCalloutProgress | null {
  if (!progress) return null;
  const fraction = Math.min(Math.max(progress.percent / 100, 0), 1);
  const percent = toWholeDownloadPercent(progress);
  const label = i18n.t("desktop.updates.callout.downloadProgress", {
    percent,
    transferred: formatMegabytes(progress.transferred),
    total: formatMegabytes(progress.total),
    speed: formatMegabytes(progress.bytesPerSecond),
  });
  return { fraction, percent, label };
}

function laterAction(): UpdateCalloutActionDescriptor {
  return { role: "later", label: i18n.t("desktop.updates.callout.later") };
}

function cancelDownloadAction({
  isCancelling,
}: {
  isCancelling: boolean;
}): UpdateCalloutActionDescriptor {
  if (isCancelling) {
    return {
      role: "cancel",
      label: i18n.t("desktop.updates.callout.cancellingAction"),
      disabled: true,
    };
  }
  return { role: "cancel", label: i18n.t("common.actions.cancel") };
}

function failureActions(status: DesktopAppUpdateStatus): UpdateCalloutActionDescriptor[] {
  const retry = { role: "retry", label: i18n.t("common.actions.retry") } as const;
  if (!offersManualDownload(status)) {
    return [{ ...retry, variant: "primary" }];
  }
  return [
    retry,
    { role: "manualDownload", label: i18n.t("desktop.updates.manualDownload"), variant: "primary" },
  ];
}

function resolveContent(input: ResolveUpdateCalloutInput): UpdateCalloutContent | null {
  const versionLabel = formatVersionLabel(input.targetVersion);
  const errorBody: UpdateCalloutBody = {
    kind: "error",
    message: input.errorMessage ?? i18n.t("desktop.updates.callout.genericError"),
  };

  switch (input.status) {
    case "available":
      return {
        title: i18n.t("desktop.updates.callout.availableTitle"),
        body: { kind: "available", versionLabel },
        showGiftIcon: true,
        variant: "default",
        actions: [
          laterAction(),
          { role: "update", label: i18n.t("desktop.updates.callout.update"), variant: "primary" },
        ],
        dismissible: true,
      };
    case "downloading":
      return {
        title: i18n.t("desktop.updates.callout.downloadingTitle"),
        body: { kind: "downloading", progress: resolveProgress(input.downloadProgress) },
        showGiftIcon: false,
        variant: "default",
        actions: [cancelDownloadAction({ isCancelling: input.isCancellingDownload })],
        dismissible: true,
      };
    case "downloaded":
      return {
        title: i18n.t("desktop.updates.callout.downloadedTitle"),
        body: { kind: "downloaded", versionLabel, installsOnQuit: input.installsOnQuit },
        showGiftIcon: true,
        variant: "default",
        actions: [
          laterAction(),
          { role: "install", label: i18n.t("desktop.updates.callout.install"), variant: "primary" },
        ],
        dismissible: true,
      };
    case "installing":
      return {
        title: i18n.t("desktop.updates.callout.installingTitle"),
        body: { kind: "installing" },
        showGiftIcon: false,
        variant: "default",
        actions: [
          {
            role: "install",
            label: i18n.t("desktop.updates.callout.installingAction"),
            variant: "primary",
            disabled: true,
          },
        ],
        dismissible: false,
      };
    case "check-failed":
    case "download-failed":
    case "cancel-failed":
    case "install-failed":
      return {
        title: i18n.t("desktop.updates.callout.failedTitle"),
        body: errorBody,
        showGiftIcon: false,
        variant: "error",
        actions: failureActions(input.status),
        dismissible: true,
      };
    case "idle":
    case "checking":
    case "up-to-date":
      return null;
  }
}

export function resolveUpdateCalloutDescriptor(
  input: ResolveUpdateCalloutInput,
): UpdateCalloutDescriptor | null {
  if (!input.isDesktopApp) return null;

  const content = resolveContent(input);
  if (!content) return null;
  // 安装中不可关闭：即使之前点过「稍后」，从设置页发起的安装也要在卡片上看得到。
  const isHiddenByUser = input.isHidden && content.dismissible;
  if (isHiddenByUser) return null;

  return {
    id: "desktop-update",
    priority: 200,
    ...content,
    testID: "update-callout",
  };
}
