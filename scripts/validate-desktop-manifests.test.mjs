import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { validateDesktopManifests } from "./validate-desktop-manifests.mjs";

const releaseDate = "2026-09-04T00:00:00.000Z";
const scriptPath = fileURLToPath(new URL("./validate-desktop-manifests.mjs", import.meta.url));

const validManifest = `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\nminimumSystemVersion: 22.0.0\n`;

function withManifests(files, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-validate-desktop-manifest-"));
  try {
    const paths = Object.entries(files).map(([name, contents]) => {
      const manifestPath = path.join(dir, name);
      writeFileSync(manifestPath, contents);
      return manifestPath;
    });
    run(paths);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function withManifest(contents, run) {
  withManifests({ "latest-mac.yml": contents }, ([manifestPath]) => run(manifestPath));
}

test("accepts a guarded macOS update manifest", () => {
  withManifest(validManifest, (manifestPath) => {
    validateDesktopManifests({ releaseDate, rolloutHours: 36, platforms: ["mac"] }, [manifestPath]);
  });
});

test("validates release manifests through the workflow CLI", () => {
  withManifest(validManifest, (manifestPath) => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--release-date",
        releaseDate,
        "--rollout-hours",
        "36",
        "--platforms",
        "mac",
        manifestPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
  });
});

test("rejects a macOS update manifest without the system floor", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\n`,
    (manifestPath) => {
      assert.throws(
        () =>
          validateDesktopManifests({ releaseDate, rolloutHours: 36, platforms: ["mac"] }, [
            manifestPath,
          ]),
        /minimumSystemVersion=undefined, expected 22\.0\.0/,
      );
    },
  );
});

test("rejects invalid rollout metadata", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 24\nminimumSystemVersion: 22.0.0\n`,
    (manifestPath) => {
      assert.throws(
        () =>
          validateDesktopManifests({ releaseDate, rolloutHours: 36, platforms: ["mac"] }, [
            manifestPath,
          ]),
        /rolloutHours=24, expected 36/,
      );
    },
  );
});

test("accepts a release whose expected platforms all produced a manifest", () => {
  withManifests({ "latest-mac.yml": validManifest, "latest.yml": validManifest }, (paths) => {
    validateDesktopManifests(
      { releaseDate, rolloutHours: 36, platforms: ["mac", "windows"] },
      paths,
    );
  });
});

test("names the platform whose manifest is missing", () => {
  withManifests({ "latest-mac.yml": validManifest }, (paths) => {
    assert.throws(
      () =>
        validateDesktopManifests(
          { releaseDate, rolloutHours: 36, platforms: ["mac", "windows"] },
          paths,
        ),
      /missing updater manifests for: windows/,
    );
  });
});

// 同一份产物集合，只因 Linux 进入期望集合才失败。这是 fork 去掉 Linux 后
// 唯一能证伪「期望集合被忽略」的用例。
test("requires a Linux manifest only when Linux is an expected platform", () => {
  withManifests({ "latest-mac.yml": validManifest, "latest.yml": validManifest }, (paths) => {
    assert.throws(
      () =>
        validateDesktopManifests(
          { releaseDate, rolloutHours: 36, platforms: ["mac", "windows", "linux"] },
          paths,
        ),
      /missing updater manifests for: linux/,
    );
  });
});

test("rejects an unknown expected platform", () => {
  withManifests({ "latest-mac.yml": validManifest }, (paths) => {
    assert.throws(
      () =>
        validateDesktopManifests({ releaseDate, rolloutHours: 36, platforms: ["macos"] }, paths),
      /unknown desktop platform "macos"/,
    );
  });
});

test("fails the workflow CLI when an expected platform manifest is missing", () => {
  withManifests({ "latest-mac.yml": validManifest }, (paths) => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--release-date",
        releaseDate,
        "--rollout-hours",
        "36",
        "--platforms",
        "mac,windows",
        ...paths,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing updater manifests for: windows/);
  });
});

test("requires the workflow CLI to declare expected platforms", () => {
  withManifest(validManifest, (manifestPath) => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--release-date", releaseDate, "--rollout-hours", "36", manifestPath],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--platforms/);
  });
});
