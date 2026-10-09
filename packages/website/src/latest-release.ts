import { getBlockingColdCache, type WebsiteCacheContext } from "./github-cache";

interface GitHubAsset {
  name: string;
}

export interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
  prerelease: boolean;
  draft: boolean;
}

export interface ReleaseInfo {
  version: string;
  /** Null when the release ships no Linux build. */
  linuxAppImageAsset: string | null;
  windowsX64Asset: string | null;
  windowsArm64Asset: string | null;
  /** Null until the Android APK Release workflow has attached the APK. */
  androidApkAsset: string | null;
}

export interface ReleaseChannels {
  stable: ReleaseInfo;
  /** The newest prerelease, or null when stable has caught up with it. */
  beta: ReleaseInfo | null;
}

const LINUX_APPIMAGE_ASSET_PATTERN =
  /^Osuna-(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)-)?x86_64\.AppImage$/;

// Linux 包不在必需之列：发布流程目前只出 macOS 与 Windows（docs/release.md「加回 Linux」）。
const REQUIRED_ASSET_PATTERNS = [/Osuna-.*-arm64\.dmg$/, /Osuna-Setup-.*\.exe$/];

const GITHUB_RELEASES_URL = "https://api.github.com/repos/LFT-OXY/Osuna/releases?per_page=10";
const RELEASE_CACHE_KEY = "github-release:v3";

function hasRequiredAssets(release: GitHubRelease): boolean {
  return REQUIRED_ASSET_PATTERNS.every((pattern) =>
    release.assets.some((asset) => pattern.test(asset.name)),
  );
}

function pickWindowsAssets(assets: GitHubAsset[]) {
  const x64Suffixed = assets.find((asset) => /Osuna-Setup-.*-x64\.exe$/.test(asset.name));
  const arm64 = assets.find((asset) => /Osuna-Setup-.*-arm64\.exe$/.test(asset.name));
  const legacy = assets.find(
    (asset) =>
      /Osuna-Setup-.*\.exe$/.test(asset.name) &&
      !asset.name.endsWith("-x64.exe") &&
      !asset.name.endsWith("-arm64.exe"),
  );
  return {
    x64: (x64Suffixed ?? legacy)?.name ?? null,
    arm64: arm64?.name ?? null,
  };
}

function pickLinuxAppImageAsset(assets: GitHubAsset[]) {
  return assets.find((asset) => LINUX_APPIMAGE_ASSET_PATTERN.test(asset.name))?.name ?? null;
}

// APK 由单独触发的工作流事后挂到 Release 上，桌面包发布时它还不在。
function pickAndroidApkAsset(release: GitHubRelease) {
  const apkName = `osuna-${release.tag_name}-android.apk`;
  return release.assets.find((asset) => asset.name === apkName)?.name ?? null;
}

function versionFromTag(tag: string): string {
  return tag.replace(/^v/, "");
}

async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "osuna-website",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 60,
      cacheKey: "github-releases-latest",
    },
  } as RequestInit);
  if (!response.ok) throw new Error(`github releases ${response.status}`);

  return (await response.json()) as GitHubRelease[];
}

function toReleaseInfo(release: GitHubRelease): ReleaseInfo | null {
  if (release.draft || !hasRequiredAssets(release)) return null;

  const windowsAssets = pickWindowsAssets(release.assets);
  return {
    version: versionFromTag(release.tag_name),
    linuxAppImageAsset: pickLinuxAppImageAsset(release.assets),
    windowsX64Asset: windowsAssets.x64,
    windowsArm64Asset: windowsAssets.arm64,
    androidApkAsset: pickAndroidApkAsset(release),
  };
}

function coreVersion(version: string): number[] {
  return version.split("-")[0].split(".").map(Number);
}

/**
 * A beta is only worth offering while its core version is ahead of stable.
 * Promotion ships the same core as a stable release, which retires the beta
 * channel until the next beta line opens.
 */
function leadsStable(betaVersion: string, stableVersion: string): boolean {
  const beta = coreVersion(betaVersion);
  const stable = coreVersion(stableVersion);
  for (let index = 0; index < Math.max(beta.length, stable.length); index++) {
    const betaPart = beta[index] ?? 0;
    const stablePart = stable[index] ?? 0;
    if (betaPart !== stablePart) return betaPart > stablePart;
  }
  return false;
}

export function selectReleaseChannels(releases: GitHubRelease[]): ReleaseChannels {
  const stable = releases
    .filter((release) => !release.prerelease)
    .map(toReleaseInfo)
    .find((release) => release !== null);
  if (!stable) throw new Error("no ready GitHub release found");

  const beta = releases
    .filter((release) => release.prerelease)
    .map(toReleaseInfo)
    .find((release) => release !== null);

  return { stable, beta: beta && leadsStable(beta.version, stable.version) ? beta : null };
}

async function fetchReleaseChannels(): Promise<ReleaseChannels> {
  return selectReleaseChannels(await fetchGitHubReleases());
}

function isReleaseInfo(value: unknown): value is ReleaseInfo {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(record.version) &&
    (record.linuxAppImageAsset === null ||
      record.linuxAppImageAsset === "Osuna-x86_64.AppImage" ||
      (typeof record.linuxAppImageAsset === "string" &&
        new RegExp(`^Osuna-${record.version.replaceAll(".", "\\.")}-x86_64\\.AppImage$`).test(
          record.linuxAppImageAsset,
        ))) &&
    (typeof record.windowsX64Asset === "string" || record.windowsX64Asset === null) &&
    (typeof record.windowsArm64Asset === "string" || record.windowsArm64Asset === null) &&
    (record.windowsX64Asset === null ||
      new RegExp(`^Osuna-Setup-${record.version.replaceAll(".", "\\.")}(?:-x64)?\\.exe$`).test(
        record.windowsX64Asset,
      )) &&
    (record.windowsArm64Asset === null ||
      new RegExp(`^Osuna-Setup-${record.version.replaceAll(".", "\\.")}-arm64\\.exe$`).test(
        record.windowsArm64Asset,
      )) &&
    (record.androidApkAsset === null ||
      record.androidApkAsset === `osuna-v${record.version}-android.apk`)
  );
}

function isReleaseChannels(value: unknown): value is ReleaseChannels {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isReleaseInfo(record.stable) && (record.beta === null || isReleaseInfo(record.beta));
}

export async function getReleaseChannels(context: WebsiteCacheContext): Promise<ReleaseChannels> {
  return getBlockingColdCache({
    context,
    key: RELEASE_CACHE_KEY,
    isValue: isReleaseChannels,
    fetchFresh: fetchReleaseChannels,
  });
}
