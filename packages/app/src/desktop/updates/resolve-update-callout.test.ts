import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  resolveUpdateCalloutDescriptor,
  type ResolveUpdateCalloutInput,
} from "./resolve-update-callout";

function input(overrides: Partial<ResolveUpdateCalloutInput> = {}): ResolveUpdateCalloutInput {
  return {
    isDesktopApp: true,
    status: "available",
    targetVersion: "1.2.3",
    installsOnQuit: true,
    downloadProgress: null,
    errorMessage: null,
    isHidden: false,
    isCancellingDownload: false,
    ...overrides,
  };
}

describe("resolveUpdateCalloutDescriptor", () => {
  it("returns null when not running as a desktop app", () => {
    expect(resolveUpdateCalloutDescriptor(input({ isDesktopApp: false }))).toBeNull();
  });

  it("returns null for idle / checking / up-to-date statuses", () => {
    for (const status of ["idle", "checking", "up-to-date"] as const) {
      expect(resolveUpdateCalloutDescriptor(input({ status }))).toBeNull();
    }
  });

  it("returns null while hidden for this run, in every dismissible stage", () => {
    for (const status of [
      "available",
      "downloading",
      "downloaded",
      "check-failed",
      "download-failed",
      "cancel-failed",
      "install-failed",
    ] as const) {
      expect(resolveUpdateCalloutDescriptor(input({ status, isHidden: true }))).toBeNull();
    }
  });

  it("still shows the installing stage after the user hid the card", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "installing", isHidden: true }),
    );

    expect(descriptor).toMatchObject({ title: "Installing update", dismissible: false });
  });

  it("offers Later / Update when an update is found", () => {
    expect(resolveUpdateCalloutDescriptor(input())).toEqual({
      id: "desktop-update",
      priority: 200,
      title: "Update available",
      body: { kind: "available", versionLabel: "v1.2.3" },
      showGiftIcon: true,
      variant: "default",
      actions: [
        { role: "later", label: "Later" },
        { role: "update", label: "Update", variant: "primary" },
      ],
      dismissible: true,
      testID: "update-callout",
    });
  });

  it("normalizes a leading v in the target version", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input({ targetVersion: "v2.0.0" }));
    expect(descriptor?.body).toEqual({ kind: "available", versionLabel: "v2.0.0" });
  });

  it("omits the version label when no target version is known", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input({ targetVersion: null }));
    expect(descriptor?.body).toEqual({ kind: "available", versionLabel: null });
  });

  it("offers Cancel while downloading and stays dismissible", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input({ status: "downloading" }));

    expect(descriptor).toMatchObject({
      title: "Downloading update",
      body: { kind: "downloading", progress: null },
      showGiftIcon: false,
      variant: "default",
      actions: [{ role: "cancel", label: "Cancel" }],
      dismissible: true,
    });
    expect(descriptor?.actions[0]?.variant).toBeUndefined();
  });

  it("disables Cancel and says it is cancelling while the cancel is in flight", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "downloading", isCancellingDownload: true }),
    );

    expect(descriptor?.actions).toEqual([
      { role: "cancel", label: "Cancelling...", disabled: true },
    ]);
  });

  it("shows the percent, downloaded / total size and speed in MB once progress arrives", () => {
    const MB = 1024 * 1024;
    const descriptor = resolveUpdateCalloutDescriptor(
      input({
        status: "downloading",
        downloadProgress: {
          percent: 42,
          transferred: 41.4 * MB,
          total: 98.6 * MB,
          bytesPerSecond: 3.2 * MB,
        },
      }),
    );

    expect(descriptor?.body).toEqual({
      kind: "downloading",
      progress: { fraction: 0.42, percent: 42, label: "42% · 41.4 / 98.6 MB · 3.2 MB/s" },
    });
  });

  it("does not round the percent up to 100% before the download finishes", () => {
    const MB = 1024 * 1024;
    const descriptor = resolveUpdateCalloutDescriptor(
      input({
        status: "downloading",
        downloadProgress: {
          percent: 99.7,
          transferred: 99.7 * MB,
          total: 100 * MB,
          bytesPerSecond: 0,
        },
      }),
    );

    expect(descriptor?.body).toEqual({
      kind: "downloading",
      progress: { fraction: 0.997, percent: 99, label: "99% · 99.7 / 100.0 MB · 0.0 MB/s" },
    });
  });

  it("offers Later / Install once downloaded and says it installs on quit", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input({ status: "downloaded" }));

    expect(descriptor).toMatchObject({
      title: "Update downloaded",
      body: { kind: "downloaded", versionLabel: "v1.2.3", installsOnQuit: true },
      showGiftIcon: true,
      variant: "default",
      actions: [
        { role: "later", label: "Later" },
        { role: "install", label: "Install", variant: "primary" },
      ],
      dismissible: true,
    });
  });

  it("does not promise an install on quit where the platform skips it", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "downloaded", installsOnQuit: false }),
    );

    expect(descriptor?.body).toEqual({
      kind: "downloaded",
      versionLabel: "v1.2.3",
      installsOnQuit: false,
    });
  });

  it("cannot be dismissed while installing and disables the install action", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input({ status: "installing" }));

    expect(descriptor).toMatchObject({
      title: "Installing update",
      body: { kind: "installing" },
      showGiftIcon: false,
      variant: "default",
      actions: [{ role: "install", label: "Installing...", variant: "primary", disabled: true }],
      dismissible: false,
    });
  });

  it("offers Retry / Download from Releases and surfaces the error message once failed", () => {
    for (const status of ["check-failed", "download-failed", "install-failed"] as const) {
      const descriptor = resolveUpdateCalloutDescriptor(
        input({ status, errorMessage: "sha512 checksum mismatch" }),
      );

      expect(descriptor).toMatchObject({
        title: "Update failed",
        body: { kind: "error", message: "sha512 checksum mismatch" },
        variant: "error",
        showGiftIcon: false,
        actions: [
          { role: "retry", label: "Retry" },
          { role: "manualDownload", label: "Download from Releases", variant: "primary" },
        ],
        dismissible: true,
      });
    }
  });

  it("offers only Retry when cancelling failed, since the download keeps going", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "cancel-failed", errorMessage: "ipc closed" }),
    );

    expect(descriptor).toMatchObject({
      title: "Update failed",
      body: { kind: "error", message: "ipc closed" },
      variant: "error",
      actions: [{ role: "retry", label: "Retry", variant: "primary" }],
      dismissible: true,
    });
  });

  it("falls back to a generic error message when none is provided", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "download-failed", errorMessage: null }),
    );
    expect(descriptor?.body).toEqual({ kind: "error", message: "Something went wrong." });
  });

  it("uses the active app language for local callout chrome", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      const available = resolveUpdateCalloutDescriptor(input());
      expect(available?.title).toBe("有可用更新");
      expect(available?.actions).toEqual([
        { role: "later", label: "稍后" },
        { role: "update", label: "更新", variant: "primary" },
      ]);

      const downloaded = resolveUpdateCalloutDescriptor(input({ status: "downloaded" }));
      expect(downloaded?.title).toBe("更新已下载");
      expect(downloaded?.actions).toEqual([
        { role: "later", label: "稍后" },
        { role: "install", label: "安装", variant: "primary" },
      ]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
