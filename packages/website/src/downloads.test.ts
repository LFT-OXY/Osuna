import { describe, expect, it } from "vitest";
import {
  downloadUrls,
  getDesktopDownload,
  getMobileDownload,
  type ReleaseAssetInfo,
} from "./downloads";

const RELEASE: ReleaseAssetInfo = {
  version: "1.0.0",
  linuxAppImageAsset: "Osuna-x86_64.AppImage",
  windowsX64Asset: "Osuna-Setup-1.0.0-x64.exe",
  windowsArm64Asset: "Osuna-Setup-1.0.0-arm64.exe",
};

const RELEASE_DOWNLOAD_BASE = "https://github.com/LFT-OXY/Osuna/releases/download/v1.0.0/";

describe("downloadUrls", () => {
  it("points every installer at the LFT-OXY/Osuna GitHub release", () => {
    expect(downloadUrls(RELEASE)).toEqual({
      macAppleSilicon: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-arm64.dmg`,
      macIntel: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-x64.dmg`,
      linuxAppImage: `${RELEASE_DOWNLOAD_BASE}Osuna-x86_64.AppImage`,
      linuxDeb: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-amd64.deb`,
      linuxRpm: `${RELEASE_DOWNLOAD_BASE}Osuna-1.0.0-x86_64.rpm`,
      windowsExeX64: `${RELEASE_DOWNLOAD_BASE}Osuna-Setup-1.0.0-x64.exe`,
      windowsExeArm64: `${RELEASE_DOWNLOAD_BASE}Osuna-Setup-1.0.0-arm64.exe`,
      androidApk: `${RELEASE_DOWNLOAD_BASE}osuna-v1.0.0-android.apk`,
    });
  });
});

describe("a release without a Linux build", () => {
  const release: ReleaseAssetInfo = { ...RELEASE, linuxAppImageAsset: null };

  it("offers no Linux installers", () => {
    expect(downloadUrls(release)).toMatchObject({
      linuxAppImage: null,
      linuxDeb: null,
      linuxRpm: null,
    });
  });

  it("sends Linux visitors to the download page instead of a missing installer", () => {
    expect(getDesktopDownload(release, "linux").href).toBe("/download");
  });
});

describe("getMobileDownload", () => {
  it("hands Android visitors the release APK", () => {
    expect(getMobileDownload(RELEASE, "android").href).toBe(
      `${RELEASE_DOWNLOAD_BASE}osuna-v1.0.0-android.apk`,
    );
  });

  it("sends iPhone visitors to the web app, since there is no iOS build", () => {
    expect(getMobileDownload(RELEASE, "ios").href).toBe("https://osuna-app.chinhae.cc");
  });
});
