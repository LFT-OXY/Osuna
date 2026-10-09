import { describe, expect, it } from "vitest";
import {
  AndroidIcon,
  AppleIcon,
  downloadUrls,
  getDesktopDownload,
  getMobileDownload,
  GlobeIcon,
  LinuxIcon,
} from "./downloads";
import type { ReleaseInfo } from "./latest-release";

const RELEASE: ReleaseInfo = {
  version: "1.0.0",
  linuxAppImageAsset: "Osuna-x86_64.AppImage",
  windowsX64Asset: "Osuna-Setup-1.0.0-x64.exe",
  windowsArm64Asset: "Osuna-Setup-1.0.0-arm64.exe",
  androidApkAsset: "osuna-v1.0.0-android.apk",
};

const RELEASE_DOWNLOAD_BASE = "https://github.com/LFT-OXY/Osuna/releases/download/v1.0.0/";

describe("downloadUrls", () => {
  it("points every installer at the LFT-OXY/Osuna GitHub release", () => {
    expect(downloadUrls(RELEASE)).toEqual({
      macAppleSilicon: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-arm64.dmg`,
      macIntel: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-x64.dmg`,
      linux: {
        appImage: `${RELEASE_DOWNLOAD_BASE}Osuna-x86_64.AppImage`,
        deb: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-amd64.deb`,
        rpm: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-x86_64.rpm`,
      },
      windowsExeX64: `${RELEASE_DOWNLOAD_BASE}Osuna-Setup-1.0.0-x64.exe`,
      windowsExeArm64: `${RELEASE_DOWNLOAD_BASE}Osuna-Setup-1.0.0-arm64.exe`,
      androidApk: `${RELEASE_DOWNLOAD_BASE}osuna-v1.0.0-android.apk`,
    });
  });
});

describe("the primary download for a desktop visitor", () => {
  it("is the installer for their platform, opened in a new tab", () => {
    expect(getDesktopDownload(RELEASE, "mac")).toEqual({
      label: "下载 Mac 版",
      href: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-arm64.dmg`,
      icon: AppleIcon,
      external: true,
    });
  });
});

describe("a release without a Linux build", () => {
  const release: ReleaseInfo = { ...RELEASE, linuxAppImageAsset: null };

  it("offers no Linux installers", () => {
    expect(downloadUrls(release).linux).toBeNull();
  });

  it("sends Linux visitors to the download page instead of a missing installer", () => {
    expect(getDesktopDownload(release, "linux")).toEqual({
      label: "查看下载方式",
      href: "/download",
      icon: LinuxIcon,
      external: false,
    });
  });
});

describe("a release without an Android APK", () => {
  const release: ReleaseInfo = { ...RELEASE, androidApkAsset: null };

  it("offers no APK", () => {
    expect(downloadUrls(release).androidApk).toBeNull();
  });

  it("sends Android visitors to the download page instead of a missing APK", () => {
    expect(getMobileDownload(release, "android")).toEqual({
      label: "查看下载方式",
      href: "/download",
      icon: AndroidIcon,
      external: false,
    });
  });
});

describe("getMobileDownload", () => {
  it("hands Android visitors the release APK", () => {
    expect(getMobileDownload(RELEASE, "android")).toEqual({
      label: "下载安卓 APK",
      href: `${RELEASE_DOWNLOAD_BASE}osuna-v1.0.0-android.apk`,
      icon: AndroidIcon,
      external: true,
    });
  });

  it("sends iPhone visitors to the web app, since there is no iOS build", () => {
    expect(getMobileDownload(RELEASE, "ios")).toEqual({
      label: "打开网页端",
      href: "https://osuna-app.chinhae.cc",
      icon: GlobeIcon,
      external: true,
    });
  });
});
