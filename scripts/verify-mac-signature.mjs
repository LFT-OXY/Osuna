import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isMainModule } from "./is-main-module.mjs";

// Squirrel.Mac 只接受满足当前应用 designated requirement 的新包。DR 必须绑定到固定证书
// （ADR 0001）；退回 ad-hoc 时 DR 绑的是 cdhash，发出去会打断所有人的更新链，而
// electron-builder 在这种情况下只打一条 warn。所以发版前在这里硬性把关。

export function normalizeSha1(fingerprint) {
  const hex = String(fingerprint).replaceAll(":", "").trim().toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(hex)) {
    throw new Error(
      `Expected a SHA-1 certificate fingerprint (40 hex chars), got "${fingerprint}"`,
    );
  }
  return hex;
}

// expectedSha1 须已经过 normalizeSha1。返回 null 表示通过，否则返回失败原因。
export function checkDesignatedRequirement(codesignOutput, expectedSha1) {
  // 没有显式 DR 时（ad-hoc），codesign 把隐式 DR 当注释打印：`# designated => cdhash ...`。
  const match = /^(?:# )?designated => (.+)$/m.exec(codesignOutput);
  if (!match) {
    return `No designated requirement found (is the bundle signed?):\n${codesignOutput.trim()}`;
  }
  const requirement = match[1].trim();
  if (/\bcdhash\b/.test(requirement)) {
    return `Designated requirement is pinned to a cdhash (ad-hoc signature): ${requirement}`;
  }
  // 叶证书带 Organization 时 codesign 写 `certificate root`，否则写 `certificate leaf`；
  // 自签证书的链只有一张，两种写法钉的是同一张证书。
  const pinned = /certificate (?:leaf|root) = H"([0-9a-fA-F]{40})"/.exec(requirement);
  if (!pinned || pinned[1].toUpperCase() !== expectedSha1) {
    return `Designated requirement is not pinned to certificate H"${expectedSha1}": ${requirement}`;
  }
  return null;
}

function runTool(command, args) {
  const child = spawnSync(command, args, { encoding: "utf8" });
  if (child.error) throw child.error;
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

function verifyApp(appPath, expectedSha1) {
  const failures = [];
  const requirement = runTool("codesign", ["-d", "-r-", appPath]);
  const requirementFailure = checkDesignatedRequirement(requirement.output, expectedSha1);
  if (requirementFailure) failures.push(requirementFailure);

  const verify = runTool("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  if (verify.status !== 0) {
    failures.push(`codesign --verify --deep --strict failed:\n${verify.output.trim()}`);
  }
  return failures;
}

function appsIn(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".app"))
    .map((name) => path.join(directory, name));
}

function verifyZippedApp(zipPath, extractDir, expectedSha1) {
  const extract = runTool("ditto", ["-x", "-k", zipPath, extractDir]);
  if (extract.status !== 0) return [`ditto failed:\n${extract.output.trim()}`];
  const apps = appsIn(extractDir);
  if (apps.length !== 1) return [`Expected exactly one .app, found ${apps.length}`];
  return verifyApp(apps[0], expectedSha1);
}

// 同时校验打包目录里的 .app（dmg 由它生成）和更新 zip 解出来的 .app（Squirrel 实际
// 安装的就是它，用和 Squirrel 相同的 ditto 解压）。
export function verifyMacRelease(releaseDir, expectedSha1) {
  const results = [];

  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("mac")) {
      for (const appPath of appsIn(path.join(releaseDir, entry.name))) {
        results.push({ target: appPath, failures: verifyApp(appPath, expectedSha1) });
      }
    }
  }

  const zips = readdirSync(releaseDir).filter((name) => name.endsWith(".zip"));
  for (const zip of zips) {
    const target = path.join(releaseDir, zip);
    const extractDir = mkdtempSync(path.join(tmpdir(), "osuna-verify-mac-signature-"));
    try {
      results.push({ target, failures: verifyZippedApp(target, extractDir, expectedSha1) });
    } finally {
      rmSync(extractDir, { force: true, recursive: true });
    }
  }

  const foundNoPackagedApp = results.length === zips.length;
  const missing = [];
  if (foundNoPackagedApp) missing.push("No macOS .app bundle found under mac*/");
  if (zips.length === 0) missing.push("No update .zip found");
  if (missing.length > 0) results.push({ target: releaseDir, failures: missing });
  return results;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const shaIndex = args.indexOf("--cert-sha1");
  const releaseDir = args.find((_, index) => index !== shaIndex && index !== shaIndex + 1);
  if (shaIndex === -1 || !releaseDir || !existsSync(releaseDir)) {
    throw new Error(
      "Usage: node scripts/verify-mac-signature.mjs --cert-sha1 <fingerprint> <release-dir>",
    );
  }
  const expectedSha1 = normalizeSha1(args[shaIndex + 1]);

  let failed = false;
  for (const { target, failures } of verifyMacRelease(releaseDir, expectedSha1)) {
    if (failures.length === 0) {
      console.log(`ok  ${target}`);
      continue;
    }
    failed = true;
    for (const failure of failures) {
      console.log(`::error title=macOS signature check failed::${target}: ${failure}`);
    }
  }
  if (failed) process.exit(1);
}
