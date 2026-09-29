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
    errorMessage: null,
    isHidden: false,
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
      "install-failed",
      "error",
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

  it("shows a dismissible downloading stage without actions", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input({ status: "downloading" }));

    expect(descriptor).toMatchObject({
      title: "Downloading update",
      body: { kind: "downloading" },
      showGiftIcon: false,
      variant: "default",
      actions: [],
      dismissible: true,
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

  it("shows a retry action and surfaces the error message on error", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "error", errorMessage: "Download failed" }),
    );

    expect(descriptor).toMatchObject({
      title: "Update failed",
      body: { kind: "error", message: "Download failed" },
      variant: "error",
      showGiftIcon: false,
      actions: [
        { role: "changelog", label: "What's new" },
        { role: "retry", label: "Retry", variant: "primary" },
      ],
      dismissible: true,
    });
  });

  it("offers a manual download from Releases when installing failed", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "install-failed", errorMessage: "Code signature did not pass validation" }),
    );

    expect(descriptor).toMatchObject({
      title: "Update failed",
      body: { kind: "error", message: "Code signature did not pass validation" },
      variant: "error",
      showGiftIcon: false,
      actions: [
        { role: "install", label: "Retry" },
        { role: "manualDownload", label: "Download from Releases", variant: "primary" },
      ],
      dismissible: true,
    });
  });

  it("falls back to a generic error message when none is provided", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "error", errorMessage: null }),
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
