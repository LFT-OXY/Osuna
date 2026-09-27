import type { DesktopAppUpdateStatus } from "@/desktop/updates/use-desktop-app-updater";
import { i18n } from "@/i18n/i18next";

export type UpdateCalloutBody =
  | { kind: "available"; versionLabel: string | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export type UpdateCalloutActionRole = "changelog" | "install" | "retry" | "download";

export interface UpdateCalloutActionDescriptor {
  role: UpdateCalloutActionRole;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export interface UpdateCalloutDescriptor {
  id: "desktop-update";
  dismissalKey: string;
  priority: number;
  title: string;
  body: UpdateCalloutBody;
  showGiftIcon: boolean;
  variant: "default" | "error";
  actions: UpdateCalloutActionDescriptor[];
  testID: "update-callout";
}

const CALLOUT_STATUSES: ReadonlySet<DesktopAppUpdateStatus> = new Set([
  "available",
  "installing",
  "error",
  "install-failed",
]);

export interface ResolveUpdateCalloutInput {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  isInstalling: boolean;
  availableUpdate: { latestVersion?: string | null } | null;
  errorMessage: string | null;
}

function formatVersionLabel(latestVersion: string | null | undefined): string | null {
  if (!latestVersion) return null;
  return `v${latestVersion.replace(/^v/i, "")}`;
}

function resolveCalloutActions(input: {
  isInstallFailed: boolean;
  isError: boolean;
  isInstalling: boolean;
}): UpdateCalloutActionDescriptor[] {
  if (input.isInstallFailed) {
    return [
      { role: "install", label: i18n.t("common.actions.retry") },
      { role: "download", label: i18n.t("desktop.updates.manualDownload"), variant: "primary" },
    ];
  }
  const changelog: UpdateCalloutActionDescriptor = {
    role: "changelog",
    label: i18n.t("desktop.updates.callout.whatsNew"),
  };
  if (input.isError) {
    return [
      changelog,
      { role: "retry", label: i18n.t("common.actions.retry"), variant: "primary" },
    ];
  }
  return [
    changelog,
    {
      role: "install",
      label: input.isInstalling
        ? i18n.t("desktop.updates.callout.installingAction")
        : i18n.t("desktop.updates.callout.installAndRestart"),
      variant: "primary",
      disabled: input.isInstalling,
    },
  ];
}

export function resolveUpdateCalloutDescriptor(
  input: ResolveUpdateCalloutInput,
): UpdateCalloutDescriptor | null {
  if (!input.isDesktopApp) return null;
  if (!CALLOUT_STATUSES.has(input.status)) {
    return null;
  }

  const isInstallFailed = input.status === "install-failed";
  const isError = input.status === "error" || isInstallFailed;
  const isInstalling = input.isInstalling;
  const isAvailable = !isInstalling && !isError;

  const latestVersion = input.availableUpdate?.latestVersion ?? null;
  const dismissalKey = `desktop-update:${input.status}:${latestVersion ?? "unknown"}`;

  let title: string;
  let body: UpdateCalloutBody;
  if (isInstalling) {
    title = i18n.t("desktop.updates.callout.installingTitle");
    body = { kind: "installing" };
  } else if (isError) {
    title = i18n.t("desktop.updates.callout.failedTitle");
    body = {
      kind: "error",
      message: input.errorMessage ?? i18n.t("desktop.updates.callout.genericError"),
    };
  } else {
    title = i18n.t("desktop.updates.callout.availableTitle");
    body = { kind: "available", versionLabel: formatVersionLabel(latestVersion) };
  }

  const actions = resolveCalloutActions({ isInstallFailed, isError, isInstalling });

  return {
    id: "desktop-update",
    dismissalKey,
    priority: 200,
    title,
    body,
    showGiftIcon: isAvailable,
    variant: isError ? "error" : "default",
    actions,
    testID: "update-callout",
  };
}
