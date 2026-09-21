import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { MACOS_MINIMUM_DARWIN_VERSION } from "./merge-mac-manifest.mjs";

// electron-updater 按平台读取不同的清单文件名：macOS 读 <channel>-mac.yml，
// Linux 读 <channel>-linux.yml，Windows 读没有后缀的 <channel>.yml。
// 按后缀识别平台，这样切换发布渠道（latest / beta）时无需额外传参。
const PLATFORM_MANIFEST_MATCHERS = {
  mac: (name) => name.endsWith("-mac.yml"),
  linux: (name) => name.endsWith("-linux.yml"),
  windows: (name) =>
    name.endsWith(".yml") && !name.endsWith("-mac.yml") && !name.endsWith("-linux.yml"),
};

// 一次发布需要哪些平台的清单到齐，由调用方声明。缺清单的发布如果照常放行，
// 对应平台的客户端会收不到更新，而 Release 只会静默停在草稿状态。
function assertExpectedPlatformsPresent(platforms, paths) {
  const names = paths.map((manifestPath) => path.basename(manifestPath));
  const missing = platforms.filter((platform) => !names.some(PLATFORM_MANIFEST_MATCHERS[platform]));

  if (missing.length > 0) {
    throw new Error(`missing updater manifests for: ${missing.join(", ")}`);
  }
}

export function validateDesktopManifests({ releaseDate, rolloutHours, platforms }, paths) {
  if (!Number.isFinite(rolloutHours) || rolloutHours < 0) {
    throw new Error(`expected non-negative rolloutHours, got ${rolloutHours}`);
  }

  for (const platform of platforms) {
    if (!(platform in PLATFORM_MANIFEST_MATCHERS)) {
      throw new Error(
        `unknown desktop platform "${platform}", expected one of ${Object.keys(PLATFORM_MANIFEST_MATCHERS).join(", ")}`,
      );
    }
  }
  assertExpectedPlatformsPresent(platforms, paths);

  for (const manifestPath of paths) {
    const manifest = load(fs.readFileSync(manifestPath, "utf8")) ?? {};
    if (manifest.rolloutHours !== rolloutHours) {
      throw new Error(
        `${manifestPath}: rolloutHours=${manifest.rolloutHours}, expected ${rolloutHours}`,
      );
    }
    if (manifest.releaseDate !== releaseDate) {
      throw new Error(
        `${manifestPath}: releaseDate=${manifest.releaseDate}, expected ${releaseDate}`,
      );
    }
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      throw new Error(`${manifestPath}: missing or invalid version`);
    }
    if (
      PLATFORM_MANIFEST_MATCHERS.mac(path.basename(manifestPath)) &&
      manifest.minimumSystemVersion !== MACOS_MINIMUM_DARWIN_VERSION
    ) {
      throw new Error(
        `${manifestPath}: minimumSystemVersion=${manifest.minimumSystemVersion}, expected ${MACOS_MINIMUM_DARWIN_VERSION}`,
      );
    }
  }
}

function parseArgs(argv) {
  const paths = [];
  let releaseDate;
  let rolloutHours;
  let platforms;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release-date") {
      releaseDate = argv[++index];
    } else if (argv[index] === "--rollout-hours") {
      rolloutHours = Number(argv[++index]);
    } else if (argv[index] === "--platforms") {
      platforms = (argv[++index] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    } else {
      paths.push(argv[index]);
    }
  }

  if (!releaseDate || rolloutHours === undefined || !platforms?.length || paths.length === 0) {
    throw new Error(
      "Usage: node scripts/validate-desktop-manifests.mjs --release-date <date> --rollout-hours <hours> --platforms <mac,windows> <manifest...>",
    );
  }

  return { releaseDate, rolloutHours, platforms, paths };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { releaseDate, rolloutHours, platforms, paths } = parseArgs(process.argv.slice(2));
  validateDesktopManifests({ releaseDate, rolloutHours, platforms }, paths);
}
